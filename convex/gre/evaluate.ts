// Position heuristic for the vs-AI Bot (ADR 0001, issue #111, ADR 0018).
//
// `evaluate(state, playerId)` scores a GameState from `playerId`'s point of
// view: higher is better for that player. It is the leaf estimate the greedy
// 1-ply selection (issue #111) and the truncated ISMCTS rollouts (issue #112)
// use to compare candidate continuations. Tests assert the ORDERING, not the
// magnitudes (the weights are expected to be re-tuned). The contract:
//
//   * a won position outranks any non-won position, a lost one ranks below all;
//   * more life, more board, more cards in hand and in play, and more available
//     mana each raise the score, all else equal;
//   * a richer creature (more power/toughness, higher mana value, evasion and
//     combat-relevant keywords) is worth more than a vanilla of the same size;
//   * a defender (can't attack) is worth less than an equivalent attacker.
//
// Forge-scale magnitudes (ADR 0018). The whole eval is on Forge's ~100-base
// scale: a creature is worth in the hundreds, life and material commensurate.
// This is the numeric headroom that later slices use to make a wasted card a
// decisive loss and to distinguish a bomb from a vanilla. `WIN_SCORE` still
// dominates every reachable material margin.
//
// PURE: no Math.random, no mutation, no ctx. Reads effective P/T through the
// layer system so static buffs (counters, anthems) are reflected.

import type { CardInstanceState, GameState, PlayerState } from "./state";
import { isCombatDamageImmune, sourcePreventionShieldApplies } from "./state";
import {
    anyCombatDamageUnpreventableStatic,
    isCombatDamageUnpreventable,
} from "./combatDamagePrevention";
import { lethalDamageThreshold } from "./lethalDamage";
import {
    getEffectivePower,
    getEffectiveToughness,
    getPermanentEffectivePower,
    getPermanentEffectiveToughness,
} from "./layers";
import {
    isCreature,
    isLand,
    isUntappedManaSource,
    hasNonManaActivatedAbility,
    isTapLockedBySummoningSickness,
    getProducibleColorsOnBoard,
    hasInstantSpeed,
    manaValue,
} from "./constants";
import type { ActivatedAbility } from "../cards/types";
import { getEffectiveActivatedAbilities } from "./activatedAbilities";
// Issue #1890 item 3 — the single authority on whether an activation could just
// as well happen in a later, better-informed window (CR 117.1b / 602.5d).
import { isDeferrableStackAbility } from "./ai/abilityTiming";
import { loyaltyRealizationRatio } from "./ai/loyaltyValue";
import {
    hasGraveyardRecursionAccess,
    isSelfReachableInGraveyard,
    latentGraveyardValue,
} from "./ai/graveyardReach";
import {
    getInstanceManaCost,
    getInstanceAiValue,
    tryGetDefinition,
} from "../cards";
import { dangerClock, predictCombatOutcome } from "./dangerClock";
import { castableHeldInteraction } from "./heldInteraction";
import { comboScore } from "./ai/comboAnnotations";
import {
    creatureValueRaw,
    dslLatentPiecesById,
    dslRealizedAbilityValueById,
    latentValue,
} from "./cardValue";
import { keywordBonusFor } from "./creatureBody";
// Issue #2937 — the single authority on which granted keywords are PROTECTIVE
// and on whether anything the opponent is doing can currently reach the
// permanent that carries them.
import { isQuietFor, temporaryDefensiveKeywords } from "./ai/defensiveGrants";
import { DEFAULT_EVAL_WEIGHTS, type EvalWeights } from "./ai/evalWeights";

/** A won position. Large enough to dominate every reachable material margin so
 *  the bot always prefers lethal, and finite so two winning lines stay
 *  comparable by their material margin. Forge-scale material tops out in the
 *  low tens of thousands even on a wide board, far below this.
 *
 *  Kept as a top-level export — byte-identical to `DEFAULT_EVAL_WEIGHTS.winScore`
 *  (issue #2683) — for the many call sites that want the production constant
 *  without threading a weights vector (search.ts's terminal-detection
 *  branches, tests). `evaluate()` itself reads `weights.winScore`, not this. */
export const WIN_SCORE = DEFAULT_EVAL_WEIGHTS.winScore;

// --- Forge-scale material weights (ADR 0018, issue #2683) ------------------
// Tuned for ordering (see file header). On the ~100-base scale a 2/2 vanilla is
// worth ~170, so life, hand and mana are scaled to stay commensurate. Extracted
// into `EvalWeights` (issue #2683) so calibration, a fitted eval, and ladder
// strength experiments can swap a vector instead of editing these constants —
// `weights.lifeWeight` / `weights.permanentWeight` / `weights.manaWeight` below
// are `DEFAULT_EVAL_WEIGHTS`'s `8` / `5` / `12`, this file's old `W_LIFE` /
// `W_PERMANENT` / `W_MANA`. `W_MANA` (`weights.manaWeight`) is weighted so
// DEVELOPING a land stays strictly positive (issue #149): a land drop is
// −cardValue(land) (leaves hand) +permanentWeight (enters battlefield, not a
// creature so no creature value) +manaWeight (adds an untapped source). A
// basic land's latent `cardValue` is NONCREATURE_BASE (8, MV 0), so the delta
// is −8 +5 +12 = +9 > 0 at the default vector — the greedy 1-ply selection and
// the ISMCTS tie-break both prefer the drop over passing.

// --- Reactive flexibility (ADR 0021 slice 1, issue #221; board half issue
// --- #1890 item 3) ---------------------------------------------------------
// Option value of holding an instant-speed answer you can actually use right
// now. For each holdable instant / flash card in hand that the player has
// enough open, untapped mana to cast THIS turn — and, since issue #1890 item 3,
// for each PERMANENT offering a live, affordable instant-speed ACTIVATED option
// — `evaluate` adds a small, bounded bonus. This gives the search a reason to
// KEEP the option rather than spend it for no payoff: a hand that can respond is
// worth more than the same hand tapped out, and so is a board with an untapped
// Mother of Runes over the same board with her tapped.
//
// The board half was blocked on issue #1920 and shipped with it. The credit is
// symmetric — it pays for holding the option in EVERY window, including the
// reactive one where the option should be spent — so while the search applied an
// activation's costs without ever putting its effect on the stack, this term
// priced an option whose payoff no depth of search could see, and turned the
// exact tie between "activate in response to removal" and `pass` into a
// deterministic decline. No scoping of the term repairs that: the leaf reached
// after `pass` legitimately has the option unspent.
//
// Scoped strictly to "can I respond, and with what, right now". It is NOT a
// second count of the card's body: ADR 0018's latent `cardValue` already counts
// the card while it sits in hand (see the `hand` term). This term is ADDITIVE
// and GATED on castability, so the two never double-count — a card you cannot
// afford to cast this turn (mana tapped out) contributes zero flexibility.
//
// Mana model: the affordability check counts untapped mana sources + floating
// mana against the card's mana value, the same color-blind coarse proxy the
// `mana` term uses (CR 601 colored requirements are not modelled here). Bounded
// by `FLEX_CARD_CAP` so a hand stuffed with cheap instants cannot let the term
// dominate genuine material — it only ever tips otherwise-close lines.
// `weights.flexWeight` / `weights.flexCardCap` below (issue #2683) — bonus per
// castable held instant (small: < a land drop's +9), capped at this many
// instants (bound the term).

// --- Latent `cardValue` primitive (ADR 0018, issue #195) -------------------
// The worth of a specific card while it is NOT in play (hand / library /
// graveyard), used for the Hand term and (slice 4) the resolution-choice path.
// Creatures reuse the Forge `evaluateCreature` body, discounted because a card
// in hand still has to be cast (and survive) to realize its board value; non-
// creatures get `base + MV × k`. An `aiValue` override on the CardDefinition
// replaces the derived value verbatim. A card is scored as latent OR realized,
// never both (battlefield permanents keep their realized eval), so the
// issue-#138 material tie-break stays intact.
//
// The pure body of this primitive (`creatureValueRaw`, `latentValue`,
// `cardValueById`) now lives in `./cardValue` (issue #1113, PRD #1107): it has
// no `GameState` dependency, so it is the module the Limited Bot Drafter's
// Pick Heuristic shares with this Brain evaluator instead of re-deriving card
// quality from scratch. Re-exported here (`cardValueById`) and used below
// (`creatureValueRaw`, `latentValue`) so this file's own behavior and tests
// are unchanged.
export { cardValueById } from "./cardValue";

/** Realized Forge-scale value of a creature in play. Reads PERMANENT effective
 *  P/T (ADR 0020 §2) — until-end-of-turn buffs (combat tricks) are excluded so
 *  the leaf does not score a temporary +X/+X as lasting board material, which
 *  gave the bot a false incentive to dump a trick at sorcery speed. Persistent
 *  layers (counters, static buffs) still count. Mana value comes from the
 *  registry / embedded cost. Floored at 0 power/toughness so a shrunk creature
 *  never goes negative through the body term.
 *
 *  Realized worth = body PLUS the creature's DSL ability-script value
 *  (`dslRealizedAbilityValueById`, review #1440): a utility creature in play
 *  (a pinger, a sac outlet) is worth more than a vanilla of the same size, so
 *  the bot values keeping/deploying it correctly. This ALSO restores the
 *  issue-#149 invariant — the latent (in-hand) worth is the discounted body
 *  (0.85×) plus the DISCOUNTED ability value (0.5×), both factors < 1, so
 *  latent is strictly below this realized worth for every creature; developing
 *  a good utility creature is always a strictly positive move (it was inverted
 *  before: latent counted the ability, realized did not). The ability value is
 *  derived from the REGISTRY definition keyed by the card's id — the same
 *  projection-safe path the latent term uses, never the wire-stripped
 *  `card.card` blob — so it is identical client- and server-side. Scored on a
 *  creature in play; a creature is scored as realized OR latent, never both,
 *  so the ability value is never double-counted. */
