import { mockHpaStatus, readHpa, resolvePodSource } from "@/lib/k8s";
import type { HpaStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One-shot HPA snapshot. Same shape as the `hpaStatus` field on the pods
 * stream — exposed independently so curl / dashboards can poll without
 * subscribing to SSE.
 */
export async function GET(): Promise<Response> {
  const source = resolvePodSource();
  const status: HpaStatus = source.available
    ? await readHpa(source)
    : mockHpaStatus(1);

  return Response.json(status, {
    headers: { "Cache-Control": "no-store" },
  });
}
