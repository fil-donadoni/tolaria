/**
 * Blade-scenario suite — engine-real `setup` steps (issue #1487, ADR 0070 §4).
 *
 * A `ScenarioSpec` can only describe a BOARD. Three of the four charter
 * scenarios (PRD #1423, issue #1434) assert on a decision that does not exist
 * the moment the board is built — a trigger on the stack, a live
 * search-library choice, a modal choice. `setup` is the small declarative
 * sequence that walks the built board forward to that decision.
 *
 * THE ONE RULE THAT MAKES THIS WORTH DOING (ADR 0070 §4): every step is
 * executed by the REAL engine, and a step that finds no purchase in the real
 * engine THROWS. There is no fallback that builds the state "as if".
 *
 *   - A hand-built stack item (the shape the pre-existing
 *     `convex/gre/__tests__/dreadnought-stifle.bot.test.ts` uses, whose own
 *     comment admits it "mirrors `processPendingActionTriggers`") can describe
 *     a position the engine could never produce. The bot would then be
 *     measured on a position that does not occur in play, which destroys the
 *     suite's claim to be a metric of real behaviour — and a copy of engine
 *     logic does not diverge loudly, it diverges silently.
 *   - A silent fallback ("place the trigger by hand if the engine didn't")
 *     would search a position other than the one written, which is the exact
 *     failure mode this shape exists to avoid. Hence: throw.
 *
 * Why the `etb-trigger` step calls `processPendingActionTriggers` rather than
 * `collectTriggers` + `placeTriggersOnStack` by hand: that function IS the
 * production chokepoint that composes those two (CR 603.2/603.3b) — plus the
 * mana-ability carve-out (CR 605.4) and the post-placement priority hand-back
 * (CR 117.3c). Calling the two halves directly here would mean re-implementing
 * the glue between them, i.e. exactly the "mirrors the engine" copy ADR 0070
 * §4 rejects. Same for the event itself: it is produced by the engine's own
 * `emitPermanentEntered`, never by an object literal.
 */

