// debugSetupScenario admin gate (issue #768). The mutation
// (`convex/game.ts`) calls `assertIsAdmin(ctx)` as the FIRST statement of its
// handler, before any board state is touched — an arbitrary logged-in caller
// must not be able to overwrite another user's game (clear hands/battlefield,
// reseat cards, set life/mana). The project has no convex-test harness (see
// `convex/__tests__/adminAuth.test.ts`, `convex/__tests__/decks.test.ts`), so
// this asserts the same pure decision `assertIsAdmin` is built from —
// `isAdminUser` — mirroring the `deletePreset` admin-gate test convention.
import { describe, it, expect } from "vitest";
import { isAdminUser } from "../auth";
import { debugLoadMySeatId } from "../matches";
import { buildStateFromScenario } from "../gre/scenarioBuilder";
import { makePlayer, makeState } from "../cards/__tests__/setup";
import { grizzlyBears } from "../cards/sets/lea/green";
import { shivanDragon } from "../cards/sets/lea/red";
import type { Doc } from "../_generated/dataModel";
import type { ScenarioSpec } from "../debugScenarioSpec";

function user(isAdmin?: boolean): Doc<"users"> {
    return {
        _id: "user_1" as Doc<"users">["_id"],
        _creationTime: 0,
        nickname: "Tester",
        isAdmin,
    } as Doc<"users">;
}

describe("debugSetupScenario — admin gate (issue #768)", () => {
    it("rejects a non-admin caller (assertIsAdmin throws before state is touched)", () => {
        expect(isAdminUser(user(false))).toBe(false);
        expect(isAdminUser(user(undefined))).toBe(false);
    });

    it("rejects an unauthenticated caller", () => {
        expect(isAdminUser(null)).toBe(false);
    });

    it("allows an admin caller through the gate (scenario setup proceeds unchanged)", () => {
        expect(isAdminUser(user(true))).toBe(true);
    });
});

/** The live game's two seats in every fixture below — deliberately NOT
 *  `p1`/`p2`, and deliberately not ending in the ADR 0001 bot suffix on the
 *  human's side, so a test that accidentally fell back to a positional
 *  convention would read as passing for the wrong reason. */
const HUMAN_SEAT = "user_abc123-p1";
const BOT_SEAT = "user_abc123-p2";

/**
 * Which seat a Debug scenario's `"me"` resolves to (issue #3786) — the pure
 * decision `debugLoadMySeatId` (`convex/matches.ts`) is built from, tested the
 * same way `bladeLoadBotSeatId`'s sibling decision is in
 * `debugLoadBladeScenario.test.ts`: against the immutable `games` row shape,
 * with no Convex runtime needed.
 */
describe('debugSetupScenario — which seat renders as "me" (issue #3786)', () => {
    it("names the non-bot seat in a vs-AI game, whichever position it holds on the `games` row", () => {
        expect(
            debugLoadMySeatId({
                vsAi: true,
                players: [{ id: HUMAN_SEAT }, { id: BOT_SEAT }],
            })
        ).toBe(HUMAN_SEAT);
        // The `games` row's own seat order is immutable, but the decision is
        // by IDENTITY (`isBotSeat`), never by position — reversing the row
        // itself must not flip the answer.
        expect(
            debugLoadMySeatId({
                vsAi: true,
                players: [{ id: BOT_SEAT }, { id: HUMAN_SEAT }],
            })
        ).toBe(HUMAN_SEAT);
    });

    it("falls back to the first seat for solo and two-player games (no bot seat to exclude)", () => {
        expect(
            debugLoadMySeatId({
                players: [{ id: HUMAN_SEAT }, { id: BOT_SEAT }],
            })
        ).toBe(HUMAN_SEAT);
        expect(
            debugLoadMySeatId({
                players: [{ id: "user_a" }, { id: "user_b" }],
            })
        ).toBe("user_a");
    });
});