export function evaluateCreature(
    state: GameState,
    card: CardInstanceState
): number {
    return (
        creatureValueRaw(
            Math.max(0, getPermanentEffectivePower(state, card)),
            Math.max(0, getPermanentEffectiveToughness(state, card)),
            manaValue(getInstanceManaCost(card)),
            card.staticAbilities
        ) -
        // Issue #2937 — `creatureValueRaw` prices EVERY occurrence in
        // `staticAbilities` off the flat `KEYWORD_BONUS` table, which is right
        // for a printed characteristic and wrong for a duration-scoped
        // defensive GRANT in a position where nothing can reach the creature:
        // a flat, unconditional +30 is what made the bot discard a card to gain
        // indestructible with nothing to be indestructible against. Zero unless
        // the creature both carries such a grant AND stands in a provably quiet
        // position (`ai/defensiveGrants.ts`, fail-closed in every clause), so
        // no other board's valuation moves.
        quietDefensiveGrantFlat(state, card) +
        // `card` doubles as the ability-gate subject (issue #1936): the
        // trigger system already treats a raw `CardInstanceState` as the
        // `PermanentView` a CR 603.4 condition reads, so a gated trigger's
        // script value is DECIDED for this permanent (was it evoked? dashed?)
        // rather than charged/credited unconditionally.
        dslRealizedAbilityValueById(String(card.card.id ?? ""), card)
    );
}

/** Latent Forge-scale worth of a card NOT in play (hand / library / graveyard),
 *  from its live instance — the Hand-term entry point (reads effective P/T, so a
 *  buffed hand card is rare but correct). Pure. */
export function cardValue(state: GameState, card: CardInstanceState): number {
    return latentValue({
        isCreature: isCreature(card),
        power: getEffectivePower(state, card),
        toughness: getEffectiveToughness(state, card),
        manaValue: manaValue(getInstanceManaCost(card)),
        staticAbilities: card.staticAbilities,
        aiValue: getInstanceAiValue(card),
        // DSL-derived semantic layer (PRD #1423, issue #1426): reads the card's
        // Effect Script off the REGISTRY definition, keyed by the id that
        // survives the wire projection (`card.card` is stripped to `{ id }`) —
        // so the value is identical client- and server-side.
        ...dslLatentPiecesById(String(card.card.id ?? "")),
    });
}

/** One player's material score split into its weighted contributions. Each
 *  field is the term's contribution to the score, so the terms sum to the
 *  player's `playerScore`. Surfaced by `evaluateBreakdown` for the DecisionTrace
 *  debug view — seeing the per-term decomposition is what distinguishes "the
 *  draw/pump was not simulated" (the term is unchanged across choices) from a
 *  genuine evaluation. `creatures` is the summed Forge `evaluateCreature` of all
 *  creatures in play; `permanents` is the flat board-presence bonus. */
export type EvalTerms = {
    life: number;
    hand: number;
    creatures: number;
    permanents: number;
    mana: number;
    /** Mana development (issue #2686): the value of the player's mana base
     *  relative to what the hand still wants to cast. See
     *  `manaDevelopmentTerm` for the calibration and the on-curve vs flooded
     *  contrast it draws. */
    manaDevelopment: number;
    /** Reactive flexibility (ADR 0021 slice 1): bounded option-value bonus for
     *  holdable instants in hand the player can afford to cast this turn, PLUS
     *  (issue #1890 item 3) permanents offering a live, affordable instant-speed
     *  activated option. One shared cap across both halves. */
    flexibility: number;
    /** CR 104.3c / 704.5b — how close this player is to LOSING to an empty
     *  library. Zero (exactly) above `deckingHorizon`, so it cannot move a
     *  position that is not near decking; steeply negative as the library
     *  runs out. See `libraryTerm`. */
    library: number;
    /** CR 702.138 — worth of the cards in this player's own graveyard while a
     *  permanent they control makes that graveyard castable. Zero (exactly)
     *  with no such engine on the battlefield. See `graveyardEngineTerm`. */
    graveyard: number;
    /** Issue #3042 — worth of the cards in this player's graveyard that the
     *  player can actually REACH: recover with recursion they hold, or use
     *  from the graveyard itself. Exactly zero for a graveyard with no
     *  reachable payoff, which is every ordinary one. See
     *  `graveyardReachTerm` and `ai/graveyardReach.ts`. */
    graveyardReach: number;
};

/** Untapped mana sources + floating mana available to `player` this turn — the
 *  color-blind coarse proxy the `mana` term and the flexibility / castability
 *  gates all share (CR 601 colored requirements are not modelled).
 *
 *  Known asymmetry (issue #2247): an untapped source counts exactly 1
 *  regardless of its real output, while floating mana in the pool counts per
 *  unit — so tapping a multi-mana source (Sol Ring) and floating the surplus
 *  reads as a gain over leaving it untapped. `evaluateAutoTapPosition`'s
 *  smart-auto-tap ranking does NOT rely on this function for that decision:
 *  #2247 adds a dedicated surplus-avoidance term to `solveSmartAutoTapCore`
 *  (`autoTap.ts`, `planSurplus`, reading `floatingAfterPlan`'s exact leftover
 *  pool directly) sized to dominate this proxy's noise for the ranking, so
 *  the auto-tap bug is fixed without correcting the proxy itself here.
 *
 *  Out of scope for #2247: correcting this function (and its duplicate,
 *  `heldInteraction.ts`'s `availableManaFor`) to count a source's real output
 *  would move the `mana`/flexibility terms on every ISMCTS leaf and the
 *  castability gates bot-wide, for every board with a multi-mana untapped
 *  source — a change disproportionate to, and independently verifiable from,
 *  the ranking fix above. Left as a deliberate simplification pending its own
 *  slice if a symptom traces back to this proxy specifically (rather than to
 *  the auto-tap ranking, which #2247 already covers). */
function availableManaFor(player: PlayerState): number {
    let n = 0;
    for (const perm of player.battlefield) {
        // CR 605.1a / 305.6 — a source counts only if it can actually produce
        // mana. A fetchland (no mana ability) is NOT a source (issue #1499);
        // nor is a board-conditional source whose CURRENT output is zero — an
        // Everflowing Chalice with no charge counters (issue #1889), which is
        // why the controller's own battlefield is threaded through.
        if (isUntappedManaSource(perm, player.battlefield)) n += 1;
    }
    for (const c of ["W", "U", "B", "R", "G", "C"] as const) {
        n += player.manaPool[c] ?? 0;
    }
    return n;
}

/** Whether `playerId` holds at least one instant-speed card it can afford to
 *  cast THIS turn (ADR 0021 slice 1 castability, reused by slice 3). The search
 *  uses this to know a player has a live reactive option — a trick to ambush a
 *  block with, a removal to hold up — when deciding whether the reactive line is
 *  worth exploring.
 *
 *  `extra` narrows the instant-speed set further (primitive reuse, issue
 *  #2248): the mover's-own-main hold nudge (`isReactiveHold` in `search.ts`)
 *  needs "at least one affordable FLASH PERMANENT" specifically, not any
 *  instant-speed card — a plain Instant's sorcery-speed dump is already
 *  covered by the existing reactive-cast prior and rollout guardrail, so
 *  reusing this predicate unfiltered there would blur a narrow nudge into a
 *  general "consider passing on my own turn" bias. Omitted, it reproduces the
 *  original unfiltered behavior every existing caller relies on. */
export function hasCastableInstant(
    state: GameState,
    playerId: string,
    extra?: (card: CardInstanceState) => boolean
): boolean {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return false;
    const availableMana = availableManaFor(player);
    return player.hand.some(
        (c) =>
            hasInstantSpeed(c) &&
            (!extra || extra(c)) &&
            manaValue(getInstanceManaCost(c)) <= availableMana
    );
}

/** Whether `playerId` holds at least one affordable FLASH PERMANENT — a
 *  non-Instant card carrying the Flash keyword (CR 702.8) — with the mana open
 *  THIS turn to cast it (issue #2248). A thin, named wrapper over
 *  `hasCastableInstant`'s `extra` filter rather than a parallel
 *  implementation (primitive reuse) — see that function's doc for why the
 *  narrowing matters. */
export function hasCastableFlashPermanent(
    state: GameState,
    playerId: string
): boolean {
    return hasCastableInstant(
        state,
        playerId,
        (c) => !c.types.includes("Instant")
    );
}

/** Activation cost legs the board-side flexibility term is willing to price.
 *
 *  A permanent's activated ability is a "held option" in the same sense a held
 *  instant is only when using it spends nothing but mana and the source's own
 *  tap. Every other leg — a sacrifice, a discard, a graveyard exile, a counter
 *  removal, life — is a real resource, so the ability is not free to hold and
 *  its payability needs the activation cost planner (`enumerateActivationCostPicks`,
 *  `moves.ts`), which this leaf-heuristic must not re-implement.
 *
 *  Expressed as an ALLOWLIST over the cost's own keys, deliberately: a cost leg
 *  added to `ActivatedAbility` in future then drops the credit (fail closed)
 *  instead of silently inflating it, which a hand-written list of `if
 *  (cost.sacrifice) return false` checks would do. */
const FLEX_FREE_COST_KEYS: ReadonlySet<string> = new Set(["mana", "tap"]);

function isFreeToHoldCost(cost: ActivatedAbility["cost"]): boolean {
    for (const [key, value] of Object.entries(cost)) {
        if (value === undefined) continue;
        if (!FLEX_FREE_COST_KEYS.has(key)) return false;
    }
    return true;
}

/** The ability ids of `perm` that `player` has ANNOUNCED and that are still on
 *  the stack (CR 602.2a) — the option is in flight: neither still held, nor yet
 *  realized into the position.
 *
 *  Identified by instance id because an activated ability's stack item IS a
 *  snapshot of its source (`buildActivatedAbilityStackItem`, `gre/activationCommit.ts`),
 *  carrying the same `id`; `abilityId` distinguishes it from a triggered ability's
 *  item, and `castById` from an activation the OPPONENT made off this permanent
 *  (CR 113.3c — "any player may activate"). */
function activationsInFlight(
    state: GameState,
    player: PlayerState,
    perm: CardInstanceState
): ReadonlySet<string> {
    const out = new Set<string>();
    for (const item of state.stack) {
        if (item.abilityId === undefined) continue;
        if (item.id !== perm.id) continue;
        if (item.castById !== player.id) continue;
        out.add(item.abilityId);
    }
    return out;
}

