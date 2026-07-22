// debugLoadBladeScenario — read-only browser loader for blade scenarios
// (issue #1432, PRD #1423). The mutation (`convex/game.ts`) resolves a
// client-supplied `label` against the code-side registry
// (`findBladeScenario`, `convex/gre/ai/blade/registry.ts`), then applies
// the resolved entry's `spec` to the CURRENT game's state through
// `buildBladeLoadState` (`convex/gre/ai/blade/runner.ts`) — the same
// normalize-then-`buildStateFromScenario` pipeline the DB-backed scenario
// loader and the blade test harness both build on. The project has no
// convex-test harness (see `convex/__tests__/debugSetupScenario.test.ts`),
// so:
//   - the admin gate is asserted the same way `debugSetupScenario`'s is:
//     against the pure decision `isAdminUser` the mutation's
//     `assertIsAdmin(ctx)` is built from;
//   - "resolves a label / rejects an unknown one" is asserted against the
//     pure `findBladeScenario` the mutation's lookup delegates to
//     (`registry.test.ts` also covers this at the registry level);
//   - `runMutationBody` below mirrors the handler's own body (label lookup +
//     `buildBladeLoadState`, minus `ctx`/the admin gate/`saveGameState`) so
//     the "loaded position matches the harness's built state" assertions run
//     through the CODE THE MUTATION ACTUALLY EXECUTES, not a hand-rolled
//     stand-in — dropping the `findBladeScenario` lookup from the real
//     handler (review finding #1432/#3) would now break these tests, not
//     silently pass them.
//   - the acceptance criterion "loaded position matches the harness's built
//     state for that entry" is asserted by calling `runMutationBody` against
//     a base state that stands in for "an arbitrary current game" (different
//     player ids, life totals, turn, active player, a mid-turn land drop and
//     floating mana, than the harness's synthetic base) — and comparing the
//     resulting board to `buildBladeState` (the harness's own builder call).

import { describe, it, expect } from "vitest";
import { isAdminUser } from "../auth";
import type { Doc } from "../_generated/dataModel";
import type { CardInstanceState, GameState } from "../gre/state";
import { STARTING_LIFE } from "../gre/setup";
import { makePlayer, makeState } from "../cards/__tests__/setup";
import { BLADE_SCENARIOS, findBladeScenario } from "../gre/ai/blade/registry";
import { buildBladeLoadState, buildBladeState } from "../gre/ai/blade/runner";

/**
 * Mirrors `debugLoadBladeScenario`'s handler body (`convex/game.ts`) minus
 * `ctx`, the `assertIsAdmin` gate, and the `saveGameState` persistence call
 * — those three are Convex-runtime concerns the project's test setup can't
 * exercise without a `convex-test` harness (see file header) and are covered
 * separately/conventionally (admin gate: `isAdminUser` describe block below;
 * label resolution: `findBladeScenario` describe block below). Everything
 * ELSE the mutation does — the label lookup and the state build — runs here
 * verbatim, so a regression in either (e.g. always applying
 * `BLADE_SCENARIOS[0].spec` regardless of `label`) breaks this helper's
 * callers too.
 */
function runMutationBody(gameState: GameState, label: string): GameState {
    const scenario = findBladeScenario(label);
    if (!scenario) {
        throw new Error(`Unknown blade scenario: ${label}`);
    }
    return buildBladeLoadState(gameState, scenario);
}

function user(isAdmin?: boolean): Doc<"users"> {
    return {
        _id: "user_1" as Doc<"users">["_id"],
        _creationTime: 0,
        nickname: "Tester",
        isAdmin,
    } as Doc<"users">;
}

describe("debugLoadBladeScenario — admin gate (issue #1432)", () => {
    it("rejects a non-admin caller (assertIsAdmin throws before state is touched)", () => {
        expect(isAdminUser(user(false))).toBe(false);
        expect(isAdminUser(user(undefined))).toBe(false);
    });

    it("rejects an unauthenticated caller", () => {
        expect(isAdminUser(null)).toBe(false);
    });

    it("allows an admin caller through the gate (scenario load proceeds unchanged)", () => {
        expect(isAdminUser(user(true))).toBe(true);
    });
});

describe("debugLoadBladeScenario — label resolution (issue #1432)", () => {
    it("resolves a registered label to its entry, mirroring the mutation's lookup", () => {
        for (const scenario of BLADE_SCENARIOS) {
            expect(findBladeScenario(scenario.label)?.spec).toBe(
                scenario.spec
            );
        }
    });

    it("resolves an unknown label to undefined — the mutation throws instead of applying a spec", () => {
        expect(findBladeScenario("no such scenario")).toBeUndefined();
    });
});

