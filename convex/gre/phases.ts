import type { Phase } from "./types";
import type { GameEvent, StaticUntapRestriction } from "../cards/types";
import type {
    CardInstanceState,
    DelayedTriggerInstance,
    GameState,
    PlayerState,
    StackItem,
} from "./state";
import { MAX_HAND_SIZE } from "./constants";
import {
    allocInstanceId,
    applyTargetPrevention,
    bumpDamageDealtToPlayer,
    consumePreventionIfAny,
    drawCard,
    flushPendingEvents,
    getOpponentId,
    getPlayer,
    matchesPermanentFilter,
    moveCard,
    regenerateOrDestroy,
    resolveTopOfStack,
    runDamageReplacement,
    tapPermanent,
    tickDuration,
} from "./state";
import { tryGetCardById } from "../cards";
import { applyDiscardReplacements, describeDamageSource } from "./replacements";
import { getEffectivePower, getEffectiveToughness } from "./layers";
import { isProtectedFromSource } from "./protection";
import { collectTriggers } from "./triggers";
import { hasAnyLegalBlock, getRequiredAttackerIds } from "./combat";
import {
    getEffectiveBlockGraph,
    getDamageAssignerId,
    type BlockGraph,
} from "./banding";

/** Ordered sequence of all phases/steps in a turn. */
const PHASE_ORDER: Phase[] = [
    "UNTAP",
    "UPKEEP",
    "DRAW",
    "PRECOMBAT_MAIN",
    "BEGINNING_OF_COMBAT",
    "DECLARE_ATTACKERS",
    "DECLARE_BLOCKERS",
    "FIRST_STRIKE_DAMAGE",
    "COMBAT_DAMAGE",
    "END_OF_COMBAT",
    "POSTCOMBAT_MAIN",
    "END_STEP",
    "CLEANUP",
];

/** Which damage step a creature deals damage in (CR 510.2-510.5, 702.7). */
export type DamageKind = "first-strike" | "regular";

function hasFirstOrDoubleStrike(card: CardInstanceState): boolean {
    return (
        card.staticAbilities.includes("first strike") ||
        card.staticAbilities.includes("double strike")
    );
}

/** CR 510.5: A creature deals damage in the first-strike step iff it has
 *  first strike or double strike. It deals damage in the regular step iff
 *  it has no first strike, or it has double strike (which deals twice). */
function dealsDamageIn(card: CardInstanceState, kind: DamageKind): boolean {
    const fs = card.staticAbilities.includes("first strike");
    const ds = card.staticAbilities.includes("double strike");
    if (kind === "first-strike") return fs || ds;
    return !fs || ds;
}

/** CR 510.5: first-strike damage step is skipped if no attacker or blocker
 *  has first strike or double strike when the step would begin. */
function anyCombatantHasFirstOrDoubleStrike(state: GameState): boolean {
    if (!state.combat) return false;
    const activePlayer = getPlayer(state, state.activePlayerId);
    const defenderId = getOpponentId(state, state.activePlayerId);
    const defender = getPlayer(state, defenderId);
    for (const id of state.combat.attackerIds) {
        const c = activePlayer.battlefield.find((x) => x.id === id);
        if (c && hasFirstOrDoubleStrike(c)) return true;
    }
    for (const blockerId of Object.keys(state.combat.blockerAssignments)) {
        const c = defender.battlefield.find((x) => x.id === blockerId);
        if (c && hasFirstOrDoubleStrike(c)) return true;
    }
    return false;
}

/** Phases where no player receives priority (automatic). */
const AUTO_PHASES = new Set<Phase>(["UNTAP", "CLEANUP"]);

/** Returns the next phase after the given one, or null if end of turn (CLEANUP). */
function nextPhase(current: Phase): Phase | null {
    const idx = PHASE_ORDER.indexOf(current);
    if (idx === -1) throw new Error(`Unknown phase: ${current}`);
    if (idx === PHASE_ORDER.length - 1) return null;
    return PHASE_ORDER[idx + 1];
}

/** Collects every `StaticUntapRestriction` in play (CR 502.1) in a
 *  deterministic walk: active player's battlefield first, then opponent's,
 *  battlefield order within each player. The cursor on
 *  `state.pendingUntapStep` keys into this same order so suspend/resume
 *  across an `untap-pick` prompt resumes exactly where it left off. */
export function collectUntapRestrictions(state: GameState): {
    source: CardInstanceState;
    restriction: StaticUntapRestriction;
}[] {
    const out: {
        source: CardInstanceState;
        restriction: StaticUntapRestriction;
    }[] = [];
    const order: CardInstanceState[] = [];
    const activePlayer = getPlayer(state, state.activePlayerId);
    const opponentId = getOpponentId(state, state.activePlayerId);
    const opponent = getPlayer(state, opponentId);
    order.push(...activePlayer.battlefield, ...opponent.battlefield);
    for (const card of order) {
        const cardId = (card.card as { id?: string }).id;
        if (!cardId) continue;
        const def = tryGetCardById(cardId);
        const effects = def?.staticEffects ?? [];
        for (const effect of effects) {
            if (effect.kind === "untap-restriction") {
                out.push({ source: card, restriction: effect });
            }
        }
    }
    return out;
}

/** Returns the list of `PermanentFilter`s from every active hard-skip
 *  restriction (`maxUntap === 0`) in play. Used by the dispatcher to veto
 *  permanents from cap-style restriction eligible sets, and by
 *  `selectResolutionChoice` as a commit-time defense (CR 502.1). */
export function computeHardSkipFilters(state: GameState) {
    return collectUntapRestrictions(state)
        .filter((r) => r.restriction.maxUntap === 0)
        .map((r) => r.restriction.filter);
}

/** Commits an `untap-pick` `PendingChoice` (CR 502.1): untaps the chosen
 *  ids on the chooser's battlefield, pops the choice off the queue, and
 *  resumes the untap dispatcher (`untapStep`). If the dispatcher enqueues
 *  the next restriction's prompt, priority stays with the chooser; if all
 *  restrictions are resolved, `advancePhase` leaves UNTAP and routes
 *  priority to the active player for UPKEEP. */
export function finalizeUntapPick(
    state: GameState,
    selectedIds: string[]
): void {
    const queue = state.pendingChoices ?? [];
    const head = queue[0];
    if (!head || head.kind !== "untap-pick") return;
    const chooser = getPlayer(state, head.zoneOwnerId ?? head.playerId);
    for (const id of selectedIds) {
        const card = chooser.battlefield.find((c) => c.id === id);
        if (card) card.isTapped = false;
    }
    queue.shift();
    state.pendingChoices = queue.length > 0 ? queue : undefined;
    untapStep(state);
    if ((state.pendingChoices?.length ?? 0) > 0) {
        state.priorityPlayerId = state.pendingChoices![0].playerId;
        return;
    }
    // No more restrictions to resolve — leave UNTAP and continue the
    // normal auto-phase recursion (UNTAP → UPKEEP, granting priority).
    advancePhase(state);
    drainAutoPasses(state);
}

/** Returns a `MatchablePermanent`-shaped view of `card` with its `power` and
 *  `toughness` overridden by the effective values read at call time
 *  (CR 613 layer 7c/7d — counters, +N/+N auras, temporary buffs). The
 *  untap-step dispatcher uses this so power-keyed filters (Meekstone's
 *  `powerAtLeast: 3`) honor the live layer system instead of printed P/T. */
export function effectivePermanentView(
    state: GameState,
    card: CardInstanceState
): CardInstanceState {
    if (!card.types.includes("Creature")) return card;
    return {
        ...card,
        power: getEffectivePower(state, card),
        toughness: getEffectiveToughness(state, card),
    };
}