/** Whether `perm` offers `player` an instant-speed activated option that is
 *  still THEIRS — live and affordable, or already announced and awaiting
 *  resolution. The board-side mirror of `hasInstantSpeed` (issue #1890 item 3).
 *
 *  Per-card-agnostic by construction: the only inputs are the ability's declared
 *  TIMING (through `isDeferrableStackAbility`, the shared authority), its cost
 *  shape, and board state. `hasNonManaActivatedAbility` is the gate for "this
 *  source does something beyond producing mana" — the same predicate the
 *  auto-tapper uses to know a source is dual-purpose, so the two can never
 *  disagree, and it already returns false for a permanent stripped of its
 *  abilities (CR 613.1f, Titania's Song).
 *
 *  **Why an ANNOUNCED option still counts** (and this is load-bearing, not
 *  generosity): the term prices whether the player still owns the option, and it
 *  must price it exactly ONCE — at the moment the effect actually enters the
 *  position. An ability on the stack has been paid for but has not resolved, so
 *  the leaf shows the source tapped AND shows no payoff. Dropping the credit
 *  there charges for the spend twice, and the second charge is an artefact of the
 *  1-ply horizon rather than anything about the position.
 *
 *  That artefact is not hypothetical. `policyValue` resolves one stack item, and
 *  a resolution that SUSPENDS on a mid-resolution choice (CR 601.2b / 608.2 —
 *  Mother of Runes picks a colour) yields no payoff at that depth by
 *  construction. Measured on the issue-#1890 reactive fixture (opponent's Bolt on
 *  the stack aimed at Mother, the bot holding priority): without the in-flight
 *  clause, `pass` scored 192.5 and the activation 186.5 — a deficit of exactly
 *  `W_FLEX`, so `selectRolloutMove`'s exact-equality argmax dropped the
 *  activation out of the bucket entirely and NO rng value could return it. That
 *  is the regression this term was held back from PR #1919 to avoid, arriving
 *  through the one door closing issue #1920 does not shut.
 *
 *  Every remaining check is FAIL CLOSED — an option this function cannot prove
 *  is live scores no flexibility. The first four are properties of the ability
 *  itself, so they apply announced or not:
 *
 *    * `activateFromHand` / `activateFromGraveyard` (CR 113.6) — the ability
 *      functions from another zone, so it is not an option this permanent offers.
 *    * `canActivate` / `getTargetRequirement` — a runtime predicate this leaf
 *      heuristic does not evaluate, exactly as the move enumerator refuses to
 *      (`moves.ts`).
 *    * `activatableByOpponentsOnly` (CR 602.1) — an ability only the OPPONENT
 *      may activate is not this player's option to hold.
 *
 *  The rest are AVAILABILITY, which an announced ability has already cleared —
 *  it is on the stack, so re-testing them would reject the very state the
 *  in-flight clause exists to credit (its `oncePerTurn` tally is already
 *  incremented, its `{T}` source already tapped):
 *
 *    * `oncePerTurn` already used (CR 602.5) and an already-animated
 *      `animatesSelf` manland (CR 611.1) — spent options, not held ones.
 *    * `controllerTurnOnly` off-turn — not activatable in the very window the
 *      credit is about.
 *    * a `{T}` leg with the source tapped or summoning-locked (CR 302.1).
 *    * a mana cost the player cannot currently cover. */
function hasFlexibleActivation(
    state: GameState,
    player: PlayerState,
    perm: CardInstanceState,
    availableMana: number
): boolean {
    // The shared "does something beyond producing mana" authority (CR 605.1a) —
    // the same predicate the auto-tapper uses, never a parallel copy.
    //
    // It walks the post-layer ability set, and the loop below walks it again:
    // two allocations per candidate permanent per `evaluate` call on the ISMCTS
    // hot path (issue #1920 review, finding 5, measured there at ~+8%). Folding
    // the two into one walk was tried and REVERTED — measured interleaved over
    // 50k `evaluate` calls with 10 permanents a side, three pairs: 6397/5568/6543
    // ms before against 6391/5753/5965 after, a ~2% mean difference inside a
    // ~1000 ms run-to-run spread on this shared machine. The cost is the
    // board-side loop EXISTING on the hot path at all, not the double walk, so
    // the redundancy buys clarity for nothing measurable and the simpler shape
    // stays.
    if (!hasNonManaActivatedAbility(perm)) return false;
    const abilities = getEffectiveActivatedAbilities(perm);
    const inFlight = activationsInFlight(state, player, perm);
    for (const { ability } of abilities) {
        if (!isDeferrableStackAbility(ability)) continue;
        if (ability.activateFromHand || ability.activateFromGraveyard) continue;
        if (ability.canActivate || ability.getTargetRequirement) continue;
        // CR 602.1 — "Only your opponents may activate this ability" (Clergy of
        // the Holy Nimbus). It is not an option THIS player holds at all, and
        // `enumerateMoves` offers them none; without this gate the term credited
        // the controller for an ability only the opponent can use (issue #1920
        // review, finding 1 — the one gate this loop did not mirror from
        // `moves.ts`, and a fail-OPEN one).
        if (ability.activatableByOpponentsOnly) continue;
        if (!isFreeToHoldCost(ability.cost)) continue;
        if (inFlight.has(ability.id)) return true;
        if (
            ability.oncePerTurn &&
            (perm.activationsThisTurn?.[ability.id] ?? 0) > 0
        ) {
            continue;
        }
        // CR 702.142a (Boast, issue #2375) — "Activate only if this creature
        // attacked this turn". Mirrored from `moves.ts`' enumerator for the
        // same reason every other gate in this loop is: a flexible-activation
        // credit for an ability the enumerator will never offer is a
        // fail-OPEN valuation of an option the player does not hold.
        if (
            ability.requiresAttackedThisTurn &&
            perm.hasAttackedThisTurn !== true
        ) {
            continue;
        }
        if (ability.animatesSelf && perm.animation) continue;
        if (ability.controllerTurnOnly && state.activePlayerId !== player.id) {
            continue;
        }
        if (ability.cost.tap) {
            if (perm.isTapped) continue;
            if (isTapLockedBySummoningSickness(perm)) continue;
        }
        if (manaValue(ability.cost.mana) > availableMana) continue;
        return true;
    }
    return false;
}

/** The reactive-flexibility bonus for one player (ADR 0021 slice 1, issue #221;
 *  board half issue #1890 item 3).
 *
 *  Two halves, one shared budget:
 *
 *    * HAND — holdable instants the player has enough open mana to cast THIS
 *      turn (`availableMana` ≥ the card's mana value, the same color-blind proxy
 *      the `mana` term uses).
 *    * BOARD — permanents offering an instant-speed ACTIVATED option that is
 *      still the player's, live or in flight (`hasFlexibleActivation`). The
 *      mirror case: every seam that expressed option value read
 *      `types.includes("Instant")`, so a battlefield Mother of Runes carried
 *      none at all.
 *
 *  Both halves are additive to the latent worth already counted elsewhere (the
 *  `hand` term's `cardValue`, the `permanents` term's board presence), so
 *  neither double-counts a body — this term prices only "can I respond, and with
 *  what, right now". Castability-gated, so a tapped-out player and a tapped-out
 *  board both score zero.
 *
 *  ONE shared `FLEX_CARD_CAP` across both halves, not one cap each: the cap
 *  exists to stop the term dominating genuine material, and two independent caps
 *  would double the ceiling it was chosen to hold.
 *
 *  The board half only became safe to ship with issue #1920. The credit is
 *  SYMMETRIC — it pays for holding the option in every window, the reactive one
 *  included — so while the search could not see an activation's payoff, it
 *  turned the exact tie between "activate in response to removal" and `pass`
 *  into a deterministic `W_FLEX`-sized loss for the activation
 *  (`selectRolloutMove`'s argmax is exact-equality). Now that the ability
 *  reaches the stack and `policyValue` resolves it, spending the option pays for
 *  itself; the pin is
 *  `convex/gre/__tests__/activationPayoffInSearch.bot.test.ts`, which asserts
 *  the activation beats `pass` by MORE than `W_FLEX` in that window. */
function flexibilityTerm(
    state: GameState,
    player: PlayerState,
    availableMana: number,
    weights: EvalWeights
): number {
    let castable = 0;
    for (const card of player.hand) {
        if (castable >= weights.flexCardCap) break;
        if (!hasInstantSpeed(card)) continue;
        if (manaValue(getInstanceManaCost(card)) > availableMana) continue;
        castable += 1;
    }
    for (const perm of player.battlefield) {
        if (castable >= weights.flexCardCap) break;
        if (!hasFlexibleActivation(state, player, perm, availableMana))
            continue;
        castable += 1;
    }
    return castable * weights.flexWeight;
}

/** The mana-development term (issue #2686) — the value of a player's mana base
 *  relative to what their hand still wants to cast.
 *
 *  CALIBRATION (the numbers the ticket asks to document). A land's flat worth
 *  today is `permanentWeight (5) + manaWeight (12) = 17`, while a 2-life gain
 *  is `2 × lifeWeight (8) = 16` — a 1-point gap, inside the rollout-noise band,
 *  so "sacrifice a land for 2 life" (Zuran Orb) ties with passing and is decided
 *  by noise. The term prices the DEVELOPMENT a land buys: a land on curve —
 *  the player has fewer lands than the largest mana value their hand still
 *  wants to reach — is worth `manaDevWeight` (12, symmetric with `manaWeight`)
 *  ON TOP of the flat 17, i.e. 29, decisively above 16. A land whose mana the
 *  hand no longer needs (the base is flooded) earns no development bonus and
 *  returns to 17 — the mana it produces has nothing to cast, so it is worth
 *  less than the cards that would use it.
 *
 *  DEMAND IS THE CURVE, NOT THE HAND (issue #2927). The demand proxy shipped by
 *  #2686 was the SUM of every hand card's mana value, and a sum binds at land
 *  counts a game never reaches: a 7-card hand of average MV 3 asks for 20
 *  lands, so `min(lands, handNeed)` selected `lands` in virtually every real
 *  position, the flooded branch never fired, and the term degenerated to a flat
 *  `manaDevWeight` per land. A sum also encodes the wrong quantity twice over —
 *  it rewards holding MORE cards (drawing raises demand with no land gained),
 *  and it reads two 6-drops as "this player needs 12 lands", which is not what
 *  being on curve means. The largest mana value in hand is the quantity being
 *  on curve is ABOUT: it binds at 1-7 (the range boards actually reach), it
 *  moves only when the top of the curve moves, and a hand whose most expensive
 *  card is a 2-drop stops wanting a third land — which is exactly the "flooded"
 *  reading. The cap is the hand's own top end, so no magic constant is needed.
 *
 *  This is a SNAPSHOT of the position (the owner's framing on this ticket): it
 *  reads only the land count and the hand's mana values (castability), never a
 *  forecast ("a land is worth a lot because flooding loses games later" — that
 *  belongs to the search, not a weight). Lands in hand contribute zero demand:
 *  a land is played, never cast (CR 305.1 — a land "is never a spell"), and a
 *  card with no mana cost has mana value 0 (CR 202.3a), so a held land is not
 *  something this term should urge the player to ramp toward.
 *
 *  Zero card names, pure, and state-only by construction. */
