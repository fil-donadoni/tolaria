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
    emitPermanentEntered,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../state";
import { applyDeclareAttackers, applyExtraCombat } from "./combatSetup";
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
            case "activate":
                applyActivate(state, scenario.label, step);
                break;
            case "cast":
                applyCast(state, scenario.label, step);
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
            case "extra-combat":
                // Logic in `combatSetup.ts`; this file keeps only the dispatch.
                applyExtraCombat(
                    state,
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
