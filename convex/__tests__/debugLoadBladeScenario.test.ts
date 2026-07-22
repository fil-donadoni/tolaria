// debugLoadBladeScenario — read-only browser loader for blade scenarios
// (issue #1432, PRD #1423). The mutation (`convex/game.ts`) resolves a
// client-supplied `label` against the code-side registry and applies the
// resolved entry's `spec` to the CURRENT game's state, all through ONE pure
// function: `resolveBladeLoadState` (`convex/gre/ai/blade/runner.ts`). The
// handler is a thin wrapper around it (`ctx` / `assertIsAdmin` / DB
// fetch+persist only) — see that function's doc comment and the mutation's
// own comment in `convex/game.ts` for the shape.
//
// The project has no `convex-test` harness (see
// `convex/__tests__/debugSetupScenario.test.ts`), so the Convex-runtime
// slice of the handler (the `ctx` calls) genuinely cannot be driven from
// here and is covered by convention instead, not by exercising the mutation
// itself:
//   - the admin gate is asserted against the pure decision `isAdminUser`
//     the mutation's `assertIsAdmin(ctx)` is built from (describe block
//     below);
//   - `getLatestGameState`/`saveGameState` (DB fetch/persist) are exercised
//     nowhere in this file — they're generic plumbing shared by every
//     Convex mutation in `convex/game.ts`, not specific to this one.
//
// EVERYTHING ELSE — the `label` → scenario lookup and the state build — is
// NOT a Convex-runtime concern (`resolveBladeLoadState` takes a plain
// `GameState`, no `ctx`), so it needs no stand-in: this file imports and
// calls the exact function `convex/game.ts` calls. A regression in either
// half (e.g. the lookup always returning `BLADE_SCENARIOS[0]` regardless of
// `label`, or a dropped normalization field) breaks these tests directly,
// not a hand-rolled copy of them. The "mutation body throws on an unknown
// label" block near the bottom exercises that same guard through
// `resolveBladeLoadState` itself, on top of `registry.test.ts`'s coverage of
// `findBladeScenario` in isolation.

import { describe, it, expect } from "vitest";
import { isAdminUser } from "../auth";
import type { Doc } from "../_generated/dataModel";
import type { CardInstanceState, GameState } from "../gre/state";
import { STARTING_LIFE } from "../gre/setup";
import { makePlayer, makeState } from "../cards/__tests__/setup";
import { BLADE_SCENARIOS, findBladeScenario } from "../gre/ai/blade/registry";
import { buildBladeState, resolveBladeLoadState } from "../gre/ai/blade/runner";

/** Thin alias so the tests below read as "run the mutation's body" — this
 *  IS `resolveBladeLoadState`, the same function `convex/game.ts` imports
 *  and calls; not a copy. */
const runMutationBody = resolveBladeLoadState;

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
            expect(findBladeScenario(scenario.label)?.spec).toBe(scenario.spec);
        }
    });

    it("resolves an unknown label to undefined — the mutation throws instead of applying a spec", () => {
        expect(findBladeScenario("no such scenario")).toBeUndefined();
    });
});

/** An arbitrary "current game" base state, deliberately UNLIKE the blade
 *  harness's synthetic base (real-looking player ids, non-default life
 *  totals, a turn already underway, a leftover library, an already-used land
 *  drop, floating mana, and every other turn-/game-scoped field a real match
 *  can accumulate) — so a match against the harness's built state proves the
 *  loader is base-state-independent, not an artifact of both builds starting
 *  from the same substrate. Every divergent field here is deliberate: they
 *  are exactly the fields `buildStateFromScenario` alone leaves untouched
 *  (issue #1432 review finding #1), PLUS the fields review round 2's
 *  finding #2 found still leaking through a hand-picked 4-field list —
 *  `restrictedMana` (CR 500.4/106.6, `manaPool`'s sibling), per-player and
 *  global `spellsCastThisTurn` (Storm, ADR 0052), `poisonCounters`
 *  (CR 122.1 — 10+ is an instant SBA loss, CR 704.5c), `energyCounters`
 *  (ADR 0032), `skipNextTurn` (CR 614.10), `hasDrawnFromEmpty` (CR 704.5b),
 *  `permanentYouControlledLeftThisTurn` (Revolt, CR 702.RV),
 *  `drawnThisTurn`/`lastDrawnCardId`, and `turnsTaken` (CR 500.1).
 *  `resolveBladeLoadState` must normalize every one of them away. */
