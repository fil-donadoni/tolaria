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
import {
    assertLoadableIntoLiveGame,
    buildStateFromScenario,
} from "../gre/scenarioBuilder";
import { makePlayer, makeState } from "../cards/__tests__/setup";
import { grizzlyBears } from "../cards/sets/lea/green";
import { lightningBolt, shivanDragon } from "../cards/sets/lea/red";
import { forest } from "../cards/sets/lea/colorless";
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

/** The live game's `players[]` AFTER a `bot: "me"` Blade load — the Bot seat
 *  first, the shape `buildBladeLoadState` persists (issue #3443). Shared by
 *  every describe block below that needs to build against an
 *  already-reordered live snapshot. */
function postBladeLoadState() {
    return makeState({
        players: [makePlayer(BOT_SEAT), makePlayer(HUMAN_SEAT)],
    });
}

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
    // No `hiddenHand`: `assertLoadableIntoLiveGame` (CR 400.2, issue #3452)
    // refuses one for THIS exact loader — a card of unknown identity has no
    // characteristics for the cleanup discard or a hand pick to read — so a
    // spec carrying one could never reach `debugSetupScenario`'s handler.
    // The named `zone: "hand"` card below proves the same per-seat HAND
    // mapping without that impossible combination.
    const spec: ScenarioSpec = {
        cards: [
            { name: grizzlyBears.name, owner: "me" },
            { name: shivanDragon.name, owner: "opp" },
            { name: forest.name, owner: "me", zone: "hand" },
        ],
        life: { me: 5, opp: 12 },
        activePlayer: "me",
        priority: "me",
    };

    it("is loadable into a live game — the fixture itself must clear the mutation's own refusal", () => {
        expect(() => assertLoadableIntoLiveGame(spec)).not.toThrow();
    });

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
        expect(human.hand.some((c) => c.card.id === forest.id)).toBe(true);
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
        expect(human.hand.some((c) => c.card.id === forest.id)).toBe(true);
        expect(human.life).toBe(5);
        expect(bot.life).toBe(12);
        expect(state.activePlayerId).toBe(HUMAN_SEAT);
        expect(state.priorityPlayerId).toBe(HUMAN_SEAT);
    });

    it("a solo game the SAME Blade load just converted to vs-AI, loaded with no `vsAi` yet on the `games` row — the `players[0]` fallback still names the human", () => {
        // `debugLoadBladeScenario` patches `vsAi: true` onto the `games` row
        // the moment it converts a solo game, but this fixture deliberately
        // omits it — the row as it stood the INSTANT BEFORE that patch — to
        // exercise `debugLoadMySeatId`'s OTHER branch (the `players[0]`
        // fallback) against an already-reordered live snapshot. The `games`
        // row's own seat order is unaffected by the Blade load (issue
        // #3443's whole point): the human is still its first seat.
        const mySeatId = debugLoadMySeatId({
            players: [{ id: HUMAN_SEAT }, { id: BOT_SEAT }],
        });
        expect(mySeatId).toBe(HUMAN_SEAT);
        const state = buildStateFromScenario(
            postBladeLoadState(),
            spec,
            mySeatId
        );

        expect(state.players.find((p) => p.id === HUMAN_SEAT)!.life).toBe(5);
        expect(state.activePlayerId).toBe(HUMAN_SEAT);
    });
});

/**
 * The four helpers `buildStateFromScenario` threads `mySeatId` through
 * (issue #3786) — `seedDeclaredCombat`, `seedContinuousEffects`,
 * `seedDeclaredStack` and `scenarioExpiry` — each independently re-derived
 * `state.players[0]`/`[1]` before this fix, so every call site elsewhere in
 * this file (which all pass the DEFAULT `mySeatId`) proves nothing about
 * whether the threading actually landed: the default is equivalent to the
 * old positional code by construction. This block is the only place a
 * non-default seat exercises all four, against a live snapshot already
 * reordered by a Blade load — the exact shape a Debug scenario faces in
 * practice.
 */
describe("debugSetupScenario — combat, the stack and continuous effects also resolve from the human seat after a reorder (issue #3786)", () => {
    it('an "opp"-controlled stack item, a per-seat combat record and an "opp" continuous-effect duration all land on the Bot', () => {
        const mySeatId = debugLoadMySeatId({
            vsAi: true,
            players: [{ id: HUMAN_SEAT }, { id: BOT_SEAT }],
        });
        const spec: ScenarioSpec = {
            cards: [
                { name: grizzlyBears.name, owner: "me" },
                { name: shivanDragon.name, owner: "opp" },
            ],
            phase: "PRECOMBAT_MAIN",
            activePlayer: "me",
            // `seedDeclaredCombat`'s CR 506.4 per-seat tally, applied
            // independently of a declared attack: "opp"'s Shivan Dragon
            // attacked THIS turn, searched on "opp"'s own battlefield.
            combat: { attackedThisTurn: { opp: [shivanDragon.name] } },
            // `seedDeclaredStack`: the controller/owner of a declared item.
            stack: [
                {
                    kind: "spell",
                    name: lightningBolt.name,
                    controller: "opp",
                    targets: [{ kind: "player", seat: "me" }],
                },
            ],
            // `seedContinuousEffects` + `scenarioExpiry`: an "opp"-controlled
            // effect on "opp"'s own permanent, expiring at the turn holder's
            // OPPONENT'S next turn — the branch that reads `duration.player`.
            continuousEffects: [
                {
                    layer: 6,
                    controller: "opp",
                    affected: { opp: [shivanDragon.name] },
                    payload: { kind: "keyword-grant", keyword: "flying" },
                    duration: { phase: "upkeep", player: "opp" },
                },
            ],
        };

        const state = buildStateFromScenario(
            postBladeLoadState(),
            spec,
            mySeatId
        );

        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].controllerId).toBe(BOT_SEAT);
        expect(state.stack[0].ownerId).toBe(BOT_SEAT);
        expect(state.stack[0].targets?.[0]).toMatchObject({
            type: "player",
            id: HUMAN_SEAT,
        });

        const shivan = state.players
            .find((p) => p.id === BOT_SEAT)!
            .battlefield.find((c) => c.card.id === shivanDragon.id)!;
        expect(shivan.card).toBeDefined();
        expect(shivan.hasAttackedThisTurn).toBe(true);
        const effect = state.continuousEffects?.find(
            (e) =>
                e.affected.kind === "instances" &&
                e.affected.instanceIds.includes(shivan.id)
        );
        expect(effect).toBeDefined();
        expect(effect!.expiry).toMatchObject({
            kind: "duration",
            controllerId: BOT_SEAT,
            duration: { playerId: BOT_SEAT },
        });
    });
});
