import { tryGetDefinition } from "@convex/cards";
import { tryGetEmblemDefinition } from "@convex/cards/emblems";
import type { CardInstance, Player, StackItem } from "~/types/game";
import { displayCardId } from "~/lib/card-utils";

/** Resolve a stack item's announced targets (CR 601.2c) to display names, for
 *  the stack panel's target LINE (ADR 0103, issue #2727).
 *
 *  **Why a text line exists at all, when the board already draws arrows.** The
 *  readable-stack design deliberately dropped target chips: the board-crossing
 *  SVG arrows (`board-arrows.tsx`) say WHERE the target is, which a name chip
 *  cannot. That still holds on desktop — and this line does not replace the
 *  arrows anywhere. What changed is the phone: in portrait the stack panel is
 *  pinned across the whole viewer half (`PORTRAIT_STACK_PANEL_TOP` →
 *  `NARROW_BOTTOM_CLASS`) and in landscape-compact it covers the right rail, so
 *  whenever the panel is open the arrow's far end is frequently BEHIND it. On
 *  those viewports the arrow is not a substitute for anything, because it isn't
 *  visible. One quiet muted line per row is the smallest thing that answers
 *  "what is this pointed at" without re-introducing a chip row.
 *
 *  Pure and React-free: given the same item and the same seats it always
 *  returns the same names, so the resolution is unit-testable away from the
 *  panel. Unknown ids fall back to nothing rather than to a raw instance id —
 *  a hex string in the middle of a sentence is worse than a shorter sentence. */
export function stackTargetNames(
    item: StackItem,
    allPlayers: readonly Player[],
    stack: readonly StackItem[]
): string[] {
    if (!item.targets || item.targets.length === 0) return [];
    const names: string[] = [];
    for (const target of item.targets) {
        const name = resolveTargetName(target, allPlayers, stack);
        if (name) names.push(name);
    }
    return names;
}

function resolveTargetName(
    target: NonNullable<StackItem["targets"]>[number],
    allPlayers: readonly Player[],
    stack: readonly StackItem[]
): string | null {
    if (target.type === "player") {
        return allPlayers.find((p) => p.id === target.id)?.name ?? null;
    }
    if (target.type === "spell") {
        const spell = stack.find((s) => s.id === target.id);
        // Issue #1735 (round 3) — a face-down spell's `card.id` is the CR
        // 708.2 sentinel for EVERY viewer including the caster; the line is
        // display-only, so it must read `displayCardId`, exactly like
        // `stack-row.tsx`'s own `identityId` for the row this line renders
        // under.
        return spell ? cardName(displayCardId(spell)) : null;
    }
    // Zone-scoped targets (CR 400.7 / 109.2): `playerId` disambiguates WHICH
    // graveyard or hand, and is required on those two types — but a projection
    // that ever omits it must still resolve, so the search widens to every seat
    // rather than returning nothing.
    const seats =
        target.playerId != null
            ? allPlayers.filter((p) => p.id === target.playerId)
            : allPlayers;
    for (const seat of seats) {
        const zone: readonly (CardInstance | null)[] =
            target.type === "graveyard-card"
                ? seat.graveyard
                : target.type === "hand-card"
                  ? seat.hand
                  : seat.battlefield;
        const hit = zone.find((c) => c !== null && c.id === target.id);
        // Only a battlefield hit can be face down (CR 708.7 turns a face-down
        // permanent back face up before it can reach hand/graveyard), but
        // `displayCardId` is a no-op for every non-face-down card, so it is
        // safe to route every zone through the same call rather than
        // special-casing battlefield alone — one fewer branch to forget the
        // NEXT time this file grows a target type.
        if (hit) return cardName(displayCardId(hit));
    }
    return null;
}

/** CR 114 — an emblem-sourced object's `card.id` is an emblem KEY, absent from
 *  the card registry, so the emblem registry is the second lookup rather than
 *  a raw id fallback. */
function cardName(cardId: string): string | null {
    return (
        tryGetDefinition(cardId)?.name ??
        tryGetEmblemDefinition(cardId)?.name ??
        null
    );
}
