import { useEffect } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import LoadingScreen from "~/components/ui/loading-screen";
import { useDocumentTitle } from "~/hooks/useDocumentTitle";

/** `/limited/events` (issue #2590) — retired as its own page, kept as a
 *  redirect stub so a bookmarked/shared link still lands somewhere real. The
 *  merged `/limited` list absorbed the "every event I've ever sat at" view
 *  in the hub's "Your events" and History (see `limited-events.route.tsx`, issue
 *  #5388), so this route's entire job is one unconditional redirect to
 *  `/limited`.
 *
 *  Unconditional (no `sessionStorage` one-shot marker needed, unlike
 *  `useDraftRoomRedirect`): there is no "stay put after leaving" concern here
 *  — the route has nothing else to offer, ever, so every visit redirects.
 *
 *  Renders `LoadingScreen` rather than `null` while the effect fires so the
 *  route still has a static root element (the shell-height census in
 *  `shell-height-claims.guard.test.tsx` asserts every registered route root
 *  reaches the bottom of its own content) and so a slow navigation shows
 *  something instead of a blank flash. */
export default function LimitedYourEventsRoute() {
    useDocumentTitle("Your Limited Events");
    const navigate = useNavigate();
    // The fixture-label filter survives the redirect (issue #2822): the
    // `limited-your-events` walk enters at `/limited/events?label=ui-gate/`,
    // and a redirect that dropped the param would land it on the unbounded
    // list — measuring the deployment's own events, which is the bug.
    const { label } = useSearch({ strict: false }) as { label?: string };

    useEffect(() => {
        void navigate({
            to: "/limited",
            search: label ? { label } : {},
            replace: true,
        });
    }, [navigate, label]);

    return <LoadingScreen />;
}
