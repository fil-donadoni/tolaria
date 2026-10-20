// Grounding for the per-Op value model (PRD #1423, issue #1426). A valuer
// reads Op parameters — amounts (`EffectValue`), player refs — that are only
// concrete AT a decision node. The `GroundingContext` abstracts that read so
// the SAME valuer runs in both grounding modes the PRD names:
//
//   • CONTEXT-FREE — a card's worth in hand, no board. `forEach`/`count`
//     collapse to a representative count of 1 (with a `board-scaling` tag so
//     the caller knows the scalar is a floor), `X` takes a representative
//     value, refs take a representative magnitude, and player refs are read
//     from the CASTER's perspective (a card's own effect is, by construction,
//     something its caster wants to happen). This is what `cardValue` consumes.
//
//   • CONTEXT-AWARE — a prior at a decision node, over real state. Amounts and
//     `forEach` counts come from the live resolver; player refs resolve
//     against the real caster. Only genuinely-unmade decisions (`choice`,
//     `mayPay`) stay approximated. This is what the choice-node search and the
//     rollout policy consume.
//
// Kept isomorphic (type-only state import) so it rides in `convex/gre/cardValue`
// 's client-importable barrel.

import type {
    EffectCardFilter,
    EffectManaPool,
    EffectValue,
    EffectSignedValue,
    EffectPlayerRef,
    EffectForEachSelector,
    EffectRef,
    PermanentView,
    TargetRequirement,
} from "../../cards/types";
import type { GameState } from "../state";
import type { Feature } from "./featureBasis";
import type { LatentWeights } from "./evalWeights";
import { DEFAULT_EVAL_WEIGHTS } from "./evalWeights";

/** Representative magnitudes used in CONTEXT-FREE grounding (PRD #1423). Not
 *  tuned per card — a coarse "typical" value so a variable-amount card is
 *  valued in the right ballpark and flagged `board-scaling`. */
export const CF_ASSUMED_X = 2; // a chosen X paid from a hand (a mid ritual/burn X)
export const CF_ASSUMED_COUNT = 1; // one forEach member / one counted thing
export const CF_ASSUMED_REF = 2; // a bound object's power/toughness/manaValue

/** The LATENT pricing lens a valuer reads (issue #3398, PRD #3397): the
 *  fitted price of one unit of each feature-basis dimension, plus — when a
 *  board is attached — how many units of `boardRemoval` the best legal victim
 *  of an announced target slot is actually worth THERE.
 *
 *  Kept on the grounding context rather than passed as a second valuer
 *  parameter for the same reason every other runtime read already lives here:
 *  a valuer must be identical in both grounding modes, and the thing that
 *  varies between them is what the context can answer. */