/** Untap step (CR 502.1, 502.4): the active player declares which
 *  permanents they control will untap, those permanents untap
 *  simultaneously, and every permanent gets per-turn flag cleanup.
 *
 *  Two restriction families compose here:
 *  - **Data-driven `StaticUntapRestriction`** (ADR 0002 factory family,
 *    e.g. Winter Orb, Smoke): the dispatcher walks each restriction in
 *    deterministic order (active player's battlefield first, then
 *    opponent's), computes the active player's eligible set, and either
 *    auto-resolves (per ADR 0003 — `maxUntap === 0` hard skip, or
 *    `eligibles.length === 0` vacuous) or enqueues a `untap-pick`
 *    `PendingChoice` with `count: { min: 0, max: r.maxUntap }`. The cap-
 *    style zero-branch (CR 502.1, 701.39 — "no more than" is a cap, not an
 *    obligation) is the tactical opt-out that keeps the prompt on
 *    single-eligible boards. Multiple restrictions in play fire as
 *    independent prompts in FIFO order — each binds its own filter and
 *    cap, so Winter Orb + Smoke lets the active player untap one land AND
 *    one creature (the filters do not overlap).
 *  - **Per-permanent `does-not-untap`** (Basalt Monolith, Mana Vault,
 *    Paralyze's grant) is an orthogonal axis untouched by the dispatcher
 *    refactor: the marked permanent stays tapped regardless of any other
 *    restriction's outcome.
 *
 *  A `maxUntap: 0` restriction (e.g. Stasis) is a hard skip: matching
 *  permanents cannot untap this step under ANY other cap, and they receive
 *  full cleanup (`manaCommitted` / `isSummoningSick` / `chosenMana` cleared)
 *  exactly as if the untap had succeeded.
 *
 *  Flag cleanup (`manaCommitted`, `isSummoningSick`, `chosenMana`) runs
 *  for every permanent on the active player's battlefield once all
 *  restrictions are processed — including permanents that did not
 *  untap. */
export function untapStep(state: GameState): void {
    const player = getPlayer(state, state.activePlayerId);

    // Data-driven dispatcher loop. `state.pendingUntapStep.restrictionCursor`
    // is set when a prior call enqueued an `untap-pick` prompt; resumption
    // (from `submitResolutionChoice` / `selectResolutionChoice`) re-enters here
    // and continues from where we left off.
    const restrictions = collectUntapRestrictions(state);
    const startCursor = state.pendingUntapStep?.restrictionCursor ?? 0;

    const hardSkipFilters = computeHardSkipFilters(state);

    // First entry only: untap permanents that are NOT subject to any
    // data-driven restriction (so non-land permanents under Winter Orb
    // untap immediately, in parallel with the still-pending land
    // prompt), and clear per-turn flags universally. Restricted
    // permanents stay tapped here; their fate is decided by the matching
    // restriction's prompt (or by the cap auto-resolving in the loop
    // below).
    if (startCursor === 0) {
        const restrictionFilters = restrictions.map(
            (r) => r.restriction.filter
        );

        for (const card of player.battlefield) {
            if (card.staticAbilities.includes("does-not-untap")) {
                card.manaCommitted = undefined;
                card.isSummoningSick = undefined;
                card.chosenMana = undefined;
                continue;
            }
            const view = effectivePermanentView(state, card);
            if (hardSkipFilters.some((f) => matchesPermanentFilter(view, f))) {
                // Stasis-style hard skip (CR 502.1) — permanent cannot
                // untap this step. Full cleanup runs as if the untap had
                // happened, so the next priority window doesn't misread
                // stale commitment flags.
                card.manaCommitted = undefined;
                card.isSummoningSick = undefined;
                card.chosenMana = undefined;
                continue;
            }
            if (
                card.isTapped &&
                restrictionFilters.some((f) => matchesPermanentFilter(view, f))
            ) {
                // Subject to a data-driven cap — defer untap to the
                // restriction's prompt (or to the cap's auto-resolve in
                // the loop below). Per-turn flag cleanup still runs
                // unconditionally on the active BF (CR 502.1, mirrors the
                // `does-not-untap` branch above).
                card.manaCommitted = undefined;
                card.isSummoningSick = undefined;
                card.chosenMana = undefined;
                continue;
            }
            card.isTapped = false;
            card.manaCommitted = undefined;
            card.isSummoningSick = undefined;
            card.chosenMana = undefined;
        }
    }

    for (let i = startCursor; i < restrictions.length; i++) {
        const r = restrictions[i].restriction;
        const eligibles = player.battlefield.filter(
            (c) =>
                c.isTapped &&
                !c.staticAbilities.includes("does-not-untap") &&
                matchesPermanentFilter(
                    effectivePermanentView(state, c),
                    r.filter
                ) &&
                !hardSkipFilters.some((f) =>
                    matchesPermanentFilter(effectivePermanentView(state, c), f)
                )
        );

        // ADR 0003 auto-resolve cases:
        // - `maxUntap === 0`: hard skip (Stasis-style) — no eligibles can
        //   untap and there is no tactical zero-branch to offer.
        // - `eligibles.length === 0`: nothing to pick, restriction is
        //   vacuous on this board.
        // Otherwise (cap binds with ≥1 eligible): keep the prompt so the
        // active player may declare "untap zero" (CR 502.1 / 701.39 — the
        // cap is permissive, not mandatory).
        if (r.maxUntap === 0 || eligibles.length === 0) {
            continue;
        }

        state.pendingChoices = state.pendingChoices ?? [];
        state.pendingChoices.push({
            stackItemId: "",
            step: 0,
            choiceId: `untap-${i}-${r.id}`,
            playerId: state.activePlayerId,
            zoneOwnerId: state.activePlayerId,
            kind: "untap-pick",
            zone: "battlefield",
            filter: {
                ...r.filter,
                excludeInstanceIds:
                    hardSkipFilters.length > 0
                        ? player.battlefield
                              .filter((c) =>
                                  hardSkipFilters.some((f) =>
                                      matchesPermanentFilter(
                                          effectivePermanentView(state, c),
                                          f
                                      )
                                  )
                              )
                              .map((c) => c.id)
                        : undefined,
            },
            count: { min: 0, max: r.maxUntap },

            prompt: r.oracleText,
        });
        state.pendingUntapStep = { restrictionCursor: i + 1 };
        state.priorityPlayerId = state.activePlayerId;
        return;
    }

    state.pendingUntapStep = undefined;
}

/** Draw step: active player draws a card. Skipped on turn 1 (CR 103.8). */
function drawStep(state: GameState): void {
    if (state.turn === 1) return;
    if (hasDrawSkipReplacement(state, state.activePlayerId)) return;
    drawCard(getPlayer(state, state.activePlayerId));
}

function hasDrawSkipReplacement(state: GameState, playerId: string): boolean {
    const player = getPlayer(state, playerId);
    for (const card of player.battlefield) {
        const cardId = (card.card as { id?: string }).id;
        if (!cardId) continue;
        const def = tryGetCardById(cardId);
        if (def?.drawStepReplacement) return true;
    }
    return false;
}

/** attackerId → blocker ids, band-expanded (CR 702.21e): a blocker assigned to
 *  any band member blocks every member. Reduces to a plain inversion of
 *  blockerAssignments when no bands are declared. */
function getBlockersPerAttacker(state: GameState): Record<string, string[]> {
    return getEffectiveBlockGraph(state).blockersByAttacker;
}

function getCardPower(state: GameState, card: CardInstanceState): number {
    return Math.max(0, getEffectivePower(state, card));
}

function getCardToughness(state: GameState, card: CardInstanceState): number {
    return getEffectiveToughness(state, card);
}

/** Looks up a creature on either battlefield by instance id. */
function findCreature(
    state: GameState,
    id: string
): CardInstanceState | undefined {
    for (const player of state.players) {
        const found = player.battlefield.find((c) => c.id === id);
        if (found) return found;
    }
    return undefined;
}

/** A combat-damage source needs a manual assignment choice when it deals
 *  damage this step and has 2+ targets to split among (CR 510.1c/d). For an
 *  attacker that means 2+ blockers; for a blocker (only possible under banding)
 *  that means it blocks 2+ band members. Returns the set of such source ids. */
