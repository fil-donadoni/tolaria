// Colour coverage — "does this seat's mana base supply the colours this seat
// actually needs" (issue #3532, PRD #3526).
//
// `evaluate` could not see that mana has colours. The `mana` term prices a
// source at a flat weight whatever it taps for, so turning the opponent's only
// Forests into Swamps scored EXACTLY ZERO (the source count did not change),
// and five Mountains held against a {B}{B} hand read as five lands. This module
// is the quantity that difference is priced with, computed for BOTH seats, so
// the margin between them prices colour DENIAL on one side and colour SCREW on
// the other.
//
// ONE SHAPE, TWO SEATS, TWO SOURCES OF DEMAND. Both sides answer the same
// question — "what fraction of the colours this seat wants can its mana base
// supply" — and both return a ratio in [0, 1], so the two are subtractable. The
// SUPPLY is public on both sides (a battlefield is public). What differs is the
// DEMAND, and that difference is the hidden-information boundary:
//
//   - own seat: the costs actually in hand, asked through `coversCostColors`
//     (`gre/manaAvailability.ts`, the reader issue #3531 built — the same
//     authority the real castability gate runs from);
//   - opponent seat: `estimateOpponentColorDemand` (`ai/observedColors.ts`),
//     whose evidence hierarchy is public information by construction.
//     `observedColorCoverage` never reads a hand on any path, and
//     `colorCoverage.bot.test.ts` proves it with a `hand` accessor that throws.
//
// WHAT THAT GUARANTEE IS AND IS NOT. It is about the ESTIMATE, not about the
// evaluator: `evaluate(state, viewer)` treats the VIEWER's seat as `own` by
// construction, so a call made from the opponent's own viewpoint — the search
// ranking the opponent's own choices (`materialMargin(settled.state, moverId)`
// and `policyValue(fired, pid, …)` in `search.ts`) — runs the own-seat half on
// that seat's determinized hand. That is the determinization working as
// designed, and it is what `hand`, `flexibility` and `manaDevelopment` have
// always done on whichever seat is the viewer. The line this module draws is
// the one PRD #3526 asks for: NOTHING reads the hand of the seat being
// ESTIMATED, on any path, ever.
//
// THE SUPPLY IS THE `base` CENSUS, TAP STATE IGNORED — on both seats, and this
// is a deliberate boundary, not an oversight. A tapped source untaps in its
// controller's next untap step (CR 502.3), so tap state is TEMPO, not a
// property of the mana base; issue #3377 is the measured precedent (counting
// untapped sources as material made tapping four lands read as a 48-point loss,
// so the bot refused every mana-costed activation). Pricing tap state HERE
// would re-introduce exactly that on both seats: paying a cost would read as
// self-inflicted colour screw, and an opponent casting a spell would read as a
// gain for us. Re-typing (Vision Charm, Blood Moon), destruction (Stone Rain)
// and static mana-ability rewrites (Contamination) all change the BASE and are
// priced here.
//
// TAP STATE IS NOT FULLY OUT, and the residue is in the DENOMINATOR, not the
// supply. The opponent's demand comes from `observedOpponentColors`, whose
// weakest evidence class is an UNTAPPED source's producible colour — so when
// that source taps, the colour leaves the demand set and the ratio is re-based.
// MEASURED (a green creature beside a Plains, no white permanent): 0.25 with
// the Plains untapped and 0 with it tapped, 6.66 margin points at the committed
// weight. So a tap-based denial (a Rishadan Port activation, Rising Waters) is
// priced here after all — by DILUTION rather than by denial, in the same
// direction but for the wrong reason, and it unwinds at the next untap step.
// Living with it is deliberate: the alternative is a second, tap-blind
// derivation of the evidence, and one derivation shared with every other
// colour heuristic is worth more than 6.60 points of exactness (issue #2306).
//
// A LIVE-EVIDENCE DEMAND HAS ONE MORE COST, and it is the largest artefact in
// this module: removing a permanent removes the evidence it carried. A creature
// that DIES keeps its colour (battlefield weight 3 → graveyard weight 3, both
// "committed"), one that is EXILED or BOUNCED does not. MEASURED (a green
// creature, a Swamp, a black card in the graveyard): 0.5714 before, 0.5714
// after destroying the creature, 1.0 after exiling it — so exile-based removal
// scores 11.42 points worse than destruction on an identical board. That is
// ~10% of one removal's worth and cannot stop a removal from happening, but it
// can pick the wrong removal spell. It is inherent to estimating demand from
// live public evidence, which is what PRD #3526 mandates; no weight fixes it.
// Recorded in `docs/findings/` rather than papered over.
//
// Pure, no card names, state-only.

import type { Color } from "../../cards/types";
import { getInstanceManaCost } from "../../cards";
import type { CardInstanceState, GameState, PlayerState } from "../state";
import { coversCostColors, type ManaUnits } from "../manaAvailability";
import { estimateOpponentColorDemand } from "./observedColors";

