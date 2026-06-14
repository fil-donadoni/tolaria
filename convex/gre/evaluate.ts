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
const W_MANA = 1; // per untapped mana source (available mana proxy)

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

/** Material score of one player's resources, from their own perspective. */
function playerScore(state: GameState, player: PlayerState): number {
    let score = player.life * W_LIFE;
    score += player.hand.length * W_HAND;

    let availableMana = 0;
    for (const perm of player.battlefield) {
        score += W_PERMANENT;
        if (isCreature(perm)) {
            const power = Math.max(0, getEffectivePower(state, perm));
            const toughness = Math.max(0, getEffectiveToughness(state, perm));
            score += power * W_POWER + toughness * W_TOUGHNESS;
            if (isEvasive(perm)) score += power * W_EVASION_POWER;
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
    score += availableMana * W_MANA;
    return score;
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
