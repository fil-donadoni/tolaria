/**
 * Blade-scenario harness — matcher + runner unit tests (issue #1427).
 *
 * A `.test.ts` on purpose: the blade SUITE (`*.spec.ts`) is excluded from
 * `bun run test` because it runs real ISMCTS searches, but the harness's own
 * logic — partial-match semantics, name→instance resolution across every
 * zone INCLUDING the stack, the loud failure on an unresolvable name, and the
 * `forbidden` / `predicate` / multi-seed branches of the runner — is ordinary
 * pure logic and belongs in the fast suite. Without this file none of it is
 * covered by the mandatory gate at all.
 *
 * Shape follows `convex/gre/__tests__/scenarioBuilder.test.ts` (issue #1424).
 */

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../../cards/__tests__/setup";
import type { TargetSelection } from "../../../../cards/types";
import { counterspell } from "../../../../cards/sets/lea/blue";
import { lightningBolt } from "../../../../cards/sets/lea/red";
import { grizzlyBears } from "../../../../cards/sets/lea/green";
import { forest, mountain } from "../../../../cards/sets/lea/colorless";
import type { GameState } from "../../../state";
import type { Move } from "../../../moves";
import {
    describeChosenMove,
    instanceIdsForName,
    matchesMove,
    seatPlayerId,
} from "../matcher";
import { BladeDeciderError, runBladeScenario } from "../runner";
import {
    getSearchVariant,
    LADDER_VARIANTS,
    setSearchVariant,
} from "../../searchVariant";
import type { BladeScenario } from "../types";

// ────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────

/** p1 holds a Bolt in hand; p2 has a Grizzly Bears on the battlefield. */
function boltVsBearsState(): {
    state: GameState;
    boltId: string;
    bearsId: string;
} {
    const bolt = makeInstance(lightningBolt.id, {
        id: "bolt-1",
        controllerId: "p1",
        zone: "hand",
    });
    const bears = makeInstance(grizzlyBears.id, {
        id: "bears-1",
        controllerId: "p2",
        zone: "battlefield",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { hand: [bolt] }),
            makePlayer("p2", { battlefield: [bears] }),
        ],
    });
    return { state, boltId: bolt.id, bearsId: bears.id };
}

function castSpell(
    cardInstanceId: string,
    targets: TargetSelection[] = []
): Move {
    return {
        kind: "cast-spell",
        cardInstanceId,
        targets,
        confirmTargets: false,
        tapPlan: [],
    };
}

// ────────────────────────────────────────────────────────────────────────