function getManualAssignmentSourceIds(
    state: GameState,
    kind: DamageKind,
    graph: BlockGraph
): string[] {
    const ids: string[] = [];
    const dealsAndHasPower = (c: CardInstanceState | undefined): boolean =>
        !!c && dealsDamageIn(c, kind) && getCardPower(state, c) > 0;
    for (const [attackerId, blockerIds] of Object.entries(
        graph.blockersByAttacker
    )) {
        if (blockerIds.length < 2) continue;
        if (dealsAndHasPower(findCreature(state, attackerId)))
            ids.push(attackerId);
    }
    for (const [blockerId, attackerIds] of Object.entries(
        graph.attackersByBlocker
    )) {
        if (attackerIds.length < 2) continue;
        if (dealsAndHasPower(findCreature(state, blockerId)))
            ids.push(blockerId);
    }
    return ids;
}

/** Build auto damage assignments for attackers with 0 or 1 blocker. */
export function buildAutoDamageAssignments(
    state: GameState,
    kind: DamageKind
): Record<string, Record<string, number>> {
    const blockersPerAttacker = getBlockersPerAttacker(state);
    const activePlayer = getPlayer(state, state.activePlayerId);
    const defenderId = getOpponentId(state, state.activePlayerId);
    const defender = getPlayer(state, defenderId);
    const result: Record<string, Record<string, number>> = {};

    for (const attackerId of state.combat!.attackerIds) {
        const attacker = activePlayer.battlefield.find(
            (c) => c.id === attackerId
        );
        if (!attacker) continue;
        if (!dealsDamageIn(attacker, kind)) continue;
        const blockers = blockersPerAttacker[attackerId] ?? [];
        const hasTrample = attacker.staticAbilities.includes("trample");

        if (blockers.length === 1) {
            const blocker = defender.battlefield.find(
                (c) => c.id === blockers[0]
            );
            if (hasTrample && blocker) {
                // Trample: assign lethal damage to blocker, excess to defender
                const lethal = getCardToughness(state, blocker);
                const toBlocker = Math.min(
                    getCardPower(state, attacker),
                    lethal
                );
                const toDefender = getCardPower(state, attacker) - toBlocker;
                const assignment: Record<string, number> = {
                    [blockers[0]]: toBlocker,
                };
                if (toDefender > 0) {
                    assignment[defenderId] = toDefender;
                }
                result[attackerId] = assignment;
            } else {
                result[attackerId] = {
                    [blockers[0]]: getCardPower(state, attacker),
                };
            }
        }
        // 0 blockers = unblocked, handled separately in applyAllCombatDamage
    }
    return result;
}

/** Build default damage assignments for multi-blocker attackers.
 *  With trample, assigns lethal to each blocker in declaration order, excess
 *  to defender. CR 510.1c/d let the attacker freely re-divide damage in the
 *  damage-assignment modal — this just seeds a sensible default. */
function buildDefaultDamageAssignments(
    state: GameState,
    kind: DamageKind
): Record<string, Record<string, number>> {
    const blockersPerAttacker = getBlockersPerAttacker(state);
    const activePlayer = getPlayer(state, state.activePlayerId);
    const defenderId = getOpponentId(state, state.activePlayerId);
    const defender = getPlayer(state, defenderId);
    const result: Record<string, Record<string, number>> = {};

    for (const attackerId of state.combat!.attackerIds) {
        const attacker = activePlayer.battlefield.find(
            (c) => c.id === attackerId
        );
        if (!attacker) continue;
        if (!dealsDamageIn(attacker, kind)) continue;
        const blockers = blockersPerAttacker[attackerId] ?? [];
        const hasTrample = attacker.staticAbilities.includes("trample");

        if (blockers.length === 1) {
            if (hasTrample) {
                const blocker = defender.battlefield.find(
                    (c) => c.id === blockers[0]
                );
                const lethal = blocker ? getCardToughness(state, blocker) : 0;
                const toBlocker = Math.min(
                    getCardPower(state, attacker),
                    lethal
                );
                const toDefender = getCardPower(state, attacker) - toBlocker;
                const assignment: Record<string, number> = {
                    [blockers[0]]: toBlocker,
                };
                if (toDefender > 0) assignment[defenderId] = toDefender;
                result[attackerId] = assignment;
            } else {
                result[attackerId] = {
                    [blockers[0]]: getCardPower(state, attacker),
                };
            }
        } else if (blockers.length >= 2) {
            const assignment: Record<string, number> = {};
            if (hasTrample) {
                // Default with trample: lethal to each in order, excess to defender
                let remaining = getCardPower(state, attacker);
                for (const blockerId of blockers) {
                    const blocker = defender.battlefield.find(
                        (c) => c.id === blockerId
                    );
                    const lethal = blocker
                        ? getCardToughness(state, blocker)
                        : 0;
                    const toThis = Math.min(remaining, lethal);
                    assignment[blockerId] = toThis;
                    remaining -= toThis;
                }
                if (remaining > 0) assignment[defenderId] = remaining;
            } else {
                // Default without trample: all damage to first blocker
                for (let i = 0; i < blockers.length; i++) {
                    assignment[blockers[i]] =
                        i === 0 ? getCardPower(state, attacker) : 0;
                }
            }
            result[attackerId] = assignment;
        }
    }

    // Blocker sources with 2+ targets exist only under banding (CR 702.21e): a
    // blocker blocking a band. Seed all of its power onto the first band member
    // — the assigning player (the attacker, CR 702.21k) redivides in the modal.
    const { attackersByBlocker } = getEffectiveBlockGraph(state);
    for (const [blockerId, attackerIds] of Object.entries(attackersByBlocker)) {
        if (attackerIds.length < 2) continue;
        const blocker = findCreature(state, blockerId);
        if (!blocker || !dealsDamageIn(blocker, kind)) continue;
        const power = getCardPower(state, blocker);
        const assignment: Record<string, number> = {};
        attackerIds.forEach((id, i) => {
            assignment[id] = i === 0 ? power : 0;
        });
        result[blockerId] = assignment;
    }
    return result;
}

/**
 * Apply combat damage for a single damage step and move dead creatures to
 * the graveyard. When `kind` is "first-strike" only creatures with first
 * strike or double strike deal damage (CR 510.2). When "regular", creatures
 * without first strike deal damage; creatures with double strike deal again
 * (CR 510.5).
 *
 * @param damageAssignments attackerId → { blockerId|defenderId: damage } — used
 *   only for multi-blocker attackers currently dealing damage in this step.
 */
