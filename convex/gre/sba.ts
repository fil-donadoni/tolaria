import type { CardInstanceState, GameState } from "./state";
import { getOpponentId, removePermanentTo, revertControlChange } from "./state";
import { isAura } from "./constants";
import {
    getEffectivePower,
    getEffectiveToughness,
    isSourceTappedLive,
} from "./layers";
import { isProtectedFromSource } from "./protection";
import { applyLoseGameReplacements } from "./replacements";
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
            // CR 614 — Lich's "you don't lose the game" replacement can consume
            // the loss event. If the replacement returns null, the player
            // survives this check; the loss can re-fire on a subsequent SBA
            // sweep if the replacement source has left play in the meantime.
            const survived =
                applyLoseGameReplacements(state, {
                    kind: "lose-game",
                    playerId: player.id,
                    reason: "life-zero",
                }) === null;
            if (!survived) {
                reason = "life";
            }
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
        if (
            t === "player" ||
            t === "any" ||
            t === "spell" ||
            t === "spell-or-permanent" ||
            t === "card"
        )
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

/** CR 704.5d — a token in any zone other than the battlefield ceases to
 *  exist. The token briefly enters the destination zone (so death triggers
 *  see it leave the battlefield), then this SBA wipes it away. */
export function checkTokenExistenceSBA(state: GameState): boolean {
    let removed = false;
    for (const player of state.players) {
        for (const zone of ["graveyard", "exile", "hand", "library"] as const) {
            const list = player[zone];
            const kept = list.filter((c) => !c.isToken);
            if (kept.length !== list.length) {
                player[zone] = kept;
                removed = true;
            }
        }
    }
    return removed;
}

/** CR 704.5f — a creature with toughness 0 or less is put into its owner's
 *  graveyard. This is a direct zone change, not a "destroy", so regeneration
 *  and indestructible do not apply (CR 704.5f vs 704.5g). Reads effective
 *  toughness (layer 7c) so a creature reduced to 0 by a -X/-X effect or a
 *  copy that entered as a 0/0 (Clone with no target) is swept. Loops until
 *  stable because one death can drop another creature's toughness (e.g. a
 *  Forest-counting Gaea's Liege losing its last Forest). */
export function checkZeroToughnessSBA(state: GameState): boolean {
    let removedAny = false;
    for (;;) {
        let removed = false;
        for (const player of state.players) {
            const victim = player.battlefield.find(
                (c) =>
                    c.types.includes("Creature") &&
                    getEffectiveToughness(state, c) <= 0
            );
            if (victim) {
                removePermanentTo(state, victim.id, "graveyard");
                removed = true;
                removedAny = true;
                break; // battlefield arrays mutated — restart the scan
            }
        }
        if (!removed) break;
    }
    return removedAny;
}

/** Runs every SBA once. Currently: aura attachments (CR 704.5m), zero
 *  toughness (CR 704.5f), token existence (CR 704.5d), game-over
 *  (CR 704.5a/b). Expand as more SBAs come online (706.5c/d/e for legend
 *  rule, +1/-1 counter cancellation, etc.).
 *
 *  Per CR 117.5, after SBA resolution and before priority is granted, the
 *  game scans for state-triggered abilities (CR 603.8) and puts them on the
 *  stack. The two checkpoints are coupled at every priority handoff, so we
 *  fold the state-trigger scan into this entry point. */
/** Finds a permanent on any battlefield by instance id (CR 110). */
function findPermanent(
    state: GameState,
    id: string
): CardInstanceState | undefined {
    for (const p of state.players) {
        const hit = p.battlefield.find((c) => c.id === id);
        if (hit) return hit;
    }
    return undefined;
}

/** Returns true while a conditional control change (CR 611.2b) still holds.
 *  The change's source is the entry's `auraId`; a missing source always
 *  fails the condition (the effect ends when its source leaves). */
function controlConditionHolds(
    state: GameState,
    host: CardInstanceState,
    entry: NonNullable<CardInstanceState["controlChanges"]>[number]
): boolean {
    const cond = entry.condition;
    if (!cond) return true;
    const source = findPermanent(state, entry.auraId);
    if (!source) return false;
    if (cond.kind === "controller-controls-source") {
        // Aladdin: holds while the gainer still controls the source.
        return source.controllerId === cond.controllerId;
    }
    // Old Man of the Sea: holds while the source is tapped and its power is
    // still >= the controlled creature's power.
    if (!source.isTapped) return false;
    return getEffectivePower(state, source) >= getEffectivePower(state, host);
}

/** SBA for "for as long as" control changes (CR 611.2b). Scans every
 *  permanent's `controlChanges` for entries whose condition has lapsed and
 *  reverts them (returning control to the prior controller). Loops until
 *  stable because a revert moves a permanent between battlefield arrays.
 *  Indefinite control changes (no `condition`, e.g. Ghazbán Ogre) are
 *  untouched. */
export function checkConditionalControlChanges(state: GameState): boolean {
    let revertedAny = false;
    for (;;) {
        let reverted = false;
        for (const player of state.players) {
            let hit: { hostId: string; sourceId: string } | null = null;
            for (const card of player.battlefield) {
                const entry = card.controlChanges?.find(
                    (e) => e.condition && !controlConditionHolds(state, card, e)
                );
                if (entry) {
                    hit = { hostId: card.id, sourceId: entry.auraId };
                    break;
                }
            }
            if (hit) {
                revertControlChange(state, hit.hostId, hit.sourceId);
                reverted = true;
                revertedAny = true;
                break; // battlefield arrays mutated — restart the scan
            }
        }
        if (!reverted) break;
    }
    return revertedAny;
}

/** SBA for "for as long as [the source] remains tapped" effects (CR 611.2;
 *  ATQ cluster E). Strips `sourceTappedPTMods` entries and `untapLockedBy`
 *  ids whose source has left the battlefield or untapped, so the buff /
 *  untap-lock ends the moment its source is no longer tapped. Idempotent and
 *  side-effect-free beyond the splice; the layer system also reads these live
 *  (`getSourceTappedPTBuff`), so this is the bookkeeping pass that keeps the
 *  stored state from accumulating stale entries (and that frees a locked
 *  permanent to untap on its next untap step). */
export function checkSourceTappedEffects(state: GameState): void {
    for (const player of state.players) {
        for (const card of player.battlefield) {
            if (card.sourceTappedPTMods?.length) {
                const kept = card.sourceTappedPTMods.filter((m) =>
                    isSourceTappedLive(state, m.sourceId)
                );
                card.sourceTappedPTMods = kept.length > 0 ? kept : undefined;
            }
            if (card.untapLockedBy?.length) {
                const kept = card.untapLockedBy.filter((sourceId) =>
                    isSourceTappedLive(state, sourceId)
                );
                card.untapLockedBy = kept.length > 0 ? kept : undefined;
            }
        }
    }
}

export function checkStateBasedActions(state: GameState): void {
    checkAuraAttachmentSBA(state);
    checkConditionalControlChanges(state);
    checkSourceTappedEffects(state);
    checkZeroToughnessSBA(state);
    checkTokenExistenceSBA(state);
    checkGameOverSBA(state);
    if (state.gameOver) return;
    // CR 117.5: state triggers go on the stack after SBA. Don't scan if the
    // game ended — there's no priority handoff to satisfy.
    applyStateTriggers(state);
}