export interface LatentLens {
    /** Fitted price of one unit of each basis dimension. */
    readonly weights: LatentWeights;
    /** Units of `boardRemoval` the BEST LEGAL victim of announced target slot
     *  `slot` is worth — its realised board loss over the representative
     *  victim's (`ai/latentBoard.ts`). `undefined` when NO board is attached
     *  (the valuer then falls back to exactly one representative victim, which
     *  is what reproduces the pre-#3398 constants); `0` when a board IS
     *  attached and holds no legal victim at all — a removal spell facing an
     *  empty board is worth nothing, which is the case the old fixed constant
     *  got most wrong.
     *
     *  Issue #4903 — an ETB Ability's lens (`withTypedRepresentativeVictim`,
     *  `ai/representativeVictim.ts`) answers a slot of an artifact,
     *  enchantment or land requirement with no board attached: one
     *  representative victim of THAT type, never the creature-sized unit. */
    victimUnits(slot: number): number | undefined;
    /** Issue #5014 — `victimUnits` for a requirement the caller names
     *  itself rather than a slot of the card's own spell requirements: an ETB
     *  Ability's target lives on the ability, not on the definition the lens
     *  reads its slots from. Present only on a lens attached to a real board;
     *  absent, a context-free valuation keeps the representative victim. */
    requirementUnits?(requirement: TargetRequirement): number | undefined;
    /** Issue #5014 — true for an announced slot whose board holds no legal
     *  permanent victim: the damage aimed at it can only reach a player's
     *  face, so it is a life swing and not removal. Set only by the lens an
     *  ETB Ability is valued under (`etbGrounding`); a spell's own lens keeps
     *  pricing its damage as removal. */
    faceOnly?(slot: number): boolean;
    /** Issue #4773 — units of `boardRemoval` a `forEach` over the battlefield
     *  takes off the board NET for the caster: the realised loss of every
     *  member the caster's opponents control, minus every member the caster
     *  controls, over the representative victim's. A symmetric sweep takes
     *  the caster's own members too (CR 701.8a destroy, CR 701.13a exile),
     *  so what it is worth in hand is the SURPLUS it takes,
     *  never one representative victim. `undefined` when no board is attached
     *  or the selector is not one the lens can read (the valuer then keeps the
     *  representative-count valuation); negative when the caster would lose
     *  more than the opponents.
     *
     *  Issue #4781 — `outcome` names what the sweep does to each member
     *  (`SweepOutcome`); omitted, every member leaves the battlefield for
     *  good. */
    sweepUnits(
        select: EffectForEachSelector,
        outcome?: SweepOutcome
    ): number | undefined;
    /** Issue #5162 (ADR 0151) — the Differential Reading of a one-shot
     *  `forEach { set: "players" }` body: `valueSide` is run once per player
     *  on the board, with that player as the `$each` it names, and the sides
     *  are summed (each side's points are caster-relative already, so the sum
     *  is the opponent's realised loss minus the caster's own). `undefined`
     *  — the walker then keeps the representative-member valuation — when no
     *  board is attached or a side's walk read nothing off the board
     *  (`EachPlayerSide`); otherwise the reading is MEASURED. Present only on
     *  a lens attached to a real board. */
    eachPlayerDifferential?(
        valueSide: (side: EachPlayerSide) => number
    ): number | undefined;
    /** Issue #5560 — the share of a ONE-SHOT's Differential Reading the
     *  card in hand is credited (`EvalWeights.heldDifferentialFraction`):
     *  the swing decays once it resolves, its price read off each leaf never
     *  does. A standing engine's reading (`eachStepDifferentialValue`) is not
     *  held — it recurs on the board face — and never reads it: its lens,
     *  `engineLensOf` (`cardValue.ts`), drops the field on purpose. Present
     *  only on a lens attached to a real board. */
    readonly heldDifferentialFraction?: number;
    /** Issue #5162 — the player a `forEach { set: "players" }` body's
     *  `$each` names during one side of `eachPlayerDifferential`. Absent on
     *  every other walk. */
    readonly eachPlayer?: EachPlayerSide;
    /** Issue #5163 (ADR 0151) — the points a STANDING LOCK in hand (a
     *  permanent whose static restrictions reach the whole battlefield —
     *  Winter Orb, Stasis, Meekstone, Moat) would move the margin by once on
     *  this board under the caster's control: the opponent's realised loss
     *  minus the caster's own, the reading the board face makes at every
     *  leaf. Negative when the lock hurts its caster more. Present only on a
     *  lens attached to a real board; read by `dslLatentPieces`, whose
     *  `latentValue` then drops the Latent Floor (a measured reading). */
    standingLockWorth?(): number;
    /** True once `victimUnits` or `sweepUnits` has ANSWERED at least one slot off a REAL
     *  board — i.e. this script's board-affecting worth is MEASURED, not
     *  assumed from a representative victim.
     *
     *  Read by `latentValue` (`cardValue.ts`) to lift the `base + MV`
     *  coverage floor. That floor exists so a card whose script the Op
     *  vocabulary cannot value yet never drops below its mana-value proxy —
     *  a statement about COVERAGE. Once the board has been read, the proxy is
     *  superseded by a measurement, and keeping it is what left Stone Rain
     *  priced at 38 in hand against a 17-point land: still a net loss to
     *  cast, so still never cast (issue #3398). */
    measured(): boolean;
}

/** Issue #4781 — what a sweep's body does to each member, as far as the
 *  loss it inflicts goes:
 *   - `leaves` — it leaves the battlefield and nothing comes back (`destroy`,
 *     `exile`): the member's whole realised loss;
 *   - `lethalDamage` — `amount` damage is dealt to it: only a member that
 *     damage kills is a loss (CR 704.5g / 704.5i), a survivor is none;
 *   - `returnsToHand` — it is returned to its owner's hand: the realised loss
 *     NET of the card's worth back in that hand, since a bounced card is
 *     recast (a token ceases to exist, CR 111.8, and loses it all). */