export function applyAllCombatDamage(
    state: GameState,
    damageAssignments: Record<string, Record<string, number>>,
    kind: DamageKind = "regular"
): void {
    if (!state.combat) return;
    if (state.preventAllCombatDamageThisTurn) return;

    const activePlayer = getPlayer(state, state.activePlayerId);
    const defenderId = getOpponentId(state, state.activePlayerId);
    const defender = getPlayer(state, defenderId);
    // Band-expanded block graph (CR 702.21e): a blocker assigned to one band
    // member blocks the whole band, and every member is blocked.
    const { blockersByAttacker, attackersByBlocker } =
        getEffectiveBlockGraph(state);

    // Track damage received: cardId → total damage
    const damageReceived: Record<string, number> = {};
    const events: GameEvent[] = [];

    // Helper: apply one combat damage event from `source` through the full
    // CR 614 → CR 615 → CR 702.16 → application pipeline. `target` and
    // `amount` may be rewritten by replacement effects (Simulacrum, Veteran
    // Bodyguard, Personal Incarnation redirect damage to themselves; Jade
    // Monolith activates redirect to controller). Permanent damage is
    // accumulated into `damageReceived` for the post-loop lethal scan.
    function applyOneCombatDamage(
        source: CardInstanceState,
        rawTarget: { type: "player" | "permanent"; id: string },
        rawAmount: number
    ): void {
        if (rawAmount <= 0) return;
        const repl = runDamageReplacement(
            state,
            source.id,
            source.controllerId,
            rawTarget,
            rawAmount,
            true
        );
        if (!repl) return;
        const finalTarget = repl.target;
        const finalAmount = repl.amount;
        if (finalAmount <= 0) return;
        if (finalTarget.type === "player") {
            if (consumePreventionIfAny(state, source.id, finalTarget.id))
                return;
            const reduced = applyTargetPrevention(
                state,
                "player",
                finalTarget.id,
                finalAmount
            );
            if (reduced <= 0) return;
            getPlayer(state, finalTarget.id).life -= reduced;
            bumpDamageDealtToPlayer(state, finalTarget.id, reduced);
            const desc = describeDamageSource(state, source.id);
            events.push({
                type: "DAMAGE_DEALT",
                sourceInstanceId: source.id,
                sourceControllerId: source.controllerId,
                target: { type: "player", id: finalTarget.id },
                amount: reduced,
                isCombat: true,
                sourceColors: desc.colors,
                sourceTypes: desc.types,
                sourceSubtypes: desc.subtypes,
                sourceStaticAbilities: desc.staticAbilities,
            });
        } else if (finalTarget.type === "permanent") {
            const targetCard =
                activePlayer.battlefield.find((c) => c.id === finalTarget.id) ??
                defender.battlefield.find((c) => c.id === finalTarget.id);
            if (!targetCard) return;
            if (isProtectedFromSource(targetCard, source)) return;
            const reduced = applyTargetPrevention(
                state,
                "permanent",
                finalTarget.id,
                finalAmount
            );
            if (reduced <= 0) return;
            damageReceived[finalTarget.id] =
                (damageReceived[finalTarget.id] ?? 0) + reduced;
            const desc = describeDamageSource(state, source.id);
            events.push({
                type: "DAMAGE_DEALT",
                sourceInstanceId: source.id,
                sourceControllerId: source.controllerId,
                target: { type: "permanent", id: finalTarget.id },
                amount: reduced,
                isCombat: true,
                sourceColors: desc.colors,
                sourceTypes: desc.types,
                sourceSubtypes: desc.subtypes,
                sourceStaticAbilities: desc.staticAbilities,
            });
        }
    }

    // --- Attacker damage (CR 510). Unblocked attackers hit the defender;
    // blocked attackers (including band members blocked only by association)
    // deal per their assignment among blockers / the defender on trample. ---
    for (const attackerId of state.combat.attackerIds) {
        const attacker = activePlayer.battlefield.find(
            (c) => c.id === attackerId
        );
        if (!attacker) continue; // removed before damage (e.g. killed by instant)
        if (!dealsDamageIn(attacker, kind)) continue;

        const blockers = blockersByAttacker[attackerId] ?? [];
        const attackerPower = getCardPower(state, attacker);

        if (blockers.length === 0) {
            if (attackerPower > 0) {
                // CR 615 — Forcefield: cap damage from unblocked creature
                let damage = attackerPower;
                const caps = state.damageCapShields;
                if (caps && caps.length > 0) {
                    const capIdx = caps.findIndex(
                        (s) => s.playerId === defenderId
                    );
                    if (capIdx !== -1) {
                        damage = Math.min(damage, caps[capIdx].maxDamage);
                        state.damageCapShields = [
                            ...caps.slice(0, capIdx),
                            ...caps.slice(capIdx + 1),
                        ];
                        if (state.damageCapShields.length === 0) {
                            state.damageCapShields = undefined;
                        }
                    }
                }
                applyOneCombatDamage(
                    attacker,
                    { type: "player", id: defenderId },
                    damage
                );
            }
        } else {
            const assignments = damageAssignments[attackerId] ?? {};
            for (const [targetId, damage] of Object.entries(assignments)) {
                if (damage <= 0) continue;
                applyOneCombatDamage(
                    attacker,
                    targetId === defenderId
                        ? { type: "player", id: defenderId }
                        : { type: "permanent", id: targetId },
                    damage
                );
            }
        }
    }

    // --- Blocker damage (CR 510). Each blocker deals once. A blocker blocking
    // a single creature deals its full power to it; a blocker blocking a band
    // (CR 702.21e) splits its power among the members per the assignment the
    // attacking player chose (CR 702.21k). ---
    for (const [blockerId, blockedAttackerIds] of Object.entries(
        attackersByBlocker
    )) {
        const blocker = defender.battlefield.find((c) => c.id === blockerId);
        if (!blocker) continue;
        if (!dealsDamageIn(blocker, kind)) continue;
        const blockerPower = getCardPower(state, blocker);
        if (blockerPower <= 0) continue;

        if (blockedAttackerIds.length <= 1) {
            const targetId = blockedAttackerIds[0];
            if (targetId) {
                applyOneCombatDamage(
                    blocker,
                    { type: "permanent", id: targetId },
                    blockerPower
                );
            }
        } else {
            const assignments = damageAssignments[blockerId] ?? {};
            for (const [targetId, damage] of Object.entries(assignments)) {
                if (damage <= 0) continue;
                applyOneCombatDamage(
                    blocker,
                    { type: "permanent", id: targetId },
                    damage
                );
            }
        }
    }

    // CR 120.3: record which sources dealt damage to each victim this turn.
    // Preserved through CLEANUP (CR 514.2) so post-death lookup triggers
    // (Sengir Vampire) can inspect the victim after it leaves the battlefield.
    for (const ev of events) {
        if (ev.type !== "DAMAGE_DEALT") continue;
        if (ev.target.type !== "permanent") continue;
        const hit =
            activePlayer.battlefield.find((c) => c.id === ev.target.id) ??
            defender.battlefield.find((c) => c.id === ev.target.id);
        if (!hit) continue;
        hit.damagedBySources = [
            ...(hit.damagedBySources ?? []),
            ev.sourceInstanceId,
        ];
    }

    // CR 120.3: accumulate combat damage onto the creature's marked damage,
    // then check CR 704.5g lethal against effective toughness (layer 7c).
    const deadIds = new Set<string>();
    for (const [cardId, damage] of Object.entries(damageReceived)) {
        const card =
            activePlayer.battlefield.find((c) => c.id === cardId) ??
            defender.battlefield.find((c) => c.id === cardId);
        if (!card) continue;
        card.damageMarked = (card.damageMarked ?? 0) + damage;
        if (card.damageMarked >= getCardToughness(state, card)) {
            deadIds.add(cardId);
        }
    }

    // Move dead creatures to their owner's graveyard. Each victim is routed
    // through regenerateOrDestroy (CR 614.5, 701.15a) so a regen shield can
    // replace the destroy with the heal/tap/leave-combat rider — those
    // creatures stay on the battlefield. Actual deaths emit CREATURE_DIED
    // (CR 700.4) into `state.pendingEvents` from `removePermanentTo`; we
    // drain the queue below so the combat collectTriggers pass sees both
    // DAMAGE_DEALT and CREATURE_DIED in one go.
    for (const cardId of deadIds) {
        const carrier =
            activePlayer.battlefield.find((c) => c.id === cardId) ??
            defender.battlefield.find((c) => c.id === cardId);
        if (!carrier) continue;
        const wasDestroyed = regenerateOrDestroy(state, cardId);
        if (!wasDestroyed) continue;
        // The destroyed card has already been moved to its owner's graveyard
        // by removePermanentTo. Reset combat-only flags on the dead instance
        // for parity with the prior implementation.
        carrier.isAttacking = undefined;
        carrier.isBlocking = undefined;
        carrier.isTapped = false;
    }
    // Drain CREATURE_DIED events queued by removePermanentTo so this step's
    // trigger scan sees them alongside DAMAGE_DEALT (CR 603.2).
    events.push(...flushPendingEvents(state));

    // Collect triggered abilities fired by this damage step (CR 603.2). Dead
    // permanents are already gone, so their own triggers are skipped — that's
    // not strictly CR-correct for LTB/"when ~ dies" triggers, but those are
    // out of scope here.
    const triggers = collectTriggers(state, events);
    if (triggers.length > 0) {
        state.stack.push(...triggers);
        // Active player gets priority again with triggers on the stack (CR 117.3c).
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
    }
}

/** Emits a PHASE_BEGIN event for the current phase, collects matching
 *  triggered abilities from all battlefield permanents (CR 603.6a), pushes
 *  them on the stack, and restarts priority at the active player (CR 117.3c).
 *  No-op when the scan yields no triggers. Intervening-if conditions are
 *  the card's responsibility inside `matches()` (CR 603.4). */
function firePhaseBeginTriggers(state: GameState): void {
    const event: GameEvent = {
        type: "PHASE_BEGIN",
        phase: state.phase,
        activePlayerId: state.activePlayerId,
    };
    const triggers = collectTriggers(state, [event]);
    if (triggers.length === 0) return;
    state.stack.push(...triggers);
    state.priorityPlayerId = state.activePlayerId;
    state.passCount = 0;
}

