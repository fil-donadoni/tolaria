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
import { isCombatDamageImmune } from "./state";
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
    getProducibleColors,
    manaValue,
} from "./constants";
import {
    getInstanceManaCost,
    getInstanceAiValue,
    tryGetDefinition,
} from "../cards";
import { dangerClock, predictCombatOutcome } from "./dangerClock";
import { castableHeldInteraction } from "./heldInteraction";
import {
    creatureValueRaw,
    dslLatentPiecesById,
    dslRealizedAbilityValueById,
    latentValue,
} from "./cardValue";

/** A won position. Large enough to dominate every reachable material margin so
 *  the bot always prefers lethal, and finite so two winning lines stay
 *  comparable by their material margin. Forge-scale material tops out in the
 *  low tens of thousands even on a wide board, far below this. */
export const WIN_SCORE = 1_000_000;

// --- Forge-scale material weights (ADR 0018) -------------------------------
// Tuned for ordering (see file header). On the ~100-base scale a 2/2 vanilla is
// worth ~170, so life, hand and mana are scaled to stay commensurate.
const W_LIFE = 8; // per life point (20 life ≈ one creature)
const W_PERMANENT = 5; // board-presence bonus for every permanent in play
// Per untapped mana source (available-mana proxy). Weighted so DEVELOPING a land
// stays strictly positive (issue #149): a land drop is −cardValue(land) (leaves
// hand) +W_PERMANENT (enters battlefield, not a creature so no creature value)
// +W_MANA (adds an untapped source). A basic land's latent `cardValue` is
// NONCREATURE_BASE (8, MV 0), so the delta is −8 +5 +12 = +9 > 0 — the greedy
// 1-ply selection and the ISMCTS tie-break both prefer the drop over passing.
const W_MANA = 12;

// --- Reactive flexibility (ADR 0021 slice 1, issue #221) -------------------
// Option value of holding an instant-speed answer you can actually cast right
// now. For each holdable instant / flash card in hand that the player has
// enough open, untapped mana to cast THIS turn, `evaluate` adds a small,
// bounded bonus. This gives the search a reason to KEEP the option rather than
// spend it for no payoff — a hand that can respond is worth more than the same
// hand tapped out (no response possible).
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
const W_FLEX = 6; // bonus per castable held instant (small: < a land drop's +9)
const FLEX_CARD_CAP = 3; // at most this many instants contribute (bound the term)

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
        ) +
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
    /** Reactive flexibility (ADR 0021 slice 1): bounded option-value bonus for
     *  holdable instants in hand the player can afford to cast this turn. */
    flexibility: number;
};

/** Whether a hand card can be cast at instant speed — an Instant, or any card
 *  with the Flash keyword (CR 702.8). The flexibility term only rewards holding
 *  cards that can actually answer something during an opponent's window. */
function hasInstantTiming(card: CardInstanceState): boolean {
    if (card.types.includes("Instant")) return true;
    return card.staticAbilities.includes("flash");
}

/** Untapped mana sources + floating mana available to `player` this turn — the
 *  color-blind coarse proxy the `mana` term and the flexibility / castability
 *  gates all share (CR 601 colored requirements are not modelled). */
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
 *  worth exploring. */
export function hasCastableInstant(
    state: GameState,
    playerId: string
): boolean {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return false;
    const availableMana = availableManaFor(player);
    return player.hand.some(
        (c) =>
            hasInstantTiming(c) &&
            manaValue(getInstanceManaCost(c)) <= availableMana
    );
}

/** The reactive-flexibility bonus for one player (ADR 0021 slice 1, issue #221).
 *  Counts holdable instants in hand the player has enough open mana to cast THIS
 *  turn (`availableMana` ≥ the card's mana value — the same color-blind proxy the
 *  `mana` term uses), capped at `FLEX_CARD_CAP`. Castability-gated so a tapped-out
 *  hand scores no flexibility, and additive to the latent `cardValue` already in
 *  the `hand` term so the two never double-count. */
function flexibilityTerm(player: PlayerState, availableMana: number): number {
    let castable = 0;
    for (const card of player.hand) {
        if (!hasInstantTiming(card)) continue;
        if (manaValue(getInstanceManaCost(card)) > availableMana) continue;
        castable += 1;
        if (castable === FLEX_CARD_CAP) break;
    }
    return castable * W_FLEX;
}

/** The weighted contributions of one player's resources, from their own
 *  perspective. `sumTerms` of this equals the legacy `playerScore`. */
