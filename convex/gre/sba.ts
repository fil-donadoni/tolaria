import type { CardInstanceState, GameState } from "./state";
import { getOpponentId, removePermanentTo } from "./state";
import { isAura } from "./constants";
import { isProtectedFromSource } from "./protection";
import { applyStateTriggers } from "./triggers";
import { tryGetCardById } from "../cards";

/**
 * Check State-Based Actions related to game ending (CR 704.5).
 * Returns true if the game is over (sets state.gameOver).
 *
 * Checked conditions:
 * - CR 704.5a: A player with 0 or less life loses.
 * - CR 704.5b: A player who attempted to draw from an empty library loses.
 */
export function checkGameOverSBA(state: GameState): boolean {
    if (state.gameOver) return true;

    for (const player of state.players) {
        let reason: "life" | "decked" | null = null;

        if (player.life <= 0) {
            reason = "life";
        } else if (player.hasDrawnFromEmpty) {
            reason = "decked";
        }

        if (reason) {
            state.gameOver = {
                winnerId: getOpponentId(state, player.id),
                loserId: player.id,
                reason,
            };
            return true;
        }
    }

    return false;
}

/**
 * CR 704.5m — if an Aura is attached to an illegal object or player, or is
 * not attached at all, it is put into its owner's graveyard. Also enforces
 * CR 702.16c: an Aura of color X attached to a permanent with protection
 * from X goes to the graveyard. CR 702.16n exempts auras that carry the
 * "this effect doesn't remove this Aura" rider — see
 * `CardDefinition.exemptFromProtectionDetach`.
 *
 * Illegal host means: no longer on the battlefield, or no longer satisfies
 * the aura's enchant restriction (derived from the aura's `targetRequirement`
 * type — e.g. Control Magic requires a Creature, Steal Artifact requires an
 * Artifact).
 *
 * Called after any action that may invalidate an attachment: resolution,
 * combat damage, destroy effects, acquiring protection, etc.
 */
export function checkAuraAttachmentSBA(state: GameState): boolean {
    const toDetach: string[] = [];
    for (const player of state.players) {
        for (const card of player.battlefield) {
            if (!isAura(card)) continue;
            const hostId = card.attachedTo;
            const host = hostId ? findOnBattlefield(state, hostId) : null;
            if (!host || !hostMatchesAuraRestriction(card, host)) {
                toDetach.push(card.id);
                continue;
            }
            // CR 702.16c: protected host with matching-quality aura →
            // graveyard. CR 702.16n exemption short-circuits the check.
            if (isAuraBlockedByProtection(card, host)) {
                toDetach.push(card.id);
            }
        }
    }
    // Defer mutation so iteration isn't affected. removePermanentTo also
    // reverts any keyword grants this aura applied to its host (if still
    // present), keeping read-time lookups consistent.
    for (const id of toDetach) {
        removePermanentTo(state, id, "graveyard");
    }
    return toDetach.length > 0;
}

/** True if `host` still satisfies the aura's enchant restriction. The
 *  restriction is read from the aura's `targetRequirement.type` — auras in
 *  this codebase encode "Enchant X" as a `CardType` target. */
function hostMatchesAuraRestriction(
    aura: CardInstanceState,
    host: CardInstanceState
): boolean {
    const cardId = (aura.card as { id?: string }).id;
    const def = cardId ? tryGetCardById(cardId) : null;
    const req = def?.targetRequirement;
    if (!req) return false;
    const types = Array.isArray(req.type) ? req.type : [req.type];
    for (const t of types) {
        if (t === "player" || t === "any" || t === "spell" || t === "card")
            continue;
        if (host.types.includes(t)) return true;
    }
    return false;
}

/** CR 702.16c with the 702.16n exemption: true when the aura's color matches
 *  a protection the host has AND the aura does not carry the self-remove
 *  exemption. */
function isAuraBlockedByProtection(
    aura: CardInstanceState,
    host: CardInstanceState
): boolean {
    const cardId = (aura.card as { id?: string }).id;
    const def = cardId ? tryGetCardById(cardId) : null;
    if (def?.exemptFromProtectionDetach) return false;
    return isProtectedFromSource(host, aura);
}

function findOnBattlefield(
    state: GameState,
    id: string
): CardInstanceState | null {
    for (const p of state.players) {
        const found = p.battlefield.find((c) => c.id === id);
        if (found) return found;
    }
    return null;
}

/** Runs every SBA once. Currently: aura attachments (CR 704.5m), game-over
 *  (CR 704.5a/b). Expand as more SBAs come online (706.5c/d/e for legend
 *  rule, +1/-1 counter cancellation, etc.).
 *
 *  Per CR 117.5, after SBA resolution and before priority is granted, the
 *  game scans for state-triggered abilities (CR 603.8) and puts them on the
 *  stack. The two checkpoints are coupled at every priority handoff, so we
 *  fold the state-trigger scan into this entry point. */
export function checkStateBasedActions(state: GameState): void {
    checkAuraAttachmentSBA(state);
    checkGameOverSBA(state);
    if (state.gameOver) return;
    // CR 117.5: state triggers go on the stack after SBA. Don't scan if the
    // game ended — there's no priority handoff to satisfy.
    applyStateTriggers(state);
}
