import { readFileSync, existsSync } from "node:fs";
import { AutoscalingV2Api, CoreV1Api, KubeConfig, Watch } from "@kubernetes/client-node";
import type { HpaStatus, PodInfo } from "./types";

const SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";
const SA_NAMESPACE_FILE = `${SA_DIR}/namespace`;
const SA_TOKEN_FILE = `${SA_DIR}/token`;

const WORKER_LABEL = process.env.WORKER_LABEL_SELECTOR ?? "app=autoscale-arena-worker";
const HPA_NAME = process.env.WORKER_HPA_NAME ?? "autoscale-arena-worker";

export interface PodWatchEvent {
  type: "ADDED" | "MODIFIED" | "DELETED" | "SYNC";
  pod: PodInfo;
}

export interface ClusterContext {
  available: true;
  namespace: string;
  kubeConfig: KubeConfig;
  labelSelector: string;
}

export interface MockContext {
  available: false;
  namespace: string;
  labelSelector: string;
}

export type PodSource = ClusterContext | MockContext;

/**
 * Resolve how we will fetch pod data. In-cluster we read the ServiceAccount
 * token and namespace file. Locally we fall back to a mock so `npm run dev`
 * does not require a kubeconfig.
 */
export function resolvePodSource(): PodSource {
  const inCluster = existsSync(SA_TOKEN_FILE) && existsSync(SA_NAMESPACE_FILE);
  if (!inCluster) {
    return {
      available: false,
      namespace: process.env.POD_NAMESPACE ?? "local-dev",
      labelSelector: WORKER_LABEL,
    };
  }

  const namespace = readFileSync(SA_NAMESPACE_FILE, "utf8").trim();
  const kubeConfig = new KubeConfig();
  kubeConfig.loadFromCluster();
  return {
    available: true,
    namespace,
    kubeConfig,
    labelSelector: WORKER_LABEL,
  };
}

export function mockPods(): PodInfo[] {
  // Match the fallback in `runCpuWork`'s response so the client can correlate
  // a tap with the pod that handled it during local dev.
  const host = process.env.HOSTNAME ?? "local-worker";
  return [
    {
      name: host,
      status: "Running",
      ready: true,
      startTime: new Date(Date.now() - 30_000).toISOString(),
      nodeName: "local-node",
    },
  ];
}

interface RawPod {
  metadata?: {
    name?: string;
    deletionTimestamp?: string;
  };
  status?: {
    phase?: string;
    startTime?: string;
    conditions?: Array<{ type?: string; status?: string }>;
    containerStatuses?: Array<{ ready?: boolean; state?: Record<string, unknown> }>;
  };
  spec?: {
    nodeName?: string;
  };
}

export function toPodInfo(raw: RawPod): PodInfo | null {
  const name = raw.metadata?.name;
  if (!name) return null;
  const phase = raw.status?.phase ?? "Unknown";
  const terminating = Boolean(raw.metadata?.deletionTimestamp);
  const readyCond = raw.status?.conditions?.find((c) => c.type === "Ready");
  const containers = raw.status?.containerStatuses ?? [];
  const allContainersReady = containers.length > 0 && containers.every((c) => c.ready === true);
  const ready = !terminating && readyCond?.status === "True" && allContainersReady;

  let status = phase;
  if (terminating) {
    status = "Terminating";
  } else if (containers.length > 0) {
    const waiting = containers.find((c) => {
      const state = c.state as { waiting?: { reason?: string } } | undefined;
      return state?.waiting?.reason;
    });
    if (waiting) {
      const state = waiting.state as { waiting?: { reason?: string } } | undefined;
      status = state?.waiting?.reason ?? phase;
    }
  }

  return {
    name,
    status,
    ready,
    startTime: raw.status?.startTime ?? null,
    nodeName: raw.spec?.nodeName ?? null,
  };
}

/**
 * Fetch a one-shot list of pods matching the worker label.
 *
 * We go through `CoreV1Api` rather than raw `fetch` because the kube-apiserver
 * on OpenShift is fronted by a cluster-internal CA. The @kubernetes/client-node
 * library loads that CA during `loadFromCluster()` and applies it on each
 * request; raw `fetch` would otherwise fail with `SELF_SIGNED_CERT_IN_CHAIN`.
 * (`NODE_EXTRA_CA_CERTS` only works if set before Node starts, so runtime
 * assignment does nothing — don't try that.)
 */