function playerTerms(state: GameState, player: PlayerState): EvalTerms {
    const terms: EvalTerms = {
        life: player.life * W_LIFE,
        // Latent worth of the hand (ADR 0018): each card's `cardValue`, replacing
        // the old flat per-card constant. A bomb in hand now outweighs a spare
        // land, and pitching a good card for no effect is a decisive loss.
        hand: player.hand.reduce((sum, c) => sum + cardValue(state, c), 0),
        creatures: 0,
        permanents: 0,
        mana: 0,
        flexibility: 0,
    };

    for (const perm of player.battlefield) {
        terms.permanents += W_PERMANENT;
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
            if (!isLand(perm)) {
                terms.permanents += cardValue(state, perm);
            }
        }
    }
    const availableMana = availableManaFor(player);
    terms.mana = availableMana * W_MANA;
    // Reactive flexibility uses the SAME available-mana count as the affordability
    // gate, so it can only reward instants the player can actually cast now.
    terms.flexibility = flexibilityTerm(player, availableMana);
    return terms;
}

function sumTerms(t: EvalTerms): number {
    return (
        t.life + t.hand + t.creatures + t.permanents + t.mana + t.flexibility
    );
}

/** Material score of one player's resources, from their own perspective. */
function playerScore(state: GameState, player: PlayerState): number {
    return sumTerms(playerTerms(state, player));
}

/** Score `state` from `playerId`'s perspective. Higher = better for the player.
 *  Terminal positions dominate: a win returns ≥ +WIN_SCORE, a loss ≤ −WIN_SCORE
 *  (offset by the surviving material margin so winning lines stay comparable). */