/** The flat `KEYWORD_BONUS` value `creatureValueRaw` has already added for
 *  defensive keyword occurrences that reached `card` through a DURATION-SCOPED
 *  grant, in a position where nothing can currently reach it (issue #2937).
 *  Read off the same table that added it (`keywordBonusFor`), so the two can
 *  never drift, and gated on `isQuietFor` so the correction never fires while
 *  anything is on the stack, any combat damage is headed at the creature, or
 *  the opponent can pay for an answer. */
function quietDefensiveGrantFlat(
    state: GameState,
    card: CardInstanceState
): number {
    const keywords = temporaryDefensiveKeywords(card);
    if (keywords.length === 0) return 0;
    if (!isQuietFor(state, card)) return 0;
    const power = Math.max(0, getPermanentEffectivePower(state, card));
    let flat = 0;
    for (const keyword of keywords) flat += keywordBonusFor(keyword, power);
    return flat;
}

function manaDevelopmentTerm(
    player: PlayerState,
    weights: EvalWeights
): number {
    // The TOP OF THE CURVE the hand still wants to reach: the largest mana
    // value in hand, never the sum of them (issue #2927). Lands count as 0
    // (played, not cast — CR 305.1; no mana cost → MV 0 — CR 202.3a).
    let handNeed = 0;
    for (const c of player.hand) {
        const mv = manaValue(getInstanceManaCost(c));
        if (mv > handNeed) handNeed = mv;
    }
    // Every land counts — tapped or untapped — because development is about the
    // BASE the hand can draw on, not the current-turn tap state (which the
    // `mana` term already prices). Each land up to the hand's need is "earning
    // its keep"; beyond that the base is flooded and a further land unlocks
    // nothing.
    const lands = player.battlefield.filter((c) => isLand(c)).length;
    return weights.manaDevWeight * Math.min(lands, handNeed);
}

/** CR 104.3c / 704.5b — the cost of a library running out.
 *
 *  A player who must draw from an empty library loses, so the cards left in it
 *  are a resource exactly like life, and milling is a way to win. Before this
 *  term the evaluator could not see a library AT ALL: measured on the probe
 *  board, `evaluate` returned the identical 25.0000 for an opponent library of
 *  40, of 1 and of 0, while an opponent at 1 life scored 177 — so no amount of
 *  search could ever find a mill kill, because the objective did not exist in
 *  the value function.
 *
 *  NARROW SUPPORT (ADR 0070 §5), like `lethalUnblockedDelta` below: exactly
 *  zero at or above `deckingHorizon`, so an ordinary game is byte-identical
 *  and no global weight is touched. Quadratic below it, so the gradient is
 *  shallow where decking is theoretical and steep where it decides the game —
 *  the shape `dangerClock` already uses for the life race. Negative for the
 *  player who is short: `evaluate` takes my score minus the opponent's, so
 *  milling THEM raises my score and milling MYSELF lowers it, with no
 *  special-casing of who is who. */
/** Phases in which the ACTIVE player has not yet taken their draw step, so the
 *  next draw in the game is theirs. Spelled out rather than imported: the phase
 *  order is a module-local const in `phases.ts`, and this only needs the cut at
 *  DRAW. CR 103.8a's skipped first draw is deliberately ignored — this is a
 *  leaf heuristic, and turn one is not a decking endgame. */
const PHASES_BEFORE_ACTIVE_DRAW: ReadonlySet<string> = new Set([
    "MULLIGAN",
    "UNTAP",
    "UPKEEP",
    "DRAW",
]);

/** Whose draw step comes NEXT (CR 504.1). The whole reason decking is a RACE
 *  rather than a resource: with both libraries equally short, the player who
 *  draws first is the one who loses. */
function playerDrawingNext(state: GameState): string | undefined {
    const active = state.activePlayerId;
    if (PHASES_BEFORE_ACTIVE_DRAW.has(state.phase)) return active;
    return state.players.find((p) => p.id !== active)?.id;
}

function libraryTerm(
    state: GameState,
    player: PlayerState,
    weights: EvalWeights
): number {
    const remaining = player.library.length;
    // Half a draw of handicap to whoever draws FIRST, so two equally short
    // libraries no longer cancel exactly: the player about to draw is strictly
    // worse off, which is the truth (CR 104.3c) and is what stops the bot
    // treating "mill us both out" as neutral.
    const effective =
        remaining + (playerDrawingNext(state) === player.id ? 0 : 0.5);
    if (effective >= weights.deckingHorizon) return 0;
    const deficit = weights.deckingHorizon - effective;
    return -weights.deckingWeight * deficit * deficit;
}
// CALIBRATION. `deckingWeight` is sized so this term's whole range —
// `deckingHorizon² · deckingWeight` ≈ 216 — stays well inside
// `weights.materialFull` (500), the cap `materialSignal` (`search.ts`) clips
// at. At the original 4 the range was 576, so on a WON leaf the opponent's
// empty-library penalty alone saturated the band: every continuation mapped to
// the identical reward 1.0 and the search could not tell "keep my own library"
// from "mill myself too". Measured on a 9/9 Underworld Breach board,
// `v - winScore` now runs +384.6 → +348.6 → +285.6 → +228.6 → +195.6 as the
// bot's own library is spent, so the won band orders them and surplus storm
// copies stop being pointed at their own controller by rollout noise.

/** CR 702.138 — a graveyard is a RESOURCE while something makes it castable.
 *
 *  Underworld Breach ("Each nonland card in your graveyard has escape. The
 *  escape cost is ... plus exile three other cards from your graveyard") turns
 *  every four cards in the graveyard into roughly one more spell: the one cast,
 *  plus the `exileOtherCount` exiled to pay for it. Without this term the
 *  evaluator saw a graveyard as worth nothing at all, so filling one's OWN
 *  graveyard was pure loss — measured on the Breach probe, the bot fired Brain
 *  Freeze at the opponent for three cards and stopped, and would never mill
 *  ITSELF to make escape fodder, which is the first half of the real line.
 *
 *  NARROW SUPPORT (ADR 0070 §5): exactly zero unless the player controls a
 *  permanent whose definition declares `grantsEscapeToOwnGraveyard`, so no
 *  ordinary board is moved and the hot path pays one cached definition lookup
 *  per permanent. The arithmetic is read off the GRANT (`exileOtherCount`),
 *  never off a card name, so any future card of the same shape is priced by
 *  the same rule.
 *
 *  Deliberately NOT covered: a card carrying PRINTED escape (Uro, Phlage,
 *  Nethergoyf) with no such engine in play. That is a per-card property rather
 *  than a graveyard-wide one, and pricing it means walking the graveyard on
 *  every leaf. Left out rather than approximated.
 *
 *  Calibration note: sized so a self-mill is VISIBLE against the library it
 *  costs, not so it wins automatically. Milling the opponent stays the better
 *  leaf; self-milling only pays off through the multi-step line the search has
 *  to actually find, which is where that decision belongs. */
function graveyardEngineTerm(
    player: PlayerState,
    weights: EvalWeights
): number {
    let exileOtherCount: number | undefined;
    for (const perm of player.battlefield) {
        const permId = (perm.card as { id?: string }).id;
        const grant = permId
            ? tryGetDefinition(permId)?.grantsEscapeToOwnGraveyard
            : undefined;
        if (grant) {
            exileOtherCount = grant.exileOtherCount;
            break;
        }
    }
    if (exileOtherCount === undefined) return 0;
    // One cast consumes the card itself plus `exileOtherCount` others.
    const perCast = exileOtherCount + 1;
    const casts = Math.floor(player.graveyard.length / perCast);
    return (
        Math.min(casts, weights.graveyardEngineCap) *
        weights.graveyardEngineWeight
    );
}

/** Issue #3042 — a graveyard is worth something only to a player who can
 *  REACH it. Without this term a card put into a graveyard was worth exactly
 *  zero, so a correct Entomb (bury the fatty, reanimation already in hand)
 *  evaluated as a strict loss — the hand term dropped by the tutor and nothing
 *  came back — and the whole line ranked below doing nothing past the rollout
 *  horizon.
 *
 *  THE GATE IS THE TERM (`ai/graveyardReach.ts`). Credit is conditional on a
 *  reachable payoff: recursion the player holds or controls, or the card being
 *  usable out of the graveyard on its own. With none reachable the term is
 *  EXACTLY zero — a graveyard is a dead zone by default and must evaluate as
 *  one — so every position that has no payoff scores byte-identically to
 *  before the term existed (ADR 0070 §5 narrow support). The gate is per
 *  player and symmetric: the opponent's graveyard is credited to the OPPONENT
 *  under the OPPONENT's own reach, never assumed hostile or harmless.
 *
 *  IT MUST NOT MAKE A TRADE A WASH. A creature dying already moves its full
 *  realized worth out of `creatures` (plus `permanentWeight`); returning a
 *  large slice of it here would have the bot chump-blocking and trading for
 *  free. Only `graveyardReachFraction` of each card's LATENT worth comes back,
 *  best-first and capped at `graveyardReachCap` — the payoff can be used a
 *  bounded number of times, and this term models neither the mana nor the
 *  cards that would pay for it.
 *
 *  NO DOUBLE COUNT with the hand term: `hand` prices cards in HAND, and a
 *  graveyard card is not one. Nor with `graveyardEngineTerm`: that term prices
 *  the pile's escape THROUGHPUT (how many casts the fodder supports) under a
 *  battlefield grant, and this one skips any card whose only reach is exactly
 *  that grant. */
