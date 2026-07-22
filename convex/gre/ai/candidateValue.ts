// Shared "worth of a card" reads for the choice-node seam (PRD #1423, issue
// #1425). Both the per-kind candidate generator's structural hints
// (`choiceCandidates.ts`) and the DSL `priorFor` provider (`choicePriors.ts`,
// issue #1433) score a card through the SAME functions here, so a
// candidate's `hint` (what the prior seam is told) and the prior itself never
// drift apart — one source, read by both.
//
// A creature — on the battlefield OR still prospective in hand/library — is
// scored by `permanentWorth`: live EFFECTIVE P/T (CR 613, the layer system),
// genuinely context-aware by construction. A noncreature is scored through
// OP_VALUERS' per-Op value model (PRD #1423, issue #1426): a card WITH a real
// `effects[]`/`aiEffects` script is valued by what it actually DOES (a burn
// spell outranks a cantrip outranks a do-nothing enchantment) — issue #1433's
// fix for the bug class "every noncreature priced flat at 30" (a tutor used
// to rank a 3/3 body above a real removal/ramp spell). A card with NEITHER a
// real nor a shadow script floors at the v1 flat prior — the documented
// fallback for "no Op maps" (issue #1433's acceptance criterion), covering
// pre-DSL `resolve()` / `effect`-shorthand cards the migration hasn't reached
// (e.g. Black Lotus's mana ability, an `effect:` shorthand).

import type { CardInstanceState, GameState } from "../state";
import { getPlayer } from "../state";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { tryGetDefinition } from "../../cards";
import { dslSpellScriptOpValue } from "./cardScriptValue";
import type { GroundingContext } from "./grounding";
import type { OpValue } from "./featureBasis";

/** Rough board worth of a permanent — used to order sacrifice/discard
 *  victims AND search-library leads. Deliberately local/cheap (P/T based)
 *  rather than the full `evaluate.ts` currency: `gre/ai` must not depend on
 *  `evaluate.ts` (which already depends on this module's siblings). */
export function permanentWorth(
    state: GameState,
    card: CardInstanceState
): number {
    const p = Math.max(0, getEffectivePower(state, card));
    const t = Math.max(0, getEffectiveToughness(state, card));
    return card.types.includes("Creature") ? p * p + t * t + 10 : 20;
}

/** No-script flat floor — the v1 heuristic's flat noncreature prior (issue
 *  #1425), preserved as the honest fallback for a card the DSL layer has no
 *  opinion on (issue #1433: "heuristics may remain as fallback where no Op
 *  maps"). Also the floor a real script can never read BELOW — a script the
 *  current Op vocabulary undervalues never scores worse than "unknown". */
const NONCREATURE_FLOOR = 30;

/** Rescales OP_VALUERS' Forge-scale points (`opValuers.ts`'s currency — a
 *  representative burn spell ≈ 66-110, `DESTROY_VALUE` = 160) onto this
 *  module's smaller "board-worth" currency (`permanentWorth`'s scale — a 2/2
 *  ≈ 18, a 6/4 ≈ 62), so a mixed creature/noncreature candidate pool ranks on
 *  ONE consistent scale rather than two incompatible ones (issue #1433). */
const NONCREATURE_SCRIPT_SCALE = 1 / 3;

/** The registry-derived Op-valued script (`{ points, tags }`) of a card
 *  instance's DEFINITION, under a given grounding context — `undefined` for
 *  an unregistered id or a card with neither a real `effects[]` nor an
 *  `aiEffects` shadow script. Reads the definition off the card's registry
 *  id, never the (wire-strippable) fat `card.card` blob. Exposed so a
 *  context-aware caller (the `priorFor` seam) can read the TAGS (e.g.
 *  `boardRemoval` + `targeted`) without re-deriving them. */
export function scriptOpValueOf(
    card: CardInstanceState,
    ctx?: GroundingContext
): OpValue | undefined {
    const defId = (card.card as { id?: string }).id;
    if (!defId) return undefined;
    const def = tryGetDefinition(defId);
    return def ? dslSpellScriptOpValue(def, ctx) : undefined;
}

/** Latent worth of a NONCREATURE hand/library card (issue #1433's fix for the
 *  "every noncreature priced flat at 30" bug class): the OP_VALUERS
 *  spell-script value (context-free — the card's worth before it's cast) when
 *  the card has a real/shadow script, rescaled onto this module's currency
 *  and floored at the v1 flat prior. */
export function noncreatureCardWorth(card: CardInstanceState): number {
    const scripted = scriptOpValueOf(card);
    if (!scripted) return NONCREATURE_FLOOR;
    return Math.max(
        NONCREATURE_FLOOR,
        scripted.points * NONCREATURE_SCRIPT_SCALE
    );
}

/** Latent worth of a prospective card (hand/library — not yet in play):
 *  creatures reuse `permanentWorth` (off the battlefield, `getEffectivePower`
 *  degrades to the definition's base stats); noncreatures reuse
 *  `noncreatureCardWorth`. */
export function prospectiveCardWorth(
    state: GameState,
    card: CardInstanceState
): number {
    return card.types.includes("Creature")
        ? permanentWorth(state, card)
        : noncreatureCardWorth(card);
}

// --- Library-search target pricing (CR 701.19) ------------------------------

/** Lands in play at which searching up ANOTHER land stops being development
 *  and starts being flood (a rough Forge-style curve point). Below it a
 *  fetched land outranks a small creature; at or above it, it is nearly
 *  worthless. */
const LAND_SEARCH_SATURATION = 5;

/** Worth of a fetched LAND at zero lands in play, decaying `LAND_SEARCH_STEP`
 *  per land already on the battlefield until `LAND_SEARCH_SATURATION`. */
const LAND_SEARCH_BASE = 70;
const LAND_SEARCH_STEP = 10;
const LAND_SEARCH_FLOODED = 20;

/** Rough latent worth of a card a library search could find (CR 701.19), used
 *  to RANK targets and to feed the `priorFor` seam — never legality. A LAND
 *  is priced against the SEARCHER's own mana development (real board state —
 *  genuinely context-aware), which is what makes a fetchland pick sensible
 *  early and near-irrelevant when flooded; every other card reuses
 *  `prospectiveCardWorth` (OP_VALUERS-driven for a noncreature, issue #1433).
 *  Shared by the `search-library` candidate generator's hint
 *  (`choiceCandidates.ts`) AND the DSL `priorFor` provider
 *  (`choicePriors.ts`) so the two never drift apart. */
export function libraryTargetWorth(
    state: GameState,
    searcherId: string,
    card: CardInstanceState
): number {
    if (!card.types.includes("Land")) return prospectiveCardWorth(state, card);
    const lands = getPlayer(state, searcherId).battlefield.filter((c) =>
        c.types.includes("Land")
    ).length;
    return lands >= LAND_SEARCH_SATURATION
        ? LAND_SEARCH_FLOODED
        : LAND_SEARCH_BASE - LAND_SEARCH_STEP * lands;
}