/** Coverage credited to a seat whose colour demand is UNKNOWN — the opponent
 *  has shown nothing at all (issue #3532 acceptance criterion 3).
 *
 *  Strictly between the two readings it exists to refuse, because BOTH of them
 *  are claims the position does not support:
 *
 *   - "needs no colours" reads as coverage 1 — vacuously perfect, and
 *     invariant: every denial we could aim at that player is then FREE, since
 *     nothing we take from their base can lower a ratio already at its
 *     ceiling.
 *   - "needs every colour" reads as (colours produced / 5) — nearly always
 *     low, so a board that has shown nothing scores as badly colour-screwed
 *     and EVERY denial of EVERY colour scores. That is the vacuous heuristic
 *     issue #2306 exists to kill.
 *
 *  A fixed midpoint is an abstention: it is invariant to the mana base, so no
 *  denial aimed at an evidence-free player moves it in either direction, which
 *  is the only honest answer when the position has shown nothing. NOT a
 *  fittable weight — it is a prior over an unobserved quantity, not the price
 *  of one, and the fit reads derivatives of prices (`verdicts/features.ts`). */
export const UNKNOWN_COLOR_COVERAGE = 0.5;

/** No units at all — the probe that asks a cost whether it demands a COLOUR in
 *  the first place. `coversCostColors` is total over an empty census: it
 *  returns true exactly for a cost with no coloured, hybrid or {C} pip (a
 *  purely generic cost, a land's absent cost, a Phyrexian pip its controller
 *  can still pay 2 life for). Asking the single authority beats re-parsing
 *  `ManaCost` here and drifting from it. */
const NO_UNITS: ManaUnits = [];

/** Whether `cost` demands any colour at all — see {@link NO_UNITS}. */
function demandsColor(card: CardInstanceState, life: number): boolean {
    return !coversCostColors(NO_UNITS, getInstanceManaCost(card), { life });
}

/** The fraction of the coloured costs in `player`'s OWN hand that `base` can
 *  supply the colours for (issue #3532).
 *
 *  Per CARD, not per pip: the question a screwed hand asks is "how much of my
 *  hand is dead", and a card is dead or it is not. `coversCostColors` is
 *  deliberately quantity-BLIND (one Island covers {U}{U}) — being unable to
 *  afford a cost yet is what `manaDevelopment` prices; being unable to produce
 *  its colours AT ALL is what this prices, and the two are different failures.
 *
 *  Cards demanding no colour are not in the denominator: a generic cost is
 *  never colour-screwed, so counting it would dilute the ratio by hand shape
 *  rather than by colour.
 *
 *  An EMPTY denominator reads 1 — nothing in hand is colour-dead, which is the
 *  literal truth for an empty hand and for a hand of purely generic costs. It
 *  is also the one direction that cannot invent a preference: were it 0, a
 *  player would improve their own colour coverage by emptying their hand. */
export function ownHandColorCoverage(
    player: PlayerState,
    base: ManaUnits
): number {
    let demanding = 0;
    let covered = 0;
    for (const card of player.hand) {
        if (!demandsColor(card, player.life)) continue;
        demanding += 1;
        if (
            coversCostColors(base, getInstanceManaCost(card), {
                life: player.life,
            })
        )
            covered += 1;
    }
    return demanding === 0 ? 1 : covered / demanding;
}

/** The fraction of the colours `player` has VISIBLY shown a use for that their
 *  own mana base can supply — the opponent-seat half, on lawful evidence only
 *  (issue #3532).
 *
 *  EVIDENCE-WEIGHTED, because the hierarchy is the whole point: a colour
 *  carried by permanents on the battlefield and cards in the graveyard weighs
 *  more than one merely producible by an untapped source, so denying the
 *  colour they are demonstrably PLAYING is worth more than denying one they
 *  have only shown a land for (`ai/observedColors.ts`).
 *
 *  That weighting is also what makes the negative case fall out with no
 *  special-casing. A lone untapped Plains is its own only evidence for {W}:
 *  destroy it and the demand leaves with the supply, the ratio is unchanged,
 *  and spending a card on the denial buys nothing — which is exactly the
 *  behaviour issue #3532 asks for. A Forest beside a green creature is a
 *  different position: the creature's evidence survives the land, so the
 *  colour goes uncovered and the ratio falls. */
export function observedColorCoverage(
    state: GameState,
    player: PlayerState,
    base: ManaUnits
): number {
    const demand = estimateOpponentColorDemand(state, player.id);
    if (demand.kind === "unknown") return UNKNOWN_COLOR_COVERAGE;
    let total = 0;
    let covered = 0;
    for (const [color, mass] of Object.entries(demand.evidence)) {
        if (!mass || mass <= 0) continue;
        total += mass;
        if (base.some((unit) => unit.has(color as Color))) covered += mass;
    }
    // Unreachable through `estimateOpponentColorDemand` (a `known` estimate
    // carries at least one positive entry), kept so the function is total and
    // can never divide by zero.
    return total === 0 ? UNKNOWN_COLOR_COVERAGE : covered / total;
}
