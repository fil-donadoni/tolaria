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
import {
    getEffectivePower,
    getEffectiveToughness,
    getPermanentEffectivePower,
    getPermanentEffectiveToughness,
} from "./layers";
import { isCreature, isLand, hasManaAbility, manaValue } from "./constants";
import {
    getInstanceManaCost,
    getInstanceAiValue,
    tryGetCardById,
} from "../cards";
import { dangerClock, predictCombatOutcome } from "./dangerClock";

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
const LATENT_DISCOUNT = 0.85; // latent creature worth = discounted realized
const NONCREATURE_BASE = 8; // base latent worth of a non-creature card (MV 0)
const W_NC_MV = 10; // per mana value, non-creature latent worth

// --- Forge `evaluateCreature` port (ADR 0018) ------------------------------
// Realized worth of a creature on the battlefield: a base, power- and
// toughness-weighted body, a mana-value term, plus keyword bonuses. Forge
// magnitudes (a vanilla 2/2 ≈ 170). Power-scales evasion / combat amplifiers
// (their value grows with the damage they push through), flat for binary
// keywords, negative for defender.
const CREATURE_BASE = 100;
const W_CR_POWER = 15;
const W_CR_TOUGHNESS = 14;
const W_CR_MV = 5;

/** Keyword → realized-value bonus, as a function of the creature's (floored)
 *  effective power. Structured as a table so an unimplemented keyword is
 *  zero-cost to add: drop in one entry. Restricted to the implemented keyword
 *  vocabulary (CR 702). Evasion and combat amplifiers are power-scaled; binary
 *  keywords are flat; `defender` is a penalty (the creature can't attack, so its
 *  power pushes no damage). Both `"first strike"` (the canonical engine spelling,
 *  see phases.ts) and the hyphenated form are accepted. */
const KEYWORD_BONUS: Record<string, (power: number) => number> = {
    // Evasion — harder-to-block damage scales with power (CR 509.1b).
    flying: (p) => 10 * p,
    fear: (p) => 8 * p,
    unblockable: (p) => 12 * p,
    intimidate: (p) => 8 * p,
    skulk: (p) => 6 * p,
    horsemanship: (p) => 10 * p,
    shadow: (p) => 10 * p,
    // Combat amplifiers — value grows with power.
    trample: (p) => 5 * p,
    "first strike": (p) => 5 + 4 * p,
    "first-strike": (p) => 5 + 4 * p,
    // Binary keywords — flat.
    vigilance: () => 8,
    reach: () => 5,
    indestructible: () => 30,
    haste: () => 10,
    banding: () => 5,
    // Defender — can't attack: its power is dead weight (CR 702.3a).
    defender: () => -30,
};

/** Pure Forge-scale creature body value from raw characteristics — no game
 *  state. Shared by the realized `evaluateCreature` (effective P/T) and the
 *  latent `cardValue*` (base P/T), so both read the identical formula. Power /
 *  toughness must already be floored at 0. */
function creatureValueRaw(
    power: number,
    toughness: number,
    mv: number,
    staticAbilities: readonly string[]
): number {
    let value =
        CREATURE_BASE +
        power * W_CR_POWER +
        toughness * W_CR_TOUGHNESS +
        mv * W_CR_MV;
    for (const keyword of staticAbilities) {
        const bonus = KEYWORD_BONUS[keyword];
        if (bonus) value += bonus(power);
    }
    return value;
}

/** Realized Forge-scale value of a creature in play. Reads PERMANENT effective
 *  P/T (ADR 0020 §2) — until-end-of-turn buffs (combat tricks) are excluded so
 *  the leaf does not score a temporary +X/+X as lasting board material, which
 *  gave the bot a false incentive to dump a trick at sorcery speed. Persistent
 *  layers (counters, static buffs) still count. Mana value comes from the
 *  registry / embedded cost. Floored at 0 power/toughness so a shrunk creature
 *  never goes negative through the body term. */
export function evaluateCreature(
    state: GameState,
    card: CardInstanceState
): number {
    return creatureValueRaw(
        Math.max(0, getPermanentEffectivePower(state, card)),
        Math.max(0, getPermanentEffectiveToughness(state, card)),
        manaValue(getInstanceManaCost(card)),
        card.staticAbilities
    );
}

/** Latent worth from a card's raw characteristics (ADR 0018) — the SHARED core
 *  of every `cardValue*` entry point. An `aiValue` override wins outright (the
 *  Forge `SVar` analog); otherwise a creature is its discounted creature body
 *  (a card in hand must still be cast and survive), and a non-creature is
 *  `NONCREATURE_BASE + MV × W_NC_MV`. A basic land scores `NONCREATURE_BASE`
 *  (MV 0) — below its realized in-play worth, so developing it stays strictly
 *  positive (issue #149). */