export type SweepOutcome =
    | { kind: "leaves" }
    | { kind: "lethalDamage"; amount: number }
    | { kind: "returnsToHand" };

/** Issue #5162 — one player of a Differential Reading, read off the board
 *  the lens is attached to. Each reader answers in the units of the read the
 *  sweep path already makes, and marks the side ANSWERED. */
export interface EachPlayerSide {
    /** True for the caster's own side. */
    readonly own: boolean;
    /** What this player loses when its whole hand leaves it: each card's
     *  CONTEXT-FREE `cardValue` (no board lens — a lens per card would
     *  recurse through a second symmetric card in the same hand), the card
     *  being valued left out, since casting it takes it out of the hand.
     *  Points. */
    handWorth(): number;
    /** Issue #5559 — what this player loses when it discards the `count`
     *  cards of its choice: the CHEAPEST `count` of the cards `handWorth`
     *  sums, since the chooser keeps its best. Points. */
    discardWorth(count: number): number;
    /** Issue #5624 — what this player loses when it discards `count` cards
     *  AT RANDOM (CR 701.9b), in `cardAdvantage` units: the MEAN of the cards
     *  `handWorth` sums, times the count — no chooser keeps its best — at
     *  most the whole hand, over the board's mean library card (the
     *  `drawUnits` scale), so a random discard of an average card is one
     *  unit, the mirror of a draw. An empty hand loses nothing. A hand
     *  holding a hidden placeholder, or a board with no readable library
     *  card to scale by, is unreadable (0, the side voided). */
    randomDiscardUnits(count: number): number;
    /** Issue #5559 — `value` read off the board with `$each` bound to this
     *  player: a literal, a `count` of this player's (or the fewest / all
     *  players') battlefield or hand members, or a `difference` of two of
     *  them. The card being valued is not counted in its caster's hand — it
     *  is on the stack when the count is taken. `undefined` for a value the
     *  board cannot ground, which voids the side.
     *
     *  Issue #5574 — `namesSide` names the ref bound to this player: `$each`
     *  by default, the scoped player (`$event.activePlayerId`) for a standing
     *  each-step engine. A `{ domain: { of } }` of that player is grounded
     *  too (CR 305.6). A grounded value marks the side ANSWERED: the amount
     *  was read off this side's board, so a literal that nets out across the
     *  sides is a MEASURED zero (ADR 0151 rule 2). */
    groundCount(
        value: EffectValue,
        namesSide?: (ref: EffectPlayerRef) => boolean
    ): number | undefined;
    /** Issue #5574 — CR 603.4: whether a standing each-step engine's
     *  intervening-if holds on THIS player's step, decided by the trigger's
     *  own predicate against the board the lens is attached to, with this
     *  player as the one whose step it is. Marks the side answered. */
    stepGateHolds(gate: StepGate): boolean;
    /** Issue #5164 — what drawing `count` more cards is worth to this
     *  player, in `cardAdvantage` units: each card at the side's
     *  library-top expectation (the mean CONTEXT-FREE `cardValue` of its
     *  library — the order is hidden, the contents are not), kept only as
     *  far as the cleanup discard lets it stay (CR 514.1 / 402.2: past the
     *  maximum hand size the player keeps its best cards, so a drawn card
     *  into a full hand is worth only what it beats; issue #5579 — read over
     *  the hands that can reach that cleanup, the leaf's ± one card, so one
     *  card in or out of a hand moves it by a share of one), over the board's mean
     *  library card — so an average card kept whole is one unit, and the
     *  side with the better library draws more of them. The card being
     *  valued is left out of the hand, as in `handWorth`; at most the
     *  library's size is drawn. A side holding a hidden placeholder is
     *  unreadable (0, and the Differential falls back).
     *
     *  Issue #5573 — `before` is what the earlier Ops of a one-shot body did
     *  to this player's hand and library before the draw (`HandStep`), in
     *  order: the draw lands in the hand they leave behind, from the library
     *  they leave behind. An empty library draws nothing and reads 0. */
    drawUnits(count: number, before?: readonly HandStep[]): number;
    /** `boardRemoval` units (the `sweepUnits` scale) of the `count` members
     *  this player would choose to sacrifice among its permanents matching
     *  `filter`: the cheapest ones — only a permanent's controller can
     *  sacrifice it (CR 701.21a), and it keeps its best. `undefined` for a
     *  filter the lens cannot match exactly. */
    sacrificeUnits(
        filter: EffectCardFilter | undefined,
        count: number
    ): number | undefined;
    /** Issue #5628 — `boardRemoval` units (the `sweepUnits` scale) of the
     *  `count` members this player would choose to return to their owners'
     *  hands among its permanents matching `filter`: each one's realised
     *  loss NET of its card's worth back in hand (the `returnsToHand` sweep
     *  outcome) — the cheapest nets, since the chooser keeps its best. A card
     *  it controls but does not own lands in its owner's hand (CR 400.3), so
     *  the other player's gain is this one's loss; a token hands nothing
     *  back (CR 111.7). No matching permanent loses nothing. `undefined` for
     *  a filter the lens cannot match exactly. */
    bounceUnits(
        filter: EffectCardFilter | undefined,
        count: number
    ): number | undefined;
    /** Issue #5626 — what `mana` added to this player's pool at the
     *  beginning of its main phase is worth to it, in `ramp` units: the most
     *  of it one card of its hand spends that its own mana base (every
     *  source, untapped in its untap step, CR 502.3) cannot pay for alone —
     *  0 when its base already pays for everything it holds, or nothing in
     *  hand uses the extra (CR 106.4: unspent, the mana empties at the end
     *  of the phase). The card being valued is left out of the hand. A side
     *  holding a hidden placeholder in hand is unreadable (0, and the
     *  Differential falls back). */
    manaUnits(mana: EffectManaPool): number;
    /** Issue #5627 — what this player digs out of its own library by
     *  revealing from the top until a card matching `filter` (Oath of
     *  Druids' `revealUntilMatch`): `match`, the expected matching card put
     *  onto its battlefield — the mean realised worth of the library's
     *  matching cards, each landed under this player, over a representative
     *  victim's (the `sweepUnits` scale), 0 when none matches; `milled`, the
     *  expected count of cards revealed before it, put into the graveyard —
     *  `(n - m) / (m + 1)` of a shuffled library of `n` cards holding `m`
     *  matches, the whole library when `m` is 0 (CR 101.3: the match leg has
     *  no referent, the rest leg is still performed). The order is hidden,
     *  the contents are not. `undefined` for a filter the lens cannot match
     *  exactly, which voids the side; a side holding a hidden placeholder in
     *  its library is unreadable (0s, and the Differential falls back). An
     *  empty library digs nothing and reads 0s, answering nothing. */
    digUnits(
        filter: EffectCardFilter
    ): { match: number; milled: number } | undefined;
}