/** Dequeue delayed triggers matching `timing`, push them on the stack as
 *  StackItems, and restart priority at the active player (CR 603.3, 603.7a).
 *  Controller-as-APNAP ordering isn't implemented — triggers fire in
 *  scheduling order. */
export function fireDelayedTriggers(
    state: GameState,
    timing: DelayedTriggerInstance["timing"]
): void {
    if (!state.delayedTriggers?.length) return;
    const firing: DelayedTriggerInstance[] = [];
    const remaining: DelayedTriggerInstance[] = [];
    for (const t of state.delayedTriggers) {
        (t.timing === timing ? firing : remaining).push(t);
    }
    state.delayedTriggers = remaining.length > 0 ? remaining : undefined;
    if (firing.length === 0) return;
    for (const t of firing) {
        const stackItem: StackItem = {
            id: allocInstanceId(state),
            card: { id: t.sourceCardId },
            controllerId: t.controller,
            ownerId: t.controller,
            zone: "stack",
            types: [],
            subtypes: [],
            staticAbilities: [],
            isTapped: false,
            castById: t.controller,
            delayedTriggerId: t.triggerId,
            delayedPayload: t.payload,
        };
        state.stack.push(stackItem);
    }
    state.priorityPlayerId = state.activePlayerId;
    state.passCount = 0;
}

/** Emits one BLOCKERS_CONFIRMED event per attacker-blocker pair and pushes
 *  any matching triggers onto the stack (CR 509.1h — "blocks or becomes
 *  blocked by" triggers). Called from both the manual `confirmBlockers`
 *  mutation and the auto-confirm path in `drainAutoPasses`. */
export function emitBlockersConfirmedEvents(state: GameState): void {
    if (!state.combat) return;
    const events: GameEvent[] = [];
    const activePlayer = getPlayer(state, state.activePlayerId);
    const defenderId = getOpponentId(state, state.activePlayerId);
    const defender = getPlayer(state, defenderId);

    for (const [blockerId, attackerIds] of Object.entries(
        state.combat.blockerAssignments
    )) {
        const blocker =
            defender.battlefield.find((c) => c.id === blockerId) ??
            activePlayer.battlefield.find((c) => c.id === blockerId);
        if (!blocker) continue;
        for (const attackerId of attackerIds) {
            const attacker =
                activePlayer.battlefield.find((c) => c.id === attackerId) ??
                defender.battlefield.find((c) => c.id === attackerId);
            if (!attacker) continue;
            events.push({
                type: "BLOCKERS_CONFIRMED",
                attackerId: attacker.id,
                attackerControllerId: attacker.controllerId,
                attackerTypes: attacker.types,
                attackerSubtypes: attacker.subtypes,
                blockerId: blocker.id,
                blockerControllerId: blocker.controllerId,
                blockerTypes: blocker.types,
                blockerSubtypes: blocker.subtypes,
            });
        }
    }
    if (events.length === 0) return;
    const triggers = collectTriggers(state, events);
    for (const t of triggers) {
        state.stack.push(t);
    }
    if (triggers.length > 0) {
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
    }
}

/** Emits a single ATTACKERS_DECLARED event (CR 508.1) once the active player
 *  confirms attackers, and pushes any resulting triggers (Raging River). One
 *  event carries every attacker so a "whenever one or more creatures you
 *  control attack" ability fires exactly once. */
export function emitAttackersDeclaredEvents(state: GameState): void {
    if (!state.combat || state.combat.attackerIds.length === 0) return;
    const event: GameEvent = {
        type: "ATTACKERS_DECLARED",
        attackingPlayerId: state.activePlayerId,
        attackerIds: [...state.combat.attackerIds],
    };
    const triggers = collectTriggers(state, [event]);
    for (const t of triggers) {
        state.stack.push(t);
    }
    if (triggers.length > 0) {
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
    }
}

/** Perform automatic entry actions for the current phase. */
function performPhaseEntry(state: GameState): void {
    switch (state.phase) {
        case "UNTAP":
            untapStep(state);
            break;
        case "DRAW":
            drawStep(state);
            break;
        case "DECLARE_ATTACKERS":
            state.combat = {
                attackerIds: [],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            };
            break;
        case "DECLARE_BLOCKERS": {
            if (state.combat) {
                state.combat.blockerAssignments = {};
                state.combat.pendingBlockerId = undefined;
                state.combat.blockersConfirmed = false;
            }
            break;
        }
        case "FIRST_STRIKE_DAMAGE":
        case "COMBAT_DAMAGE": {
            if (state.combat && state.combat.attackerIds.length > 0) {
                const kind: DamageKind =
                    state.phase === "FIRST_STRIKE_DAMAGE"
                        ? "first-strike"
                        : "regular";
                const graph = getEffectiveBlockGraph(state);
                const manualSources = getManualAssignmentSourceIds(
                    state,
                    kind,
                    graph
                );
                if (manualSources.length > 0) {
                    // Pre-fill default assignments and wait for the assigners.
                    state.combat.damageAssignments =
                        buildDefaultDamageAssignments(state, kind);
                    state.combat.damageConfirmed = false;
                    // CR 702.21j-k: compute who assigns each multi-target
                    // source. Normally the source's controller; banding shifts
                    // it to the controller of the banding creature(s) opposite.
                    const assignerIds: Record<string, string> = {};
                    for (const sourceId of manualSources) {
                        const source = findCreature(state, sourceId);
                        if (!source) continue;
                        const targets =
                            graph.blockersByAttacker[sourceId] ??
                            graph.attackersByBlocker[sourceId] ??
                            [];
                        assignerIds[sourceId] = getDamageAssignerId(
                            state,
                            source,
                            targets
                        );
                    }
                    state.combat.damageAssignerIds = assignerIds;
                    state.combat.damageAssignmentConfirmedBy = [];
                } else {
                    // All auto: apply immediately. Clear any per-source assigner
                    // state left from a prior (first-strike) damage step.
                    state.combat.damageAssignerIds = undefined;
                    state.combat.damageAssignmentConfirmedBy = undefined;
                    applyAllCombatDamage(
                        state,
                        buildAutoDamageAssignments(state, kind),
                        kind
                    );
                }
            }
            break;
        }
        case "END_OF_COMBAT": {
            fireDelayedTriggers(state, "next-end-of-combat");

            if (state.combat) {
                const activePlayer = getPlayer(state, state.activePlayerId);
                const defenderId = getOpponentId(state, state.activePlayerId);
                const defender = getPlayer(state, defenderId);
                for (const card of activePlayer.battlefield) {
                    card.isAttacking = undefined;
                    card.pileLabel = undefined;
                }
                for (const card of defender.battlefield) {
                    card.isBlocking = undefined;
                    card.pileLabel = undefined;
                }
                state.combat = undefined;
            }
            // ADR 0012 — combat-scoped pile block restrictions (Raging River)
            // end with the combat.
            state.combatBlockRestrictions = undefined;
            // CR 511.3 — "until end of combat" effects end here.
            tickAllDurations(state);
            break;
        }
        case "END_STEP": {
            fireDelayedTriggers(state, "next-end-step");
            break;
        }
        case "CLEANUP":
            // CR 514.1 runs first: if the active player's hand exceeds their
            // maximum hand size, they discard down to it before any of the
            // 514.2 turn-based actions fire. The discard requires interactive
            // input, so the step may suspend on a `discard-hand` PendingChoice
            // here — `finalizeCleanup` runs out of the commit handler when the
            // discards land.
            if (tryEnqueueCleanupDiscard(state)) break;
            finalizeCleanup(state);
            break;
    }
}

