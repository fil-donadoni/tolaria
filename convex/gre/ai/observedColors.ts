// The opponent's OBSERVABLE colour footprint (CR 105.1) — issue #2306.
//
// "Which colours has this player visibly shown, or could currently produce,
// that the searcher can read WITHOUT looking at hidden information" — one
// place, reused by every colour-choice heuristic (protection-from-colour
// today, `colorModePrior` in `choicePriors.ts`; "becomes the colour of your
// choice" — `chooseColorEffects` — is a later ticket per the issue, but reads
// this same derivation unchanged).
//
// HIDDEN-INFORMATION DISCIPLINE. This module never reads `player.hand`, full
// stop — not "reads it only for the searcher's own seat", never at all — so
// the "swap the opponent's true hand" invariant holds even if a future caller
// runs it against an undeterminized state by mistake. `determinize`
// (`gre/determinize.ts`) already pools/reshuffles hidden zones before any AI
// seam sees `state`, so reading straight off `state.players`/`state.stack`
// here is hidden-info-safe by construction; the no-hand-read rule is the
// defence-in-depth on top of that.
//
// THE EVIDENCE BOUNDARY (the deliberate line issue #2306 exists to draw).
// Acceptance criterion 3 wants an untapped colour-producing land to count as
// a threat even with ZERO permanents of that colour on board — count every
// theoretically-producible colour instead and a 4-5 colour manabase makes
// every colour "equally threatening", which is the vacuous heuristic this
// issue exists to kill. So:
//
//   - a permanent's EFFECTIVE colour on the battlefield (CR 613.1e,
//     `getEffectiveColors`) is the STRONGEST signal — resolved, present,
//     already layer-5-correct.
//   - a card's static colour (CR 202.2) in the graveyard or on the stack is
//     comparably strong: the opponent has ALREADY committed the card (cast
//     it, or it died/was discarded/countered) — not a maybe.
//   - an UNTAPPED source's producible colour is real evidence too (criterion
//     3), but WEAKER — potential, not actuation — so it is weighted lower.
//   - a TAPPED source contributes nothing (the opponent spent it on
//     something else, or it simply isn't available right now — no different
//     from it not being there). A SACRIFICE-gated / extra-cost mana ability
//     (Lotus Petal) is excluded too: spending it is a real decision the
//     opponent hasn't made, so it is not yet evidence — `requireTap` on
//     `getManaTapOptionsDetailed` restricts to abilities costing `{T}`, PLUS
//     this module's own `isNonDestructiveManaOption` check, because
//     `requireTap` alone still admits a TAP-AND-sacrifice ability (Lotus
//     Petal's "{T}, Sacrifice…" has `cost.tap: true`, so `requireTap`'s
//     `!ability.cost.tap` gate does not exclude it — it only excludes a
//     NO-TAP sacrifice ability like Lion's Eye Diamond). A board-conditional
//     chooser (Fellwar Stone) DOES count, resolved against the real, PUBLIC
//     board — that resolution is not hidden information.
//
//   - a DECKLIST the search was explicitly granted for this seat (issue
//     #3533) is the fourth class, and the only one that is not read off the
//     board. It weighs the same as an untapped source's producible colour, and
//     for the same reason: a card sitting in a deck is the purest form of
//     POTENTIAL — it may never be drawn. What makes it matter is that there
//     are sixty of them, so a deck that is 40% green outweighs two Forests
//     without any special pleading and without a second scale.
//
// THE DECKLIST IS NOT PUBLIC, and nothing above is weakened by admitting it.
// It arrives only on a world `determinize` stamped (`GameState.deckColorKnowledge`),
// and `determinize` stamps a seat only when the search was HANDED that seat's
// decklist and that seat is not the observer — true exactly at `expert`
// (`DIFFICULTY_KNOWS_OPPONENT`, `gre/difficulty.ts`). At every other
// difficulty, on every server path, and in every test that stamps nothing, the
// field is `undefined` and this module computes byte-identically to before.
// Still NO HAND READ at any difficulty: a decklist says what the deck
// CONTAINS, never what the opponent is holding.
//
// This stays a HEURISTIC input (a search-prior deviation, never a filter) —
// see `colorModePrior` in `choicePriors.ts`.

import type { Color } from "../../cards/types";
import { getEffectiveColors } from "../../cards/effectiveColors";
import { getCardColors } from "../../cards/colors";
import { tryGetDefinition } from "../../cards";
import type { CardInstanceState, GameState, PlayerState } from "../state";
import { getPlayer } from "../state";
import { getManaTapOptionsDetailed, type ManaTapOption } from "../constants";
import { MANA_COLORS } from "../manaColors";
import { getEffectiveActivatedAbilities } from "../activatedAbilities";
import { deckColorsFor } from "../deckKnowledge";

/** Per-colour evidence SCORE (not a probability) — higher means more visibly
 *  threatened. An absent key is zero evidence for that colour. Never carries
 *  a `"C"` entry — colourless is not a colour (CR 105.2a) and is scored
 *  separately by every consumer (a "protection from colourless" mode has no
 *  colour-evidence opinion at all, see `colorModePrior`). */
