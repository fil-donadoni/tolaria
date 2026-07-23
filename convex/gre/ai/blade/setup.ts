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
import type { CardInstanceState, GameState, StackItem } from "../../state";
import {
    emitPermanentEntered,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../state";
import { seatPlayerId } from "./matcher";
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
