import { readFileSync, existsSync } from "node:fs";
import { KubeConfig, Watch } from "@kubernetes/client-node";
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
 * Fetch a one-shot list of pods matching the worker label. Uses the raw REST
 * endpoint so we can reuse the same auth the Watch does without touching the
 * heavyweight generated API surface.
 */
export async function listPods(ctx: ClusterContext): Promise<PodInfo[]> {
  const cluster = ctx.kubeConfig.getCurrentCluster();
  if (!cluster) throw new Error("no current cluster in kubeconfig");
  const url = new URL(
    `/api/v1/namespaces/${ctx.namespace}/pods`,
    cluster.server,
  );
  url.searchParams.set("labelSelector", ctx.labelSelector);

  const token = readFileSync(SA_TOKEN_FILE, "utf8").trim();
  const caPath = `${SA_DIR}/ca.crt`;

  // Node 20+ fetch honours NODE_EXTRA_CA_CERTS; OpenShift mounts the CA into
  // the SA dir but not into the process trust store. We still point at it for
  // clarity in case the cluster ships a non-default CA.
  if (existsSync(caPath) && !process.env.NODE_EXTRA_CA_CERTS) {
    process.env.NODE_EXTRA_CA_CERTS = caPath;
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`list pods failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { items?: RawPod[] };
  return (body.items ?? [])
    .map(toPodInfo)
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