function latentValue(chars: {
    isCreature: boolean;
    power: number;
    toughness: number;
    manaValue: number;
    staticAbilities: readonly string[];
    aiValue?: number;
}): number {
    if (chars.aiValue !== undefined) return chars.aiValue;
    if (chars.isCreature) {
        return (
            LATENT_DISCOUNT *
            creatureValueRaw(
                Math.max(0, chars.power),
                Math.max(0, chars.toughness),
                chars.manaValue,
                chars.staticAbilities
            )
        );
    }
    return NONCREATURE_BASE + chars.manaValue * W_NC_MV;
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
    });
}

/** Latent worth of a card from its registry id alone — the resolution-choice
 *  entry point (ADR 0018, issue #197). The bot's owed-choice path has full card
 *  identity but only a slim projected instance, so this derives the value from
 *  the `CardDefinition` (base P/T, mana value, keywords, `aiValue`) via the same
 *  `latentValue` core the Hand term uses. Returns 0 for an unknown id (a token
 *  or a card the client registry lacks — it simply ranks lowest). */
export function cardValueById(cardId: string): number {
    const def = tryGetCardById(cardId);
    if (!def) return 0;
    return latentValue({
        isCreature: def.types.includes("Creature"),
        power: def.power ?? 0,
        toughness: def.toughness ?? 0,
        manaValue: manaValue(def.manaCost),
        staticAbilities: def.staticAbilities ?? [],
        aiValue: def.aiValue,
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

    let availableMana = 0;
    for (const perm of player.battlefield) {
        terms.permanents += W_PERMANENT;
        if (isCreature(perm)) {
            terms.creatures += evaluateCreature(state, perm);
        }
        // Available mana: an untapped source that can still produce mana this
        // turn. Lands and other mana permanents both count.
        if (!perm.isTapped && (isLand(perm) || hasManaAbility(perm))) {
            availableMana += 1;
        }
    }
    // Floating mana is already-available too.
    for (const c of ["W", "U", "B", "R", "G", "C"] as const) {
        availableMana += player.manaPool[c] ?? 0;
    }
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
        declaredCombatDelta(state, me.id)
    );
}

/** The expected material + life swing of a combat ALREADY DECLARED but not yet
 *  resolved, from `viewerId`'s perspective (ADR 0020 §3). A `declare-attackers`
 *  leaf is otherwise scored on the PRE-damage snapshot, so every attack set
 *  evaluates identically and the choice falls to the noisy rollout. Folding the
 *  predicted exchange in lets the leaf tell a profitable attack from a creature
 *  walking into death. Zero when no combat is pending blocks. */
function declaredCombatDelta(state: GameState, viewerId: string): number {
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

    const outcome = predictCombatOutcome(state, attackerId, defender.id);
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

    return viewerId === attackerId ? attackerDelta : -attackerDelta;
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
 *  confirmed. */
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
    const blockersByAttacker = new Map<string, CardInstanceState[]>();
    for (const [blockerId, atkIds] of Object.entries(
        combat.blockerAssignments
    )) {
        const blocker = defender.battlefield.find((c) => c.id === blockerId);
        if (!blocker) continue;
        for (const atkId of atkIds) {
            const list = blockersByAttacker.get(atkId) ?? [];
            list.push(blocker);
            blockersByAttacker.set(atkId, list);
        }
    }

    let faceDamage = 0;
    const deadAttackers: CardInstanceState[] = [];
    const deadBlockers: CardInstanceState[] = [];

    for (const atkId of combat.attackerIds) {
        const atk = attacker.battlefield.find((c) => c.id === atkId);
        if (!atk) continue;
        const blockers = blockersByAttacker.get(atkId) ?? [];
        if (blockers.length === 0) {
            faceDamage += Math.max(0, getPermanentEffectivePower(state, atk));
            continue;
        }
        const atkPower = Math.max(0, getPermanentEffectivePower(state, atk));
        const atkTough = Math.max(
            0,
            getPermanentEffectiveToughness(state, atk)
        );
        // Blockers' combined power vs the attacker's toughness.
        const blockPower = blockers.reduce(
            (sum, b) => sum + Math.max(0, getPermanentEffectivePower(state, b)),
            0
        );
        if (blockPower >= atkTough) deadAttackers.push(atk);
        // Attacker assigns its power to blockers in listed order, lethal first.
        let remaining = atkPower;
        for (const b of blockers) {
            const bTough = Math.max(
                0,
                getPermanentEffectiveToughness(state, b)
            );
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
    const defenderDelta =
        value(deadAttackers) - value(deadBlockers) - faceDamage * W_LIFE;

    return viewerId === defender.id ? defenderDelta : -defenderDelta;
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
 *  `evaluate(state, playerId)`. In an open position `total = margin + danger`;
 *  in a terminal one the win/loss offset dominates and `danger` is omitted. */
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