describe("matchesMove — partial-match semantics (issue #1427)", () => {
    it("compares only the fields the matcher declares", () => {
        const { state, boltId, bearsId } = boltVsBearsState();
        const move = castSpell(boltId, [{ type: "permanent", id: bearsId }]);

        // kind only — matches regardless of card and targets.
        expect(matchesMove(state, move, { kind: "cast-spell" })).toBe(true);
        // kind + card.
        expect(
            matchesMove(state, move, {
                kind: "cast-spell",
                card: lightningBolt.name,
            })
        ).toBe(true);
        // kind + target.
        expect(
            matchesMove(state, move, {
                kind: "cast-spell",
                target: grizzlyBears.name,
            })
        ).toBe(true);
    });

    it("rejects on a declared field that disagrees", () => {
        const { state, boltId, bearsId } = boltVsBearsState();
        const move = castSpell(boltId, [{ type: "permanent", id: bearsId }]);

        // kind mismatch.
        expect(matchesMove(state, move, { kind: "pass" })).toBe(false);
        // `card` names a card that EXISTS in the state but is not the acting
        // card — a real non-match, not the unresolvable-name throw.
        expect(
            matchesMove(state, move, {
                kind: "cast-spell",
                card: grizzlyBears.name,
            })
        ).toBe(false);
        // `target` names an existing card that is not among the targets.
        expect(
            matchesMove(state, move, {
                kind: "cast-spell",
                target: lightningBolt.name,
            })
        ).toBe(false);
    });

    it("never matches a null move", () => {
        const { state } = boltVsBearsState();
        expect(matchesMove(state, null, { kind: "pass" })).toBe(false);
    });

    it("resolves `me` / `opp` to the seat player ids", () => {
        const { state, boltId } = boltVsBearsState();
        const move = castSpell(boltId, [
            { type: "player", id: seatPlayerId(state, "opp") },
        ]);
        expect(
            matchesMove(state, move, { kind: "cast-spell", target: "opp" })
        ).toBe(true);
        expect(
            matchesMove(state, move, { kind: "cast-spell", target: "me" })
        ).toBe(false);
    });

    it("`cards` demands every name, `accept` compares the yes/no payload", () => {
        const bearA = makeInstance(grizzlyBears.id, {
            id: "bear-a",
            controllerId: "p1",
        });
        const boltOnBattlefield = makeInstance(lightningBolt.id, {
            id: "bolt-bf",
            controllerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bearA, boltOnBattlefield] }),
                makePlayer("p2"),
            ],
        });

        const attack: Move = {
            kind: "declare-attackers",
            attackerIds: [bearA.id],
        };
        expect(
            matchesMove(state, attack, {
                kind: "declare-attackers",
                cards: [grizzlyBears.name],
            })
        ).toBe(true);
        // Bolt is on the battlefield (so the name resolves) but is not an
        // attacker — every name in `cards` must appear.
        expect(
            matchesMove(state, attack, {
                kind: "declare-attackers",
                cards: [grizzlyBears.name, lightningBolt.name],
            })
        ).toBe(false);

        const mayPay: Move = { kind: "may-pay", accept: true };
        expect(
            matchesMove(state, mayPay, { kind: "may-pay", accept: true })
        ).toBe(true);
        expect(
            matchesMove(state, mayPay, { kind: "may-pay", accept: false })
        ).toBe(false);
        // `accept` is undefined for a move kind that carries no boolean.
        expect(
            matchesMove(state, attack, {
                kind: "declare-attackers",
                accept: true,
            })
        ).toBe(false);
    });

    it("`option` (issue #2306) matches a resolution-choice by its submitted OPTION id, never a card name", () => {
        const { state } = boltVsBearsState();
        const move: Move = {
            kind: "resolution-choice",
            stackItemId: "stack-1",
            step: 0,
            choiceId: "optionChoiceMode",
            cardInstanceIds: ["protection-blue"],
        };
        expect(
            matchesMove(state, move, {
                kind: "resolution-choice",
                option: "protection-blue",
            })
        ).toBe(true);
        expect(
            matchesMove(state, move, {
                kind: "resolution-choice",
                option: "protection-red",
            })
        ).toBe(false);
        // Wrong move kind: `option` never resolves a card name, so a
        // non-resolution-choice move rejects on kind alone, not on a throw.
        const pass: Move = { kind: "pass" };
        expect(
            matchesMove(state, pass, {
                kind: "resolution-choice",
                option: "protection-blue",
            })
        ).toBe(false);
    });
});

describe("matchesMove — stack-resident names (finding 1, issue #1427)", () => {
    /** p1 holds a Counterspell; p2's Lightning Bolt is ON THE STACK. This is
     *  the archetypal blade position: responding to a spell. */
    function counterspellState(): {
        state: GameState;
        counterId: string;
        stackBoltId: string;
    } {
        const counter = makeInstance(counterspell.id, {
            id: "counter-1",
            controllerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [counter] }), makePlayer("p2")],
        });
        const boltOnStack = pushSpell(state, lightningBolt.id, "p2");
        return { state, counterId: counter.id, stackBoltId: boltOnStack.id };
    }

    it("resolves a card name to its instance on the stack", () => {
        const { state, stackBoltId } = counterspellState();
        expect([...instanceIdsForName(state, lightningBolt.name)]).toEqual([
            stackBoltId,
        ]);
    });

    it("matches a counterspell targeting the stack spell", () => {
        const { state, counterId, stackBoltId } = counterspellState();
        const move = castSpell(counterId, [{ type: "spell", id: stackBoltId }]);
        expect(
            matchesMove(state, move, {
                kind: "cast-spell",
                card: counterspell.name,
                target: lightningBolt.name,
            })
        ).toBe(true);
    });

    it("describes a stack-resident target by NAME, not by raw id", () => {
        const { state, counterId, stackBoltId } = counterspellState();
        const move = castSpell(counterId, [{ type: "spell", id: stackBoltId }]);
        const described = describeChosenMove(state, move);
        expect(described).toContain(`cards=[${counterspell.name}]`);
        expect(described).toContain(`targets=[${lightningBolt.name}]`);
        expect(described).not.toContain(stackBoltId);
    });

    it("describes player targets as `me` / `opp` and a null move explicitly", () => {
        const { state, counterId } = counterspellState();
        const move = castSpell(counterId, [
            { type: "player", id: seatPlayerId(state, "opp") },
        ]);
        expect(describeChosenMove(state, move)).toContain("targets=[opp]");
        expect(describeChosenMove(state, null)).toBe("<no move>");
    });
});

