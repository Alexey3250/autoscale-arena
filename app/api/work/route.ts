import { existsSync } from "node:fs";
import { runCpuWork } from "@/lib/cpuWork";
import { recordWork } from "@/lib/metrics";
import type { WorkResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface WorkRequestBody {
  intensity?: number;
}

const IS_WORKER = process.env.WORKER_MODE === "true";
const WORKER_SERVICE_URL = process.env.WORKER_SERVICE_URL ?? "http://autoscale-arena-worker:3000";
// Running outside a cluster means there is no worker Service to forward to,
// so the local dev experience would be broken if we strictly proxied. Detect
// the absence of a ServiceAccount mount and run the CPU loop in-process.
const IS_IN_CLUSTER = existsSync("/var/run/secrets/kubernetes.io/serviceaccount/token");

export async function POST(request: Request): Promise<Response> {
  if (!IS_WORKER && IS_IN_CLUSTER) {
    return forwardToWorker(request);
  }

  const intensity = await readIntensity(request);
  const { durationMs, iterations } = await runCpuWork(intensity);
  const timestamp = Date.now();
  recordWork({ timestamp, durationMs });

  const payload: WorkResponse = {
    podName: process.env.HOSTNAME ?? "local-worker",
    durationMs,
    timestamp,
    iterations,
  };
  return Response.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}

async function readIntensity(request: Request): Promise<number> {
  const contentLength = request.headers.get("content-length");
  if (!contentLength || contentLength === "0") return 1;
  try {
    const body = (await request.json()) as WorkRequestBody;
    if (typeof body.intensity === "number" && Number.isFinite(body.intensity)) {
      return Math.min(5, Math.max(0.25, body.intensity));
    }
  } catch {
    // Ignore malformed body; treat as default intensity.
  }
  return 1;
}

async function forwardToWorker(request: Request): Promise<Response> {
  // Frontend deployments forward the tap to the worker Service. Using the
  // raw request body preserves intensity overrides without re-parsing.
  const body = await request.text();
  try {
    const upstream = await fetch(`${WORKER_SERVICE_URL}/api/work`, {
      method: "POST",
      headers: {
        "Content-Type": request.headers.get("content-type") ?? "application/json",
      },
      body: body.length > 0 ? body : undefined,
      cache: "no-store",
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[api/work] upstream fetch failed", err);
    return Response.json(
      { error: "worker unreachable", detail: String(err) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