export async function listPods(ctx: ClusterContext): Promise<PodInfo[]> {
  const api = ctx.kubeConfig.makeApiClient(CoreV1Api);
  const res = await api.listNamespacedPod({
    namespace: ctx.namespace,
    labelSelector: ctx.labelSelector,
  });
  return (res.items ?? [])
    .map((item) => toPodInfo(item as RawPod))
    .filter((p): p is PodInfo => p !== null);
}

interface RawHpa {
  spec?: {
    minReplicas?: number;
    maxReplicas?: number;
    metrics?: Array<{
      type?: string;
      resource?: {
        name?: string;
        target?: {
          type?: string;
          averageUtilization?: number;
        };
      };
    }>;
  };
  status?: {
    currentReplicas?: number;
    desiredReplicas?: number;
    lastScaleTime?: string | Date;
    currentMetrics?: Array<{
      type?: string;
      resource?: {
        name?: string;
        current?: { averageUtilization?: number };
      };
    }>;
  };
}

/**
 * Read the HPA driving the worker Deployment. Returns a normalised snapshot
 * the UI can render directly. If RBAC isn't granted (sandbox quirk) or the
 * HPA doesn't exist yet, returns an HpaStatus with `error` set so the caller
 * can render a friendly fallback rather than a crash.
 */
export async function readHpa(ctx: ClusterContext): Promise<HpaStatus> {
  const api = ctx.kubeConfig.makeApiClient(AutoscalingV2Api);
  try {
    const hpa = (await api.readNamespacedHorizontalPodAutoscaler({
      name: HPA_NAME,
      namespace: ctx.namespace,
    })) as RawHpa;
    return toHpaStatus(hpa);
  } catch (err) {
    return {
      currentCpuPercent: null,
      targetCpuPercent: null,
      desiredReplicas: null,
      currentReplicas: null,
      minReplicas: null,
      maxReplicas: null,
      lastScaleTime: null,
      error: errorMessage(err),
    };
  }
}

function toHpaStatus(hpa: RawHpa): HpaStatus {
  const cpuTarget = hpa.spec?.metrics?.find(
    (m) => m.type === "Resource" && m.resource?.name === "cpu",
  );
  const cpuCurrent = hpa.status?.currentMetrics?.find(
    (m) => m.type === "Resource" && m.resource?.name === "cpu",
  );
  const lastScaleTime = hpa.status?.lastScaleTime;
  return {
    currentCpuPercent:
      typeof cpuCurrent?.resource?.current?.averageUtilization === "number"
        ? cpuCurrent.resource.current.averageUtilization
        : null,
    targetCpuPercent:
      typeof cpuTarget?.resource?.target?.averageUtilization === "number"
        ? cpuTarget.resource.target.averageUtilization
        : null,
    desiredReplicas: hpa.status?.desiredReplicas ?? null,
    currentReplicas: hpa.status?.currentReplicas ?? null,
    minReplicas: hpa.spec?.minReplicas ?? null,
    maxReplicas: hpa.spec?.maxReplicas ?? null,
    lastScaleTime:
      lastScaleTime instanceof Date
        ? lastScaleTime.toISOString()
        : typeof lastScaleTime === "string"
          ? lastScaleTime
          : null,
    error: null,
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "unknown error";
  }
}

export function mockHpaStatus(podCount: number): HpaStatus {
  return {
    currentCpuPercent: null,
    targetCpuPercent: 50,
    desiredReplicas: podCount,
    currentReplicas: podCount,
    minReplicas: 1,
    maxReplicas: 10,
    lastScaleTime: null,
    error: "mock",
  };
}

/**
 * Start a Kubernetes watch against the worker label. Returns an AbortController
 * that the caller must abort when the consumer disconnects.
 */
export async function watchPods(
  ctx: ClusterContext,
  onEvent: (event: PodWatchEvent) => void,
  onError: (err: unknown) => void,
): Promise<AbortController> {
  const watch = new Watch(ctx.kubeConfig);
  const path = `/api/v1/namespaces/${ctx.namespace}/pods`;
  const queryParams = { labelSelector: ctx.labelSelector } as Record<string, string>;
  return watch.watch(
    path,
    queryParams,
    (phase: string, apiObj: unknown) => {
      if (phase !== "ADDED" && phase !== "MODIFIED" && phase !== "DELETED") return;
      const pod = toPodInfo(apiObj as RawPod);
      if (!pod) return;
      onEvent({ type: phase as PodWatchEvent["type"], pod });
    },
    (err) => {
      if (err) onError(err);
    },
  );
}
