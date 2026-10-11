import { useNavigate, useSearch } from "@tanstack/react-router";
import LimitedEventsPage from "~/components/limited/limited-events-page";
import { useDocumentTitle } from "~/hooks/useDocumentTitle";
import type { LimitedEventStatusChip } from "~/lib/limitedEventStatus";

/** `/limited` — the hub (PRD #5383, issue #5388). The route owns the URL <->
 *  filter-state translation — `useSearch`/`useNavigate` here, a plain
 *  controlled `status` prop on the page — so the page itself stays a pure
 *  render/behavior unit the way every other page in this tree is
 *  (`deck-builder.route.tsx` reads `?format=` the same way and hands the
 *  resolved value down rather than letting the child re-derive it). */
export default function LimitedEventsRoute() {
    useDocumentTitle("Limited Events");
    const navigate = useNavigate();
    const search = useSearch({ strict: false }) as {
        status?: LimitedEventStatusChip;
        label?: string;
    };
    const status = search.status;
    // Fixture-label prefix (issue #2822). Carried through the chip handler
    // below rather than read once and dropped: a filtered view that silently
    // un-filters itself the moment the walk (or a human) touches a chip would
    // put the deployment's real events back in the measurement.
    const label = search.label;

    // `undefined` clears back to the plain hub — a real value narrows it.
    const onStatusChange = (nextStatus: LimitedEventStatusChip | undefined) => {
        void navigate({
            to: "/limited",
            search: () => ({
                ...(nextStatus ? { status: nextStatus } : {}),
                ...(label ? { label } : {}),
            }),
            replace: true,
        });
    };

    return (
        <LimitedEventsPage
            status={status}
            label={label}
            onStatusChange={onStatusChange}
        />
    );
}