/** Returns the effective maximum hand size for a player (CR 402.2). The
 *  default is `MAX_HAND_SIZE` (7); the value is mutated by two channels:
 *
 *  - `player.maxHandSizeOverride` — player-scoped override (Vanguard-style
 *    effects that don't live on a battlefield permanent).
 *  - Any `StaticHandSizeOverride` (`kind: "hand-size-override"`) on a
 *    permanent the player controls — Library of Leng / Reliquary Tower
 *    grants "unlimited" while in play, Spellbook-style cards set a numeric
 *    value.
 *
 *  Merge semantics: `"unlimited"` always wins. Among numeric overrides the
 *  largest is taken (most permissive). Absent any override, the default
 *  cap applies. No state mutation — the cap is recomputed on every CLEANUP
 *  entry, so multiple copies / mid-turn enter-and-leave events need no
 *  bookkeeping. */
export function effectiveMaxHandSize(player: PlayerState): number {
    let bestNumeric: number | null = null;
    let unlimited = false;

    const consider = (v: number | "unlimited" | undefined): boolean => {
        if (v === undefined) return false;
        if (v === "unlimited") {
            unlimited = true;
            return true;
        }
        if (bestNumeric === null || v > bestNumeric) bestNumeric = v;
        return false;
    };

    if (consider(player.maxHandSizeOverride)) {
        return Infinity;
    }

    for (const card of player.battlefield) {
        const cardId = (card.card as { id?: string }).id;
        if (!cardId) continue;
        const def = tryGetCardById(cardId);
        for (const effect of def?.staticEffects ?? []) {
            if (
                effect.kind === "hand-size-override" &&
                consider(effect.value)
            ) {
                return Infinity;
            }
        }
    }

    if (unlimited) return Infinity;
    return bestNumeric ?? MAX_HAND_SIZE;
}

/** CR 514.1 — at CLEANUP, if the active player has more cards in hand than
 *  their maximum hand size, they discard down to it. The chooser selects
 *  which cards; the engine suspends on a `discard-hand` PendingChoice
 *  (`stackItemId: ""` — the same phase-level sentinel used by `untap-pick`).
 *  Returns true when a discard prompt was enqueued (caller must NOT run
 *  514.2 yet — wait for the commit handler), false when no discard is
 *  required and CLEANUP can continue immediately. */
function tryEnqueueCleanupDiscard(state: GameState): boolean {
    const active = getPlayer(state, state.activePlayerId);
    const max = effectiveMaxHandSize(active);
    const excess = active.hand.length - max;
    if (excess <= 0) return false;
    state.pendingChoices = state.pendingChoices ?? [];
    state.pendingChoices.push({
        stackItemId: "",
        step: 0,
        choiceId: `cleanup-discard-${state.activePlayerId}`,
        playerId: state.activePlayerId,
        zoneOwnerId: state.activePlayerId,
        kind: "discard-hand",
        zone: "hand",
        count: excess,
        prompt:
            excess === 1
                ? "Discard a card (hand size)"
                : `Discard ${excess} cards (hand size)`,
    });
    state.pendingCleanupDiscard = { playerId: state.activePlayerId };
    state.priorityPlayerId = state.activePlayerId;
    return true;
}

/** Commits a CR 514.1 cleanup-discard `PendingChoice`: moves each selected
 *  card out of the chooser's hand (honoring discard replacement effects
 *  like Library of Leng, CR 614), clears the suspension marker, runs the
 *  remainder of CLEANUP (CR 514.2 — damage wipe, "until end of turn"
 *  expiry), then leaves CLEANUP via the normal auto-phase recursion. No-op
 *  if the head choice is not a cleanup discard. */
export function finalizeCleanupDiscard(
    state: GameState,
    selectedIds: string[]
): void {
    const queue = state.pendingChoices ?? [];
    const head = queue[0];
    if (
        !head ||
        head.kind !== "discard-hand" ||
        head.stackItemId !== "" ||
        !state.pendingCleanupDiscard
    ) {
        return;
    }
    const player = getPlayer(state, state.pendingCleanupDiscard.playerId);
    for (const cardInstanceId of selectedIds) {
        // Defense-in-depth: a discard replacement (Library of Leng) earlier
        // in the loop could in principle have routed an id away from hand
        // before the loop reaches it. `findIndex === -1` makes the second
        // pick a silent no-op rather than a throw — matches the SpellContext
        // `discardCard` contract used by Disrupting Scepter / discardAtRandom.
        const idx = player.hand.findIndex((c) => c.id === cardInstanceId);
        if (idx === -1) continue;
        const repl = applyDiscardReplacements(state, {
            kind: "discard",
            playerId: player.id,
            cardInstanceId,
        });
        if (repl === null) continue;
        moveCard(player, repl.cardInstanceId, "hand", "graveyard");
    }
    queue.shift();
    state.pendingChoices = queue.length > 0 ? queue : undefined;
    state.pendingCleanupDiscard = undefined;
    // CR 514.2 — runs only after the discard lands.
    finalizeCleanup(state);
    // CLEANUP is an auto-phase. Leaving it lands at the next turn's UNTAP →
    // UPKEEP via the normal auto-phase recursion (CR 500.1). Drain any
    // auto-pass left on the new active player so priority settles correctly.
    advancePhase(state);
    drainAutoPasses(state);
}

/** CR 514.2 — runs after the (possibly empty) 514.1 discard. Exported so
 *  the commit handler in `game.ts` can resume CLEANUP after the discards
 *  land. "Until end of turn" effects expire, marked damage is removed from
 *  every permanent, and turn-scoped combat flags are cleared. */
export function finalizeCleanup(state: GameState): void {
    // CR 514.2 — "until end of turn" effects end at the cleanup step.
    tickAllDurations(state);
    // CR 514.2 — marked damage is removed from all permanents, and
    // turn-scoped combat flags are cleared.
    for (const p of state.players) {
        for (const card of p.battlefield) {
            if (card.damageMarked !== undefined) {
                card.damageMarked = undefined;
            }
            if (card.hasAttackedThisTurn) {
                card.hasAttackedThisTurn = undefined;
            }
            if (card.hasBlockedThisTurn) {
                card.hasBlockedThisTurn = undefined;
            }
            if (card.damagedBySources !== undefined) {
                card.damagedBySources = undefined;
            }
            // CR 701.15a — regeneration shields apply only "this turn".
            // Unused shields wear off here.
            if (card.regenerationShields !== undefined) {
                card.regenerationShields = undefined;
            }
            // CR 614.1a — Disintegrate's exile-on-death flag is turn-scoped.
            if (card.exileOnDeath !== undefined) {
                card.exileOnDeath = undefined;
            }
            // CR 508.1d — forced-attack flag is turn-scoped.
            if (card.mustAttackThisTurn !== undefined) {
                card.mustAttackThisTurn = undefined;
            }
            if (card.canBlockAdditional !== undefined) {
                card.canBlockAdditional = undefined;
            }
            if (card.mustBlockAllThisTurn) {
                card.mustBlockAllThisTurn = undefined;
            }
        }
    }
}

/** Advances all parametric durations on the current game state by one
 *  phase-boundary tick. Called from END_OF_COMBAT (CR 511.3) and CLEANUP
 *  (CR 514.2); `tickDuration` itself filters by phase+playerId so entries
 *  scoped to a different boundary are left untouched. */