export type ObservedColorEvidence = Partial<
    Record<Exclude<Color, "C">, number>
>;

/** Weight of one battlefield permanent's colour(s) — resolved, current,
 *  layer-5-correct: the strongest signal. */
const BATTLEFIELD_WEIGHT = 3;
/** Weight of one graveyard/stack card's colour(s) — the opponent already
 *  committed this card (cast it, or it died/was discarded/countered/milled). */
const COMMITTED_WEIGHT = 3;
/** Weight of one untapped source's producible colour — real, but merely
 *  POTENTIAL until spent, so it counts for less than an actuated signal
 *  (criterion 3: it must still count for SOMETHING, never zero). */
const POTENTIAL_MANA_WEIGHT = 1;
/** Weight of ONE coloured card in a decklist the search was granted (issue
 *  #3533). Deliberately the same as {@link POTENTIAL_MANA_WEIGHT}: both are
 *  potential rather than actuation, and sharing the unit is what keeps the
 *  decklist SHARPENING this hierarchy instead of becoming a second scale
 *  bolted beside it. The decklist's weight comes from its COUNT, not from a
 *  per-card premium. */
const DECKLIST_CARD_WEIGHT = 1;

function addColors(
    evidence: Record<string, number>,
    colors: readonly Color[],
    weight: number
): void {
    for (const c of colors) {
        if (c === "C") continue; // colourless carries no colour-evidence signal here
        evidence[c] = (evidence[c] ?? 0) + weight;
    }
}

/** A card's STATIC printed colours (CR 202.2) — used for graveyard/stack
 *  objects, which have no live battlefield layer-5 context
 *  (`getEffectiveColors` needs `isTapped`/`controllerId` on a permanent VIEW).
 *  Reads the registry definition through the card's id; a card with no
 *  resolvable definition (a slim/legacy fixture) contributes no evidence. */
