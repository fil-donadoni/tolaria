// CR 105.2 / 118.5 / 702.34e — single-authority eligibility check for an
// "exile cards from your graveyard/hand" CAST cost picker (delve, escape,
// flashback). Lives outside the GRE and outside `convex/game.ts` so it can be
// shared, unchanged, by the server mutation, the human picker dialog, and the
// bot's view builder — the same single-authority shape as
// `getLegalTargets == selectTarget` (issue #1659). Before this file existed,
// `convex/game.ts`'s `graveyardCardMatchesColor` and
// `src/components/board/cast-exile-cost-dialog.tsx`'s `eligible` memo each
// re-derived the colour check inline, and `src/lib/ai/bot-view.ts`'s
// `buildCastExileChoiceView` skipped it entirely — the bot could submit a
// colour-ineligible instance id the mutation would then reject.

import { tryGetDefinition } from "./index";
import { cardHasColor } from "./colors";
import type { Color } from "./types";

/** Minimal card shape this check needs. Both the full client `CardInstance`
 *  (`~/types/game`, used by the dialog) and the wire-slim `SlimCardInstance`
 *  (`convex/gameProjections`, used by the bot's view builder) structurally
 *  satisfy this — no cast required at either call site. */
export interface ExileCostCandidate {
    id: string;
    card: { id: string };
}

/** True iff `card` is a legal pick for an exile-from-graveyard/hand CAST cost:
 *  never the card paying its own cost (CR 702.34e — `excludeInstanceId`), and
 *  — when the cost carries a colour filter (Flash of Insight's "exile X BLUE
 *  cards from your graveyard") — matching the card's actual printed COLOUR
 *  ({@link cardHasColor}, CR 105.2 / 202.2), NOT its deck-builder colour
 *  identity: an Island taps for blue but is colourless. `color` undefined
 *  matches any card (delve has no colour filter). A card whose definition
 *  can't be resolved is never eligible (a token has no graveyard existence,
 *  CR 111.7). Mirrors `convex/game.ts`'s `graveyardCardMatchesColor` +
 *  `excludeInstanceId` check exactly — the server enforces this same pair at
 *  `recordCastExileCostPick` commit. */
export function isExileCostEligible(
    card: ExileCostCandidate,
    excludeInstanceId: string,
    color: Color | undefined
): boolean {
    if (card.id === excludeInstanceId) return false;
    if (color === undefined) return true;
    const def = tryGetDefinition(card.card.id);
    return def ? cardHasColor(def, color) : false;
}
