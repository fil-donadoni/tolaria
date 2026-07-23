/**
 * Blade `setup` steps — engine-real, or loud (issue #1487, ADR 0070 §4).
 *
 * The value of `setup` is entirely in its invariant: every step runs through
 * the REAL engine, and a step that finds no purchase THROWS rather than
 * building the state "as if". So these tests assert BOTH halves — the step
 * produces the engine's own artefact (a `StackItem` carrying the real
 * `triggeredAbilityId` and `triggerEvent`, indistinguishable from one a
 * genuine ETB produced), and every unsatisfiable step is a hard error.
 */

import { describe, expect, it } from "vitest";
import {
    BladeSetupError,
    applyBladeSetup,
    buildBladeBaseState,
    buildBladeState,
    findBladeScenario,
} from "..";
import { buildStateFromScenario } from "../../../scenarioBuilder";
import type { GameState } from "../../../state";
import type { ScenarioSpec } from "../../../../debugScenarioSpec";

const DREADNOUGHT = "Phyrexian Dreadnought";
const CHARTER = "charter: Stifles its own Phyrexian Dreadnought trigger";

function build(spec: ScenarioSpec): GameState {
    return buildStateFromScenario(buildBladeBaseState(), spec);
}

describe("blade setup — `etb-trigger` runs the real engine (ADR 0070 §4)", () => {
    it("puts the source's OWN trigger on the stack, as the engine builds it", () => {
        const state = build({
            cards: [
                {
                    name: DREADNOUGHT,
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        });
        expect(state.stack).toHaveLength(0);

        applyBladeSetup(state, {
            label: "t",
            setup: [{ kind: "etb-trigger", card: DREADNOUGHT }],
        });

        expect(state.stack).toHaveLength(1);
        const item = state.stack[0];
        const dread = state.players[0].battlefield.find((c) => c.power === 12)!;
        expect(item.triggerSourceId).toBe(dread.id);
        // The ability id and the triggering event come from the CARD and the
        // engine's own emitter — not from an object literal in the harness.
        expect(item.triggeredAbilityId).toBe(
            "phyrexian-dreadnought-etb-sacrifice"
        );
        expect(item.triggerEvent?.type).toBe("PERMANENT_ENTERED");
        // CR 117.3c — placement hands priority back to the active player, so
        // the seat that owns the Dreadnought may respond to its own trigger.
        expect(state.priorityPlayerId).toBe(state.activePlayerId);
    });

    it("THROWS when no battlefield permanent carries the name (no silent fallback)", () => {
        const state = build({
            cards: [{ name: DREADNOUGHT, owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            libraryCount: 20,
        });
        expect(() =>
            applyBladeSetup(state, {
                label: "t",
                setup: [{ kind: "etb-trigger", card: DREADNOUGHT }],
            })
        ).toThrow(BladeSetupError);
        expect(state.stack).toHaveLength(0);
    });

    it("THROWS when the named permanent has no enters-the-battlefield trigger", () => {
        // A Grizzly Bears enters and nothing happens. The step cannot be
        // satisfied by the engine, so it fails loudly instead of leaving the
        // search on a position with an empty stack.
        const state = build({
            cards: [
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            libraryCount: 20,
        });
        expect(() =>
            applyBladeSetup(state, {
                label: "t",
                setup: [{ kind: "etb-trigger", card: "Grizzly Bears" }],
            })
        ).toThrow(/put no triggered ability on the stack/);
    });

    it("THROWS on an ambiguous name rather than picking one", () => {
        const state = build({
            cards: [
                {
                    name: DREADNOUGHT,
                    owner: "me",
                    zone: "battlefield",
                    count: 2,
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            libraryCount: 20,
        });
        expect(() =>
            applyBladeSetup(state, {
                label: "t",
                setup: [{ kind: "etb-trigger", card: DREADNOUGHT }],
            })
        ).toThrow(/ambiguous/);
    });

    it("`controller` narrows the match to one seat", () => {
        const state = build({
            cards: [
                {
                    name: DREADNOUGHT,
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: DREADNOUGHT,
                    owner: "opp",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            libraryCount: 20,
        });
        applyBladeSetup(state, {
            label: "t",
            setup: [
                { kind: "etb-trigger", card: DREADNOUGHT, controller: "opp" },
            ],
        });
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].controllerId).toBe(state.players[1].id);
    });
});

describe("blade setup — `resolve-top` runs the real resolution path", () => {
    it("resolves the trigger, leaving the CR 118 punisher choice live", () => {
        const state = build({
            cards: [
                {
                    name: DREADNOUGHT,
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            libraryCount: 20,
        });
        applyBladeSetup(state, {
            label: "t",
            setup: [
                { kind: "etb-trigger", card: DREADNOUGHT },
                { kind: "resolve-top" },
            ],
        });
        // The decision the trigger creates: the may-pay choice node the search
        // must traverse (issue #1425). Reached by running the engine, not by
        // constructing a `pendingChoices` entry.
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        // Real engine behaviour, and the reason `resolve-top` does not assert
        // an emptied stack: a resolution that raises a pending choice SUSPENDS
        // with its item still on the stack and finishes when the choice is
        // submitted (CR 608.2 / ADR 0037).
        expect(state.stack).toHaveLength(1);
    });

    it("THROWS on an empty stack", () => {
        const state = build({
            cards: [{ name: "Grizzly Bears", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            libraryCount: 20,
        });
        expect(() =>
            applyBladeSetup(state, {
                label: "t",
                setup: [{ kind: "resolve-top" }],
            })
        ).toThrow(BladeSetupError);
    });
});

describe("blade setup — wired into the build pipeline", () => {
    it("the charter entry's built state has its trigger on the stack", () => {
        const scenario = findBladeScenario(CHARTER)!;
        expect(scenario).toBeDefined();
        const state = buildBladeState(scenario);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "phyrexian-dreadnought-etb-sacrifice"
        );
        // Stifle is castable in response: the {U} is on an untapped Island.
        expect(state.players[0].battlefield.some((c) => !c.isTapped)).toBe(
            true
        );
    });

    it("a scenario with no `setup` is untouched", () => {
        const state = build({
            cards: [{ name: "Forest", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            libraryCount: 20,
        });
        const before = JSON.stringify(state);
        applyBladeSetup(state, { label: "t" });
        expect(JSON.stringify(state)).toBe(before);
    });
});
