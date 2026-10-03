import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
    bladeDeckKnowledge,
    buildBladeState,
    seatPlayerId,
    BLADE_SCENARIOS,
    type BladeScenario,
} from "../ai/blade";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cloneGameState } from "../clone";
import { enumerateMoves, onlyPassIsLegal, type Move } from "../moves";
import { makeRng } from "../rng";
import {
    advanceToDecision,
    applyMoveInSearch,
    moveKey,
    searchWithTrace,
} from "../search";
import type { GameState } from "../state";

/**
 * Forced-pass fast path (issue #4460, PRD #4454) — the contract is
 * BYTE-IDENTICAL decisions: the fast path removes work, never a draw and never
 * a state change.
 *
 * No `vi.mock` here: the bot suite runs `isolate: false`, so a module mock is
 * only as good as the import order of the files sharing the worker. The SBA
 * check is observed through a CANARY instead — a life total set to 0 by hand,
 * which only a check turns into a finished game — and the search's draw count
 * is pinned by the cost fixture (`searchCost.bot.test.ts`, `searchDraws`),
 * which counts through namespace spies, not module mocks.
 */

const ITERATIONS = 100;
const SEED = 0xb1ade;

type Fixture = {
    name: string;
    /** Label prefix of the blade entry — unique, resolved below. */
    labelPrefix: string;
    /** Recorded on the tree BEFORE the fast path existed (base 6a9791267). */
    expected: {
        chosen: string;
        gameRngCounter: number;
        /** sha256 (first 16 hex) over `key:visits:meanReward` of every root
         *  candidate, most-visited first — the whole root table, unrounded. */
        rootDigest: string;
    };
};

// The three positions of the cost fixture (`searchCost.bot.test.ts`, issue
// #4458): a small board, a medium one and the widest root in the `must` tier.
const FIXTURES: Fixture[] = [
    {
        name: "small (4 moves)",
        labelPrefix: "adventure: casts Stomp to kill the blocker",
        expected: {
            chosen: "cast Bonecrusher Giant [adventure:ff984a4c-1818-4f8f-a9d7-fce57e77937d] → Grizzly Bears",
            gameRngCounter: 118,
            rootDigest: "50b1e14640cf8208",
        },
    },
    {
        name: "medium (13 moves)",
        labelPrefix: "depletion land: spends the last charge because it",
        expected: {
            chosen: "cast Fireball (X=3) → Blade P2",
            gameRngCounter: 118,
            rootDigest: "26b3c054411a2137",
        },
    },
    {
        name: "large (49 moves)",
        labelPrefix: "redirection shield: shields ITS OWN side and point",
        expected: {
            chosen: "cast Captain's Maneuver (X=1) → Blade P1, Craw Wurm",
            gameRngCounter: 118,
            rootDigest: "95ef84b1820deaad",
        },
    },
];

function scenarioFor(prefix: string): BladeScenario {
    const found = BLADE_SCENARIOS.filter((s) => s.label.startsWith(prefix));
    expect(found).toHaveLength(1);
    return found[0];
}

describe("forced-pass fast path: decisions are byte-identical (issue #4460)", () => {
    for (const fixture of FIXTURES) {
        it(`${fixture.name}: same move, same game RNG counter, same root statistics`, () => {
            const scenario = scenarioFor(fixture.labelPrefix);
            const state = buildBladeState(scenario);
            const botId = seatPlayerId(state, scenario.bot);
            const deckKnowledge = bladeDeckKnowledge(state, scenario);

            const { trace } = searchWithTrace(
                state,
                botId,
                { iterations: ITERATIONS },
                SEED,
                deckKnowledge
            );

            const actual = {
                chosen: trace?.chosen ?? "",
                // The search never touches the caller's state (it clones), and
                // the GAME's stream is not the search's to advance.
                gameRngCounter: state.rngCounter,
                rootDigest: createHash("sha256")
                    .update(
                        (trace?.candidates ?? [])
                            .map(
                                (c) =>
                                    `${moveKey(c.move)}:${c.visits}:${c.meanReward}`
                            )
                            .join("\n")
                    )
                    .digest("hex")
                    .slice(0, 16),
            };
            expect(actual).toEqual(fixture.expected);
        });
    }
});

const PASS: Move = { kind: "pass" };

function fixtureRoot(fixture: Fixture): { state: GameState; botId: string } {
    const scenario = scenarioFor(fixture.labelPrefix);
    const state = buildBladeState(scenario);
    return { state, botId: seatPlayerId(state, scenario.bot) };
}

/** The small fixture, two passes in: the phase has advanced, the world is
 *  SETTLED by that pass's own check, the stack is empty and the pass count is
 *  back to 0 — the next pass is a pure hand-off. */
function settledAtHandOff(): GameState {
    const { state, botId } = fixtureRoot(FIXTURES[0]);
    const world = cloneGameState(state);
    applyMoveInSearch(world, botId, PASS);
    applyMoveInSearch(world, world.priorityPlayerId, PASS);
    expect(world.passCount).toBe(0);
    expect(world.stack).toHaveLength(0);
    expect(world.gameOver).toBeFalsy();
    return world;
}

/** Set a life total to 0 BY HAND — the edit a vouching caller promises never
 *  to make. Only an SBA check ends the game over it (CR 704.5a), so
 *  `gameOver` after a pass says whether the check ran. */
function plantCanary(world: GameState): void {
    world.players[0].life = 0;
}