describe("instanceIdsForName — unresolvable names fail loudly (finding 2, issue #1427)", () => {
    it("throws when a REAL card has zero instances in the built state", () => {
        const { state } = boltVsBearsState();
        expect(() => instanceIdsForName(state, mountain.name)).toThrow(
            /no instance of it exists/i
        );
    });

    it("throws when the name is not a card at all", () => {
        const { state } = boltVsBearsState();
        expect(() =>
            instanceIdsForName(state, "Definitely Not A Card")
        ).toThrow();
    });

    it("a `forbidden`-style matcher on an absent card can no longer pass vacuously", () => {
        const { state, boltId } = boltVsBearsState();
        // Pre-fix this returned `false` (= "not forbidden" = a green test that
        // asserted nothing). It must now be a hard error — and it must be one
        // whether or not the chosen move's kind happens to line up, otherwise
        // the bug hides behind whatever the bot picked that run.
        expect(() =>
            matchesMove(state, castSpell(boltId, []), {
                kind: "play-land",
                card: mountain.name,
            })
        ).toThrow(/no instance of it exists/i);
        expect(() =>
            matchesMove(
                state,
                { kind: "play-land", cardInstanceId: boltId },
                {
                    kind: "play-land",
                    card: mountain.name,
                }
            )
        ).toThrow(/no instance of it exists/i);
        // Even a null move (nothing owed) surfaces the authoring bug.
        expect(() =>
            matchesMove(state, null, {
                kind: "play-land",
                card: mountain.name,
            })
        ).toThrow(/no instance of it exists/i);
    });

    it("throws for an absent name used as a `target`", () => {
        const { state, boltId, bearsId } = boltVsBearsState();
        const move = castSpell(boltId, [{ type: "permanent", id: bearsId }]);
        expect(() =>
            matchesMove(state, move, {
                kind: "cast-spell",
                target: mountain.name,
            })
        ).toThrow(/no instance of it exists/i);
    });
});

// ────────────────────────────────────────────────────────────────────────
// Runner — expectation branches and multi-seed aggregation. The budget is
// deliberately tiny: these tests assert the HARNESS's bookkeeping, not the
// bot's playing strength (that is the blade suite's job).
// ────────────────────────────────────────────────────────────────────────

const LAND_SPEC: BladeScenario["spec"] = {
    cards: [{ name: forest.name, owner: "me", zone: "hand" }],
    phase: "PRECOMBAT_MAIN",
    turn: 3,
    libraryCount: 20,
};

function landScenario(
    expectation: BladeScenario["expect"],
    seeds?: number[]
): BladeScenario {
    return {
        label: "unit: land drop",
        spec: LAND_SPEC,
        bot: "me",
        budget: { iterations: 20 },
        seeds,
        tier: "must",
        expect: expectation,
    };
}

// In this position the bot's only two legal moves are `play-land Forest` and
// `pass`, so an expectation naming BOTH is satisfied whatever it picks, and
// one naming neither always fails. Every runner test below is written that
// way on purpose: it asserts the runner's bookkeeping and never doubles as a
// (duplicated, fast-suite) bet on the bot's playing strength.
const ANY_LEGAL: { kind: Move["kind"]; card?: string }[] = [
    { kind: "play-land", card: forest.name },
    { kind: "pass" },
];

describe("runBladeScenario — expectation branches (issue #1427)", () => {
    it("`forbidden` passes when the chosen move matches none of the matchers", () => {
        const result = runBladeScenario(
            landScenario({ forbidden: [{ kind: "declare-attackers" }] })
        );
        expect(result.ok).toBe(true);
        expect(result.failureMessage).toBe("");
    });

    it("`forbidden` fails, and names the matcher that bit, when it matches", () => {
        const result = runBladeScenario(landScenario({ forbidden: ANY_LEGAL }));
        expect(result.ok).toBe(false);
        expect(result.failureMessage).toContain("forbidden by");
        // The rendering is in the matcher's own vocabulary, not raw ids.
        expect(result.failureMessage).toMatch(/play-land card=Forest|pass/);
    });

    it("`moves` passes when the chosen move matches at least one matcher", () => {
        const result = runBladeScenario(landScenario({ moves: ANY_LEGAL }));
        expect(result.ok).toBe(true);
        expect(result.failureMessage).toBe("");
    });

    it("`predicate` passes / fails on the closure, and prints `describe` on failure", () => {
        const pass = runBladeScenario(
            landScenario({
                predicate: (move) => move !== null,
                describe: "chooses some move",
            })
        );
        expect(pass.ok).toBe(true);

        const fail = runBladeScenario(
            landScenario({
                predicate: (move, state) =>
                    move?.kind === "declare-blockers" && state.turn === 3,
                describe: "blocks something",
            })
        );
        expect(fail.ok).toBe(false);
        expect(fail.failureMessage).toContain("blocks something");
    });

    it("`moves` reports the actual move alongside the wanted matchers on failure", () => {
        const result = runBladeScenario(
            landScenario({ moves: [{ kind: "declare-attackers" }] })
        );
        expect(result.ok).toBe(false);
        expect(result.failureMessage).toContain("expected one of");
        expect(result.failureMessage).toContain("declare-attackers");
    });
});