function graveyardReachTerm(
    state: GameState,
    player: PlayerState,
    weights: EvalWeights
): number {
    const cap = weights.graveyardReachCap;
    if (player.graveyard.length === 0 || cap <= 0) return 0;
    // Cheapest gate first: with recursion access every graveyard card is a
    // candidate, so the per-card castability walk is skipped entirely.
    const recursion = hasGraveyardRecursionAccess(player);
    // Bounded top-K rather than value-everything-then-sort: the cap is small
    // (2 in production) and this runs per ISMCTS leaf, per player, so an
    // insertion into a `cap`-sized best list is cheaper than an array the size
    // of the graveyard plus an O(n log n) sort of it.
    const best: number[] = [];
    for (const card of player.graveyard) {
        if (!recursion && !isSelfReachableInGraveyard(state, player, card)) {
            continue;
        }
        const value = latentGraveyardValue(card);
        if (best.length === cap && value <= best[cap - 1]) continue;
        let i = best.length < cap ? best.length : cap - 1;
        while (i > 0 && best[i - 1] < value) {
            best[i] = best[i - 1];
            i -= 1;
        }
        best[i] = value;
    }
    let credited = 0;
    for (const v of best) credited += v;
    return credited * weights.graveyardReachFraction;
}

/** The weighted contributions of one player's resources, from their own
 *  perspective. `sumTerms` of this equals the legacy `playerScore`. */
function playerTerms(
    state: GameState,
    player: PlayerState,
    weights: EvalWeights
): EvalTerms {
    const terms: EvalTerms = {
        life: player.life * weights.lifeWeight,
        // Latent worth of the hand (ADR 0018): each card's `cardValue`, replacing
        // the old flat per-card constant. A bomb in hand now outweighs a spare
        // land, and pitching a good card for no effect is a decisive loss.
        hand: player.hand.reduce((sum, c) => sum + cardValue(state, c), 0),
        creatures: 0,
        permanents: 0,
        mana: 0,
        manaDevelopment: 0,
        flexibility: 0,
        library: libraryTerm(state, player, weights),
        graveyard: graveyardEngineTerm(player, weights),
        graveyardReach: graveyardReachTerm(state, player, weights),
    };

    for (const perm of player.battlefield) {
        terms.permanents += weights.permanentWeight;
        if (isCreature(perm)) {
            terms.creatures += evaluateCreature(state, perm);
        } else {
            // Non-creature, non-land beneficial permanents (a static buff
            // Enchantment like Castle, a card-advantage Artifact like Jayemdae
            // Tome) carry no power/toughness, so without a realized body value
            // they registered only the flat W_PERMANENT (5) — destroying one
            // read as ~neutral and the bot would Disenchant its OWN Castle
            // (issue #365). Give them the SAME Forge-scale realized worth their
            // `cardValue` body assigns latently (an `aiValue` override or
            // `NONCREATURE_BASE + MV × W_NC_MV`), so their loss is a measurable,
            // correctly-signed material change in both `materialMargin` and
            // `evaluate`. Lands are excluded — their worth is already counted by
            // the `mana` term (an untapped source), so adding the body here
            // would double-count and skew the land-drop invariant (issue #149).
            //
            // CR 306.5b / 606.4 (issue #2491, ADR 0107) — a PLANESWALKER's
            // realized worth is that same body scaled by how much of its
            // useful loyalty range it currently holds. Loyalty counters are a
            // resource: a `-N` that empties the walker trades the permanent
            // away, and a `+1` banks a real gain. Without the scale both
            // valued as ~nothing and the search picked between them by
            // rollout noise. `loyaltyRealizationRatio` is exactly 1 at
            // starting loyalty (and for every non-walker), so this line is a
            // no-op for the rest of the catalogue and for every position that
            // existed before the term. The flat `W_PERMANENT` above stays
            // unscaled — "a permanent is here" is equally true at 1 loyalty.
            if (!isLand(perm)) {
                terms.permanents +=
                    cardValue(state, perm) * loyaltyRealizationRatio(perm);
            }
        }
    }
    const availableMana = availableManaFor(player);
    terms.mana = availableMana * weights.manaWeight;
    // The mana-development term prices the base against the hand's castability
    // (issue #2686) — additive to `mana`, never a replacement for it, and zero
    // on any board whose land count already covers the hand's mana needs.
    terms.manaDevelopment = manaDevelopmentTerm(player, weights);
    // Reactive flexibility uses the SAME available-mana count as the affordability
    // gate, so it can only reward instants the player can actually cast now — and
    // activated options the player can actually pay for (issue #1890 item 3).
    terms.flexibility = flexibilityTerm(state, player, availableMana, weights);
    return terms;
}

function sumTerms(t: EvalTerms): number {
    return (
        t.life +
        t.hand +
        t.creatures +
        t.permanents +
        t.mana +
        t.manaDevelopment +
        t.flexibility +
        t.library +
        t.graveyard +
        t.graveyardReach
    );
}

/** Material score of one player's resources, from their own perspective. */
function playerScore(
    state: GameState,
    player: PlayerState,
    weights: EvalWeights
): number {
    return sumTerms(playerTerms(state, player, weights));
}

/** Score `state` from `playerId`'s perspective. Higher = better for the player.
 *  Terminal positions dominate: a win returns ≥ +WIN_SCORE, a loss ≤ −WIN_SCORE
 *  (offset by the surviving material margin so winning lines stay comparable).
 *
 *  `weights` (issue #2683) defaults to `DEFAULT_EVAL_WEIGHTS` — today's
 *  production constants, byte-for-byte — so every existing call site (the
 *  search, greedy selection, the self-play ladder, tests) is unaffected by
 *  this parameter's addition unless it explicitly passes a different vector. */
export function evaluate(
    state: GameState,
    playerId: string,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS
): number {
    const me = state.players.find((p) => p.id === playerId);
    const opp = state.players.find((p) => p.id !== playerId);
    if (!me || !opp) return 0;

    const margin =
        playerScore(state, me, weights) - playerScore(state, opp, weights);

    // Terminal detection. A recorded game-over is authoritative; otherwise a
    // player at ≤ 0 life has effectively lost (SBA may not have run on this
    // sandbox state yet). The material margin is added so two won/lost lines
    // remain ordered by how decisive they are. The Danger Clock is omitted in
    // terminal positions — the outcome already dominates and the race is moot.
    if (state.gameOver) {
        // CR 104.4a — a drawn game is a neutral terminal: neither a win nor a
        // loss for either player (Divine Intervention).
        if (state.gameOver.isDraw) return 0;
        if (state.gameOver.winnerId === playerId)
            return weights.winScore + margin;
        if (state.gameOver.loserId === playerId)
            return -weights.winScore + margin;
    }
    const oppLost = opp.life <= 0;
    const meLost = me.life <= 0;
    if (oppLost && !meLost) return weights.winScore + margin;
    if (meLost && !oppLost) return -weights.winScore + margin;

    // Open position: add the Danger Clock race term (ADR 0018) and, on a
    // declare-attackers leaf, the expected combat exchange (ADR 0020 §3). Both
    // are kept OUT of `materialMargin` so the issue-#138 saturation-proof
    // tie-break stays pure material; they shape only the leaf `evaluate` the
    // reward band reads.
    return (
        margin +
        comboScore(state, playerId) +
        dangerClock(state, playerId) +
        declaredCombatDelta(state, me.id, weights) +
        lethalUnblockedDelta(state, playerId, weights) +
        deckOutDelta(me, opp, weights)
    );
}

/** CR 104.3c / 704.5b — an empty library IS a loss, one step before the SBA
 *  records it.
 *
 *  The same shape and the same justification as `lethalUnblockedDelta` below:
 *  losing to an empty library happens at the next DRAW, not at the moment the
 *  last card leaves, so `state.gameOver` and `hasDrawnFromEmpty` are both still
 *  false on the leaf where the kill is decided. The graded `libraryTerm` gives
 *  the search a gradient to climb toward that leaf; this puts the leaf itself
 *  in the terminal band, where the surviving material margin still orders two
 *  winning lines (issue #138).
 *
 *  NARROW SUPPORT: exactly zero unless a library is actually empty, so no
 *  position that is not one draw from a deck-out can be moved by it.
 *
 *  Both libraries empty is NOT resolved here — see the note in the body. */
function deckOutDelta(
    me: PlayerState,
    opp: PlayerState,
    weights: EvalWeights
): number {
    const meEmpty = me.library.length === 0;
    const oppEmpty = opp.library.length === 0;
    // EXACTLY ONE empty library, and no verdict at all otherwise.
    //
    // Both-empty is deliberately NOT resolved here, though it is the endgame a
    // mill deck produces and though whose draw comes next really does decide it
    // (CR 504.1). A terminal verdict for it was tried and withdrawn, for two
    // measured reasons: every hand-built fixture in the suite has `library: []`
    // for both seats (`cards/__tests__/setup.ts`), so it fired on essentially
    // every synthetic board; and terminal bands STACK — a position already lost
    // to `lethalUnblockedDelta` scored −2 × winScore, the exact doubling that
    // term's own history records fighting once already.
    //
    // Both-empty is instead resolved, sub-terminally, by `libraryTerm`'s
    // half-draw handicap: the player about to draw is strictly worse off, so
    // the position is never read as neutral, and the won-band ORDERING below
    // makes every step towards it strictly worse anyway.
    if (meEmpty === oppEmpty) return 0;
    return oppEmpty ? weights.winScore : -weights.winScore;
}

