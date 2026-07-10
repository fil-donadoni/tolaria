import type { CardInstanceState, GameState } from "./state";
import {
    destroyWithReplacements,
    getOpponentId,
    processPendingActionTriggers,
    refreshLandPlayLock,
    removePermanentTo,
    revertControlChange,
} from "./state";
import { isAura } from "./constants";
import {
    getEffectivePower,
    getEffectiveToughness,
    isSourceTappedLive,
} from "./layers";
import { isProtectedFromSource } from "./protection";
import { applyLoseGameReplacements } from "./replacements";
import { applyStateTriggers } from "./triggers";
import { tryGetDefinition } from "../cards";

/** A player found to meet a loss condition during a single game-over sweep. */
type LossEntry = { playerId: string; reason: "life" | "decked" | "poison" };

/** CR 704.5a/b/c — does this player currently meet a loss condition? Returns
 *  the reason, or null if they survive. Loss replacements (CR 614) are applied
 *  here, BEFORE the player is counted as a loser: a "you don't lose the game"
 *  replacement that consumes the event means the player did not lose, which is
 *  what preserves (or breaks) simultaneity in the caller. */
function playerLossReason(
    state: GameState,
    player: GameState["players"][number]
): "life" | "decked" | "poison" | null {
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
        return survived ? null : "life";
    }
    if (player.hasDrawnFromEmpty) {
        return "decked";
    }
    if ((player.poisonCounters ?? 0) >= 10) {
        // CR 704.5c — a player with ten or more poison counters loses the
        // game. Routed through the same loss-replacement framework as
        // life-zero (CR 614) so a "you don't lose the game" replacement
        // can intercept it.
        const survived =
            applyLoseGameReplacements(state, {
                kind: "lose-game",
                playerId: player.id,
                reason: "poison",
            }) === null;
        return survived ? null : "poison";
    }
    return null;
}

/**
 * Check State-Based Actions related to game ending (CR 704.5).
 * Returns true if the game is over (sets state.gameOver).
 *
 * Checked conditions:
 * - CR 704.5a: A player with 0 or less life loses.
 * - CR 704.5b: A player who attempted to draw from an empty library loses.
 * - CR 704.5c: A player with ten or more poison counters loses.
 *
 * CR 704.5 — all loss conditions are checked simultaneously in a single sweep,
 * not one player at a time. CR 104.4a — if all the players still in the game
 * lose simultaneously, the game is a draw. So this collects EVERY player meeting
 * a loss condition this sweep (running each player's CR 614 loss replacements
 * first); if more than one loses (i.e. all remaining players in a 2-player
 * game), the game is a draw with no winner/loser. Otherwise the lone loser's
 * opponent wins, exactly as before.
 */