/** Issue #5573 — one earlier Op of a one-shot `forEach { set: "players" }`
 *  body, as far as the hand a later draw lands in goes:
 *   - `leaves` — the whole hand is discarded (CR 701.9): the hand is empty;
 *   - `shuffledIn` — the whole hand is put into the library: the hand is
 *     empty and the library holds its cards;
 *   - `discards` — `count` cards of the player's choice are discarded: its
 *     CHEAPEST `count`, as `discardWorth` reads them;
 *   - `draws` — `count` cards are drawn, each at the library expectation. */
export type HandStep =
    | { readonly kind: "leaves" }
    | { readonly kind: "shuffledIn" }
    | { readonly kind: "discards"; readonly count: number }
    | { readonly kind: "draws"; readonly count: number };

/** Issue #5574 — a standing each-step trigger's CR 603.4 intervening-if,
 *  asked for one player's step: `activePlayerId` is the player whose step it
 *  is, `self` the source permanent, `state` the board it stands on. */
export type StepGate = (
    activePlayerId: string,
    self: PermanentView,
    state: GameState
) => boolean;

/** True for the `{ ref: "$each" }` forEach iteration variable used as a
 *  PLAYER ref (issue #1521). Every catalogue card naming a player this way
 *  does so inside a `forEach { set: "players" }` — an Earthquake / Flame
 *  Rift / Fissure-style "deals N damage to each player" (CR 120.3), which
 *  hits the caster too. The walker only evaluates a context-free `forEach`
 *  body ONCE (a representative member, not once per real player), so a
 *  valuer that saw this ref and guessed "self" (the generic `isSelf`
 *  heuristic for an opaque ref) would score the whole symmetric effect as a
 *  pure self-cost — wrong in the other direction from the bug this guards
 *  against. Treated as its own case so the caller can score it neutral. */