// --- Lethal-on-the-table term (issue #1489, ADR 0070 §5) -------------------
//
// MEASURED, not assumed. At a `declare-blockers` leaf the pre-existing
// evaluation is BYTE-IDENTICAL for "chump-block and live" and "take it and
// die":
//
//   * `declaredCombatDelta` is zero by construction once blockers are
//     confirmed (it scores a combat *pending* blocks);
//   * `dangerClock` is the STEADY-STATE race term — it never reads
//     `state.combat`, so a declared attack and a declared block move it not at
//     all;
//   * the material terms are the PRE-damage snapshot: nothing has died and no
//     life has been lost yet.
//
// So the leaf carried NO signal at all for the one decision that decides the
// game, and the choice fell entirely to whether a rollout happened to reach
// the damage step — noise, and demonstrably non-monotonic in the budget (the
// charter position blocks on 5/5 seeds at 100 iterations and DECLINES on 3/5
// at the production 400).
//
// The fix is a term with NARROW SUPPORT (ADR 0070 §5), not a re-weight: it is
// EXACTLY ZERO unless a confirmed block leaves combat damage lethal to the
// defending player, so it cannot degrade any position that does not exhibit
// the pattern. No global weight (`W_LIFE`, `W_CLOCK`, `BLOCK_CAUTION_FRACTION`)
// is touched.
//
// Its MAGNITUDE is terminal-scale on purpose, and that too is measured rather
// than picked: the open reward band saturates at `MATERIAL_FULL = 500`
// (`search.ts`), and the charter position already sits at ≈ −1000, so ANY
// sub-terminal penalty — 500, 5 000, 20 000 — maps to the identical saturated
// reward and would be invisible. A term that cannot move the reward is not a
// fix. `WIN_SCORE` puts the leaf in the LOST band, where the surviving
// material margin still discriminates (issue #138), which is exactly the
// semantics the position deserves: unblocked lethal damage with blockers
// already locked in IS a loss (CR 510.1c/704.5a), one step before the SBA
// records it.
//
// Deliberately CONSERVATIVE (it under-reports rather than over-fires):
//   * blocked attackers contribute nothing, so trample damage through a chump
//     is not counted — same simplification `declaredBlockDelta` already makes;
//   * an attacker directed at a planeswalker (CR 508.1a) never touches the
//     player's life, so it is excluded;
//   * it fires only once blockers are CONFIRMED — at declare-attackers time
//     the defender has not yet had its say, and the term stays zero;
//   * its support is the DECLARE_BLOCKERS phase and nothing else: `state.combat`
//     survives the damage steps, so without a phase guard the term would
//     re-count damage already dealt against the already-reduced life;
//   * every engine-modelled way the damage can fail to arrive zeroes it —
//     `preventAllCombatDamageThisTurn` (Fog), `sourcePreventionShields`
//     (CR 510.1c / 615), `combatDamageImmunity` (Ebony Horse), an unspent
//     `playerDamagePrevention` shield (CR 615.1) — and `blockedAttackerIds`
//     (CR 509.1h) is consulted, not just the live block graph.
//
// WIRED AT EXACTLY TWO SEAMS, each counting it ONCE: `evaluate` (the shared
// leaf the reward band reads) and `blockDeltaOf` (search.ts — the root
// block-quality tie-break lens). It is deliberately NOT inside
// `declaredBlockDelta` itself, because `policyValue` (search.ts) sums
// `evaluate` AND `declaredBlockDelta`: folding it into the latter would make
// the rollout default policy see ±2·WIN_SCORE.

/** Invert `blockerAssignments` (blocker → attackers) into attacker → blockers,
 *  in stable listed order, so each attacker's combat can be resolved
 *  independently. Shared by `declaredBlockDelta` and `declaredFaceDamage` so
 *  the two can never disagree about who is blocked. */
function blockersByAttacker(
    combat: NonNullable<GameState["combat"]>,
    defender: PlayerState
): Map<string, CardInstanceState[]> {
    const out = new Map<string, CardInstanceState[]>();
    for (const [blockerId, atkIds] of Object.entries(
        combat.blockerAssignments
    )) {
        const blocker = defender.battlefield.find((c) => c.id === blockerId);
        if (!blocker) continue;
        for (const atkId of atkIds) {
            const list = out.get(atkId) ?? [];
            list.push(blocker);
            out.set(atkId, list);
        }
    }
    return out;
}

/** The combat damage a CONFIRMED block leaves headed at the defending PLAYER's
 *  life, plus who that player is. `null` when no block is confirmed — the one
 *  shape both consumers below need, so "which attacker is unblocked" is
 *  computed in exactly one place. Pure. */
function declaredFaceDamage(
    state: GameState
): { defender: PlayerState; attacker: PlayerState; damage: number } | null {
    // PHASE GUARD (mandatory). `state.combat` — `confirmed`, `blockersConfirmed`
    // and `attackerIds` included — SURVIVES the damage steps: it is torn down
    // only as END_OF_COMBAT *ends* (`endCombatStep`, phases.ts, CR 511.3).
    // Without this guard the term would re-count damage ALREADY APPLIED against
    // the ALREADY-REDUCED life at every COMBAT_DAMAGE / END_OF_COMBAT leaf,
    // firing on any attack that took the defender past roughly half its life —
    // a broad, common-position false `∓WIN_SCORE`. DECLARE_BLOCKERS is the only
    // PRE-damage phase in which `blockersConfirmed` can be true, so it is the
    // term's entire support window (CR 509 → 510).
    if (state.phase !== "DECLARE_BLOCKERS") return null;
    const combat = state.combat;
    if (
        !combat ||
        !combat.confirmed ||
        !combat.blockersConfirmed ||
        combat.attackerIds.length === 0
    ) {
        return null;
    }
    // CR 615 / 615.12 — a resolved Fog. `applyAllCombatDamage` returns
    // immediately on this flag UNLESS a source-side unpreventable-combat-damage
    // static is on the board (Questing Beast), in which case its controller's
    // creatures still connect. Mirrors `phases.ts`'s own guard so the bot does
    // not write off a lethal swing the engine will actually apply.
    if (
        state.preventAllCombatDamageThisTurn &&
        !anyCombatDamageUnpreventableStatic(state)
    ) {
        return null;
    }
    const attackerId = state.activePlayerId; // CR 508.1 — active player attacks.
    const attacker = state.players.find((p) => p.id === attackerId);
    const defender = state.players.find((p) => p.id !== attackerId);
    if (!attacker || !defender) return null;

    const byAttacker = blockersByAttacker(combat, defender);
    let damage = 0;
    for (const atkId of combat.attackerIds) {
        // CR 508.1a — an attacker aimed at a planeswalker never reaches the
        // player's life (issue #1220).
        if (combat.attackTargets?.[atkId] !== undefined) continue;
        // CR 509.1h — "blocked" is combat STATE, not the live blocker count.
        // `blockedAttackerIds` is the engine's authority (written at every
        // blocker confirmation, read by the damage step itself, phases.ts):
        // an attacker that became blocked stays blocked and deals NOTHING to
        // the player even after every blocker has left the battlefield.
        // Reading `blockerAssignments` alone would count its full power.
        if (combat.blockedAttackerIds?.includes(atkId)) continue;
        if ((byAttacker.get(atkId) ?? []).length > 0) continue;
        const atk = attacker.battlefield.find((c) => c.id === atkId);
        if (!atk) continue;
        // CR 615.12 — this attacker's combat damage can't be prevented
        // (Questing Beast), so every shield below is a no-op against it.
        // Mirrors `applyOneCombatDamage`'s own per-source computation.
        const unpreventable = isCombatDamageUnpreventable(state, atk);
        // CR 615 — the Fog, re-applied PER ATTACKER exactly as the engine does
        // (`applyOneCombatDamage`, phases.ts). The blanket early return above
        // is skipped whenever ANY battlefield carries an unpreventable-combat-
        // damage static — `anyCombatDamageUnpreventableStatic` is board-wide,
        // so the OPPONENT's Questing Beast disables it too. Without this line
        // every unblocked attacker's power is summed as face damage while the
        // engine prevents all of it: a false lethal-on-the-table (WIN_SCORE)
        // in the bot's most decision-critical term.
        if (state.preventAllCombatDamageThisTurn && !unpreventable) continue;
        // CR 510.1c / 615 — a SOURCE-scoped prevention shield (Farrel's
        // Mantle's "assigns no combat damage"; Falling Timber / Guard Dogs /
        // Radiant Kavu's "prevent all combat damage <X> would deal"). Source-
        // only; the damage step skips it outright.
        if (sourcePreventionShieldApplies(state, atk.id, true, unpreventable))
            continue;
        // CR 615 — Ebony Horse's shield prevents all combat damage BY the
        // shielded creature as well as to it.
        if (!unpreventable && isCombatDamageImmune(state, atk.id)) continue;
        damage += Math.max(0, getEffectivePower(state, atk));
    }
    return { defender, attacker, damage };
}

/**
 * The lethal-on-the-table term (issue #1489). EXACTLY ZERO unless a CONFIRMED
 * block leaves combat damage that is lethal to the defending player; on that
 * pattern it is `∓WIN_SCORE` from `viewerId`'s point of view (negative for the
 * player about to die, positive for the one about to win). See the block
 * comment above for the measurement it was designed against, why the magnitude
 * has to be terminal-scale, and the deliberate under-reporting.
 *
 * Pure. Exported so the narrowness of its support is unit-testable in
 * isolation (ADR 0070 §5): pattern present → non-zero, pattern absent → 0.
 */
export function lethalUnblockedDelta(
    state: GameState,
    viewerId: string,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS
): number {
    const declared = declaredFaceDamage(state);
    if (!declared) return 0;
    const { defender, attacker, damage } = declared;
    // CR 615.1 — a live per-player prevention shield (Dark Sphere, Scarecrow)
    // can cut or erase the damage headed at the defender. Whether it MATCHES
    // depends on the source and its mode, and resolving that would mean running
    // `applyPlayerDamagePrevention`, which MUTATES state (it decrements
    // `remaining`) — illegal in a pure term. So the term declines to claim
    // lethality whenever any unspent shield is registered for the defender:
    // under-report, never over-fire. (`isCombatDamagePreventedFromSource` needs
    // no consultation here: it is queried only on the PERMANENT branch of the
    // damage step — a self-protective property of the creature being dealt
    // damage — and a PLAYER is never its target.)
    if (
        state.playerDamagePrevention?.some(
            (s) => s.playerId === defender.id && s.remaining > 0
        )
    ) {
        return 0;
    }
    // CR 704.5a — a player at 0 or less life loses. Damage already locked in
    // that takes the defender there is a loss, one SBA sweep early.
    if (damage <= 0 || damage < defender.life) return 0;
    if (viewerId === defender.id) return -weights.winScore;
    if (viewerId === attacker.id) return weights.winScore;
    return 0;
}

