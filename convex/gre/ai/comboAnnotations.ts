// Combo annotation system — per-combo boost layer on top of the general eval.
//
// Each annotation declares which card pieces must be present (in which zones),
// and progressive stage boosts. The combo scorer checks every registered combo
// against the current GameState and returns the sum of all matching stage
// boosts. Zero risk of regression: only ADDITIVE boosts, and the general eval
// is never touched.
//
// A combo the bot would otherwise miss (e.g. Splinter Twin + Deceiver Exarch)
// gets a boost large enough to prioritise assembling it, and ISMCTS handles
// tactical execution through the real GRE.

import type { CardInstanceState, GameState, PlayerState } from "../state";
import { isUntappedManaSource } from "../constants";

// --- Types ------------------------------------------------------------------

export interface ComboPiece {
    /** Card definition id (the Scryfall UUID). */
    cardId: string;
    /** Which zone the card must be in. */
    zone: "battlefield" | "hand" | "any";
    /** Who must control the card (only meaningful for battlefield). */
    controller?: "you" | "any";
    /** If true, the permanent must be untapped (only meaningful for battlefield). */
    untapped?: boolean;
}

export interface ComboStage {
    /** How many pieces must be satisfied to earn this boost. */
    piecesRequired: number;
    /** Forge-scale boost added to the player's score. */
    boost: number;
}

export interface ComboAnnotation {
    /** Stable unique id. */
    id: string;
    /** Human-readable name for debug logs. */
    name: string;
    /** Required pieces. */
    pieces: ComboPiece[];
    /** Optional conditions (e.g. "need enough mana to cast the missing piece"). */
    manaRequired?: number;
    /** Progressive boosts for each assembly stage. */
    stages: ComboStage[];
}

// --- Registry ---------------------------------------------------------------

const COMBO_REGISTRY: ComboAnnotation[] = [];

export function registerCombo(combo: ComboAnnotation): void {
    COMBO_REGISTRY.push(combo);
}

export function clearComboRegistry(): void {
    COMBO_REGISTRY.length = 0;
}

export function getComboRegistry(): readonly ComboAnnotation[] {
    return COMBO_REGISTRY;
}

// --- Scoring ----------------------------------------------------------------

function availableManaFor(player: PlayerState): number {
    let n = 0;
    for (const perm of player.battlefield) {
        if (isUntappedManaSource(perm, player.battlefield)) n += 1;
    }
    for (const c of ["W", "U", "B", "R", "G", "C"] as const) {
        n += player.manaPool[c] ?? 0;
    }
    return n;
}

function pieceSatisfied(
    piece: ComboPiece,
    player: PlayerState,
    allBattlefield: CardInstanceState[]
): boolean {
    if (piece.zone === "hand" || piece.zone === "any") {
        const inHand = player.hand.some(
            (c) => (c.card as { id?: string }).id === piece.cardId
        );
        if (inHand) return true;
    }
    if (piece.zone === "battlefield" || piece.zone === "any") {
        for (const perm of allBattlefield) {
            const cid = (perm.card as { id?: string }).id;
            if (cid !== piece.cardId) continue;
            if (piece.controller === "you" && perm.controllerId !== player.id)
                continue;
            if (piece.untapped && perm.isTapped) continue;
            return true;
        }
    }
    return false;
}

/**
 * Scores all registered combos from `player`'s perspective. Returns the sum of
 * all matching stage boosts. PURE: no state mutation, no randomness.
 */
export function comboScore(state: GameState, playerId: string): number {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return 0;

    const allBattlefield = state.players.flatMap((p) => p.battlefield);
    const mana = availableManaFor(player);

    let total = 0;
    for (const combo of COMBO_REGISTRY) {
        let satisfied = 0;
        let hasInHandPiece = false;
        for (const piece of combo.pieces) {
            if (pieceSatisfied(piece, player, allBattlefield)) {
                satisfied += 1;
                if (piece.zone === "hand" || piece.zone === "any") {
                    // Check if this piece was satisfied via hand (not battlefield)
                    const inHand = player.hand.some(
                        (c) => (c.card as { id?: string }).id === piece.cardId
                    );
                    if (inHand) hasInHandPiece = true;
                }
            }
        }
        // Mana gate: if the combo needs mana to cast a piece still in hand,
        // and we don't have enough, cap the stage. Skip the gate when every
        // piece is already on the battlefield (the mana was already spent).
        if (
            hasInHandPiece &&
            combo.manaRequired !== undefined &&
            mana < combo.manaRequired
        ) {
            satisfied = Math.min(satisfied, combo.pieces.length - 1);
        }
        // Find the highest qualifying stage.
        let bestBoost = 0;
        for (const stage of combo.stages) {
            if (satisfied >= stage.piecesRequired) {
                bestBoost = stage.boost;
            }
        }
        total += bestBoost;
    }
    return total;
}
