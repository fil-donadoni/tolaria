// Manual drag-drop resolution (PRD #2162, issue #2169).
//
// The hand-written manual board resolved a drop against a bespoke element tree
// (`data-manual-zone` / `data-card-id` on its own markup). That tree is gone
// with the swap, so the drop is re-based on the SHARED surface's own inert
// hit-test handles (`data-zone-drop` / `data-zone-owner` on the four bands and
// the three pile tiles, `data-arrow-anchor-permanent` on a battlefield card).
// Reading the DOM is the hook's job; deciding what the drop MEANS is this
// module's, so the decision is testable without a browser.
//
// Precedence:
//   1. dropped ON another permanent → attach (Aura / Equipment),
//   2. a clearly VERTICAL drag that starts AND lands on the battlefield → set
//      the combat / main lane,
//   3. otherwise, a drop over a different zone → move the card there.
//
// Rules 1 and 3 are the deleted `resolveDrop`'s. **Rule 2 deliberately
// diverges from it.** The old rule was `isVertical && card.zone ===
// "battlefield"` → set the lane and return, with no constraint on where the
// pointer was released (`manual-board.tsx:403-408`). Here it additionally
// requires the drop point to be over the battlefield or over nothing
// (`probe.zone === null || probe.zone === "battlefield"`), so a vertical drag
// off the battlefield into the hand band falls through to a zone MOVE where the
// old board silently changed the lane instead. The shared surface is what makes
// the old rule wrong: its four zone bands are stacked vertically and directly
// adjacent, so "drag a permanent straight up/down" and "drag a permanent into
// the neighbouring zone" are the same gesture shape — on the deleted flat
// thumbnail grid they were not.
//
// Pure: no Convex, no React, no DOM.

import type { ManualZone, ProjectedManualCard } from "@convex/manual";
import type { ManualDispatch } from "./manual-runtime";

/** How much of the gesture must be vertical before it reads as a lane change
 *  rather than a zone move. */
const VERTICAL_RATIO = 1.5;
/** Upward travel (px) that reads as "put this in the combat row". */
const COMBAT_LIFT_PX = 40;

/** What the DOM under the drop point resolved to. */
export type ManualDropProbe = {
    /** Instance id of a battlefield permanent under the drop point, if any. */
    permanentId: string | null;
    /** The zone whose drop band / pile tile is under the drop point. */
    zone: ManualZone | null;
    /** Which seat owns that zone. */
    zoneOwnerId: string | null;
};

export type ManualDrop =
    | { kind: "attach"; instanceId: string; targetId: string }
    | { kind: "lane"; instanceId: string; lane: "main" | "combat" }
    | { kind: "move"; instanceId: string; toZone: ManualZone }
    | null;

export function resolveManualDrop(args: {
    card: ProjectedManualCard;
    probe: ManualDropProbe;
    dx: number;
    dy: number;
}): ManualDrop {
    const { card, probe, dx, dy } = args;

    // 1. Attach — dropping one permanent onto another. `data-arrow-anchor-
    //    permanent` only ever renders on a battlefield card, so a hit here IS
    //    a battlefield permanent by construction.
    if (probe.permanentId && probe.permanentId !== card.id) {
        return {
            kind: "attach",
            instanceId: card.id,
            targetId: probe.permanentId,
        };
    }

    // 2. Lane — a vertical drag that stays on the battlefield.
    const isVertical = Math.abs(dy) > Math.abs(dx) * VERTICAL_RATIO;
    if (
        isVertical &&
        card.zone === "battlefield" &&
        (probe.zone === null || probe.zone === "battlefield")
    ) {
        return {
            kind: "lane",
            instanceId: card.id,
            lane: dy < -COMBAT_LIFT_PX ? "combat" : "main",
        };
    }

    // 3. Zone move. A card may always go to its owner's own zones; the
    //    battlefield is the one zone another seat's card may be dropped on
    //    (a stolen permanent, a token handed over) — the same allowance the
    //    deleted `resolveDrop` made.
    if (probe.zone && probe.zone !== card.zone) {
        const ownZone = probe.zoneOwnerId === card.ownerId;
        if (ownZone || probe.zone === "battlefield") {
            return { kind: "move", instanceId: card.id, toZone: probe.zone };
        }
    }
    return null;
}

/** Dispatches a resolved drop. Split from {@link resolveManualDrop} so the
 *  decision can be asserted without stubbing a dispatcher, and the dispatch
 *  can be asserted without stubbing the DOM. */
export function applyManualDrop(
    drop: ManualDrop,
    dispatch: ManualDispatch
): void {
    if (!drop) return;
    if (drop.kind === "attach") {
        dispatch.attach({
            instanceId: drop.instanceId,
            targetId: drop.targetId,
        });
        return;
    }
    if (drop.kind === "lane") {
        dispatch.setLane({ instanceId: drop.instanceId, lane: drop.lane });
        return;
    }
    dispatch.moveCard({ instanceId: drop.instanceId, toZone: drop.toZone });
}
