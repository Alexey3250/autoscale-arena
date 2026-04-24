import { NextResponse, type NextRequest } from "next/server";

const IS_WORKER = process.env.WORKER_MODE === "true";

/**
 * Next.js 16 renamed `middleware.ts` to `proxy.ts`. We use it to gate routes
 * by mode: one codebase, two deployments.
 *
 *   - Worker pods: `/api/work` is the CPU endpoint. `/api/pods/*` is hidden so
 *     a caller cannot skip the frontend, and `/` returns a plaintext note
 *     instead of the full UI.
 *   - Frontend pods: `/api/work` is handled by the route which forwards to the
 *     worker Service. `/api/pods/*` is exposed for the UI.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (IS_WORKER) {
    if (pathname.startsWith("/api/pods")) {
      return new NextResponse("Not Found", { status: 404 });
    }
    if (pathname === "/") {
      return new NextResponse(
        "This is a worker pod. Visit the frontend route to drive load.\n",
        {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        },
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/api/:path*"],
};
