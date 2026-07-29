import type { PendingChoiceKind } from "@convex/gre/types";
import type { PendingChoice } from "~/types/game";
import type { MayPayCost } from "@convex/cards/types";
import { normalizeMayPayCost } from "~/lib/card-utils";

/** UI label shown as the source tag on a pending choice prompt
 *  (the bold leading word, e.g. "Sacrifice — choose ...").
 *
 *  Exhaustive `Record<PendingChoiceKind, ...>` typing — adding a new kind
 *  without an entry here is a compile error, so the UI stays in sync with
 *  the engine taxonomy. */
const PENDING_CHOICE_KIND_LABELS: Record<PendingChoiceKind, string> = {
    // zone-pick family
    "keep-permanents": "Keep",
    "sacrifice-permanents": "Sacrifice",
    "keep-hand": "Keep in hand",
    "search-library": "Search",
    "pick-source": "Pick source",
    "untap-pick": "Untap step",
    "discard-hand": "Discard",
    "reorder-library": "Reorder",
    "reveal-hand": "Reveal",
    "choose-permanents": "Choose",
    partition: "Divide",
    "choose-hand-card": "Choose",
    "choose-graveyard-card": "Return",
    // Dauthi Voidwalker (issue #1156) — pick an exiled card to grant a free
    // cast for.
    "choose-exile-card": "Choose",
    "choose-damage-target": "Choose target",
    // trigger-time player target (CR 115.1a — Endurance's "up to one target player")
    "choose-player": "Choose a player",
    "draw-look-keep": "Keep",
    // look-top (Stock Up / Preordain, #942) — look at the top N, pick a subset
    "look-top": "Look",
    // order-top (scry / surveil / ponder drag picker) — order the kept top cards
    "order-top": "Scry",
    // look-distribute (Impulse / Stock Up) — take N to hand, order the rest bottom
    "look-distribute": "Look",
    // legend rule (CR 704.5j)
    "legend-keep": "Legend rule",
    // non-cast Aura host choice (CR 303.4f — Replenish, Living Death)
    "choose-aura-host": "Choose host",
    // yes-no family
    "may-pay": "Optional",
    // land-entry pay-choice (CR 614.12, ADR 0051 — shock lands)
    "land-entry-tapped": "Pay 2 life",
    // order family
    "mulligan-bottom": "Mulligan",
    // simultaneous-trigger ordering (CR 603.3b, ADR 0058)
    "trigger-order": "Order triggers",
    // option family
    "option-pick": "Choose",
    // name-card family (CR 202.3)
    "name-card": "Name a card",
    // random-reveal family (CR 705, ADR 0023)
    "random-reveal": "Coin flip",
    // pile-division divide-then-choose family (ADR 0053)
    "divide-piles": "Divide into piles",
    "pick-pile": "Choose a pile",
    // reflexive Madness cast-choice (CR 702.35d)
    "madness-cast": "Madness",
    // reflexive Rebound cast-choice (CR 702.88a)
    "rebound-cast": "Rebound",
    // draw-reveal pay-choice (CR 614, issue #735 — Zur's Weirding)
    "draw-replacement": "Pay life",
};

export function pendingChoiceLabel(kind: PendingChoiceKind): string {
    return PENDING_CHOICE_KIND_LABELS[kind];
}

/** True when a `may-pay` cost's mana leg demands an actual payment — at least
 *  one non-zero colored/generic pip or a variable `{X}` — as opposed to no
 *  mana leg at all (a pure life/sacrifice/discard/energy cost) or a
 *  degenerate all-zero mana leg. `xFactor` is a multiplier on `X`, never a pip
 *  by itself, so it never trips this on its own. */
function mayPayCostHasPayableManaLeg(cost: MayPayCost | undefined): boolean {
    if (!cost) return false;
    const norm = normalizeMayPayCost(cost);
    if (!norm.mana) return false;
    return Object.entries(norm.mana).some(([key, value]) => {
        if (key === "xFactor") return false;
        if (key === "X") return value !== undefined && value !== 0;
        return typeof value === "number" && value > 0;
    });
}

/** Issue #1813 — does resolving this choice route clicks to a battlefield
 *  permanent? `zone: "battlefield"` (`PendingChoice.zone`) is the
 *  authoritative signal: the UI routes clicks to battlefield permanents for
 *  every such pick — a may-pay sacrifice/threshold leg (`needsSacrificePick` /
 *  `sacrificeThreshold`, `pending-choice-prompt.tsx`), `keep-permanents` /
 *  `sacrifice-permanents` / `choose-permanents`, the non-cast Aura host choice
 *  (`choose-aura-host`, CR 303.4f), etc. This is the click-ROUTING predicate
 *  only — see {@link pendingChoiceRequiresBoardTap} for the (wider) pinning
 *  predicate built on top of it. Shared with `useBattlefieldVisualState.ts`,
 *  `useBattlefieldInteraction.tsx` and `usePendingChoicePrimaryAction.ts`,
 *  which used to each inline `choice.zone === "battlefield"` separately
 *  (review fixup on #1813/#1823) — those sites want ONLY the routing
 *  semantics (does a click on a battlefield card feed this choice?), never
 *  the mana-leg clause below, so they stay on this narrower predicate. */
export function pendingChoiceRoutesToBattlefield(
    choice: PendingChoice
): boolean {
    return choice.zone === "battlefield";
}

/** Issue #1813 (review fixup, #1823) — does resolving this choice require the
 *  chooser to tap a permanent on the mid-board WHILE THE PROMPT IS OPEN? Built
 *  on {@link pendingChoiceRoutesToBattlefield} (every zone==="battlefield"
 *  choice qualifies — nothing new there) PLUS a case that predicate misses
 *  entirely: a `may-pay` whose cost has a payable MANA leg. Those choices are
 *  zone-less BY DESIGN (`convex/gre/state.ts`'s `requestMayPay` only sets
 *  `zone` when the cost's sacrifice/discard leg admits a real victim/card
 *  pick — a mana leg never sets it) — Echo
 *  (`convex/cards/abilities/echo.ts`), cumulative upkeep
 *  (`convex/cards/abilities/cumulativeUpkeep.ts`), and "unless you pay
 *  {mana}" triggers (Sunken City, `convex/cards/sets/drk/blue.ts`) all land
 *  here. Critically, there is NO auto-tap for these: the Pay button only
 *  enables once the mana pool already covers the cost
 *  (`usePendingChoicePrimaryAction.ts`'s `mayPayCanAfford` gate), so the
 *  player MUST tap lands with the prompt still open — a centered banner sits
 *  right over the permanents they need to click. A `hand`/`library`/
 *  `graveyard`/`exile` zone pick, or a truly costless/non-mana zone-less
 *  choice (`option-pick`, `name-card`, plain yes/no, a life-only or
 *  sacrifice/discard-only may-pay), has nothing on the mid-board to cover, so
 *  it's safe to vertically center on portrait like any other non-targeting
 *  prompt. Shared by `pending-choice-prompt.tsx` and
 *  `minimized-choice-indicator.tsx` — both render the SAME `PendingChoice` and
 *  must agree on whether it pins. */
export function pendingChoiceRequiresBoardTap(choice: PendingChoice): boolean {
    return (
        pendingChoiceRoutesToBattlefield(choice) ||
        (choice.kind === "may-pay" && mayPayCostHasPayableManaLeg(choice.cost))
    );
}
