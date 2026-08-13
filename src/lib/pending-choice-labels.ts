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
    // choose-categorized (issue #1945, Noxious Vapors / Planar Overlay) —
    // per-category pick from the chooser's own hand/battlefield.
    "choose-categorized": "Choose",
    // legend rule (CR 704.5j)
    "legend-keep": "Legend rule",
    // non-cast Aura host choice (CR 303.4f — Replenish, Living Death)
    "choose-aura-host": "Choose host",
    // yes-no family (CR 117.3a / 118.4 — including the ADR 0079 permanent
    // leg's sacrifice/return pick, worded by `mayPayPermanentPickVerb`)
    "may-pay": "Optional",
    // land-entry pay-choice (CR 614.12, ADR 0051 — shock lands)
    "land-entry-tapped": "Pay 2 life",
    // order family
    "mulligan-bottom": "Mulligan",
    // simultaneous-trigger ordering (CR 603.3b, ADR 0058)
    "trigger-order": "Order triggers",
    // option family
    "option-pick": "Choose",
    // modal triggered ability's announce-time mode (CR 603.3c)
    "trigger-mode": "Choose a mode",
    // name-card family (CR 202.3)
    "name-card": "Name a card",
    // random-reveal family (CR 705, ADR 0023)
    "random-reveal": "Coin flip",
    // pile-division divide-then-choose family (ADR 0053)
    "divide-piles": "Divide into piles",
    "pick-pile": "Choose a pile",
    // reflexive Madness cast-choice (CR 702.35a)
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
 *  one non-zero colored/generic pip, a variable `{X}`, a guild-hybrid pip
 *  (CR 202.1a — `{B/G}`), or a Phyrexian pip (CR 107.4f — `{U/P}`) — as
 *  opposed to no mana leg at all (a pure life/sacrifice/discard/energy cost)
 *  or a degenerate all-zero/empty mana leg. `xFactor` is a multiplier on `X`,
 *  never a pip by itself, so it never trips this on its own. Every pip shape
 *  is board-tap-relevant: a hybrid or Phyrexian pip is still payable with
 *  mana (Phyrexian ALSO with 2 life, but the mana option alone is enough to
 *  make this a "player may need to tap lands with the prompt open" case) —
 *  before this fixup (#1823 review), `hybrid` (an array) and `phyrexian` (an
 *  object) both silently failed the `typeof value === "number"` check below
 *  and were ignored: a false negative, unreachable today (no shipped card
 *  routes a hybrid/Phyrexian-only leg through `may-pay`) but silent should
 *  one ever land. */
function mayPayCostHasPayableManaLeg(cost: MayPayCost | undefined): boolean {
    if (!cost) return false;
    const norm = normalizeMayPayCost(cost);
    if (!norm.mana) return false;
    const { hybrid, phyrexian, ...pips } = norm.mana;
    if (hybrid && hybrid.length > 0) return true;
    if (phyrexian && Object.values(phyrexian).some((n) => (n ?? 0) > 0)) {
        return true;
    }
    return Object.entries(pips).some(([key, value]) => {
        if (key === "xFactor") return false;
        if (key === "X") return value !== undefined && value !== 0;
        return typeof value === "number" && value > 0;
    });
}

/** The terminal action a `may-pay` battlefield pick performs, as the verb the
 *  pick-progress hint uses (CR 701.16 "sacrifice" / 701.24 "return", ADR 0079).
 *  Reads `PendingChoice.permanentAction` — denormalized server-side onto the
 *  choice by `requestMayPay`, so the prompt never re-derives it from the cost
 *  union and cannot drift from what the submit boundary will accept. This is
 *  the field's ONLY consumer; the bot reads `cost.permanent` directly. Defaults
 *  to `"sacrifice"`, the shape every pre-ADR-0079 may-pay had. */
export function mayPayPermanentPickVerb(choice: PendingChoice): string {
    return choice.permanentAction === "return" ? "return" : "sacrifice";
}

/** Full pick-progress hint for a `may-pay` PERMANENT leg: "N / M selected —
 *  click a permanent to sacrifice|return". One place so the sacrifice and
 *  return legs can never word themselves differently. */
export function mayPayPermanentPickHint(
    choice: PendingChoice,
    selected: number,
    required: number
): string {
    return `${selected} / ${required} selected — click a permanent to ${mayPayPermanentPickVerb(choice)}`;
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
 *  prompt. Called from `pending-choice-prompt.tsx` to pick its `pinned`
 *  branch. `minimized-choice-indicator.tsx` does NOT call this predicate — its
 *  collapsed badge is ALWAYS `pinned: true` regardless of `choice.kind`
 *  (review fixup #1823): minimizing exists specifically to clear the
 *  mid-board, so a centered badge would defeat that for every choice, not
 *  just the ones this predicate would pin anyway. */
export function pendingChoiceRequiresBoardTap(choice: PendingChoice): boolean {
    return (
        pendingChoiceRoutesToBattlefield(choice) ||
        (choice.kind === "may-pay" && mayPayCostHasPayableManaLeg(choice.cost))
    );
}