function cardStaticColors(card: CardInstanceState): Color[] {
    const cardId = (card.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    return def ? getCardColors(def) : [];
}

/** True for a mana-tap option this module is willing to count as EVIDENCE — a
 *  plain tap (a basic land subtype, or an activated ability whose only cost
 *  is `{T}`). `getManaTapOptionsDetailed`'s own `requireTap` flag is NOT
 *  sufficient on its own: it excludes a NO-TAP sacrifice ability (Lion's Eye
 *  Diamond) but, read literally, still admits a TAP-AND-sacrifice one
 *  (Lotus Petal's "{T}, Sacrifice this artifact: …" has `cost.tap: true`, so
 *  `requireTap`'s `!ability.cost.tap` check does not exclude it). Spending a
 *  one-shot sacrifice source is a real decision the opponent hasn't made, so
 *  this module cross-checks the option's own ability definition and drops
 *  any with a `cost.sacrifice` leg regardless of what `requireTap` let
 *  through. A `"basic"`-provenance option (CR 305.6) is never sacrifice-
 *  gated and always counts. */
function isNonDestructiveManaOption(
    card: CardInstanceState,
    option: ManaTapOption
): boolean {
    if (option.source.kind !== "activated") return true;
    const abilityId = option.source.abilityId;
    const entry = getEffectiveActivatedAbilities(card).find(
        (r) => r.ability.id === abilityId
    );
    return !entry?.ability.cost.sacrifice;
}

/** The colours `opponent`'s UNTAPPED mana sources can currently produce,
 *  restricted to the non-destructive tap-only leg (`requireTap` PLUS
 *  {@link isNonDestructiveManaOption}) so a sacrifice-gated source (Lotus
 *  Petal) — a real decision the opponent hasn't made — is not counted as a
 *  shown colour (see the module header's evidence boundary). Board-
 *  conditional choosers (Fellwar Stone) resolve against the real, public
 *  board and DO count.
 *
 *  Issue #2420 review finding 2 (lower-severity third consumer) — the
 *  widened `requireTap` gate this shares with `getProducibleManaUnits`
 *  (rules.ts) and `planManaPayment` (moves.ts) now also returns a
 *  PURE-GENERIC `cost.mana` option (Farrelite Priest's "{1}: Add {W}"),
 *  which is NET ZERO mana, not a free unit. Deliberately UN-netted here,
 *  unlike `getProducibleManaUnits`: this function answers a different
 *  question — "could this permanent EVER put colour C into play" (a boolean
 *  membership test, counted as WEAKER evidence per the module header, not a
 *  legality/affordability gate) — not "how much free mana is on this board"
 *  (`getProducibleManaUnits`'s counting question, where the same net-zero
 *  shape genuinely mis-fed a human Cast affordance). Farrelite Priest CAN
 *  genuinely produce {W} once its own {1} is funded by something else, so
 *  colour W remains real evidence; only its WEIGHT would need revisiting,
 *  which this module's `HIDDEN-INFORMATION` header already reserves for a
 *  future evidence-strength rework, not this fix. A structurally
 *  unexecutable shape (Nomadic Elf's `{X:1,G:1}`) needs no equivalent
 *  carve-out: `isAutoPayableManaAbilityCost` (constants.ts) now excludes it
 *  from `requireTap`'s result upstream, so it never reaches `options` here
 *  either (review finding 1). */
function untappedProducibleColors(
    state: GameState,
    opponent: PlayerState
): Set<Color> {
    const battlefields = state.players.map((p) => ({
        playerId: p.id,
        battlefield: p.battlefield,
    }));
    const colors = new Set<Color>();
    for (const card of opponent.battlefield) {
        if (card.isTapped) continue;
        const options = getManaTapOptionsDetailed(
            card,
            card.controllerId,
            battlefields,
            { requireTap: true },
            state.continuousEffects
        );
        for (const option of options) {
            if (!isNonDestructiveManaOption(card, option)) continue;
            for (const c of MANA_COLORS) {
                if (c === "C") continue;
                if ((option.mana[c] ?? 0) > 0) colors.add(c);
            }
        }
    }
    return colors;
}

/** The observable colour footprint of `opponentId` (CR 105.1 colours only,
 *  never colourless): every colour visible on their battlefield, graveyard,
 *  the stack, or producible from an untapped mana source. Public information
 *  only — see the module header for the hidden-information discipline and
 *  the evidence-weight boundary. */
export function observedOpponentColors(
    state: GameState,
    opponentId: string
): ObservedColorEvidence {
    const opponent = getPlayer(state, opponentId);
    const evidence: Record<string, number> = {};

    for (const card of opponent.battlefield) {
        addColors(evidence, getEffectiveColors(card), BATTLEFIELD_WEIGHT);
    }
    for (const card of opponent.graveyard) {
        addColors(evidence, cardStaticColors(card), COMMITTED_WEIGHT);
    }
    for (const item of state.stack) {
        // `castById`, not `controllerId` — the player who put this object on
        // the stack (a spell's caster, an ability's activator), matching the
        // "already committed the card" evidence class even if control of the
        // source later changes (StackItem's own field, `gre/state.ts`).
        if (item.castById !== opponentId) continue;
        addColors(evidence, cardStaticColors(item), COMMITTED_WEIGHT);
    }
    for (const c of untappedProducibleColors(state, opponent)) {
        evidence[c] = (evidence[c] ?? 0) + POTENTIAL_MANA_WEIGHT;
    }
    // The decklist, when the search was granted this seat's (issue #3533) —
    // folded into the SAME map, at the same scale, so every consumer of this
    // derivation sharpens at once and none of them grows a decklist branch of
    // its own. `undefined` at every difficulty but `expert`.
    const deckColors = deckColorsFor(state.deckColorKnowledge, opponentId);
    if (deckColors) {
        for (const [color, count] of Object.entries(deckColors)) {
            if (!count || count <= 0) continue;
            evidence[color] =
                (evidence[color] ?? 0) + count * DECKLIST_CARD_WEIGHT;
        }
    }
    return evidence as ObservedColorEvidence;
}

/** The opponent's colour DEMAND as this searcher is allowed to know it — the
 *  three-state reading of {@link observedOpponentColors} that issue #3532's
 *  colour-coverage term prices.
 *
 *  The third state is the whole point. Read an empty evidence map as "this
 *  player needs no colours" and every denial becomes free: their coverage is
 *  vacuously perfect and nothing we take from their mana base can ever lower
 *  it. Read it as "this player needs every colour" — the vacuous heuristic
 *  issue #2306 exists to kill — and every denial of every colour scores, on a
 *  board that has shown nothing. `unknown` is the abstention: a fixed reading
 *  that is invariant to the mana base, so neither mistake is available. */
export type ColorDemandEstimate =
    | { kind: "known"; evidence: ObservedColorEvidence }
    | { kind: "unknown" };

/** {@link observedOpponentColors}, lifted into {@link ColorDemandEstimate}:
 *  `unknown` exactly when the position has shown nothing at all. This is the
 *  SAME derivation, never a second one — which is exactly why the `expert`
 *  decklist (issue #3533) arrives THROUGH `observedOpponentColors` rather than
 *  beside it.
 *
 *  A consequence worth naming: a seat whose decklist the search was granted is
 *  effectively never `unknown`, because a decklist with any coloured card in
 *  it is evidence on turn zero. That is the correct reading and the whole
 *  point of the abstention — `unknown` answers "the position has shown
 *  nothing", and to an informed search the position HAS shown something. */
export function estimateOpponentColorDemand(
    state: GameState,
    opponentId: string
): ColorDemandEstimate {
    const evidence = observedOpponentColors(state, opponentId);
    for (const color of MANA_COLORS) {
        if (color === "C") continue;
        if ((evidence[color] ?? 0) > 0) return { kind: "known", evidence };
    }
    return { kind: "unknown" };
}