function tickAllDurations(state: GameState): void {
    const view = { phase: state.phase, activePlayerId: state.activePlayerId };

    // Player-granted activated abilities (e.g. Channel).
    for (const p of state.players) {
        if (!p.grantedAbilities?.length) continue;
        const kept: typeof p.grantedAbilities = [];
        for (const grant of p.grantedAbilities) {
            const next = tickDuration(grant.duration, view);
            if (next !== null) kept.push({ ...grant, duration: next });
        }
        p.grantedAbilities = kept.length > 0 ? kept : undefined;
    }

    // Granted static keywords (e.g. Berserk's trample). On expiry, splice
    // one occurrence out of `staticAbilities` so natively-declared
    // duplicates are left untouched (CR 113.1). Aura-sourced grants have
    // no duration — they're managed by the aura's lifetime (see
    // applyAuraStaticEffects / unapplyAuraStaticEffects in state.ts) and
    // pass through this purge unchanged.
    for (const p of state.players) {
        for (const card of p.battlefield) {
            if (!card.grantedStaticAbilities?.length) continue;
            const kept: typeof card.grantedStaticAbilities = [];
            for (const grant of card.grantedStaticAbilities) {
                if (!grant.duration) {
                    kept.push(grant);
                    continue;
                }
                const next = tickDuration(grant.duration, view);
                if (next === null) {
                    const idx = card.staticAbilities.indexOf(grant.ability);
                    if (idx !== -1) {
                        card.staticAbilities = [
                            ...card.staticAbilities.slice(0, idx),
                            ...card.staticAbilities.slice(idx + 1),
                        ];
                    }
                } else {
                    kept.push({ ...grant, duration: next });
                }
            }
            card.grantedStaticAbilities = kept.length > 0 ? kept : undefined;
        }
    }

    // One-shot prevention effects (e.g. Circle of Protection). An effect
    // that hasn't been consumed by the time its duration expires simply
    // wears off.
    if (state.preventionEffects?.length) {
        const kept: typeof state.preventionEffects = [];
        for (const effect of state.preventionEffects) {
            const next = tickDuration(effect.duration, view);
            if (next !== null) kept.push({ ...effect, duration: next });
        }
        state.preventionEffects = kept.length > 0 ? kept : undefined;
    }

    // Target-keyed prevention shields (e.g. Samite Healer, Conservator).
    // Unconsumed remainder wears off at the same boundary.
    if (state.targetPreventionShields?.length) {
        const kept: typeof state.targetPreventionShields = [];
        for (const shield of state.targetPreventionShields) {
            const next = tickDuration(shield.duration, view);
            if (next !== null) kept.push({ ...shield, duration: next });
        }
        state.targetPreventionShields = kept.length > 0 ? kept : undefined;
    }

    // Transient damage redirections (Reverse Damage, Jade Monolith {1},
    // Personal Incarnation {0}). Same wear-off semantics as prevention.
    if (state.damageRedirections?.length) {
        const kept: typeof state.damageRedirections = [];
        for (const shield of state.damageRedirections) {
            const next = tickDuration(shield.duration, view);
            if (next === null) continue;
            kept.push({ ...shield, duration: next });
        }
        state.damageRedirections = kept.length > 0 ? kept : undefined;
    }

    // "Becomes a creature" animations (e.g. Jade Statue). On expiry, splice
    // back out anything the animation added and restore the pre-animation
    // P/T so the permanent returns to its original shape.
    for (const p of state.players) {
        for (const card of p.battlefield) {
            if (!card.animation) continue;
            const next = tickDuration(card.animation.duration, view);
            if (next === null) {
                revertAnimation(card);
            } else {
                card.animation = { ...card.animation, duration: next };
            }
        }
    }

    // Temporary P/T modifications (e.g. Firebreathing's `{R}: ~ gets +1/+0
    // until end of turn`). Purged at the same boundary as `grantedStaticAbilities`
    // and `preventionEffects`.
    for (const p of state.players) {
        for (const card of p.battlefield) {
            if (!card.temporaryPTMods?.length) continue;
            const kept: typeof card.temporaryPTMods = [];
            for (const mod of card.temporaryPTMods) {
                const next = tickDuration(mod.duration, view);
                if (next !== null) kept.push({ ...mod, duration: next });
            }
            card.temporaryPTMods = kept.length > 0 ? kept : undefined;
        }
    }

    // Fog-style blanket combat-damage prevention (CR 615). Only meaningful
    // at CLEANUP — the flag is set at resolution time and lasts until end of
    // turn. Cleared unconditionally so it doesn't persist across turns.
    if (state.preventAllCombatDamageThisTurn) {
        state.preventAllCombatDamageThisTurn = undefined;
    }
    if (state.damageCapShields) {
        state.damageCapShields = undefined;
    }
    if (state.allCreaturesMustAttack) {
        state.allCreaturesMustAttack = undefined;
    }
}

/** Undoes the mutations applied by `animateAsCreature`, restoring the
 *  permanent to its pre-animation shape. Safe to call only on a card whose
 *  `animation` field is set (caller checks). */
function revertAnimation(card: CardInstanceState): void {
    const anim = card.animation;
    if (!anim) return;
    if (anim.addedSubtype !== undefined) {
        const idx = card.subtypes.indexOf(anim.addedSubtype);
        if (idx !== -1) {
            card.subtypes = [
                ...card.subtypes.slice(0, idx),
                ...card.subtypes.slice(idx + 1),
            ];
        }
    }
    if (anim.addedCreatureType) {
        const idx = card.types.indexOf("Creature");
        if (idx !== -1) {
            card.types = [
                ...card.types.slice(0, idx),
                ...card.types.slice(idx + 1),
            ];
        }
    }
    card.power = anim.savedPower;
    card.toughness = anim.savedToughness;
    card.animation = undefined;
    // CR 704.5g: damage marked on a permanent that's no longer a creature
    // is irrelevant but harmless — cleared at CLEANUP regardless.
}

/** Advance turn: increment counter, swap active player, reset autoPass.
 *  CR 500.7: if an extra turn is queued, the next active player is the one
 *  at the end of the queue (LIFO) instead of the normal turn-order swap.
 *  CR 614.10: if the next active player has skipNextTurn set, clear the flag
 *  and skip their entire turn — advance to the following player instead. */
function advanceTurn(state: GameState): void {
    state.turn += 1;
    if (state.extraTurns && state.extraTurns.length > 0) {
        const nextActive = state.extraTurns[state.extraTurns.length - 1];
        state.extraTurns = state.extraTurns.slice(0, -1);
        if (state.extraTurns.length === 0) state.extraTurns = undefined;
        state.activePlayerId = nextActive;
    } else {
        state.activePlayerId = getOpponentId(state, state.activePlayerId);
    }
    // CR 614.10: if the next active player's turn should be skipped, clear
    // the flag and recurse to advance past their turn entirely.
    const candidate = getPlayer(state, state.activePlayerId);
    if (candidate.skipNextTurn) {
        candidate.skipNextTurn = undefined;
        advanceTurn(state);
        return;
    }
    // CR 500.1: bump the new active player's per-player turn counter. Extra
    // turns (CR 500.7) increment this normally — the recipient is genuinely
    // taking another of their turns.
    const newActive = getPlayer(state, state.activePlayerId);
    newActive.turnsTaken = (newActive.turnsTaken ?? 0) + 1;
    state.autoPassPlayers = undefined;
    state.singleShotAutoPass = undefined;
    // CR 117.2c / 305.2: reset per-turn land drop count at the start of each turn.
    for (const p of state.players) p.landsPlayedThisTurn = 0;
    // Reset the per-turn deaths tally so end-step counts are turn-scoped.
    state.deathsThisTurn = undefined;
    // Reset per-turn player damage tally (CR 120.3) — Simulacrum scopes its
    // "damage dealt to you this turn" lookup to the current turn.
    state.damageDealtToPlayerThisTurn = undefined;
    // CR 602.5 — `oncePerTurn` activation counts are per-source per-turn.
    // Clear them across every permanent at turn start so the next turn's
    // first activation isn't blocked by a stale tally.
    for (const p of state.players) {
        for (const c of p.battlefield) {
            if (c.activationsThisTurn) c.activationsThisTurn = undefined;
        }
    }
    // Island Sanctuary: clear protection when the protected player's turn starts
    if (
        state.islandSanctuaryProtection &&
        state.islandSanctuaryProtection === state.activePlayerId
    ) {
        state.islandSanctuaryProtection = undefined;
    }
}

/**
 * Advance the game to the next phase/step.
 * Called when both players pass priority with an empty stack.
 * Auto-phases (UNTAP, CLEANUP) are traversed without giving priority.
 * Returns the list of phases traversed (for event emission).
 */
/** Empty mana pools for all players (CR 500.4). Tapped lands become committed (non-untappable until untap step). */
function emptyManaPools(state: GameState): void {
    for (const player of state.players) {
        for (const color of Object.keys(player.manaPool)) {
            player.manaPool[color] = 0;
        }
        for (const card of player.battlefield) {
            if (card.isTapped) {
                card.manaCommitted = true;
            }
        }
    }
}

