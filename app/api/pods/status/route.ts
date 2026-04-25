import { listPods, mockHpaStatus, mockPods, readHpa, resolvePodSource } from "@/lib/k8s";
import type { PodsSnapshot } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const source = resolvePodSource();
  const snapshot: PodsSnapshot = source.available
    ? await safeList(source)
    : { pods: mockPods(), count: 1, source: "mock", hpaStatus: mockHpaStatus(1) };

  return Response.json(snapshot, {
    headers: { "Cache-Control": "no-store" },
  });
}

async function safeList(
  source: Extract<ReturnType<typeof resolvePodSource>, { available: true }>,
): Promise<PodsSnapshot> {
  try {
    const [pods, hpaStatus] = await Promise.all([
      listPods(source),
      readHpa(source),
    ]);
    return { pods, count: pods.length, source: "cluster", hpaStatus };
  } catch (err) {
    console.error("[pods/status] list failed, falling back to mock", err);
    const pods = mockPods();
    return { pods, count: pods.length, source: "mock", hpaStatus: mockHpaStatus(pods.length) };
  }
}
