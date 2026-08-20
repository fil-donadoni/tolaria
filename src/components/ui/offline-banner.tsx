import { useConvexConnectionState } from "convex/react";
import { Banner } from "@/components/ui/banner";

/**
 * Global "you've lost the connection" strip (issue #2592, PRD #2405 D51).
 * Mounted once at the router root (`router.tsx`, alongside `BugReportButton`)
 * — every route shares one Convex client (`main.tsx`), so one subscription
 * covers the whole app rather than a per-surface one.
 *
 * `useConvexConnectionState` (Convex 1.39+) exposes `isWebSocketConnected` —
 * `false` while the socket is down AND while reconnect backoff is in flight.
 * Gated on `hasEverConnected` so the strip never flashes during the very
 * first connect (that moment already reads as "loading", not "offline" —
 * every route's own `LoadingScreen`/query-`undefined` branch owns it).
 */
export default function OfflineBanner() {
    const { isWebSocketConnected, hasEverConnected } =
        useConvexConnectionState();

    if (!hasEverConnected || isWebSocketConnected) return null;

    return (
        <div className="fixed inset-x-0 top-0 z-modal flex justify-center px-4 pt-[max(env(safe-area-inset-top),0.5rem)]">
            <Banner
                tone="danger"
                role="status"
                aria-live="polite"
                className="w-full max-w-sm justify-center text-center"
            >
                Offline — reconnecting…
            </Banner>
        </div>
    );
}