describe("forced-pass fast path: the SBA skip covers the hand-off branch only (CR 704.3)", () => {
    it("a vouched hand-off on a settled world skips the check, and moves priority and the pass count only", () => {
        const world = settledAtHandOff();
        const holder = world.priorityPlayerId;
        plantCanary(world);
        const before = cloneGameState(world);

        applyMoveInSearch(world, holder, PASS, true);

        expect(world.gameOver).toBeFalsy();
        expect(world.passCount).toBe(1);
        expect(world.priorityPlayerId).not.toBe(holder);
        expect({
            ...world,
            passCount: before.passCount,
            priorityPlayerId: before.priorityPlayerId,
        }).toEqual(before);
    });

    it("the same hand-off WITHOUT the caller's word checks: a settled mark alone is never trusted", () => {
        const world = settledAtHandOff();
        plantCanary(world);

        applyMoveInSearch(world, world.priorityPlayerId, PASS);

        expect(world.gameOver).toBeTruthy();
    });

    it("a vouched hand-off on a world this module never settled (a fresh clone) checks", () => {
        const world = settledAtHandOff();
        plantCanary(world);
        const fresh = cloneGameState(world);

        applyMoveInSearch(fresh, fresh.priorityPlayerId, PASS, true);

        expect(fresh.gameOver).toBeTruthy();
    });

    it("the vouched pass that ends the round (phase advance) still checks", () => {
        const world = settledAtHandOff();
        applyMoveInSearch(world, world.priorityPlayerId, PASS, true);
        expect(world.passCount).toBe(1);
        plantCanary(world);

        applyMoveInSearch(world, world.priorityPlayerId, PASS, true);

        expect(world.gameOver).toBeTruthy();
    });

    it("the vouched pass that resolves the stack still checks", () => {
        const { state, botId } = fixtureRoot(FIXTURES[0]);
        const world = cloneGameState(state);
        const opponent = world.players.find((p) => p.id !== botId)!;
        // The fixture's burn-the-face line: Stomp at the opponent.
        const stomp = enumerateMoves(world, botId).find(
            (m) =>
                m.kind === "cast-spell" &&
                m.targets[0]?.type === "player" &&
                m.targets[0].id === opponent.id
        )!;
        applyMoveInSearch(world, botId, stomp, true);
        expect(world.stack).toHaveLength(1);

        // The cast auto-passes for the caster, so the world is SETTLED and one
        // pass short of resolving: the opponent's pass is the second of the
        // round. At 2 life, Stomp's 2 damage ends the game — but only once the
        // check after the resolution runs (CR 704.5a).
        expect(world.passCount).toBe(1);
        opponent.life = 2;
        const responder = advanceToDecision(world)!;
        expect(responder).toBe(opponent.id);
        applyMoveInSearch(world, responder, PASS, true);

        expect(world.stack).toHaveLength(0);
        expect(opponent.life).toBe(0);
        expect(world.gameOver).toBeTruthy();
    });
});

describe("forced-pass fast path: lockstep against the unconditional path", () => {
    const PLAYOUTS = 12;
    const MAX_PLIES = 80;

    for (const fixture of FIXTURES) {
        it(`${fixture.name}: fast and plain worlds are equal at every ply, and the probe never contradicts the enumerator`, () => {
            const { state } = fixtureRoot(fixture);
            let handOffs = 0;
            let probed = 0;
            let passOnly = 0;

            for (let playout = 0; playout < PLAYOUTS; playout++) {
                const rng = makeRng(SEED + playout);
                const fast = cloneGameState(state);
                const plain = cloneGameState(state);
                for (let ply = 0; ply < MAX_PLIES; ply++) {
                    const pid = advanceToDecision(fast);
                    expect(advanceToDecision(plain)).toBe(pid);
                    if (!pid) break;
                    const moves = enumerateMoves(fast, pid);
                    if (moves.length === 0) break;

                    const forced =
                        moves.length === 1 && moves[0].kind === "pass";
                    if (forced) passOnly++;
                    if (onlyPassIsLegal(fast, pid)) {
                        probed++;
                        expect(moves).toEqual([PASS]);
                    }

                    const move = moves[Math.floor(rng() * moves.length)];
                    // A first pass of a round after the playout's first ply:
                    // the branch the fast world skips its check on.
                    if (
                        move.kind === "pass" &&
                        fast.passCount === 0 &&
                        ply > 0
                    ) {
                        handOffs++;
                    }
                    applyMoveInSearch(fast, pid, move, true);
                    applyMoveInSearch(plain, pid, move);
                    expect(fast).toEqual(plain);
                }
            }

            // Not vacuous: hand-offs were played, and the probe proved passes.
            expect(handOffs).toBeGreaterThan(0);
            expect(passOnly).toBeGreaterThan(0);
            expect(probed).toBeGreaterThan(0);
        });
    }
});

describe("onlyPassIsLegal names every move source of the priority window", () => {
    it("the ordinary window of `enumerateMoves` has the fifteen `moves.push` sites the probe was written against", () => {
        const source = readFileSync(
            fileURLToPath(new URL("../moves.ts", import.meta.url)),
            "utf8"
        );
        const start = source.indexOf(
            'const moves: Move[] = [{ kind: "pass" }];'
        );
        const end = source.indexOf("const candidates = collapsed(moves);");
        expect(start).toBeGreaterThan(0);
        expect(end).toBeGreaterThan(start);
        // A new site is a new way to act with priority: teach
        // `onlyPassIsLegal` (gre/moves.ts) to rule it out, then move this.
        expect(source.slice(start, end).split("moves.push(").length - 1).toBe(
            15
        );
    });
});