describe("runBladeScenario — seeds (issue #1427)", () => {
    it("runs every declared seed and reports one result per seed", () => {
        const result = runBladeScenario(
            landScenario({ moves: ANY_LEGAL }, [1, 2, 3])
        );
        expect(result.seeds.map((s) => s.seed)).toEqual([1, 2, 3]);
        expect(result.seeds.every((s) => s.ok)).toBe(true);
        expect(result.ok).toBe(true);
    });

    it("fails the scenario when ANY seed fails, and lists each failing seed", () => {
        const result = runBladeScenario(
            landScenario({ moves: [{ kind: "declare-attackers" }] }, [7, 8])
        );
        expect(result.ok).toBe(false);
        expect(result.seeds.every((s) => !s.ok)).toBe(true);
        expect(result.failureMessage).toContain("seed 7:");
        expect(result.failureMessage).toContain("seed 8:");
    });

    it("rejects an empty seed list and a non-positive budget", () => {
        expect(() =>
            runBladeScenario(landScenario({ moves: [{ kind: "pass" }] }, []))
        ).toThrow(/empty seed list/i);
        expect(() =>
            runBladeScenario({
                ...landScenario({ moves: [{ kind: "pass" }] }),
                budget: { iterations: 0 },
            })
        ).toThrow(/positive iterations/i);
    });

    it("propagates the unresolvable-name error out of the runner (finding 2)", () => {
        // The exact demonstration from review: a `forbidden` entry naming a
        // card no spec placed used to PASS. It must now blow up.
        expect(() =>
            runBladeScenario(
                landScenario({
                    forbidden: [{ kind: "play-land", card: mountain.name }],
                })
            )
        ).toThrow(/no instance of it exists/i);
    });
});

describe("runBladeScenario — decider authoring check (issue #1522)", () => {
    // LAND_SPEC is "me"'s own main phase with priority: only "me" owes a
    // decision (play the Forest, or pass). Declaring `bot: "opp"` is an
    // authoring mistake the runner used to mask — `searchWithTrace` for a
    // seat that owes nothing just returns `move: null`, which then failed
    // the entry as "chose [no move]" against whatever `expect` demanded,
    // rather than surfacing the real bug (the entry names the wrong seat).
    it("throws BladeDeciderError when the declared bot does not hold the decision", () => {
        const misauthored: BladeScenario = {
            ...landScenario({ moves: [{ kind: "pass" }] }),
            bot: "opp",
        };
        expect(() => runBladeScenario(misauthored)).toThrow(BladeDeciderError);
        expect(() => runBladeScenario(misauthored)).toThrow(
            /declares bot "opp".*decision belongs to "me"/s
        );
    });

    it("does not throw when the declared bot does hold the decision", () => {
        expect(() =>
            runBladeScenario(landScenario({ moves: ANY_LEGAL }))
        ).not.toThrow();
    });
});

describe("runBladeScenario — search-variant leg (issue #2684)", () => {
    // Until #2684 the runner ran unconditionally under production defaults, so
    // "all `must` entries green with the variant ON" — an acceptance criterion
    // of every ladder experiment — could not be answered without editing the
    // runner. These tests pin the plumbing itself: that the variant is really
    // INSTALLED for the duration of the scenario, and that the previous one is
    // restored afterwards.
    const observed: (string | null)[] = [];
    const observingScenario = (): BladeScenario =>
        landScenario(
            {
                // Runs INSIDE the runner, so it observes the module state the
                // search itself saw.
                predicate: () => {
                    observed.push(getSearchVariant()?.name ?? null);
                    return true;
                },
                describe: "records the installed variant",
            },
            [1]
        );

    it("installs the passed variant for the duration of the scenario", () => {
        observed.length = 0;
        const result = runBladeScenario(
            observingScenario(),
            LADDER_VARIANTS["action-priors"]
        );
        expect(result.ok).toBe(true);
        expect(observed).toEqual(["action-priors"]);
    });

    it("leaves the module state untouched when no variant is passed", () => {
        observed.length = 0;
        const result = runBladeScenario(observingScenario());
        expect(result.ok).toBe(true);
        expect(observed).toEqual([null]);
    });

    it("restores the PREVIOUS variant, never clearing an outer install", () => {
        const outer = LADDER_VARIANTS["placebo"];
        setSearchVariant(outer);
        try {
            observed.length = 0;
            runBladeScenario(
                observingScenario(),
                LADDER_VARIANTS["action-priors"]
            );
            expect(observed).toEqual(["action-priors"]);
            expect(getSearchVariant()).toBe(outer);
        } finally {
            setSearchVariant(null);
        }
    });
});