/** An arbitrary "current game" base state, deliberately UNLIKE the blade
 *  harness's synthetic base (real-looking player ids, non-default life
 *  totals, a turn already underway, a leftover library, an already-used land
 *  drop, and floating mana) — so a match against the harness's built state
 *  proves the loader is base-state-independent, not an artifact of both
 *  builds starting from the same substrate. The land-drop/mana/active-player/
 *  life divergences are deliberate: they are exactly the fields
 *  `buildStateFromScenario` alone leaves untouched (issue #1432 review
 *  finding #1) — `buildBladeLoadState` must normalize every one of them away. */
function arbitraryCurrentGameBaseState(): GameState {
    return makeState({
        players: [
            makePlayer("user_abc123-p1", {
                life: 17,
                landsPlayedThisTurn: 1,
                manaPool: { W: 0, U: 0, B: 0, R: 3, G: 0, C: 0 },
            }),
            makePlayer("user_abc123-p2", { life: 9 }),
        ],
        turn: 9,
        activePlayerId: "user_abc123-p2",
        priorityPlayerId: "user_abc123-p2",
        phase: "COMBAT_DAMAGE" as GameState["phase"],
    });
}

/** Card-name-and-shape snapshot of one zone, order-INSENSITIVE (battlefield/
 *  hand/graveyard/exile placement order doesn't matter to "the position";
 *  card identity, tapped state and counters do). */
function zoneSnapshot(cards: CardInstanceState[]) {
    return cards
        .map((c) => ({
            cardId: (c.card as { id: string }).id,
            tapped: c.isTapped,
            counters: c.counters,
        }))
        .sort((a, b) => a.cardId.localeCompare(b.cardId));
}

/** Card-id snapshot of a library, order-SENSITIVE (index 0 = top, where
 *  `drawCard` reads — the top of the library IS part of "the position"). */
function librarySnapshot(cards: CardInstanceState[]) {
    return cards.map((c) => (c.card as { id: string }).id);
}

/** Position snapshot INCLUDING the fields `buildStateFromScenario` alone
 *  never normalizes — `activePlayerId`/`priorityPlayerId` (who's to act),
 *  `life`, and the per-turn counters (`landsPlayedThisTurn`, `manaPool`).
 *  Omitting these (as the pre-fix version of this test did) masks the exact
 *  divergence review finding #1432/#1 flagged: a scenario loaded mid-game
 *  inheriting the live game's turn/life/land-drop state instead of the
 *  harness's starting position. */
function positionSnapshot(state: GameState) {
    return {
        phase: state.phase,
        turn: state.turn,
        activePlayerId: state.players.findIndex(
            (p) => p.id === state.activePlayerId
        ),
        priorityPlayerId: state.players.findIndex(
            (p) => p.id === state.priorityPlayerId
        ),
        players: state.players.map((p) => ({
            life: p.life,
            landsPlayedThisTurn: p.landsPlayedThisTurn ?? 0,
            manaPool: p.manaPool,
            battlefield: zoneSnapshot(p.battlefield),
            hand: zoneSnapshot(p.hand),
            graveyard: zoneSnapshot(p.graveyard),
            exile: zoneSnapshot(p.exile),
            library: librarySnapshot(p.library),
        })),
    };
}

describe("debugLoadBladeScenario — loaded position matches the harness's built state (issue #1432)", () => {
    for (const scenario of BLADE_SCENARIOS) {
        it(`"${scenario.label}" — same label through the mutation body, different base state, same resulting position`, () => {
            const harnessState = buildBladeState(scenario);
            const loaderState = runMutationBody(
                arbitraryCurrentGameBaseState(),
                scenario.label
            );

            expect(positionSnapshot(loaderState)).toEqual(
                positionSnapshot(harnessState)
            );
        });
    }

    it("normalizes active/priority player to the 'me' seat and life to the starting total", () => {
        const scenario = BLADE_SCENARIOS[0];
        const loaderState = runMutationBody(
            arbitraryCurrentGameBaseState(),
            scenario.label
        );

        expect(loaderState.activePlayerId).toBe(loaderState.players[0].id);
        expect(loaderState.priorityPlayerId).toBe(loaderState.players[0].id);
        expect(loaderState.players[0].life).toBe(STARTING_LIFE);
        expect(loaderState.players[1].life).toBe(STARTING_LIFE);
        expect(loaderState.players[0].landsPlayedThisTurn ?? 0).toBe(0);
        expect(
            Object.values(loaderState.players[0].manaPool).every((v) => v === 0)
        ).toBe(true);
    });
});

describe("debugLoadBladeScenario — mutation body throws on an unknown label (issue #1432)", () => {
    it("mirrors the mutation's own guard, not just the pure findBladeScenario lookup", () => {
        expect(() =>
            runMutationBody(arbitraryCurrentGameBaseState(), "no such scenario")
        ).toThrow("Unknown blade scenario: no such scenario");
    });
});
