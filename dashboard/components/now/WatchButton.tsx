import { useRef } from "react";
import { CONTROL_CLASS } from "../../lib/controls";
import { openWatch } from "../../lib/watch";

/**
 * Opens the session tail drawer on one session (issue #3135, ported in S2).
 *
 * `data-watch` is load-bearing and not decoration: the drawer closes on a
 * click outside itself, and a click on ANOTHER row's Watch must SWITCH it
 * rather than close it. `TailDrawer` recognises that click by this attribute,
 * so the marker has to be on the element the pointer actually lands on.
 */
export function WatchButton({
    session,
    label,
    issue = null,
}: {
    session: string;
    label: string;
    issue?: number | null;
}) {
    const ref = useRef<HTMLButtonElement>(null);
    return (
        <button
            ref={ref}
            type="button"
            data-watch={session}
            className={CONTROL_CLASS}
            aria-label={`Watch ${label}`}
            onClick={() =>
                openWatch({ session, label, issue, opener: ref.current })
            }
        >
            Watch
        </button>
    );
}
