import { useMemo, type ComponentProps } from "react";
import { useTargetingSession } from "~/hooks/useTargetingSession";
import { targetingSessionNodeIds } from "~/lib/targeting-session";
import BoardArrows from "./board-arrows";
import TargetingArrow from "./targeting-arrow";

/** The board's two arrow layers: the standing target / combat / manual arrows
 *  and, while the viewer chooses a target, the cursor-pinned targeting arrow
 *  (issue #9163). One owner for the open choice, so the standing layer dims
 *  the board around exactly the nodes the targeting arrow offers. */
export default function BoardArrowLayers(
    props: Omit<ComponentProps<typeof BoardArrows>, "targetingNodeIds">
) {
    const session = useTargetingSession();
    // Keyed by content: a re-projected state with the same choice keeps the
    // same set, so the highlight channel is not re-published.
    const nodeKey = session
        ? [...targetingSessionNodeIds(session)].join(",")
        : null;
    const nodeIds = useMemo(
        () =>
            nodeKey === null
                ? null
                : new Set(nodeKey ? nodeKey.split(",") : []),
        [nodeKey]
    );
    return (
        <>
            <BoardArrows {...props} targetingNodeIds={nodeIds} />
            <TargetingArrow session={session} />
        </>
    );
}
