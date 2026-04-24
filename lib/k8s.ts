import { readFileSync, existsSync } from "node:fs";
import { CoreV1Api, KubeConfig, Watch } from "@kubernetes/client-node";
import type { PodInfo } from "./types";

const SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";
const SA_NAMESPACE_FILE = `${SA_DIR}/namespace`;
const SA_TOKEN_FILE = `${SA_DIR}/token`;

const WORKER_LABEL = process.env.WORKER_LABEL_SELECTOR ?? "app=autoscale-arena-worker";

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
  const host = process.env.HOSTNAME ?? "local-worker-0";
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