// --- Smart auto-tap source quality (issue #794, PRD #472 / ADR 0034) --------
// The color-blind `mana` term prices every untapped source at a flat W_MANA,
// so it cannot tell a *dual-purpose* source (a manland that can animate/attack)
// or a *color-flexible* source (a dual land) apart from a plain basic. Smart
// auto-tap must, among equal-tap-count covering plans, leave the more valuable
// sources untapped — so `evaluateAutoTapPosition` folds a small SOURCE-QUALITY
// bonus on top of `evaluate`, seen only on the auto-tap path (never by the
// bot's own move search, whose leaf magnitudes stay unchanged). The bonus is
// deliberately small: two plans that differ only in *which* equal-cardinality
// set of plain basics they tap stay tied (0 delta), and the demand / flexibility
// / lexicographic tie-breaks still decide those; the bonus only tips a plan that
// spares a genuinely more valuable source (Mishra's Factory, a dual land).

// `weights.sourceBreadthWeight` (issue #2683, was `W_SOURCE_BREADTH`): per
// extra distinct color an untapped source can produce (a dual land untapped
// outranks a basic). Small — only tips otherwise-equal auto-tap plans.
// `weights.sourceDualPurposeWeight` (was `W_SOURCE_DUAL_PURPOSE`): an untapped
// source that also has a non-mana activated ability (a manland that can
// animate/attack — Mishra's Factory). Larger than a color of breadth so a
// manland is spared even against a dual land, but far below a creature's
// worth so it never distorts material.

/** Bonus for the quality of the mana sources a player leaves UNTAPPED (issue
 *  #794). Sums, over each untapped mana source: its extra color breadth (CR
 *  106.4, colored producible mana beyond one) and a flat bonus if it is
 *  dual-purpose (has a non-mana activated ability). Pure; reads only the live
 *  battlefield. */
function untappedSourceQuality(
    state: GameState,
    playerId: string,
    weights: EvalWeights
): number {
    const me = state.players.find((p) => p.id === playerId);
    if (!me) return 0;
    const battlefields = state.players.map((p) => ({
        playerId: p.id,
        battlefield: p.battlefield,
    }));
    let bonus = 0;
    for (const perm of me.battlefield) {
        // CR 605.1a / 305.6 — score only sources that can produce mana; a
        // fetchland (no mana ability) is not one, even though `isLand` is true
        // and its search ability makes it "dual-purpose" (issue #1499). Nor is
        // a board-conditional source currently producing zero (issue #1889).
        if (!isUntappedManaSource(perm, me.battlefield)) continue;
        // Only score a source with a real definition — a token without one
        // (`getProducibleColorsOnBoard` reads the throwing `getDefinition`) contributes
        // nothing to source quality.
        if (!tryGetDefinition((perm.card as { id?: string }).id ?? ""))
            continue;
        // CR 106.4 (issue #1941) — BOARD-aware breadth: a board-derived
        // colour set (Meteor Crater, Fellwar Stone) is worth exactly what it
        // currently offers, not the five-colour no-board fallback its static
        // `manaChoices` carries.
        const breadth = getProducibleColorsOnBoard(perm, battlefields).size;
        if (breadth > 1) bonus += (breadth - 1) * weights.sourceBreadthWeight;
        if (hasNonManaActivatedAbility(perm))
            bonus += weights.sourceDualPurposeWeight;
    }
    return bonus;
}

/**
 * Static score of a post-payment position for smart auto-tap (issue #794, PRD
 * #472 / ADR 0034). Reuses the Brain's STATIC `evaluate()` (NO ISMCTS search —
 * pure, synchronous, server-safe) and adds `untappedSourceQuality`, so a plan
 * that leaves a dual-purpose or color-flexible source untapped scores strictly
 * higher than an equal-tap-count plan that taps it. This is the primary scorer
 * smart auto-tap ranks its candidate plans by; demand preservation feeds it as
 * a tie-break rather than being the sole scorer. `playerId` is the paying player
 * (whose position we optimize). Pure.
 */
export function evaluateAutoTapPosition(
    state: GameState,
    playerId: string,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS
): number {
    return (
        evaluate(state, playerId, weights) +
        untappedSourceQuality(state, playerId, weights)
    );
}

/** The expected material + life swing of a combat ALREADY DECLARED but not yet
 *  resolved, from `viewerId`'s perspective (ADR 0020 §3). A `declare-attackers`
 *  leaf is otherwise scored on the PRE-damage snapshot, so every attack set
 *  evaluates identically and the choice falls to the noisy rollout. Folding the
 *  predicted exchange in lets the leaf tell a profitable attack from a creature
 *  walking into death. Zero when no combat is pending blocks. */
export function declaredCombatDelta(
    state: GameState,
    viewerId: string,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS
): number {
    const combat = state.combat;
    if (
        !combat ||
        !combat.confirmed ||
        combat.blockersConfirmed ||
        combat.attackerIds.length === 0
    ) {
        return 0;
    }
    // Only the active player declares attackers (CR 508.1).
    const attackerId = state.activePlayerId;
    const defender = state.players.find((p) => p.id !== attackerId);
    if (!defender) return 0;

    // Interaction-aware, HIDDEN-INFORMATION-respecting (ADR 0021, issue #229).
    // The attacker's held pump is folded into the prediction ONLY when scoring
    // from the ATTACKER's OWN perspective (`viewerId === attackerId`). That is
    // the holder reasoning about its own trick: a bait attacker held back for a
    // pump is no longer pre-judged dead, so the bot will SEND the bait into the
    // block instead of declining the attack. The DEFENDER's view
    // (`viewerId !== attackerId`) gets the UN-pumped prediction — the trick is
    // hidden, so the opponent blocks the visible 2/2 with its 3/3 rather than
    // playing around a card it cannot see (avoiding the clairvoyance / strategy-
    // fusion that would neutralise the ambush). The bot then pumps in response in
    // its block window (the reactive rollout default policy casts it; see
    // `policyValue`), trading up. Absent a castable pump both views are unchanged.
    const attackerHeld = castableHeldInteraction(
        state.players.find((p) => p.id === attackerId)!
    );
    const ownView = viewerId === attackerId;
    const outcome = predictCombatOutcome(
        state,
        attackerId,
        defender.id,
        ownView ? attackerHeld.pump : undefined
    );
    const value = (ids: string[], owner: PlayerState) =>
        ids.reduce((sum, id) => {
            const c = owner.battlefield.find((x) => x.id === id);
            return c ? sum + evaluateCreature(state, c) : sum;
        }, 0);

    const attacker = state.players.find((p) => p.id === attackerId)!;
    // Attacker's view: it loses its dead attackers, gains the dead blockers'
    // worth (the defender's loss), and the face damage removes opponent life.
    const attackerDelta =
        value(outcome.deadBlockerIds, defender) -
        value(outcome.deadAttackerIds, attacker) +
        outcome.faceDamage * weights.lifeWeight;

    return ownView ? attackerDelta : -attackerDelta;
}

/** The material + life swing of a block ALREADY DECLARED (blockers confirmed,
 *  damage not yet dealt), from `viewerId`'s perspective (ADR 0021 slice 2,
 *  issue #222). Unlike `declaredCombatDelta` — which predicts the defender's OWN
 *  sensible block off a pre-block snapshot — this scores the SPECIFIC block
 *  assignment recorded in `state.combat.blockerAssignments`, so it can rank one
 *  block against another. It is the lens the reactive rollout default policy
 *  uses to pick a SANE block; it is deliberately NOT folded into `evaluate`, so
 *  the shared leaf magnitudes (and the search reward band / issue-#138 tie-break)
 *  are unchanged. Crude on purpose, matching the Danger Clock shape: a blocked
 *  attacker dies if the blockers' total power covers its toughness; each blocker
 *  dies if the attacker's power (assigned in listed order) covers its toughness;
 *  an unblocked attacker's power hits the defender's life. Zero when no block is
 *  confirmed.
 *
 *  Lethality reads EFFECTIVE P/T (temp buffs included, like `predictCombatOutcome`)
 *  — the combat happens THIS turn while an until-end-of-turn pump is live, so a
 *  combat trick cast in response to the block MUST count here (ADR 0021 slice 3,
 *  issue #223); this is what lets the rollout policy see that holding a trick and
 *  casting it in the block step wins the exchange. The dead creatures' WORTH
 *  still comes from `evaluateCreature` (permanent P/T): you lose the base
 *  creature, not its one-turn pumped body. */
