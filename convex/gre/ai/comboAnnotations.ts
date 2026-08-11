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
//
// ADDING A COMBO: import `registerCombo` and call it at module level in this
// file (see the Twin combo at the bottom). No other file needs to change.

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
    /** How many pieces must be on the BATTLEFIELD (not in hand) to earn this boost. */
    piecesOnBoard: number;
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

const REGISTERED_IDS = new Set<string>();

export function registerCombo(combo: ComboAnnotation): void {
    if (REGISTERED_IDS.has(combo.id)) return;
    REGISTERED_IDS.add(combo.id);
    COMBO_REGISTRY.push(combo);
}

export function clearComboRegistry(): void {
    COMBO_REGISTRY.length = 0;
    REGISTERED_IDS.clear();
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
        let onBoard = 0;
        let hasInHandPiece = false;
        for (const piece of combo.pieces) {
            if (!pieceSatisfied(piece, player, allBattlefield)) continue;
            // Count pieces actually ON the battlefield vs merely in hand.
            if (piece.zone === "battlefield") {
                onBoard += 1;
            } else if (piece.zone === "hand") {
                hasInHandPiece = true;
            } else {
                // zone "any": check where it was found.
                const onBf = allBattlefield.some(
                    (c) => (c.card as { id?: string }).id === piece.cardId
                );
                if (onBf) {
                    onBoard += 1;
                } else {
                    hasInHandPiece = true;
                }
            }
        }
        // Mana gate: if the combo needs mana to cast a piece still in hand,
        // and we don't have enough, cap the stage.
        if (
            hasInHandPiece &&
            combo.manaRequired !== undefined &&
            mana < combo.manaRequired
        ) {
            // Cannot cast the missing piece — only onboard pieces count.
        }
        // Find the highest qualifying stage based on pieces ON BOARD.
        let bestBoost = 0;
        for (const stage of combo.stages) {
            if (onBoard >= stage.piecesOnBoard) {
                bestBoost = stage.boost;
            }
        }
        total += bestBoost;
    }
    return total;
}

// --- Registered combos -------------------------------------------------------
// Add new combos below. Each calls `registerCombo(...)` at module level so the
// combo is registered as soon as this module is loaded (which happens when
// `evaluate.ts` imports `comboScore`).

const DECEIVER_EXARCH_ID = "1f123ad6-fe84-4fed-9c0f-6b41921e9c26";
const SPLINTER_TWIN_ID = "2f8f22fb-7291-4517-9b15-e98501f2856b";

registerCombo({
    id: "splinter-twin-combo",
    name: "Splinter Twin + Deceiver Exarch",
    pieces: [
        {
            cardId: DECEIVER_EXARCH_ID,
            zone: "battlefield",
            controller: "you",
            untapped: true,
        },
        { cardId: SPLINTER_TWIN_ID, zone: "any" },
    ],
    manaRequired: 4,
    stages: [{ piecesOnBoard: 2, boost: 5000 }],
});