function arbitraryCurrentGameBaseState(): GameState {
    return makeState({
        players: [
            makePlayer("user_abc123-p1", {
                life: 17,
                landsPlayedThisTurn: 1,
                manaPool: { W: 0, U: 0, B: 0, R: 3, G: 0, C: 0 },
                restrictedMana: [{ color: "R", amount: 2 }],
                spellsCastThisTurn: 2,
                poisonCounters: 6,
                energyCounters: 4,
                skipNextTurn: true,
                hasDrawnFromEmpty: true,
                permanentYouControlledLeftThisTurn: true,
                drawnThisTurn: ["stale-drawn-card"],
                lastDrawnCardId: "stale-last-drawn",
                turnsTaken: 12,
            }),
            makePlayer("user_abc123-p2", {
                life: 9,
                poisonCounters: 3,
                energyCounters: 1,
                turnsTaken: 11,
            }),
        ],
        turn: 9,
        activePlayerId: "user_abc123-p2",
        priorityPlayerId: "user_abc123-p2",
        phase: "COMBAT_DAMAGE" as GameState["phase"],
        spellsCastThisTurn: 5,
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

/** Position snapshot INCLUDING every field `buildStateFromScenario` alone
 *  never normalizes — `activePlayerId`/`priorityPlayerId` (who's to act),
 *  `life`, and the turn-/game-scoped field set review round 2's finding #2
 *  named (see `arbitraryCurrentGameBaseState`'s doc comment for the CR
 *  references). Omitting any of these (as an earlier version of this test
 *  did) masks the exact class of divergence the review flagged: a scenario
 *  loaded mid-game inheriting the live game's counters instead of the
 *  harness's fresh starting position.
 *
 *  Deliberately EXCLUDES `drawnThisTurn`/`lastDrawnCardId`: `buildBladeState`
 *  itself goes through `createInitialGameState`'s opening-hand `drawCard`
 *  calls (7 draws per player, `gre/setup.ts`), which stamps these two with
 *  the drawn ids as a SIDE EFFECT of dealing the synthetic base's mulligan
 *  hand — the harness's own "fresh" state is not empty here, so it isn't a
 *  target the loader should reproduce (the loader correctly clears them to
 *  match the CR-correct "nothing drawn yet this turn" starting position
 *  instead — asserted directly in the "normalizes …" test below). Comparing
 *  them here would only assert that both sides drew from a shuffled deck,
 *  not anything about "the position". */
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
        spellsCastThisTurn: state.spellsCastThisTurn ?? 0,
        players: state.players.map((p) => ({
            life: p.life,
            landsPlayedThisTurn: p.landsPlayedThisTurn ?? 0,
            manaPool: p.manaPool,
            restrictedMana: p.restrictedMana ?? [],
            spellsCastThisTurn: p.spellsCastThisTurn ?? 0,
            poisonCounters: p.poisonCounters ?? 0,
            energyCounters: p.energyCounters ?? 0,
            skipNextTurn: p.skipNextTurn ?? false,
            hasDrawnFromEmpty: p.hasDrawnFromEmpty ?? false,
            permanentYouControlledLeftThisTurn:
                p.permanentYouControlledLeftThisTurn ?? false,
            turnsTaken: p.turnsTaken ?? 0,
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
        // issue #1432 review round 2, finding #2 — these leaked through the
        // prior fixup's 4-field list.
        expect(loaderState.players[0].restrictedMana).toBeUndefined();
        expect(loaderState.players[0].spellsCastThisTurn ?? 0).toBe(0);
        expect(loaderState.spellsCastThisTurn).toBeUndefined();
        expect(loaderState.players[0].poisonCounters ?? 0).toBe(0);
        expect(loaderState.players[1].poisonCounters ?? 0).toBe(0);
        expect(loaderState.players[0].energyCounters ?? 0).toBe(0);
        expect(loaderState.players[0].skipNextTurn).toBeUndefined();
        expect(loaderState.players[0].hasDrawnFromEmpty).toBeUndefined();
        expect(
            loaderState.players[0].permanentYouControlledLeftThisTurn
        ).toBeUndefined();
        expect(loaderState.players[0].drawnThisTurn).toBeUndefined();
        expect(loaderState.players[0].lastDrawnCardId).toBeUndefined();
        expect(loaderState.players[0].turnsTaken).toBe(1);
        expect(loaderState.players[1].turnsTaken).toBeUndefined();
    });
});

describe("debugLoadBladeScenario — mutation body throws on an unknown label (issue #1432)", () => {
    it("mirrors the mutation's own guard, not just the pure findBladeScenario lookup", () => {
        expect(() =>
            runMutationBody(arbitraryCurrentGameBaseState(), "no such scenario")
        ).toThrow("Unknown blade scenario: no such scenario");
    });
});