export function declaredBlockDelta(
    state: GameState,
    viewerId: string,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS
): number {
    const combat = state.combat;
    if (
        !combat ||
        !combat.confirmed ||
        !combat.blockersConfirmed ||
        combat.attackerIds.length === 0
    ) {
        return 0;
    }
    const attackerId = state.activePlayerId; // CR 508.1 — active player attacks.
    const attacker = state.players.find((p) => p.id === attackerId);
    const defender = state.players.find((p) => p.id !== attackerId);
    if (!attacker || !defender) return 0;

    // Invert blockerId → attackerIds into attackerId → blockers (in stable
    // listed order) so each attacker's combat can be resolved independently.
    const byAttacker = blockersByAttacker(combat, defender);

    // This block resolves THIS turn, before cleanup, so a temporary combat-trick
    // buff already on a creature IS live for the exchange (ADR 0021, issue #229).
    // Use FULL effective P/T (`getEffectivePower`, temporary buffs included) here
    // — NOT the buff-excluding `getPermanentEffective*` the material terms use —
    // so a pump cast in response to the block is reflected: it is what lets the
    // reactive rollout SEE that casting the trick saves the attacker. (The
    // material terms still exclude the buff: a +X/+X is never lasting board
    // material, only a one-combat swing, which this combat delta is.)
    let faceDamage = 0;
    const deadAttackers: CardInstanceState[] = [];
    const deadBlockers: CardInstanceState[] = [];

    for (const atkId of combat.attackerIds) {
        const atk = attacker.battlefield.find((c) => c.id === atkId);
        if (!atk) continue;
        const blockers = byAttacker.get(atkId) ?? [];
        if (blockers.length === 0) {
            faceDamage += Math.max(0, getEffectivePower(state, atk));
            continue;
        }
        const atkPower = Math.max(0, getEffectivePower(state, atk));
        const atkTough = Math.max(0, getEffectiveToughness(state, atk));
        // Blockers' combined power vs the attacker's toughness.
        const blockPower = blockers.reduce(
            (sum, b) => sum + Math.max(0, getEffectivePower(state, b)),
            0
        );
        // "Lethal damage" is NOT raw toughness (CR 702.19b): damage already
        // marked on the creature counts, and CR 702.2c makes any nonzero
        // amount from a deathtouch source lethal. Both sides of this exchange
        // go through `lethalDamageThreshold`, the same arithmetic the real
        // assignment path uses (`gre/damageAssignment.ts`), so the bot never
        // values a combat the engine then resolves differently — a deathtouch
        // trade or a chump-block into an already-damaged blocker used to price
        // as if nothing died.
        const blockerDeathtouch = blockers.some(
            (b) =>
                Math.max(0, getEffectivePower(state, b)) > 0 &&
                b.staticAbilities.includes("deathtouch")
        );
        const atkLethal = lethalDamageThreshold({
            effectiveToughness: atkTough,
            damageMarked: atk.damageMarked,
            sourceHasDeathtouch: blockerDeathtouch,
        });
        if (blockPower >= atkLethal) deadAttackers.push(atk);
        // Attacker assigns its power to blockers in listed order, lethal first.
        // CR 510.1a — a creature with 0 power assigns no combat damage at all,
        // so it kills nothing.
        const atkDeathtouch = atk.staticAbilities.includes("deathtouch");
        let remaining = atkPower;
        for (const b of blockers) {
            const bLethal = lethalDamageThreshold({
                effectiveToughness: Math.max(
                    0,
                    getEffectiveToughness(state, b)
                ),
                damageMarked: b.damageMarked,
                sourceHasDeathtouch: atkDeathtouch,
            });
            if (atkPower > 0 && remaining >= bLethal) {
                deadBlockers.push(b);
                remaining -= bLethal;
            }
        }
    }

    const value = (cards: CardInstanceState[]) =>
        cards.reduce((sum, c) => sum + evaluateCreature(state, c), 0);
    // Defender's view: gains the dead attackers' worth, loses its dead blockers,
    // and takes the unblocked face damage.
    //
    // NOTE (issue #1489). The lethal-on-the-table term is deliberately NOT
    // folded in here. MEASURED, this function IS the lens `selectRootMove`'s
    // block-quality tie-break ranks candidate blocks by (`blockDeltaOf`,
    // search.ts), and the life clause below is LINEAR and lethality-blind — in
    // the charter position it prices 24 incoming damage at `24 × W_LIFE = 192`
    // and therefore rates "take it and die" (−192) ABOVE "chump and live"
    // (−312). But `policyValue` (search.ts) sums `evaluate` AND
    // `declaredBlockDelta`, and `evaluate` already carries the term — folding it
    // here too would show the rollout default policy ±2·WIN_SCORE. So the tie-
    // break gets it at its own seam, `blockDeltaOf`, where it is counted once.
    const defenderDelta =
        value(deadAttackers) -
        value(deadBlockers) -
        faceDamage * weights.lifeWeight;

    // Cautious multi-block (ADR 0021, issue #229). If the ATTACKER holds castable
    // interaction (a pump or instant removal), a block that only WINS when the
    // attacker has no trick is over-exposed: a held pump lets the attacker
    // survive AND kill the committed blockers; a held removal kills one blocker
    // so the attacker connects. The block's value is discounted by a SOFT,
    // hedged expectation of that swing — never a hard rule — so the defender
    // keeps blockers back / single-blocks when the attacker is loaded, and
    // blocks normally when the attacker is tapped out / empty-handed (no
    // castable interaction → zero penalty, current behavior).
    const caution = cautiousBlockPenalty(state, attacker, byAttacker, weights);
    const defenderDeltaHedged = defenderDelta - caution;

    return viewerId === defender.id
        ? defenderDeltaHedged
        : -defenderDeltaHedged;
}

// `weights.blockCautionFraction` (issue #2683, was `BLOCK_CAUTION_FRACTION`):
// fraction of the worst-case trick swing folded into the block valuation.
// Soft: the discount is the EXPECTED cost of an over-committed block against a
// loaded attacker, not a certainty (the attacker may have no trick, may not
// have mana, may save it). A hedged expectation, exactly as the issue
// specifies.

/** The hedged penalty subtracted from a declared block when the attacker holds
 *  castable interaction (ADR 0021, issue #229). For each attacker the defender
 *  blocks, it estimates the swing a held PUMP or held REMOVAL would cause and
 *  charges `BLOCK_CAUTION_FRACTION` of the LARGEST such swing across the block
 *  (one trick, one target — the attacker spends it where it hurts most):
 *
 *    * held pump — applied to a blocked attacker the defender's blockers would
 *      otherwise kill, the attacker SURVIVES and its (pumped) power now kills the
 *      committed blockers: the swing is the blockers the defender now loses for
 *      nothing PLUS the attacker it no longer trades away.
 *    * held removal — one of the defender's blockers on a multi-block is killed
 *      in response; if removing it lets the attacker LIVE, the swing is that
 *      blocker (lost for nothing) plus the attacker no longer killed.
 *
 *  Crude and valuation-light, matching the rest of the predictor. Zero when the
 *  attacker has no castable interaction, so a tapped-out / empty-handed attacker
 *  is blocked normally. */
function cautiousBlockPenalty(
    state: GameState,
    attacker: PlayerState,
    blockersByAttacker: Map<string, CardInstanceState[]>,
    weights: EvalWeights
): number {
    const held = castableHeldInteraction(attacker);
    if (!held.pump && !held.removal) return 0;

    const cval = (c: CardInstanceState) => evaluateCreature(state, c);
    let worstSwing = 0;

    for (const [atkId, blockers] of blockersByAttacker) {
        if (blockers.length === 0) continue;
        const atk = attacker.battlefield.find((c) => c.id === atkId);
        if (!atk) continue;
        const atkPower = Math.max(0, getPermanentEffectivePower(state, atk));
        const atkTough = Math.max(
            0,
            getPermanentEffectiveToughness(state, atk)
        );
        const blockPower = blockers.reduce(
            (sum, b) => sum + Math.max(0, getPermanentEffectivePower(state, b)),
            0
        );
        // This block, with no trick, kills the attacker — the exchange the
        // defender is counting on. Only such a block is exposed to a flip.
        const blockKillsAttacker = blockPower >= atkTough;
        if (!blockKillsAttacker) continue;

        // Held pump: attacker survives (toughness raised past the block power)
        // and its raised power now kills the blockers in listed order.
        if (held.pump) {
            const survives = blockPower < atkTough + held.pump.toughness;
            if (survives) {
                let remaining = atkPower + held.pump.power;
                const lostBlockers: CardInstanceState[] = [];
                for (const b of blockers) {
                    const bT = Math.max(
                        0,
                        getPermanentEffectiveToughness(state, b)
                    );
                    if (remaining >= bT) {
                        lostBlockers.push(b);
                        remaining -= bT;
                    }
                }
                // Swing: the attacker the defender no longer kills + the blockers
                // it now loses for nothing.
                const swing =
                    cval(atk) + lostBlockers.reduce((s, b) => s + cval(b), 0);
                if (swing > worstSwing) worstSwing = swing;
            }
        }

        // Held removal: kill the single biggest committed blocker; if doing so
        // drops the block below lethal, the attacker lives and the removed
        // blocker is lost for nothing.
        if (held.removal) {
            const biggest = [...blockers].sort(
                (a, b) =>
                    getPermanentEffectivePower(state, b) -
                    getPermanentEffectivePower(state, a)
            )[0];
            const remainingPower =
                blockPower -
                Math.max(0, getPermanentEffectivePower(state, biggest));
            if (remainingPower < atkTough) {
                const swing = cval(atk) + cval(biggest);
                if (swing > worstSwing) worstSwing = swing;
            }
        }
    }

    return weights.blockCautionFraction * worstSwing;
}

/** Pure material margin from `playerId`'s view: sum(self terms) − sum(opp
 *  terms), with NO terminal win/loss offset. Unlike `evaluate`, this never
 *  saturates — a creature's worth of material is the same delta whether the
 *  position is even or decided. The ISMCTS search (issue #138) accumulates it
 *  per edge to break ties between candidates whose win/loss outcome is identical
 *  but whose surviving material differs (e.g. a free chump attack vs passing). */
export function materialMargin(
    state: GameState,
    playerId: string,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS
): number {
    const me = state.players.find((p) => p.id === playerId);
    const opp = state.players.find((p) => p.id !== playerId);
    if (!me || !opp) return 0;
    return playerScore(state, me, weights) - playerScore(state, opp, weights);
}

/** `playerId`'s view of a position, decomposed into per-player, per-term
 *  contributions plus the relational Danger Clock and the final `evaluate`
 *  value. Pure read used only by the DecisionTrace debug view — it never feeds
 *  the search itself. `margin` is the pre-terminal material difference
 *  (sum(self) − sum(opp)); `danger` is the signed Danger Clock term (ADR 0018,
 *  positive = the player holds the faster clock); `total` is the full
 *  `evaluate(state, playerId)`. In an open position `total = margin + danger`
 *  plus whatever the narrow combat terms contribute — `declaredCombatDelta`
 *  (a combat pending blocks) or `lethalUnblockedDelta` (a confirmed block that
 *  leaves lethal damage, issue #1489), each zero off its own pattern; in a
 *  terminal one the win/loss offset dominates and `danger` is omitted. */
export type PositionBreakdown = {
    self: EvalTerms;
    opp: EvalTerms;
    margin: number;
    danger: number;
    total: number;
};

export function evaluateBreakdown(
    state: GameState,
    playerId: string,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS
): PositionBreakdown {
    const me = state.players.find((p) => p.id === playerId);
    const opp = state.players.find((p) => p.id !== playerId);
    const empty: EvalTerms = {
        life: 0,
        hand: 0,
        creatures: 0,
        permanents: 0,
        mana: 0,
        manaDevelopment: 0,
        flexibility: 0,
        library: 0,
        graveyard: 0,
        graveyardReach: 0,
    };
    if (!me || !opp) {
        return { self: empty, opp: empty, margin: 0, danger: 0, total: 0 };
    }
    const self = playerTerms(state, me, weights);
    const oppTerms = playerTerms(state, opp, weights);
    const margin = sumTerms(self) - sumTerms(oppTerms);
    return {
        self,
        opp: oppTerms,
        margin,
        danger: dangerClock(state, playerId),
        total: evaluate(state, playerId, weights),
    };
}