export function checkGameOverSBA(state: GameState): boolean {
    if (state.gameOver) return true;

    const losers: LossEntry[] = [];
    for (const player of state.players) {
        const reason = playerLossReason(state, player);
        if (reason) losers.push({ playerId: player.id, reason });
    }

    if (losers.length === 0) return false;

    if (losers.length > 1) {
        // CR 104.4a — all remaining players lost simultaneously → draw. Match
        // the existing draw shape (Divine Intervention, see SpellContext
        // .drawGame): empty winner/loser, reason "draw", isDraw flag set.
        state.gameOver = {
            winnerId: "",
            loserId: "",
            reason: "draw",
            isDraw: true,
        };
        return true;
    }

    const [loser] = losers;
    state.gameOver = {
        winnerId: getOpponentId(state, loser.playerId),
        loserId: loser.playerId,
        reason: loser.reason,
    };
    return true;
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
    const def = cardId ? tryGetDefinition(cardId) : null;
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
    const def = cardId ? tryGetDefinition(cardId) : null;
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
/** CR 704.5q — if a permanent has both a +1/+1 counter and a -1/-1 counter on
 *  it, N of each are removed, where N is the smaller of the two counts. The two
 *  kinds annihilate in equal numbers; the survivor keeps the remainder. This is
 *  a pure counter mutation (no zone change), run before the zero-toughness check
 *  so a creature reduced to 0 toughness only by un-annihilated -1/-1 counters
 *  dies with the correct net P/T. Returns true if any counters were removed. */
export function checkCounterAnnihilationSBA(state: GameState): boolean {
    let changedAny = false;
    for (const player of state.players) {
        for (const card of player.battlefield) {
            const counters = card.counters;
            if (!counters) continue;
            const plus = counters["+1/+1"] ?? 0;
            const minus = counters["-1/-1"] ?? 0;
            if (plus <= 0 || minus <= 0) continue;
            const n = Math.min(plus, minus);
            const next: Record<string, number> = { ...counters };
            if (plus - n > 0) next["+1/+1"] = plus - n;
            else delete next["+1/+1"];
            if (minus - n > 0) next["-1/-1"] = minus - n;
            else delete next["-1/-1"];
            card.counters = Object.keys(next).length > 0 ? next : undefined;
            changedAny = true;
        }
    }
    return changedAny;
}

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

/** CR 704.5h / 702.2b — a creature that has been dealt damage this turn by a
 *  source with deathtouch is destroyed as a state-based action. Unlike the
 *  zero-toughness sweep (a direct zone change), this IS a "destroy", so
 *  indestructible and regeneration apply (routed through
 *  `destroyWithReplacements`). The `dealtDeathtouchDamage` mark is set at every
 *  damage sink (`markDeathtouchDamage`) off the source's EFFECTIVE static
 *  abilities, so Humility-stripped deathtouch never marks anything. Loops until
 *  stable because one death can trigger further SBAs. */
export function checkDeathtouchDestroySBA(state: GameState): boolean {
    let destroyedAny = false;
    // Ids already attempted this sweep. An indestructible / regenerated marked
    // creature survives `destroyWithReplacements` and keeps its mark (so it dies
    // if it loses indestructible later this turn, CR 702.12), so tracking
    // attempts here prevents an infinite loop on it while still restarting the
    // scan after any actual removal (a death can cascade further SBAs).
    const attempted = new Set<string>();
    for (;;) {
        let destroyed = false;
        for (const player of state.players) {
            const victim = player.battlefield.find(
                (c) =>
                    c.types.includes("Creature") &&
                    c.dealtDeathtouchDamage === true &&
                    !attempted.has(c.id)
            );
            if (victim) {
                attempted.add(victim.id);
                // Indestructible / regeneration survives (CR 702.12, 701.15a);
                // the mark stays until CLEANUP.
                if (destroyWithReplacements(state, victim.id)) {
                    destroyedAny = true;
                }
                destroyed = true;
                break; // battlefield arrays mutated — restart the scan
            }
        }
        if (!destroyed) break;
    }
    return destroyedAny;
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
    if (cond.kind === "source-tapped") {
        // Preacher (CR 611.2b): holds purely while the source stays tapped —
        // no power constraint.
        return source.isTapped === true;
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

/** Reads a permanent's current definition (honoring copy effects, which
 *  overwrite `card.card.id` — CR 707.2). Returns null when the id is missing
 *  or unregistered (tokens with synthesized defs are still registered). */
function permanentDefinition(card: CardInstanceState) {
    const cardId = (card.card as { id?: string }).id;
    return cardId ? tryGetDefinition(cardId) : null;
}

/** CR 205.4a — true when the permanent currently has the Legendary supertype.
 *  The supertype lives on the (possibly copied) card definition, not on the
 *  instance; a Clone copying a Legendary creature reads Legendary here. */
function isLegendaryPermanent(card: CardInstanceState): boolean {
    return (
        permanentDefinition(card)?.supertypes?.includes("Legendary") ?? false
    );
}

/** The name the legend rule groups on (CR 704.5j keys off name). Read from the
 *  copied definition so Vesuvan Doppelganger / Clone group with the original.
 *  Undefined when the definition is missing (defensive — never groups). */
function legendName(card: CardInstanceState): string | undefined {
    return permanentDefinition(card)?.name;
}

/** CR 704.5j (modern, per-controller "legend rule") — if a player controls two
 *  or more legendary permanents with the same name, that player chooses one of
 *  them and the rest are put into their owners' graveyards. The choice (which
 *  duplicate to keep) is a genuine tactical decision (the copies can differ in
 *  counters, attached auras, tap/damage state), so per ADR 0003 it is always
 *  surfaced as a prompt — never auto-resolved.
 *
 *  This enqueues at most one `legend-keep` PendingChoice per call (the first
 *  offending controller/name group found). The submit path
 *  (`finalizeLegendKeep`) re-runs `checkStateBasedActions`, so a board with
 *  several simultaneous violations is drained one prompt at a time. Returns
 *  true when a prompt was enqueued (the caller must suspend — priority is
 *  frozen while a choice is pending). */
export function checkLegendRuleSBA(state: GameState): boolean {
    // A pending choice already freezes the game; don't stack another.
    if ((state.pendingChoices?.length ?? 0) > 0) return false;
    for (const player of state.players) {
        // Group this controller's legendary permanents by name.
        const byName = new Map<string, string[]>();
        for (const card of player.battlefield) {
            if (!isLegendaryPermanent(card)) continue;
            const name = legendName(card);
            if (name === undefined) continue;
            const ids = byName.get(name) ?? [];
            ids.push(card.id);
            byName.set(name, ids);
        }
        for (const [name, ids] of byName) {
            if (ids.length < 2) continue;
            // Found a violation — enqueue a keep-one prompt for this
            // controller and stop. Remaining violations resolve on the next
            // SBA sweep after this choice is committed.
            state.pendingChoices = [
                ...(state.pendingChoices ?? []),
                {
                    stackItemId: "", // SBA-level (no stack item)
                    step: 0,
                    choiceId: `legend-keep-${player.id}-${name}`,
                    playerId: player.id,
                    zoneOwnerId: player.id,
                    kind: "legend-keep",
                    zone: "battlefield",
                    count: 1,
                    candidateIds: ids,
                    prompt:
                        ids.length === 2
                            ? `Choose which ${name} to keep (the other is put into its owner's graveyard).`
                            : `Choose which ${name} to keep (the rest are put into their owners' graveyards).`,
                },
            ];
            state.priorityPlayerId = player.id;
            return true;
        }
    }
    return false;
}

/** Commits a `legend-keep` PendingChoice (CR 704.5j, #378): the chooser's
 *  single selected duplicate stays; every other candidate (the same-name group
 *  recorded on the choice) is put into its owner's graveyard. Drops the head
 *  choice and re-runs the SBA loop so further violations (or deaths triggered
 *  by these departures) are processed. No-op if the head is not a legend-keep
 *  phase-level choice. */
export function finalizeLegendKeep(
    state: GameState,
    selectedIds: string[]
): void {
    const queue = state.pendingChoices ?? [];
    const head = queue[0];
    if (!head || head.kind !== "legend-keep" || head.stackItemId !== "") {
        return;
    }
    const kept = selectedIds[0];
    // Put every same-name duplicate except the kept one into its owner's
    // graveyard (CR 704.5j — "owners' graveyards"; this is a zone change, not
    // a destroy, so indestructible/regeneration do not apply).
    for (const id of head.candidateIds ?? []) {
        if (id === kept) continue;
        removePermanentTo(state, id, "graveyard");
    }
    queue.shift();
    state.pendingChoices = queue.length > 0 ? queue : undefined;
    // Re-run SBAs: the departures may have created new violations, dropped a
    // creature to 0 toughness, ended the game, etc. (CR 704.3 — repeat until
    // no SBA applies). Priority is restored to the active player only once the
    // sweep settles with no further pending choice.
    checkStateBasedActions(state);
    if ((state.pendingChoices?.length ?? 0) === 0 && !state.gameOver) {
        state.priorityPlayerId = state.activePlayerId;
    }
}

/** CR 205.4a — true when the permanent currently has the World supertype.
 *  Read from the (possibly copied) card definition, mirroring the Legendary
 *  check, so a Clone copying a World permanent reads World here. */
function isWorldPermanent(card: CardInstanceState): boolean {
    return permanentDefinition(card)?.supertypes?.includes("World") ?? false;
}

/** Every World permanent across both players' battlefields (CR 704.5m — the
 *  world rule is global, unlike the per-controller legend rule). */
function allWorldPermanents(state: GameState): CardInstanceState[] {
    const result: CardInstanceState[] = [];
    for (const player of state.players) {
        for (const card of player.battlefield) {
            if (isWorldPermanent(card)) result.push(card);
        }
    }
    return result;
}

/** CR 704.5m — the "world rule." If two or more permanents have the World
 *  supertype, all except the one that has had the World supertype for the
 *  shortest amount of time are put into their owners' graveyards. In the event
 *  of a tie for the shortest amount of time, ALL tied permanents are put into
 *  their owners' graveyards.
 *
 *  "Shortest time as a world permanent" is tracked by `worldSeq`, a monotonic
 *  timestamp stamped the first time each permanent is observed carrying the
 *  World supertype (CR 613.7m). Higher seq = became a world permanent more
 *  recently = shorter time; the survivor is the permanent with the maximum
 *  seq. Permanents first observed in the same SBA sweep share a seq — that
 *  shared maximum encodes the simultaneous-tie case (a single effect ETB-ing
 *  two World permanents), in which the rule destroys all of them.
 *
 *  Fully automatic — no player choice (CR 704.5m), unlike the legend rule.
 *  Returns true when a permanent was moved (the SBA caller re-runs the sweep
 *  per CR 704.3 until no SBA applies). */
export function checkWorldRuleSBA(state: GameState): boolean {
    const worlds = allWorldPermanents(state);
    // Stamp any newly-arrived world permanent. Every world permanent that is
    // currently unstamped is part of the same arrival event from this sweep's
    // point of view, so they all share one freshly-allocated seq (the tie).
    const unstamped = worlds.filter((c) => c.worldSeq === undefined);
    if (unstamped.length > 0) {
        state.nextWorldSeq = (state.nextWorldSeq ?? 0) + 1;
        for (const card of unstamped) card.worldSeq = state.nextWorldSeq;
    }
    if (worlds.length < 2) return false;
    // Survivor(s): the permanent(s) with the maximum seq (shortest time).
    const maxSeq = Math.max(...worlds.map((c) => c.worldSeq ?? 0));
    const newest = worlds.filter((c) => (c.worldSeq ?? 0) === maxSeq);
    // CR 704.5m — if more than one permanent shares the shortest time (a tie),
    // none survives: every world permanent (including the tied "newest" ones)
    // goes to its owner's graveyard. Otherwise the lone newest survives and
    // every older world permanent is put into its owner's graveyard.
    const doomed =
        newest.length > 1 ? worlds : worlds.filter((c) => c !== newest[0]);
    if (doomed.length === 0) return false;
    // Defer the moves past the read above (removePermanentTo mutates the
    // battlefield arrays). This is a zone change, not a destroy, so
    // indestructible / regeneration do not apply.
    for (const card of doomed) removePermanentTo(state, card.id, "graveyard");
    return true;
}

export function checkStateBasedActions(state: GameState): void {
    // CR 704.4 — SBAs are performed repeatedly until none applies. A single
    // sweep routinely CREATES the condition for another: a creature dying frees
    // an Aura enchanting it (CR 704.5m), an Aura leaving drops a P/T buff that
    // drops another creature to lethal toughness, etc. A one-pass sweep in the
    // fixed order below would leave the second condition unhandled until the
    // NEXT priority checkpoint (Animate Dead's LTB deferred to the following
    // upkeep — the bug this loop fixes). Iterate the whole set to a fixpoint
    // before any triggered ability is put on the stack (CR 603.3b).
    for (;;) {
        // Worms of the Earth (CR 614 prohibition) — refresh the serializable
        // land-play-lock cache from the live battlefield derivation. Not an SBA
        // per se, but every stable transition runs this sweep, so it is the
        // canonical recompute point; the flag tracks whether any lock source is
        // in play. Idempotent, so it does not gate the fixpoint.
        refreshLandPlayLock(state);
        let acted = false;
        acted = checkAuraAttachmentSBA(state) || acted;
        acted = checkConditionalControlChanges(state) || acted;
        // Idempotent bookkeeping (strips stale source-tapped buffs / untap
        // locks); no zone change or event, so it never gates the fixpoint. A
        // buff it strips that drops a creature to 0 toughness is caught by the
        // zero-toughness pass below in this same iteration.
        checkSourceTappedEffects(state);
        // CR 704.5q — +1/+1 / -1/-1 counters annihilate in equal numbers before
        // the zero-toughness death check reads the net P/T.
        acted = checkCounterAnnihilationSBA(state) || acted;
        acted = checkZeroToughnessSBA(state) || acted;
        // CR 704.5h / 702.2b — a creature dealt damage by a deathtouch source
        // this turn is destroyed. Runs after zero-toughness (a creature already
        // at 0 toughness leaves via the direct move first) and respects
        // indestructible.
        acted = checkDeathtouchDestroySBA(state) || acted;
        acted = checkTokenExistenceSBA(state) || acted;
        // CR 704.5m — world rule. Fully automatic (no player choice): keeps the
        // newest World permanent and graveyards the rest (all of them on a
        // tie). Runs before the legend-rule prompt so its automatic moves
        // settle before any choice suspends the sweep.
        acted = checkWorldRuleSBA(state) || acted;
        // CR 704.5j — legend rule. Enqueues a keep-one prompt and returns early;
        // priority is frozen until the controller commits via
        // finalizeLegendKeep. Run before game-over so a legend death that would
        // change life totals is resolved first; the choice itself suspends the
        // rest of the sweep (including the trigger scan below).
        if (checkLegendRuleSBA(state)) return;
        acted = checkGameOverSBA(state) || acted;
        if (state.gameOver) return;
        if (!acted) break;
    }
    // CR 603.3b — triggered abilities that triggered from the SBA-driven zone
    // changes above (an Aura's "when this leaves" LTB, a creature's death
    // trigger from an SBA-lethal move, ...) are put on the stack now, before any
    // player receives priority. Event-based triggers (CR 603.2) are drained
    // from the pending-event queue first, then state-triggered abilities
    // (CR 603.8). Reached only once the sweep has stabilised and the game has
    // not ended (no priority handoff to satisfy otherwise).
    processPendingActionTriggers(state);
    applyStateTriggers(state);
}