export function isEachPlayerRef(ref: EffectPlayerRef): boolean {
    return typeof ref === "object" && "ref" in ref && ref.ref === "$each";
}

/** The lens a valuation with no board attached reads: the production weights,
 *  no victim lookup. */
export function contextFreeLatentLens(
    weights: LatentWeights = DEFAULT_EVAL_WEIGHTS.latent
): LatentLens {
    return {
        weights,
        victimUnits: () => undefined,
        sweepUnits: () => undefined,
        measured: () => false,
    };
}

/** Price one unit of `feature` under `ctx`'s latent lens — the single read
 *  every valuer uses instead of a module-level point constant. */
export function latentWeight(ctx: GroundingContext, feature: Feature): number {
    return ctx.latent.weights[feature];
}

/** A resolved runtime amount plus whether it scales with hidden/board state
 *  (so the caller can attach the `board-scaling` tag). */
export interface GroundedAmount {
    amount: number;
    scaling: boolean;
}

/** Grounds an Op's runtime reads for a valuer, in one of the two PRD modes. */
export interface GroundingContext {
    readonly mode: "context-free" | "context-aware";
    /** Resolve an `EffectValue` (an Op amount/count) to a representative
     *  magnitude and whether it board-scales. */
    value(v: EffectValue): GroundedAmount;
    /** Resolve a SIGNED `EffectValue` (`pump` power/toughness), honoring a
     *  `negate` wrapper. */
    signedValue(v: EffectSignedValue): GroundedAmount;
    /** From the CASTER's perspective, does `ref` denote the caster's own side?
     *  `cfAssumption` is the valuer's natural assumption for an ambiguous
     *  announced-target player slot (harmful ops assume "opponent", beneficial
     *  ops assume "self") — used only in context-free mode. */
    isSelf(ref: EffectPlayerRef, cfAssumption: "self" | "opponent"): boolean;
    /** How many members a `forEach` selects (real count context-aware; the
     *  representative 1 context-free), and whether it board-scales. */
    forEachCount(select: EffectForEachSelector): GroundedAmount;
    /** True when `ref` denotes an OBJECT ref that is BOTH (a) the ability's
     *  own resolving SOURCE — the literal `{ ref: "$source" }`, or (extended
     *  per-call by `withCapturedSourceAliases` in `opValuers.ts`) a name a
     *  `delayedTrigger`/`reflexiveTrigger`'s own `capture` map aliases to it
     *  — and (b) CURRENTLY ON THE BATTLEFIELD. (b) is the default for every
     *  activated ability and the common triggered-ability case; `false` only
     *  when `withGraveyardSource` below has forced it, for a `zone:
     *  "graveyard"` triggered ability whose `$source` is a GRAVEYARD card
     *  instead (CR 603.6e — Master of Death's "return it to your hand" is
     *  card advantage, never a cost, the opposite of Dash's battlefield-zoned
     *  delayed return).
     *
     *  Distinct from `isSelf` above: `isSelf` answers a PLAYER-ref question
     *  (an announced `target`/`controllerOf` PLAYER slot); this answers an
     *  OBJECT-ref question (does the ref pick out the resolving permanent
     *  itself) — the two ref families are never interchangeable, and a
     *  permanent ref has no player-ref shape `isSelf` could read (issue
     *  #1964 — the `moveZone`/self-bounce-as-cost fix). */
    isSourceBattlefieldRef(ref: EffectRef): boolean;
    /** The latent pricing lens (issue #3398) — per-dimension unit prices, and
     *  the board's best legal victim for a targeted, board-affecting Op. */
    readonly latent: LatentLens;
}

function isNegated(v: EffectSignedValue): v is { negate: EffectValue } {
    return typeof v === "object" && v !== null && "negate" in v;
}