/**
 * The bug itself (issue #3786): `buildStateFromScenario` used to resolve
 * `"me"` as `players[0]` of the LIVE snapshot, which a `bot: "me"` Blade
 * Scenario load (`bot-slice`, issue #3443) reorders to put the Bot first.
 * From then on every Debug scenario loaded into the same game rendered
 * mirrored — its `"me"` cards, life, hand and turn holder on the Bot's seat.
 *
 * These fixtures build the live snapshot in that already-reordered shape
 * (Bot seat first) and drive the exact two functions
 * `debugSetupScenario`'s handler calls — `debugLoadMySeatId` off the
 * immutable `games` row, then `buildStateFromScenario` with that seat id —
 * so a regression here is a regression in the mutation's own body, not a
 * hand-rolled stand-in for it.
 */
describe("debugSetupScenario — a scenario renders from the human's point of view even after a Blade load reordered the live snapshot (issue #3786)", () => {
    /** The live game's `players[]` AFTER a `bot: "me"` Blade load — the Bot
     *  seat first, the shape `buildBladeLoadState` persists. */
    function postBladeLoadState() {
        return makeState({
            players: [makePlayer(BOT_SEAT), makePlayer(HUMAN_SEAT)],
        });
    }

    const spec: ScenarioSpec = {
        cards: [
            { name: grizzlyBears.name, owner: "me" },
            { name: shivanDragon.name, owner: "opp" },
        ],
        life: { me: 5, opp: 12 },
        activePlayer: "me",
        priority: "me",
        hiddenHand: { me: 2 },
    };

    it("a fresh vs-AI game with no prior Blade load — cards, life and turn holder land on the human seat", () => {
        const mySeatId = debugLoadMySeatId({
            vsAi: true,
            players: [{ id: HUMAN_SEAT }, { id: BOT_SEAT }],
        });
        const state = buildStateFromScenario(
            makeState({
                players: [makePlayer(HUMAN_SEAT), makePlayer(BOT_SEAT)],
            }),
            spec,
            mySeatId
        );

        const human = state.players.find((p) => p.id === HUMAN_SEAT)!;
        const bot = state.players.find((p) => p.id === BOT_SEAT)!;
        expect(
            human.battlefield.some((c) => c.card.id === grizzlyBears.id)
        ).toBe(true);
        expect(bot.battlefield.some((c) => c.card.id === shivanDragon.id)).toBe(
            true
        );
        expect(human.life).toBe(5);
        expect(bot.life).toBe(12);
        expect(state.activePlayerId).toBe(HUMAN_SEAT);
        expect(state.priorityPlayerId).toBe(HUMAN_SEAT);
    });

    it('after a `bot: "me"` Blade load reordered `players[]` — cards, life and turn holder still land on the human seat', () => {
        // The `games` row itself never moves (issue #3443's whole point): the
        // human is `-p1` on it whatever the live snapshot's order is now.
        const mySeatId = debugLoadMySeatId({
            vsAi: true,
            players: [{ id: HUMAN_SEAT }, { id: BOT_SEAT }],
        });
        const state = buildStateFromScenario(
            postBladeLoadState(),
            spec,
            mySeatId
        );

        const human = state.players.find((p) => p.id === HUMAN_SEAT)!;
        const bot = state.players.find((p) => p.id === BOT_SEAT)!;
        expect(
            human.battlefield.some((c) => c.card.id === grizzlyBears.id)
        ).toBe(true);
        expect(bot.battlefield.some((c) => c.card.id === shivanDragon.id)).toBe(
            true
        );
        expect(human.life).toBe(5);
        expect(bot.life).toBe(12);
        expect(state.activePlayerId).toBe(HUMAN_SEAT);
        expect(state.priorityPlayerId).toBe(HUMAN_SEAT);
        expect(human.hand).toHaveLength(2);
    });

    it('a solo game the SAME Blade load just converted to vs-AI — the conversion alone changes nothing about which seat is "me"', () => {
        // `debugLoadBladeScenario` patches `vsAi: true` onto the `games` row
        // the moment it converts a solo game — `debugLoadMySeatId` reads
        // exactly that field, so the converted row answers identically to an
        // always-vs-AI one.
        const mySeatId = debugLoadMySeatId({
            vsAi: true,
            players: [{ id: HUMAN_SEAT }, { id: BOT_SEAT }],
        });
        const state = buildStateFromScenario(
            postBladeLoadState(),
            spec,
            mySeatId
        );

        expect(state.players.find((p) => p.id === HUMAN_SEAT)!.life).toBe(5);
        expect(state.activePlayerId).toBe(HUMAN_SEAT);
    });
});