export function evaluate(state: GameState, playerId: string): number {
    const me = state.players.find((p) => p.id === playerId);
    const opp = state.players.find((p) => p.id !== playerId);
    if (!me || !opp) return 0;

    const margin = playerScore(state, me) - playerScore(state, opp);

    // Terminal detection. A recorded game-over is authoritative; otherwise a
    // player at ≤ 0 life has effectively lost (SBA may not have run on this
    // sandbox state yet). The material margin is added so two won/lost lines
    // remain ordered by how decisive they are. The Danger Clock is omitted in
    // terminal positions — the outcome already dominates and the race is moot.
    if (state.gameOver) {
        // CR 104.4a — a drawn game is a neutral terminal: neither a win nor a
        // loss for either player (Divine Intervention).
        if (state.gameOver.isDraw) return 0;
        if (state.gameOver.winnerId === playerId) return WIN_SCORE + margin;
        if (state.gameOver.loserId === playerId) return -WIN_SCORE + margin;
    }
    const oppLost = opp.life <= 0;
    const meLost = me.life <= 0;
    if (oppLost && !meLost) return WIN_SCORE + margin;
    if (meLost && !oppLost) return -WIN_SCORE + margin;

    // Open position: add the Danger Clock race term (ADR 0018) and, on a
    // declare-attackers leaf, the expected combat exchange (ADR 0020 §3). Both
    // are kept OUT of `materialMargin` so the issue-#138 saturation-proof
    // tie-break stays pure material; they shape only the leaf `evaluate` the
    // reward band reads.
    return (
        margin +
        dangerClock(state, playerId) +
        declaredCombatDelta(state, me.id) +
        lethalUnblockedDelta(state, playerId)
    );
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
//     `preventAllCombatDamageThisTurn` (Fog), `assignsNoCombatDamageThisTurn`
//     (CR 510.1c), `combatDamageImmunity` (Ebony Horse), an unspent
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
    // CR 615 — a resolved Fog. `applyAllCombatDamage` returns immediately on
    // this flag (phases.ts), so NO combat damage happens at all this turn and
    // there is nothing lethal on the table.
    if (state.preventAllCombatDamageThisTurn) return null;
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
        // CR 510.1c — "assigns no combat damage this turn" (Farrel's Mantle /
        // Farrel's Zealot). Source-only; the damage step skips it outright.
        if (state.assignsNoCombatDamageThisTurn?.includes(atk.id)) continue;
        // CR 615 — Ebony Horse's shield prevents all combat damage BY the
        // shielded creature as well as to it.
        if (isCombatDamageImmune(state, atk.id)) continue;
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
    viewerId: string
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
    if (viewerId === defender.id) return -WIN_SCORE;
    if (viewerId === attacker.id) return WIN_SCORE;
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

/** Per extra distinct color an untapped source can produce (a dual land untapped
 *  outranks a basic). Small — only tips otherwise-equal auto-tap plans. */
const W_SOURCE_BREADTH = 4;
/** An untapped source that also has a non-mana activated ability (a manland that
 *  can animate/attack — Mishra's Factory). Larger than a color of breadth so a
 *  manland is spared even against a dual land, but far below a creature's worth
 *  so it never distorts material. */
const W_SOURCE_DUAL_PURPOSE = 20;

/** Bonus for the quality of the mana sources a player leaves UNTAPPED (issue
 *  #794). Sums, over each untapped mana source: its extra color breadth (CR
 *  106.4, colored producible mana beyond one) and a flat bonus if it is
 *  dual-purpose (has a non-mana activated ability). Pure; reads only the live
 *  battlefield. */
function untappedSourceQuality(state: GameState, playerId: string): number {
    const me = state.players.find((p) => p.id === playerId);
    if (!me) return 0;
    let bonus = 0;
    for (const perm of me.battlefield) {
        // CR 605.1a / 305.6 — score only sources that can produce mana; a
        // fetchland (no mana ability) is not one, even though `isLand` is true
        // and its search ability makes it "dual-purpose" (issue #1499). Nor is
        // a board-conditional source currently producing zero (issue #1889).
        if (!isUntappedManaSource(perm, me.battlefield)) continue;
        // Only score a source with a real definition — a token without one
        // (`getProducibleColors` reads the throwing `getDefinition`) contributes
        // nothing to source quality.
        if (!tryGetDefinition((perm.card as { id?: string }).id ?? ""))
            continue;
        const breadth = getProducibleColors(perm).size;
        if (breadth > 1) bonus += (breadth - 1) * W_SOURCE_BREADTH;
        if (hasNonManaActivatedAbility(perm)) bonus += W_SOURCE_DUAL_PURPOSE;
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
    playerId: string
): number {
    return evaluate(state, playerId) + untappedSourceQuality(state, playerId);
}

/** The expected material + life swing of a combat ALREADY DECLARED but not yet
 *  resolved, from `viewerId`'s perspective (ADR 0020 §3). A `declare-attackers`
 *  leaf is otherwise scored on the PRE-damage snapshot, so every attack set
 *  evaluates identically and the choice falls to the noisy rollout. Folding the
 *  predicted exchange in lets the leaf tell a profitable attack from a creature
 *  walking into death. Zero when no combat is pending blocks. */
export function declaredCombatDelta(
    state: GameState,
    viewerId: string
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
        outcome.faceDamage * W_LIFE;

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
export function declaredBlockDelta(state: GameState, viewerId: string): number {
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
        if (blockPower >= atkTough) deadAttackers.push(atk);
        // Attacker assigns its power to blockers in listed order, lethal first.
        let remaining = atkPower;
        for (const b of blockers) {
            const bTough = Math.max(0, getEffectiveToughness(state, b));
            if (remaining >= bTough) {
                deadBlockers.push(b);
                remaining -= bTough;
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
        value(deadAttackers) - value(deadBlockers) - faceDamage * W_LIFE;

    // Cautious multi-block (ADR 0021, issue #229). If the ATTACKER holds castable
    // interaction (a pump or instant removal), a block that only WINS when the
    // attacker has no trick is over-exposed: a held pump lets the attacker
    // survive AND kill the committed blockers; a held removal kills one blocker
    // so the attacker connects. The block's value is discounted by a SOFT,
    // hedged expectation of that swing — never a hard rule — so the defender
    // keeps blockers back / single-blocks when the attacker is loaded, and
    // blocks normally when the attacker is tapped out / empty-handed (no
    // castable interaction → zero penalty, current behavior).
    const caution = cautiousBlockPenalty(state, attacker, byAttacker);
    const defenderDeltaHedged = defenderDelta - caution;

    return viewerId === defender.id
        ? defenderDeltaHedged
        : -defenderDeltaHedged;
}

/** Fraction of the worst-case trick swing folded into the block valuation. Soft:
 *  the discount is the EXPECTED cost of an over-committed block against a loaded
 *  attacker, not a certainty (the attacker may have no trick, may not have mana,
 *  may save it). A hedged expectation, exactly as the issue specifies. */
const BLOCK_CAUTION_FRACTION = 0.5;

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
    blockersByAttacker: Map<string, CardInstanceState[]>
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

    return BLOCK_CAUTION_FRACTION * worstSwing;
}

/** Pure material margin from `playerId`'s view: sum(self terms) − sum(opp
 *  terms), with NO terminal win/loss offset. Unlike `evaluate`, this never
 *  saturates — a creature's worth of material is the same delta whether the
 *  position is even or decided. The ISMCTS search (issue #138) accumulates it
 *  per edge to break ties between candidates whose win/loss outcome is identical
 *  but whose surviving material differs (e.g. a free chump attack vs passing). */
export function materialMargin(state: GameState, playerId: string): number {
    const me = state.players.find((p) => p.id === playerId);
    const opp = state.players.find((p) => p.id !== playerId);
    if (!me || !opp) return 0;
    return playerScore(state, me) - playerScore(state, opp);
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
    playerId: string
): PositionBreakdown {
    const me = state.players.find((p) => p.id === playerId);
    const opp = state.players.find((p) => p.id !== playerId);
    const empty: EvalTerms = {
        life: 0,
        hand: 0,
        creatures: 0,
        permanents: 0,
        mana: 0,
        flexibility: 0,
    };
    if (!me || !opp) {
        return { self: empty, opp: empty, margin: 0, danger: 0, total: 0 };
    }
    const self = playerTerms(state, me);
    const oppTerms = playerTerms(state, opp);
    const margin = sumTerms(self) - sumTerms(oppTerms);
    return {
        self,
        opp: oppTerms,
        margin,
        danger: dangerClock(state, playerId),
        total: evaluate(state, playerId),
    };
}