/** Context-free grounding: representative assumptions, caster's perspective. */
export function contextFreeGrounding(
    weights: LatentWeights = DEFAULT_EVAL_WEIGHTS.latent
): GroundingContext {
    const value = (v: EffectValue): GroundedAmount => {
        if (typeof v === "number") return { amount: v, scaling: false };
        if ("X" in v) return { amount: CF_ASSUMED_X, scaling: true };
        if ("ref" in v) return { amount: CF_ASSUMED_REF, scaling: false };
        if ("count" in v) return { amount: CF_ASSUMED_COUNT, scaling: true };
        // difference (issue #2006) — `from` minus `minus`, both terminals. With
        // no board context each `count` operand is the representative
        // CF_ASSUMED_COUNT, so a count-minus-count difference grounds at 0 and
        // would price the effect at nothing. That is the wrong context-FREE
        // floor (the context-aware path below reads the real board), so a
        // difference grounds at the same CF_ASSUMED_COUNT a single count does,
        // board-scaling: it is a board-dependent magnitude, and the one thing
        // the floor must not do is claim to know it is zero.
        if ("difference" in v) {
            return { amount: CF_ASSUMED_COUNT, scaling: true };
        }
        // scaled (issue #2366) — a fixed multiplier times a terminal (X, a
        // literal, or a count). The operand shape (`number | EffectCount |
        // EffectXValue`) is structurally a valid `EffectValue`, so it grounds
        // through the SAME closure recursively (X → CF_ASSUMED_X, a literal
        // → itself, a count → CF_ASSUMED_COUNT board-scaling) rather than a
        // duplicated floor — the one thing this branch must NOT do is fall
        // through to the generic CF_ASSUMED_REF floor below and price
        // "twice X" as a fixed representative constant instead of 2x whatever
        // X grounds to (the wrong-magnitude failure mode, issue #1520).
        if ("scaled" in v) {
            const inner = value(v.scaled.value);
            return {
                amount: inner.amount * v.scaled.times,
                scaling: inner.scaling,
            };
        }
        // divide (issue #2385) — a terminal divided by a fixed divisor,
        // rounded per `rounding`. Mirrors `scaled`'s recursion: the operand
        // (a literal or a `count`) grounds through the SAME closure, then the
        // quotient is rounded the way the card's Oracle text specifies (CR
        // 107.1a) rather than falling through to a generic floor.
        if ("divide" in v) {
            const inner = value(v.divide.value);
            const quotient = inner.amount / v.divide.by;
            return {
                amount:
                    v.divide.rounding === "up"
                        ? Math.ceil(quotient)
                        : Math.floor(quotient),
                scaling: inner.scaling,
            };
        }
        // sacrificed (issue #2375) — a characteristic of the cost-sacrificed
        // permanent (CR 601.2f / 608.2h). The READ itself is a dynamic
        // runtime value and takes the same `CF_ASSUMED_REF` floor every other
        // dynamic read takes, but the `plus` LITERAL is known statically and
        // must be added on top rather than swallowed by the generic floor
        // below — the wrong-magnitude failure mode `scaled` documents (issue
        // #1520): Broadside Bombardiers' "2 plus the sacrificed permanent's
        // mana value" would otherwise ground as a bare representative 2,
        // pricing a boast at half what it does and hiding the activation
        // behind `pass`.
        if ("sacrificed" in v) {
            return {
                amount: CF_ASSUMED_REF + (v.sacrificed.plus ?? 0),
                scaling: true,
            };
        }
        // counters / manaValue / domain / kickerCount / additionalCostPaid /
        // escaped / abilityResolutionCount / lifeGainedThisTurn /
        // cardsDrawnThisTurn / sum — dynamic reads off runtime state. `sum`
        // (issue #3243) belongs here rather than in a branch of its own: its
        // magnitude is the total of a characteristic over a set NOTHING has
        // bound yet at a pre-cast node, so there is strictly less to resolve
        // than for `counters`, which already takes this floor. `setSize`
        // (issue #3244) is the same case one read smaller: the COUNT of such a
        // set, so it takes the same floor for the same reason.
        if ("escaped" in v || "abilityResolutionCount" in v)
            return { amount: 1, scaling: false };
        return { amount: CF_ASSUMED_REF, scaling: true };
    };
    return {
        mode: "context-free",
        value,
        signedValue(v) {
            if (isNegated(v)) {
                const inner = value(v.negate);
                return { amount: -inner.amount, scaling: inner.scaling };
            }
            return value(v);
        },
        isSelf(ref, cfAssumption) {
            if (ref === "controller") return true;
            if (ref === "opponent") return false;
            if (typeof ref === "object" && "ref" in ref) return true; // $source etc.
            // {target} / {controllerOf} — the valuer's natural assumption.
            return cfAssumption === "self";
        },
        forEachCount() {
            return { amount: CF_ASSUMED_COUNT, scaling: true };
        },
        isSourceBattlefieldRef(ref) {
            return ref.ref === "$source";
        },
        latent: contextFreeLatentLens(weights),
    };
}

