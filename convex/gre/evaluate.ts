// Position heuristic for the vs-AI Bot (ADR 0001, issue #111).
//
// `evaluate(state, playerId)` scores a GameState from `playerId`'s point of
// view: higher is better for that player. It is the leaf estimate the greedy
// 1-ply selection (issue #111) and, later, the truncated ISMCTS rollouts
// (issue #112) use to compare candidate continuations. The exact weights are a
// first, deliberately-simple version expected to be iterated once the bot is
// playable — the contract that must hold is the ORDERING, not the magnitudes:
//
//   * a won position outranks any non-won position, a lost one ranks below all;
//   * more life, more board (summed power/toughness), more cards in hand and in
//     play, and more available mana each raise the score, all else equal;
//   * evasive attackers (flying/unblockable/fear/shadow/…) are worth more power
//     than ground creatures because their damage is harder to stop.
//
// PURE: no Math.random, no mutation, no ctx. Reads effective P/T through the
// layer system so static buffs (counters, anthems) are reflected.

import type { CardInstanceState, GameState, PlayerState } from "./state";
import { getEffectivePower, getEffectiveToughness } from "./layers";
import { isCreature, isLand, hasManaAbility } from "./constants";

/** A won position. Large enough to dominate every material term so the bot
 *  always prefers lethal, and finite so two winning lines stay comparable by
 *  their material margin. */
export const WIN_SCORE = 1_000_000;

// Material weights. Tuned only for ordering (see file header); life is the
// scarcest resource near death, so it outweighs a point of power/toughness.
const W_LIFE = 3;
const W_POWER = 2;
const W_TOUGHNESS = 1;
const W_EVASION_POWER = 1; // extra per power point on an evasive creature
const W_HAND = 2;
const W_PERMANENT = 1;
// Per untapped mana source (available mana proxy). Weighted so that DEVELOPING
// a land is strictly positive: a land drop is −W_HAND (leaves hand) +W_PERMANENT
// (enters battlefield) +W_MANA (adds an untapped source). With W_MANA = 2 that
// delta is +1 (issue #149) — a land in play (W_PERMANENT + W_MANA = 3) outvalues
// the same land sitting in hand (W_HAND = 2), so both the greedy 1-ply selection
// and the ISMCTS tie-break (materialMargin) prefer the drop over passing. At
// W_MANA = 1 the delta was 0 and the bot tied play-land with pass, stalling its
// own mana. Monotonicity ("more mana raises the score") is preserved, only
// strengthened.
const W_MANA = 2;

/** Keywords that make a creature's combat damage hard to stop. A creature with
 *  any of these is treated as a more valuable clock (CR 509.1b evasion). */
const EVASION_KEYWORDS = [
    "flying",
    "unblockable",
    "fear",
    "shadow",
    "horsemanship",
    "intimidate",
    "skulk",
] as const;

function isEvasive(card: CardInstanceState): boolean {
    return EVASION_KEYWORDS.some((k) => card.staticAbilities.includes(k));
}

/** One player's material score split into its weighted contributions. Each
 *  field is the term's contribution to the score (count × weight), so the terms
 *  sum to the player's `playerScore`. Surfaced by `evaluateBreakdown` for the
 *  DecisionTrace debug view (issue: AI reasoning logging) — seeing the per-term
 *  decomposition is what distinguishes "the draw/pump was not simulated" (the
 *  term is unchanged across target choices) from a genuine evaluation. */
export type EvalTerms = {
    life: number;
    hand: number;
    power: number;
    toughness: number;
    evasion: number;
    permanents: number;
    mana: number;
};

/** The weighted contributions of one player's resources, from their own
 *  perspective. `sumTerms` of this equals the legacy `playerScore`. */
function playerTerms(state: GameState, player: PlayerState): EvalTerms {
    const terms: EvalTerms = {
        life: player.life * W_LIFE,
        hand: player.hand.length * W_HAND,
        power: 0,
        toughness: 0,
        evasion: 0,
        permanents: 0,
        mana: 0,
    };

    let availableMana = 0;
    for (const perm of player.battlefield) {
        terms.permanents += W_PERMANENT;
        if (isCreature(perm)) {
            const power = Math.max(0, getEffectivePower(state, perm));
            const toughness = Math.max(0, getEffectiveToughness(state, perm));
            terms.power += power * W_POWER;
            terms.toughness += toughness * W_TOUGHNESS;
            if (isEvasive(perm)) terms.evasion += power * W_EVASION_POWER;
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
    return terms;
}

function sumTerms(t: EvalTerms): number {
    return (
        t.life +
        t.hand +
        t.power +
        t.toughness +
        t.evasion +
        t.permanents +
        t.mana
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
    // remain ordered by how decisive they are.
    if (state.gameOver) {
        if (state.gameOver.winnerId === playerId) return WIN_SCORE + margin;
        if (state.gameOver.loserId === playerId) return -WIN_SCORE + margin;
    }
    const oppLost = opp.life <= 0;
    const meLost = me.life <= 0;
    if (oppLost && !meLost) return WIN_SCORE + margin;
    if (meLost && !oppLost) return -WIN_SCORE + margin;

    return margin;
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
 *  contributions plus the final `evaluate` value. Pure read used only by the
 *  DecisionTrace debug view — it never feeds the search itself. `margin` is the
 *  pre-terminal material difference (sum(self) − sum(opp)); `total` is the full
 *  `evaluate(state, playerId)` (terminal offsets included), so the two differ
 *  exactly when the position is terminal. */
export type PositionBreakdown = {
    self: EvalTerms;
    opp: EvalTerms;
    margin: number;
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
        power: 0,
        toughness: 0,
        evasion: 0,
        permanents: 0,
        mana: 0,
    };
    if (!me || !opp) {
        return { self: empty, opp: empty, margin: 0, total: 0 };
    }
    const self = playerTerms(state, me);
    const oppTerms = playerTerms(state, opp);
    const margin = sumTerms(self) - sumTerms(oppTerms);
    return {
        self,
        opp: oppTerms,
        margin,
        total: evaluate(state, playerId),
    };
}
