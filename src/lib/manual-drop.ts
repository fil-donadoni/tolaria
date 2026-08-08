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
//   0. dropped ON another permanent WITH the shift key held → point an arrow
//      at it (issue #2171) — a player declaring an attack or a target to
//      their opponent, never persisted as an attachment,
//   1. dropped ON another permanent (no shift) → attach (Aura / Equipment),
//   2. a clearly VERTICAL drag that starts AND lands on the battlefield → set
//      the combat / main lane,
//   2b. a clearly HORIZONTAL drag that starts AND lands on the battlefield,
//      on a permanent NOT in the combat lane → place it in the left or the
//      right column of the back row (the manual stand-in for the GRE board's
//      automatic land/non-land split),
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
    /** Where across the drop band the pointer landed, 0 (left edge) to 1
     *  (right edge). `null` when the drop was over no band. Drives the back
     *  row's two-column placement — see rule 2b. */
    zoneFraction?: number | null;
};

export type ManualDrop =
    | { kind: "attach"; instanceId: string; targetId: string }
    | { kind: "arrow"; instanceId: string; targetId: string }
    | { kind: "lane"; instanceId: string; lane: "main" | "combat" }
    | { kind: "column"; instanceId: string; column: "left" | "right" }
    | { kind: "move"; instanceId: string; toZone: ManualZone }
    | null;

export function resolveManualDrop(args: {
    card: ProjectedManualCard;
    probe: ManualDropProbe;
    dx: number;
    dy: number;
    /** Held during the drop (issue #2171): turns a permanent-onto-permanent
     *  drop into an arrow declaration instead of an attach. */
    shiftKey?: boolean;
}): ManualDrop {
    const { card, probe, dx, dy, shiftKey } = args;

    // 0/1. Dropping one permanent onto another: shift held → point an arrow
    //    at it (#2171); otherwise attach (Aura / Equipment). `data-arrow-
    //    anchor-permanent` only ever renders on a battlefield card, so a hit
    //    here IS a battlefield permanent by construction.
    if (probe.permanentId && probe.permanentId !== card.id) {
        return {
            kind: shiftKey ? "arrow" : "attach",
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

    // 2b. Column — a HORIZONTAL drag that stays on the battlefield picks one
    //    of the back row's two columns. The GRE board splits that row
    //    automatically (lands flush-left, other noncreatures flush-right,
    //    `splitRowLayout`); a Manual Game cannot, because that split needs to
    //    know a card is a land and the Full Catalogue misses the printing
    //    outright for a large share of the ids in play — the row sorted itself
    //    half-right and read as arbitrary. So the player places it, with the
    //    same gesture that already sets the lane, on the other axis. A card in
    //    the COMBAT lane is unaffected: it is not in the back row at all, and
    //    a sideways nudge there must not silently reassign it.
    if (
        !isVertical &&
        card.zone === "battlefield" &&
        card.lane !== "combat" &&
        (probe.zone === null || probe.zone === "battlefield") &&
        probe.zoneFraction !== undefined &&
        probe.zoneFraction !== null
    ) {
        return {
            kind: "column",
            instanceId: card.id,
            column: probe.zoneFraction < 0.5 ? "left" : "right",
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
    if (drop.kind === "arrow") {
        dispatch.setArrow({
            instanceId: drop.instanceId,
            targetId: drop.targetId,
        });
        return;
    }
    if (drop.kind === "lane") {
        dispatch.setLane({ instanceId: drop.instanceId, lane: drop.lane });
        return;
    }
    if (drop.kind === "column") {
        dispatch.setBackColumn({
            instanceId: drop.instanceId,
            column: drop.column,
        });
        return;
    }
    dispatch.moveCard({ instanceId: drop.instanceId, toZone: drop.toZone });
}