/** Resolvers a context-aware caller wires to live state. Kept as callbacks so
 *  this module needs no value-level `GameState` dependency (stays isomorphic).
 *  Only the reads a valuer actually performs are required. */
export interface ContextAwareResolvers {
    /** Resolve an `EffectValue` to its real magnitude at the decision node. */
    resolveValue(v: EffectValue): number;
    /** True when `ref` resolves to the caster's own player id. */
    resolveIsSelf(ref: EffectPlayerRef): boolean;
    /** Real member count of a `forEach` selector at the decision node. */
    resolveForEachCount(select: EffectForEachSelector): number;
    /** Fitted per-dimension unit prices (issue #3398). Optional — a caller
     *  that does not run a ladder variant gets the production vector. */
    latentWeights?: LatentWeights;
}

/** Context-aware grounding: real magnitudes and perspective at a decision
 *  node. `board-scaling` is never attached — the value is already realized. */
export function contextAwareGrounding(
    resolvers: ContextAwareResolvers
): GroundingContext {
    const value = (v: EffectValue): GroundedAmount => ({
        amount: resolvers.resolveValue(v),
        scaling: false,
    });
    return {
        mode: "context-aware",
        value,
        signedValue(v) {
            if (isNegated(v)) {
                return { amount: -value(v.negate).amount, scaling: false };
            }
            return value(v);
        },
        isSelf(ref) {
            return resolvers.resolveIsSelf(ref);
        },
        forEachCount(select) {
            return {
                amount: resolvers.resolveForEachCount(select),
                scaling: false,
            };
        },
        // Issue #1964 — no context-aware caller threads an enclosing
        // ability's `zone` today (`contextAwareGroundingForChoice` values a
        // CHOICE fragment, not a whole ability), so this stays the same
        // literal-match default `contextFreeGrounding` uses rather than a
        // resolver nobody can supply yet. A future context-aware caller that
        // DOES need the graveyard-zoned exception can extend this the same
        // way `withGraveyardSource` does for the context-free path.
        isSourceBattlefieldRef(ref) {
            return ref.ref === "$source";
        },
        // No context-aware caller attaches a board lens, and one of them
        // WOULD want it: `dslSearchLibraryPrior` (`ai/choicePriors.ts`) values
        // a whole, not-yet-cast card through
        // `contextAwareGroundingForChoice`, target unchosen — so a removal
        // spell it ranks in a library prices at the representative victim
        // while `evaluate`'s hand term, one node later, prices the same card
        // against the real board. Not a regression (the prior read the fixed
        // constant before this too), but a genuine second price for one card,
        // and a `latent` sweep does not reach it: nothing sets
        // `latentWeights` below, so this reads the production vector. Both
        // need `EvalWeights` threaded from `search.ts` through `priorFor` —
        // a seam this issue's blast radius does not cover
        // (`docs/findings/choice-prior-latent-weights.md`).
        latent: contextFreeLatentLens(resolvers.latentWeights),
    };
}

/** Derives a ctx whose `isSourceBattlefieldRef` always answers `false` — for
 *  an ability whose OWN `zone` is `"graveyard"` (CR 603.6e): its `$source`
 *  denotes a GRAVEYARD card, not a battlefield permanent, so a `moveZone →
 *  hand` naming it is card advantage (regrowth — Master of Death, CR 603.6e
 *  `zone: "graveyard"`, "return it to your hand"), never the self-bounce COST
 *  `isSourceBattlefieldRef` exists to flag (issue #1964 — the OPPOSITE case
 *  from Dash's battlefield-zoned delayed return). `dslAbilityScriptOpValue`
 *  (`cardScriptValue.ts`) applies this per-ability, before walking that
 *  ability's own script — never globally, since a card's OTHER abilities may
 *  be ordinary battlefield ones. */
export function withGraveyardSource(ctx: GroundingContext): GroundingContext {
    return { ...ctx, isSourceBattlefieldRef: () => false };
}

/** Derives a ctx that reads `lens` for its latent pricing — how a caller that
 *  HAS a board (the `evaluate` hand term, via `cardValue`) attaches it to an
 *  otherwise context-free valuation (issue #3398). */
export function withLatentLens(
    ctx: GroundingContext,
    lens: LatentLens
): GroundingContext {
    return { ...ctx, latent: lens };
}
