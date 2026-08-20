import { useNavigate, useSearch } from "@tanstack/react-router";
import LimitedEventsPage from "~/components/limited/limited-events-page";
import { useDocumentTitle } from "~/hooks/useDocumentTitle";
import type { LimitedEventStatusChip } from "~/lib/limitedEventStatus";

/** `/limited` (issue #2590: absorbs the old `/limited/events`). The route
 *  owns the URL <-> filter-state translation — `useSearch`/`useNavigate` here,
 *  a plain controlled `{ mine, status }` prop pair on the page — so the page
 *  itself stays a pure render/behavior unit the way every other page in this
 *  tree is (`deck-builder.route.tsx` reads `?format=` the same way and hands
 *  the resolved value down rather than letting the child re-derive it). */
export default function LimitedEventsRoute() {
    useDocumentTitle("Limited Events");
    const navigate = useNavigate();
    const search = useSearch({ strict: false }) as {
        mine?: true;
        status?: LimitedEventStatusChip;
    };
    const mine = search.mine === true;
    const status = search.status;

    const onMineChange = (nextMine: boolean) => {
        void navigate({
            to: "/limited",
            search: () => ({
                ...(nextMine ? { mine: true as const } : {}),
                ...(status ? { status } : {}),
            }),
            replace: true,
        });
    };

    // `undefined` clears the filter back to "All" — a real value narrows it.
    const onStatusChange = (nextStatus: LimitedEventStatusChip | undefined) => {
        void navigate({
            to: "/limited",
            search: () => ({
                ...(mine ? { mine: true as const } : {}),
                ...(nextStatus ? { status: nextStatus } : {}),
            }),
            replace: true,
        });
    };

    return (
        <LimitedEventsPage
            mine={mine}
            status={status}
            onMineChange={onMineChange}
            onStatusChange={onStatusChange}
        />
    );
}
