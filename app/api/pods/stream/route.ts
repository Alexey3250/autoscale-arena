import {
  listPods,
  mockHpaStatus,
  mockPods,
  readHpa,
  resolvePodSource,
  watchPods,
  type ClusterContext,
} from "@/lib/k8s";
import type { HpaStatus, PodInfo } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const HEARTBEAT_MS = 15_000;
const MOCK_EMIT_MS = 5_000;
// HPA controller resyncs every ~15s, but the metrics-server values it reads
// update faster than that, so a tighter poll keeps the gauge feeling live.
const HPA_POLL_MS = 3_000;

interface ClientController {
  send: (event: string | null, data: unknown) => void;
  comment: (text: string) => void;
  close: () => void;
}

export async function GET(request: Request): Promise<Response> {
  const source = resolvePodSource();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const client = makeClient(controller);
      const abort = new AbortController();

      request.signal.addEventListener("abort", () => {
        abort.abort();
        client.close();
      });

      if (source.available) {
        runClusterStream(source, client, abort.signal).catch((err) => {
          console.error("[pods/stream] cluster stream failed", err);
          client.send("error", { message: "cluster stream failed" });
          client.close();
        });
      } else {
        runMockStream(client, abort.signal);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function makeClient(controller: ReadableStreamDefaultController<Uint8Array>): ClientController {
  let closed = false;
  const send: ClientController["send"] = (event, data) => {
    if (closed) return;
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    const prefix = event ? `event: ${event}\n` : "";
    try {
      controller.enqueue(encoder.encode(`${prefix}data: ${payload}\n\n`));
    } catch {
      closed = true;
    }
  };
  const comment: ClientController["comment"] = (text) => {
    if (closed) return;
    try {
      controller.enqueue(encoder.encode(`: ${text}\n\n`));
    } catch {
      closed = true;
    }
  };
  const close: ClientController["close"] = () => {
    if (closed) return;
    closed = true;
    try {
      controller.close();
    } catch {
      // Already closed.
    }
  };
  return { send, comment, close };
}

async function runClusterStream(
  ctx: ClusterContext,
  client: ClientController,
  signal: AbortSignal,
): Promise<void> {
  const pods = new Map<string, PodInfo>();
  let hpaStatus: HpaStatus | null = null;

  const emit = () => {
    const list = Array.from(pods.values()).sort(comparePods);
    client.send(null, {
      pods: list,
      count: list.length,
      source: "cluster",
      hpaStatus,
    });
  };

  try {
    const initial = await listPods(ctx);
    for (const pod of initial) pods.set(pod.name, pod);
  } catch (err) {
    console.error("[pods/stream] initial list failed", err);
    client.send("error", { message: "initial pod list failed" });
  }

  // Kick off the first HPA read inline so the first SSE message already
  // carries CPU/replica numbers; otherwise the gauge would render blank for
  // up to HPA_POLL_MS on connect.
  hpaStatus = await readHpa(ctx).catch(() => null);
  emit();

  const heartbeat = setInterval(() => client.comment("heartbeat"), HEARTBEAT_MS);
  const hpaPoll = setInterval(async () => {
    try {
      const next = await readHpa(ctx);
      // Skip emit if nothing meaningful changed; reduces SSE chatter when the
      // HPA is steady-state.
      if (!hpaEqual(next, hpaStatus)) {
        hpaStatus = next;
        emit();
      } else {
        hpaStatus = next;
      }
    } catch (err) {
      console.error("[pods/stream] hpa poll failed", err);
    }
  }, HPA_POLL_MS);

  const watchAbort = await watchPods(
    ctx,
    ({ type, pod }) => {
      if (type === "DELETED") {
        pods.delete(pod.name);
      } else {
        pods.set(pod.name, pod);
      }
      emit();
    },
    (err) => {
      // Kube watches routinely end (resource version expiry, network). Tell
      // the browser to reconnect so a fresh watch starts cleanly.
      console.error("[pods/stream] watch ended", err);
      client.send("error", { message: "watch ended" });
      clearInterval(heartbeat);
      clearInterval(hpaPoll);
      client.close();
    },
  );

  signal.addEventListener("abort", () => {
    clearInterval(heartbeat);
    clearInterval(hpaPoll);
    watchAbort.abort();
    client.close();
  });
}

function hpaEqual(a: HpaStatus | null, b: HpaStatus | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.currentCpuPercent === b.currentCpuPercent &&
    a.targetCpuPercent === b.targetCpuPercent &&
    a.desiredReplicas === b.desiredReplicas &&
    a.currentReplicas === b.currentReplicas &&
    a.minReplicas === b.minReplicas &&
    a.maxReplicas === b.maxReplicas &&
    a.lastScaleTime === b.lastScaleTime &&
    a.error === b.error
  );
}

function runMockStream(client: ClientController, signal: AbortSignal): void {
  const emit = () => {
    const pods = mockPods();
    client.send(null, {
      pods,
      count: pods.length,
      source: "mock",
      hpaStatus: mockHpaStatus(pods.length),
    });
  };
  emit();
  const heartbeat = setInterval(() => client.comment("heartbeat"), HEARTBEAT_MS);
  const refresh = setInterval(emit, MOCK_EMIT_MS);
  signal.addEventListener("abort", () => {
    clearInterval(heartbeat);
    clearInterval(refresh);
    client.close();
  });
}

function comparePods(a: PodInfo, b: PodInfo): number {
  const aTime = a.startTime ? Date.parse(a.startTime) : 0;
  const bTime = b.startTime ? Date.parse(b.startTime) : 0;
  if (bTime !== aTime) return bTime - aTime;
  return a.name.localeCompare(b.name);
}