function defenderHasAnyLegalBlock(state: GameState): boolean {
    if (!state.combat) return false;
    const defenderId = getOpponentId(state, state.activePlayerId);
    const activePlayer = getPlayer(state, state.activePlayerId);
    const defender = getPlayer(state, defenderId);
    const attackers: CardInstanceState[] = [];
    for (const id of state.combat.attackerIds) {
        const card = activePlayer.battlefield.find((c) => c.id === id);
        if (card) attackers.push(card);
    }
    return hasAnyLegalBlock(attackers, defender.battlefield, state);
}

export function advancePhase(state: GameState): Phase[] {
    const traversed: Phase[] = [];

    // CR 500.4: mana pools empty when a step or phase ends
    emptyManaPools(state);

    const next = nextPhase(state.phase);

    if (next === null) {
        // End of turn → advance to next turn
        advanceTurn(state);
        state.phase = "UNTAP";
    } else {
        state.phase = next;
    }

    traversed.push(state.phase);

    // Check combat state before entry actions (END_OF_COMBAT clears it)
    const hadAttackers = !!state.combat && state.combat.attackerIds.length > 0;
    performPhaseEntry(state);

    // CR 603.6a: fire "at the beginning of ~" triggers after the step's
    // turn-based actions. Skipped on auto-phases (UNTAP/CLEANUP) which don't
    // grant priority — triggers scoped to those steps are out of scope for
    // now and would need to be held until the next priority window.
    if (!AUTO_PHASES.has(state.phase)) {
        firePhaseBeginTriggers(state);
    }

    const skipEmptyCombat =
        (state.phase === "DECLARE_BLOCKERS" ||
            state.phase === "FIRST_STRIKE_DAMAGE" ||
            state.phase === "COMBAT_DAMAGE" ||
            state.phase === "END_OF_COMBAT") &&
        !hadAttackers;

    // Auto-skip DECLARE_BLOCKERS when every declared attacker is unblockable
    // (e.g. flying with no reach defender, or landwalk on a matching land —
    // CR 702.9, 702.13). Matches the UX where the defender has no legal
    // target to assign, avoiding a dead-end priority window.
    const skipUnblockableCombat =
        state.phase === "DECLARE_BLOCKERS" &&
        hadAttackers &&
        !!state.combat &&
        !defenderHasAnyLegalBlock(state);
    if (skipUnblockableCombat && state.combat) {
        state.combat.blockersConfirmed = true;
    }

    // CR 510.5: skip the first-strike damage step when no combatant has
    // first strike or double strike.
    const skipFirstStrikeDamage =
        state.phase === "FIRST_STRIKE_DAMAGE" &&
        hadAttackers &&
        !anyCombatantHasFirstOrDoubleStrike(state);

    // An auto-phase entry may have enqueued a pending choice (CR 608.2,
    // 502.1 — e.g. UNTAP under Winter Orb prompts the active player to
    // pick which land to untap). In that case do NOT recurse: the engine
    // is suspended awaiting input, and the submitter (`selectResolutionChoice`
    // / `submitResolutionChoice`) is responsible for re-entering this function
    // once the choice is committed. Priority has already been routed to
    // the chooser by the phase-entry hook.
    if ((state.pendingChoices?.length ?? 0) > 0) {
        return traversed;
    }

    if (
        AUTO_PHASES.has(state.phase) ||
        skipEmptyCombat ||
        skipUnblockableCombat ||
        skipFirstStrikeDamage
    ) {
        // Auto-phase or empty combat: skip straight through (no priority given)
        traversed.push(...advancePhase(state));
    } else {
        // Priority phase: active player gets priority
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
    }

    return traversed;
}

/**
 * Drain auto-passes: while the current priority holder is in autoPassPlayers,
 * simulate their pass. Handles both stack resolution and phase advancement.
 * Stops when priority lands on a non-auto-pass player or a new turn begins
 * (which clears autoPassPlayers).
 */
export function drainAutoPasses(state: GameState): void {
    const maxIterations = 50; // safety bound
    for (let i = 0; i < maxIterations; i++) {
        const autoPass = state.autoPassPlayers ?? [];
        const singleShot = state.singleShotAutoPass === state.priorityPlayerId;
        if (!autoPass.includes(state.priorityPlayerId) && !singleShot) break;
        if (singleShot) state.singleShotAutoPass = undefined;

        // Auto-confirm attackers with current selection when auto-passing
        if (
            state.phase === "DECLARE_ATTACKERS" &&
            state.combat &&
            !state.combat.confirmed
        ) {
            const activePlayer = getPlayer(state, state.activePlayerId);
            // CR 508.1d: fold in any eligible creature required to attack.
            for (const requiredId of getRequiredAttackerIds(
                activePlayer.battlefield,
                undefined,
                state.allCreaturesMustAttack
            )) {
                if (!state.combat.attackerIds.includes(requiredId)) {
                    state.combat.attackerIds.push(requiredId);
                }
            }
            for (const attackerId of state.combat.attackerIds) {
                const card = activePlayer.battlefield.find(
                    (c) => c.id === attackerId
                );
                if (card) {
                    if (!card.staticAbilities.includes("vigilance")) {
                        // CR 708.9 / ADR 0013 — face-down attacker turns up as
                        // it taps to attack.
                        tapPermanent(state, card);
                    }
                    card.isAttacking = true;
                    card.hasAttackedThisTurn = true;
                }
            }
            state.combat.confirmed = true;
            state.combat.blockerAssignments = {};
            state.combat.blockersConfirmed = false;
            emitAttackersDeclaredEvents(state);
        }

        // Auto-confirm blockers when defending player auto-passes
        if (
            state.phase === "DECLARE_BLOCKERS" &&
            state.combat &&
            !state.combat.blockersConfirmed
        ) {
            const defenderId = getOpponentId(state, state.activePlayerId);
            const defender = getPlayer(state, defenderId);
            for (const blockerId of Object.keys(
                state.combat.blockerAssignments
            )) {
                const card = defender.battlefield.find(
                    (c) => c.id === blockerId
                );
                if (card) {
                    card.isBlocking = true;
                    card.hasBlockedThisTurn = true;
                }
            }
            state.combat.pendingBlockerId = undefined;
            state.combat.blockersConfirmed = true;
            emitBlockersConfirmedEvents(state);
        }

        // Auto-confirm damage assignment when active player auto-passes
        if (
            (state.phase === "FIRST_STRIKE_DAMAGE" ||
                state.phase === "COMBAT_DAMAGE") &&
            state.combat &&
            state.combat.damageConfirmed === false
        ) {
            const kind: DamageKind =
                state.phase === "FIRST_STRIKE_DAMAGE"
                    ? "first-strike"
                    : "regular";
            applyAllCombatDamage(
                state,
                state.combat.damageAssignments ?? {},
                kind
            );
            state.combat.damageConfirmed = true;
        }

        state.passCount += 1;

        if (state.passCount >= 2 && state.stack.length > 0) {
            resolveTopOfStack(state);
            if ((state.pendingChoices?.length ?? 0) > 0) {
                // Resolution suspended on a pending choice (CR 608.2) —
                // priority moves to the chooser and auto-drain stops;
                // selectResolutionChoice will resume from here.
                state.priorityPlayerId = state.pendingChoices![0].playerId;
                return;
            }
            if (state.pendingTarget) {
                // Resolution requested a copy-retarget (CR 707.10b, Fork) —
                // priority moves to the chooser and auto-drain stops until
                // they select or decline new targets.
                state.priorityPlayerId = state.pendingTarget.playerId;
                return;
            }
            state.priorityPlayerId = state.activePlayerId;
            state.passCount = 0;
        } else if (state.passCount >= 2 && state.stack.length === 0) {
            advancePhase(state);
            // advanceTurn clears autoPassPlayers, so the loop will exit naturally
        } else {
            state.priorityPlayerId = getOpponentId(
                state,
                state.priorityPlayerId
            );
        }
    }
}

/** Returns true if sorcery-speed actions are legal (main phase, empty stack, active player has priority). */
export function isSorceryTiming(state: GameState): boolean {
    return (
        (state.phase === "PRECOMBAT_MAIN" ||
            state.phase === "POSTCOMBAT_MAIN") &&
        state.stack.length === 0 &&
        state.priorityPlayerId === state.activePlayerId
    );
}