import { getCardByName } from "../../../cards";
import {
    activateAbilityOnState,
    getEffectiveActivatedAbilities,
} from "../../../game";
import { enumerateMoves } from "../../moves";
import type { Move } from "../../moves";
import { applyMoveInSearch } from "../../search";
import type { CardInstanceState, GameState, StackItem } from "../../state";
import {
    discardToGraveyard,
    emitPermanentEntered,
    grantKnowledge,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../state";
import {
    applyDeclareAttackers,
    applyDeclareBlockers,
    applyExtraCombat,
} from "./combatSetup";
import { collectTriggers, placeTriggersOnStack } from "../../triggers";
import { instanceIdsForName, seatPlayerId } from "./matcher";
import type { BladeScenario, BladeSetupStep, BladeSeat } from "./types";

/** Thrown when a setup step finds no purchase in the real engine. A distinct
 *  class so a caller (and the runner's tests) can tell an AUTHORING failure —
 *  the position as written is unreachable — from a bot result. */
export class BladeSetupError extends Error {
    constructor(label: string, step: BladeSetupStep, detail: string) {
        super(
            `Blade scenario "${label}": setup step [${step.kind}] found no purchase in the engine — ${detail}`
        );
        this.name = "BladeSetupError";
    }
}

/** Every battlefield permanent named `name`, optionally restricted to one
 *  seat. Name-based, exactly like `MoveMatcher` — a blade entry never writes
 *  an instance id. `getCardByName` throws on an unknown name, so a typo is an
 *  authoring error, never a silently-empty match. */
function battlefieldMatches(
    state: GameState,
    name: string,
    controller: BladeSeat | undefined
): CardInstanceState[] {
    const def = getCardByName(name);
    const wantedId =
        controller === undefined ? undefined : seatPlayerId(state, controller);
    const out: CardInstanceState[] = [];
    for (const player of state.players) {
        if (wantedId !== undefined && player.id !== wantedId) continue;
        for (const card of player.battlefield) {
            if ((card.card as { id?: string } | undefined)?.id === def.id) {
                out.push(card);
            }
        }
    }
    return out;
}

/** Stack items (and the off-stack pending batch, when placement suspended on a
 *  CR 603.3b ordering choice) whose trigger source is `sourceId`. */
function triggersFrom(state: GameState, sourceId: string): StackItem[] {
    const pending = state.pendingTriggerBatch ?? [];
    return [...state.stack, ...pending].filter(
        (item) => item.triggerSourceId === sourceId
    );
}

function applyEtbTrigger(
    state: GameState,
    label: string,
    step: Extract<BladeSetupStep, { kind: "etb-trigger" }>
): void {
    const matches = battlefieldMatches(state, step.card, step.controller);
    if (matches.length === 0) {
        throw new BladeSetupError(
            label,
            step,
            `no battlefield permanent named "${step.card}"${
                step.controller ? ` controlled by "${step.controller}"` : ""
            } in the built state.`
        );
    }
    if (matches.length > 1) {
        throw new BladeSetupError(
            label,
            step,
            `${matches.length} battlefield permanents named "${step.card}" — the step is ambiguous. Place one, or narrow it with \`controller\`.`
        );
    }
    const permanent = matches[0];
    const before = triggersFrom(state, permanent.id).length;

    // The REAL emitter (CR 603.6), handed the REAL instance — so the trigger
    // matcher sees an event indistinguishable from one produced in play (same
    // last-known type snapshot, same `cardId`, same Arboria bookkeeping).
    emitPermanentEntered(state, permanent);
    // ...and the REAL collection + placement chokepoint (collectTriggers +
    // placeTriggersOnStack, CR 603.2 / 603.3b).
    processPendingActionTriggers(state);

    if (triggersFrom(state, permanent.id).length <= before) {
        throw new BladeSetupError(
            label,
            step,
            `"${step.card}" put no triggered ability on the stack when it entered. Either the card has no enters-the-battlefield trigger, or its condition is not met in this position.`
        );
    }
}

/** CR 603.6a (issue #2707) — the phase-trigger twin of `applyEtbTrigger`
 *  directly above: build the SAME `PHASE_BEGIN` event `phases.ts`'s own
 *  `firePhaseBeginTriggers` builds, run it through the SAME collection +
 *  placement chokepoint (`collectTriggers` + `placeTriggersOnStack`, CR 603.2
 *  / 603.3b), and restart priority at the active player (CR 117.3c) exactly as
 *  the engine does. Reimplemented here rather than called because
 *  `firePhaseBeginTriggers` is module-private to `phases.ts` and reaching it
 *  from outside would mean advancing a whole turn, which is a different
 *  position from the one written. */
function applyPhaseTrigger(
    state: GameState,
    label: string,
    step: Extract<BladeSetupStep, { kind: "phase-trigger" }>
): void {
    if (step.phase !== undefined) state.phase = step.phase;
    const before = state.stack.length;
    const triggers = collectTriggers(state, [
        {
            type: "PHASE_BEGIN",
            phase: state.phase,
            activePlayerId: state.activePlayerId,
        },
    ]);
    if (placeTriggersOnStack(state, triggers)) {
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
    }
    if (state.stack.length <= before) {
        throw new BladeSetupError(
            label,
            step,
            `no "at the beginning of ${state.phase}" trigger reached the stack in this position. Either no permanent in the built state has one, or its CR 603.4 condition is not met — including a targeted trigger removed for having no legal target (CR 603.3d).`
        );
    }
}

function applyResolveTop(
    state: GameState,
    label: string,
    step: Extract<BladeSetupStep, { kind: "resolve-top" }>
): void {
    if (state.stack.length === 0) {
        throw new BladeSetupError(
            label,
            step,
            "the stack is empty — nothing to resolve."
        );
    }
    // CR 608 — the real resolution path, the same one the engine runs when
    // both players pass priority.
    resolveTopOfStack(state);
}

/** Pass priority as `seat` through the search's own pass machinery (issue
 *  #2903) — `applyMoveInSearch`'s `pass` case, i.e. `passInSearch`, the exact
 *  function the search replays a pass with. This is what lets a `cast`-then-
 *  pass sequence reach the active player's post-resolution window: the cast
 *  parks priority on the opponent, and their pass drives the pass cycle to 2,
 *  resolves the stack, and hands priority back to the active player (CR
 *  117.3b). */
/** CR 701.9 / 702.35c (issue #2983) — discard the named card from a seat's
 *  hand through the REAL discard chokepoint, then run the engine's own
 *  post-action trigger scan. Both calls are exactly what a live game makes, so
 *  a discard replacement (Madness exiles instead of binning) and the reflexive
 *  trigger it schedules are the production ones, not a fixture's restatement.
 *
 *  Leaves the trigger on the stack UNRESOLVED — see the step's doc in
 *  `types.ts` for why the pairing with `resolve-top` matters. */
function applyDiscard(
    state: GameState,
    step: Extract<BladeSetupStep, { kind: "discard" }>,
    label: string
): void {
    const fail = (detail: string) => new BladeSetupError(label, step, detail);
    const seat = step.controller ?? "me";
    const playerId = seatPlayerId(state, seat);
    const player = state.players.find((p) => p.id === playerId)!;
    // Scoped to the seat's HAND: `instanceIdsForName` spans the whole state, so
    // a copy on the battlefield would otherwise read as an ambiguity (or worse,
    // as the discard target).
    const named = instanceIdsForName(state, step.card);
    const matches = player.hand.filter((c) => named.has(c.id));
    if (matches.length === 0) {
        throw fail(`seat "${seat}" holds no "${step.card}" in hand.`);
    }
    if (matches.length > 1) {
        throw fail(
            `seat "${seat}" holds ${matches.length} copies of "${step.card}" in hand — ambiguous.`
        );
    }
    if (!discardToGraveyard(state, playerId, matches[0].id)) {
        throw fail(`the engine refused to discard "${step.card}".`);
    }
    // The engine drains the discard event and scans triggers after every game
    // action; the discard above happened outside a resolution, so replicate it
    // (the same line `madness.test.ts`'s own helper carries).
    processPendingActionTriggers(state);
}

function applyPass(
    state: GameState,
    label: string,
    step: Extract<BladeSetupStep, { kind: "pass" }>
): void {
    const seat = step.seat ?? "me";
    const passerId = seatPlayerId(state, seat);
    if (!state.players.some((p) => p.id === passerId)) {
        throw new BladeSetupError(
            label,
            step,
            `no "${seat}" seat in the state.`
        );
    }
    applyMoveInSearch(state, passerId, { kind: "pass" });
}

/**
 * Activate a named permanent's activated ability through the REAL activation
 * path (issue #1491, ADR 0070 §4).
 *
 * `activateAbilityOnState` (`convex/game.ts`) IS that path: it was lifted out
 * of the `activateAbility` mutation, which now calls it and keeps nothing but
 * the I/O (fetch the row, clone, persist). So the position this step reaches
 * is produced by the same legality checks and the same cost payments a live
 * activation applies — not by a setup-side approximation of them, which is
 * the copy ADR 0070 §4 exists to prevent.
 */
function applyActivate(
    state: GameState,
    label: string,
    step: Extract<BladeSetupStep, { kind: "activate" }>
): void {
    const matches = battlefieldMatches(state, step.card, step.controller);
    if (matches.length === 0) {
        throw new BladeSetupError(
            label,
            step,
            `no battlefield permanent named "${step.card}"${
                step.controller ? ` controlled by "${step.controller}"` : ""
            } in the built state.`
        );
    }
    if (matches.length > 1) {
        throw new BladeSetupError(
            label,
            step,
            `${matches.length} battlefield permanents named "${step.card}" — the step is ambiguous. Place one, or narrow it with \`controller\`.`
        );
    }
    const permanent = matches[0];

    // CR 611.2a/613.1f (layer 6, issue #1522) — the POST-LAYER effective set:
    // native abilities from the definition (dropped while a "loses all
    // abilities" suppression is live) PLUS any ability granted to THIS
    // instance by another permanent's continuous static effect (Zombie
    // Master's "{B}: Regenerate ~"). The static `CardDefinition` alone (the
    // pre-fix lookup) sees neither case: a granted ability isn't on it at
    // all, and a suppressed native one is — this is the same resolution
    // `activateAbilityOnState`/`resolveActivatedAbility` performs, so a
    // setup step never rejects a position the real engine would accept, nor
    // accepts one it would reject.
    //
    // CR 605.1a — a mana ability never uses the stack, so it can never be the
    // pending decision this step exists to reach; only stack-using abilities
    // are addressable here.
    const abilities = getEffectiveActivatedAbilities(permanent)
        .map((r) => r.ability)
        .filter((a) => a.useStack !== false);
    if (abilities.length === 0) {
        throw new BladeSetupError(
            label,
            step,
            `"${step.card}" has no stack-using activated ability (CR 602.1).`
        );
    }
    let abilityId: string;
    if (step.ability !== undefined) {
        const found = abilities.find((a) => a.id === step.ability);
        if (!found) {
            throw new BladeSetupError(
                label,
                step,
                `"${step.card}" has no stack-using activated ability with id "${step.ability}" (has: ${abilities.map((a) => a.id).join(", ")}).`
            );
        }
        abilityId = found.id;
    } else {
        if (abilities.length > 1) {
            throw new BladeSetupError(
                label,
                step,
                `"${step.card}" has ${abilities.length} stack-using activated abilities — name one with \`ability\` (${abilities.map((a) => a.id).join(", ")}).`
            );
        }
        abilityId = abilities[0].id;
    }

    // issue #2306 — a TARGETED ability can never reach the stack through the
    // raw `activateAbilityOnState` path below: it always opens
    // `pendingTarget` (never auto-resolved, even with one legal target — see
    // the `target` field's own doc comment on `BladeSetupStep`), which is
    // exactly the "stopped at a payment/target decision" throw further down.
    // `target` routes through the SAME production seam `applyCast` uses
    // instead: `enumerateMoves` (the legality gate — only legal, FULLY
    // targeted activations) + `applyMoveInSearch` (the exact application the
    // search itself replays an activation with).
    if (step.target !== undefined) {
        applyTargetedActivate(state, label, step, permanent, abilityId);
        return;
    }

    const before = state.stack.length;
    try {
        activateAbilityOnState(state, {
            // CR 602.1 — the source's controller activates. The step never
            // guesses a seat: it activates AS whoever controls the permanent.
            playerId: permanent.controllerId,
            cardInstanceId: permanent.id,
            abilityId,
        });
    } catch (err) {
        // The real path rejected it (no priority, cost unpayable, timing
        // restriction, …). Surface it as an AUTHORING failure — never fall
        // back to placing the ability by hand.
        throw new BladeSetupError(
            label,
            step,
            `the real activation path rejected it — ${err instanceof Error ? err.message : String(err)}`
        );
    }
    if (state.stack.length <= before) {
        throw new BladeSetupError(
            label,
            step,
            `activating "${abilityId}" put nothing on the stack — it stopped at a payment/target decision (${state.pendingActivation ? "pendingActivation" : state.pendingTarget ? "pendingTarget" : "no pending decision"}). A setup step activates only abilities whose costs commit immediately.`
        );
    }
}

/** The `target`-bearing half of `applyActivate` (issue #2306) — see that
 *  field's doc comment on `BladeSetupStep` for why a targeted ability needs
 *  this second path. Mirrors `applyCast`'s candidate-narrowing shape:
 *  enumerate the real legal activations of THIS permanent/ability, narrow to
 *  the ones targeting `step.target`, and reject an ambiguous or empty match
 *  rather than guessing. */
function applyTargetedActivate(
    state: GameState,
    label: string,
    step: Extract<BladeSetupStep, { kind: "activate" }>,
    permanent: CardInstanceState,
    abilityId: string
): void {
    const target = step.target;
    if (target === undefined) return; // narrows for TS; callers only reach here when set
    const legal = enumerateMoves(state, permanent.controllerId);
    const isActivate = (
        m: Move
    ): m is Extract<Move, { kind: "activate-ability" }> =>
        m.kind === "activate-ability";
    let candidates = legal
        .filter(isActivate)
        .filter(
            (m) =>
                m.cardInstanceId === permanent.id && m.abilityId === abilityId
        );
    if (candidates.length === 0) {
        throw new BladeSetupError(
            label,
            step,
            `no legal activation of "${step.card}" — the engine offered none (check priority, cost, or timing).`
        );
    }

    const wanted = castTargetIds(state, target);
    candidates = candidates.filter((m) =>
        m.targets.some((t) => wanted.has(t.id))
    );
    if (candidates.length === 0) {
        throw new BladeSetupError(
            label,
            step,
            `"${step.card}" has no legal activation targeting "${target}".`
        );
    }
    if (candidates.length > 1) {
        throw new BladeSetupError(
            label,
            step,
            `${candidates.length} legal activations of "${step.card}" still target "${target}" — narrow the step further.`
        );
    }

    const before = state.stack.length;
    applyMoveInSearch(state, permanent.controllerId, candidates[0]);
    if (state.stack.length <= before) {
        throw new BladeSetupError(
            label,
            step,
            `activating "${step.card}" put nothing on the stack (it may have resolved immediately or been countered by a replacement).`
        );
    }
}

/** The set of ids a `cast` step's `target` may denote: a player id for a seat
 *  (`me`/`opp`), otherwise every instance of the named card in the built state.
 *  Mirrors the matcher's `targetCandidateIds`, and reuses `instanceIdsForName`
 *  so an unresolvable card name throws loudly rather than matching nothing. */
function castTargetIds(
    state: GameState,
    target: BladeSeat | string
): Set<string> {
    if (target === "me" || target === "opp") {
        return new Set([seatPlayerId(state, target)]);
    }
    return instanceIdsForName(state, target);
}

/**
 * Cast the named card through the REAL move pipeline (issue #1490, ADR 0070 §4),
 * leaving the spell on the stack unresolved — the RESPONSE position a
 * `ScenarioSpec` cannot express.
 *
 * The no-copy invariant (ADR 0070 §4) is earned exactly as `activate`'s is, but
 * through a different production seam. There is no ctx-free `castSpellOnState`
 * to reuse the way `activate` reuses `activateAbilityOnState` — the cast
 * mutation (`announceCast`, `convex/game.ts`) is an async, ctx-bound handler
 * that walks a multi-step pendingCast/target flow. So this step composes the two
 * production functions that DO run pure and synchronous and that the search
 * itself already depends on:
 *   - `enumerateMoves` (`gre/moves.ts`) is the production legality gate — it
 *     returns ONLY legal casts, and ONLY for the seat that holds priority, so
 *     mana affordability (CR 601.2f), timing (sorcery vs instant speed) and
 *     legal targets (CR 601.2c) are the real checks. A cast that finds no
 *     purchase is simply ABSENT from the list, which is what makes the throw
 *     below honest rather than a hand-rolled legality re-implementation.
 *   - `applyMoveInSearch` (`gre/search.ts`) is the exact function the search
 *     replays a chosen cast with, so the position this step reaches is
 *     byte-for-byte the one the search reasons about after that cast — not a
 *     setup-side approximation of it.
 *
 * The step must resolve to EXACTLY ONE legal cast. It throws when the name
 * matches no legal cast (wrong seat, no priority, unpayable, no legal target),
 * when `target`/`x` narrow it to none, and — rather than silently pick one —
 * when more than one legal cast still matches after narrowing.
 */
function applyCast(
    state: GameState,
    label: string,
    step: Extract<BladeSetupStep, { kind: "cast" }>
): void {
    const seat = step.by ?? "me";
    const casterId = seatPlayerId(state, seat);
    const caster = state.players.find((p) => p.id === casterId);
    if (!caster) {
        throw new BladeSetupError(
            label,
            step,
            `no "${seat}" seat in the state.`
        );
    }
    const def = getCardByName(step.card); // throws on an unknown name

    // The production legality gate. Only legal casts for the priority-holder.
    const legal = enumerateMoves(state, casterId);
    const isCast = (m: Move): m is Extract<Move, { kind: "cast-spell" }> =>
        m.kind === "cast-spell";
    let candidates = legal
        .filter(isCast)
        .filter((m) =>
            caster.hand.some(
                (c) =>
                    c.id === m.cardInstanceId &&
                    (c.card as { id?: string } | undefined)?.id === def.id
            )
        );
    if (candidates.length === 0) {
        throw new BladeSetupError(
            label,
            step,
            `no legal cast of "${step.card}" by "${seat}" — the engine offered none (check priority, mana, timing, or a legal target).`
        );
    }

    if (step.target !== undefined) {
        const wanted = castTargetIds(state, step.target);
        candidates = candidates.filter((m) =>
            m.targets.some((t) => wanted.has(t.id))
        );
        if (candidates.length === 0) {
            throw new BladeSetupError(
                label,
                step,
                `"${step.card}" has no legal cast targeting "${step.target}".`
            );
        }
    }

    if (step.x !== undefined) {
        candidates = candidates.filter((m) => (m.chosenX ?? 0) === step.x);
        if (candidates.length === 0) {
            throw new BladeSetupError(
                label,
                step,
                `"${step.card}" has no legal cast with X = ${step.x}.`
            );
        }
    }

    if (candidates.length > 1) {
        throw new BladeSetupError(
            label,
            step,
            `${candidates.length} legal casts of "${step.card}" still match — narrow the step with \`target\` and/or \`x\` (X values offered: ${[
                ...new Set(candidates.map((m) => m.chosenX ?? 0)),
            ].join(", ")}).`
        );
    }

    const before = state.stack.length;
    applyMoveInSearch(state, casterId, candidates[0]);
    if (state.stack.length <= before) {
        throw new BladeSetupError(
            label,
            step,
            `casting "${step.card}" put nothing on the stack (it may have resolved immediately or been countered by a replacement).`
        );
    }
}

/** ADR 0026 (issue #1524) — grant a seat knowledge of a library's top cards
 *  through the engine's own `grantKnowledge`, the primitive every scry /
 *  surveil / Brainstorm keep resolves into. Throws when the library is shorter
 *  than the requested run, so a scenario cannot quietly grant nothing and then
 *  assert on a pin that was never there. */
function applyKnowLibraryTop(
    state: GameState,
    label: string,
    step: Extract<BladeSetupStep, { kind: "know-library-top" }>
): void {
    const ownerId = seatPlayerId(state, step.of ?? "me");
    const knowerId = seatPlayerId(state, step.knower ?? step.of ?? "me");
    const count = step.count ?? 1;
    const library = state.players.find((p) => p.id === ownerId)!.library;
    if (count < 1) {
        // `count: 0` would grant nothing and `count: -1` an all-but-last
        // prefix — both "no purchase in the real engine", both silent.
        throw new BladeSetupError(
            label,
            step,
            `count must be at least 1, got ${count}`
        );
    }
    if (library.length < count) {
        throw new BladeSetupError(
            label,
            step,
            `library of seat "${step.of ?? "me"}" holds ${library.length} card(s), fewer than the ${count} the step grants knowledge of`
        );
    }
    grantKnowledge(
        state,
        ownerId,
        library.slice(0, count).map((c) => c.id),
        knowerId
    );
}

/**
 * Apply a scenario's `setup` sequence to a freshly built state, in order.
 * A no-op when the entry declares none. Mutates `state` in place and returns
 * it, so it composes into the build pipeline.
 *
 * Throws `BladeSetupError` on the first step that finds no purchase — never
 * degrades to a hand-built approximation (ADR 0070 §4).
 */
export function applyBladeSetup(
    state: GameState,
    scenario: Pick<BladeScenario, "label" | "setup">
): GameState {
    for (const step of scenario.setup ?? []) {
        switch (step.kind) {
            case "etb-trigger":
                applyEtbTrigger(state, scenario.label, step);
                break;
            case "resolve-top":
                applyResolveTop(state, scenario.label, step);
                break;
            case "pass":
                applyPass(state, scenario.label, step);
                break;
            case "activate":
                applyActivate(state, scenario.label, step);
                break;
            case "cast":
                applyCast(state, scenario.label, step);
                break;
            case "discard":
                applyDiscard(state, step, scenario.label);
                break;
            case "declare-attackers":
                // Logic in `combatSetup.ts`; this file keeps only the dispatch.
                applyDeclareAttackers(
                    state,
                    step,
                    (detail) =>
                        new BladeSetupError(scenario.label, step, detail)
                );
                break;
            case "declare-blockers":
                // Logic in `combatSetup.ts`; this file keeps only the dispatch.
                applyDeclareBlockers(
                    state,
                    step,
                    (detail) =>
                        new BladeSetupError(scenario.label, step, detail)
                );
                break;
            case "know-library-top":
                applyKnowLibraryTop(state, scenario.label, step);
                break;
            case "phase-trigger":
                applyPhaseTrigger(state, scenario.label, step);
                break;
            case "extra-combat":
                // Logic in `combatSetup.ts`; this file keeps only the dispatch.
                applyExtraCombat(
                    state,
                    step,
                    (detail) =>
                        new BladeSetupError(scenario.label, step, detail)
                );
                break;
            default: {
                // Exhaustiveness: a new step kind must be handled here.
                const never: never = step;
                throw new Error(
                    `Blade scenario "${scenario.label}": unknown setup step ${JSON.stringify(never)}`
                );
            }
        }
    }
    return state;
}
