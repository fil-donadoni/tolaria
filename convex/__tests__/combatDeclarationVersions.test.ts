// The PERSISTED-VERSION cost of a combat declaration (issue #3475), driven
// through the REGISTERED `game.ts` mutations.
//
// `gameStates` is one row per game, patched in place by `saveGameState` with a
// monotonic `seq` — so every mutation call that reaches a stable point costs
// one document version, one full-row write and one invalidation of every
// subscriber. The per-creature declaration path made that cost grow with the
// size of the attack: eight attackers were eight read-modify-write cycles
// before the single confirm that actually matters, and a block was TWO
// versions per assignment (`selectBlocker` then `assignBlockerTarget`).
//
// Nothing result-shaped can see this: the per-toggle path and the batched one
// end at the IDENTICAL state. So these assertions are on the write count —
// `MutationStub.writes`, the harness's record of every `ctx.db` write — and on
// `seq`, which `saveGameState` bumps once per persisted version.
//
// Same harness discipline as `combatDeclarationCap.test.ts`: a stub
// `MutationCtx` driving the mutation's own `_handler`, never a reimplementation
// (a reimplementation could not observe `saveGameState` at all, which is the
// entire subject here).

import { describe, it, expect } from "vitest";
import {
    declareAttackers,
    declareBlockers,
    toggleAttacker,
    selectBlocker,
    assignBlockerTarget,
} from "../game";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { grizzlyBears } from "../cards/sets/lea/green";
import { duelingGrounds } from "../cards/sets/inv/multicolor";
import { serraAngel } from "../cards/sets/lea/white";
import type { GameState, CardInstanceState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
    type MutationStub,
} from "./gameMutationHarness";

const GAME_ID = "game-1" as Id<"games">;
const SEED_SEQ = 1;

/** Writes addressed at the single `gameStates` row this harness seeds — the
 *  persisted-version count of whatever just ran. (`saveGameState` also writes
 *  the `gameTicks` companion row; that is a different document and is counted
 *  separately below.) */
const stateVersions = (h: MutationStub) =>
    h.writes.filter((w) => w.id === "gs-1").length;

const runDeclareAttackers = (
    h: MutationStub,
    attackerIds: string[],
    extra: {
        exertIds?: string[];
        attackTargets?: Record<string, string>;
    } = {}
) =>
    runMutation<
        {
            gameId: Id<"games">;
            playerId: string;
            attackerIds: string[];
            exertIds?: string[];
            attackTargets?: Record<string, string>;
        },
        { declaredIds: string[]; rejected: { cardInstanceId: string }[] }
    >(declareAttackers as unknown as Handler<never, never>, h.ctx, {
        gameId: GAME_ID,
        playerId: "p1",
        attackerIds,
        ...extra,
    });

const runToggleAttacker = (h: MutationStub, cardInstanceId: string) =>
    runMutation<
        { gameId: Id<"games">; playerId: string; cardInstanceId: string },
        void
    >(toggleAttacker as unknown as Handler<never, never>, h.ctx, {
        gameId: GAME_ID,
        playerId: "p1",
        cardInstanceId,
    });

const runDeclareBlockers = (
    h: MutationStub,
    assignments: { blockerId: string; attackerId: string }[]
) =>
    runMutation<
        {
            gameId: Id<"games">;
            playerId: string;
            assignments: { blockerId: string; attackerId: string }[];
        },
        void
    >(declareBlockers as unknown as Handler<never, never>, h.ctx, {
        gameId: GAME_ID,
        playerId: "p2",
        assignments,
    });

const runSelectBlocker = (h: MutationStub, cardInstanceId: string) =>
    runMutation<
        { gameId: Id<"games">; playerId: string; cardInstanceId: string },
        void
    >(selectBlocker as unknown as Handler<never, never>, h.ctx, {
        gameId: GAME_ID,
        playerId: "p2",
        cardInstanceId,
    });

const runAssignBlockerTarget = (h: MutationStub, attackerId: string) =>
    runMutation<
        { gameId: Id<"games">; playerId: string; attackerId: string },
        void
    >(assignBlockerTarget as unknown as Handler<never, never>, h.ctx, {
        gameId: GAME_ID,
        playerId: "p2",
        attackerId,
    });

function bears(id: string, controllerId: string): CardInstanceState {
    return makeInstance(grizzlyBears.id, {
        id,
        controllerId,
        ownerId: controllerId,
        isSummoningSick: false,
    });
}

const ids = (prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

/** p1 (active, holding priority) in DECLARE_ATTACKERS with `n` untapped
 *  Grizzly Bears and an empty opposing board. */
function declareAttackersState(n: number): GameState {
    return makeState({
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: ids("a", n).map((id) => bears(id, "p1")),
            }),
            makePlayer("p2", { battlefield: [] }),
        ],
        combat: {
            attackerIds: [],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
}

/** p1's `attackers` are declared and confirmed; p2 (the defender) is in
 *  DECLARE_BLOCKERS with `blockers` untapped creatures. */
function declareBlockersState(attackers: number, blockers: number): GameState {
    const attackerIds = ids("a", attackers);
    return makeState({
        phase: "DECLARE_BLOCKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: attackerIds.map((id) => {
                    const c = bears(id, "p1");
                    c.isAttacking = true;
                    return c;
                }),
            }),
            makePlayer("p2", {
                battlefield: ids("b", blockers).map((id) => bears(id, "p2")),
            }),
        ],
        combat: {
            attackerIds,
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
}

describe("combat declaration version cost (issue #3475)", () => {
    it("declares EIGHT attackers in one persisted game-state version", async () => {
        const h = makeMutationCtx("p1", [
            gameStateSeed(declareAttackersState(8), SEED_SEQ),
        ]);

        const result = await runDeclareAttackers(h, ids("a", 8));

        expect(result.declaredIds).toEqual(ids("a", 8));
        expect(h.state().combat!.attackerIds).toEqual(ids("a", 8));
        // The whole point: ONE version, not eight. A future change that
        // re-introduced a per-creature save would land here.
        expect(stateVersions(h)).toBe(1);
        expect(h.doc("gs-1").seq).toBe(SEED_SEQ + 1);
    });

    it("the version count does not grow with the size of the attack (1 vs 8 attackers)", async () => {
        const one = makeMutationCtx("p1", [
            gameStateSeed(declareAttackersState(1), SEED_SEQ),
        ]);
        await runDeclareAttackers(one, ids("a", 1));

        const eight = makeMutationCtx("p1", [
            gameStateSeed(declareAttackersState(8), SEED_SEQ),
        ]);
        await runDeclareAttackers(eight, ids("a", 8));

        expect(stateVersions(eight)).toBe(stateVersions(one));
    });

    it("the per-toggle path it replaced pays one version PER creature", async () => {
        // The contrast that makes the assertion above mean something —
        // `toggleAttacker` is still the interactive path (one human click, one
        // version), and this is exactly what the batch collapses.
        const h = makeMutationCtx("p1", [
            gameStateSeed(declareAttackersState(8), SEED_SEQ),
        ]);

        for (const id of ids("a", 8)) await runToggleAttacker(h, id);

        expect(h.state().combat!.attackerIds).toEqual(ids("a", 8));
        expect(stateVersions(h)).toBe(8);
        expect(h.doc("gs-1").seq).toBe(SEED_SEQ + 8);
    });

    it("declares FOUR blocks in one persisted game-state version", async () => {
        const h = makeMutationCtx("p2", [
            gameStateSeed(declareBlockersState(4, 4), SEED_SEQ),
        ]);

        await runDeclareBlockers(h, [
            { blockerId: "b1", attackerId: "a1" },
            { blockerId: "b2", attackerId: "a2" },
            { blockerId: "b3", attackerId: "a3" },
            { blockerId: "b4", attackerId: "a4" },
        ]);

        expect(h.state().combat!.blockerAssignments).toEqual({
            b1: ["a1"],
            b2: ["a2"],
            b3: ["a3"],
            b4: ["a4"],
        });
        expect(stateVersions(h)).toBe(1);
        expect(h.doc("gs-1").seq).toBe(SEED_SEQ + 1);
    });

    it("the per-click block path it replaced pays TWO versions per assignment", async () => {
        const h = makeMutationCtx("p2", [
            gameStateSeed(declareBlockersState(4, 4), SEED_SEQ),
        ]);

        for (const [blocker, attacker] of [
            ["b1", "a1"],
            ["b2", "a2"],
            ["b3", "a3"],
            ["b4", "a4"],
        ]) {
            await runSelectBlocker(h, blocker);
            await runAssignBlockerTarget(h, attacker);
        }

        expect(stateVersions(h)).toBe(8);
    });

    it("a creature the server refuses is skipped, not fatal, and still costs one version", async () => {
        // "x" is not on the battlefield at all — the batch reports it and
        // declares the rest, because `selectAttacker` validates before it
        // mutates (which is what makes a partial batch safe).
        const h = makeMutationCtx("p1", [
            gameStateSeed(declareAttackersState(3), SEED_SEQ),
        ]);

        const result = await runDeclareAttackers(h, ["a1", "x", "a3"]);

        expect(result.declaredIds).toEqual(["a1", "a3"]);
        expect(h.state().combat!.attackerIds).toEqual(["a1", "a3"]);
        expect(stateVersions(h)).toBe(1);
    });

    it("declares NOTHING in NO versions — the empty declaration is free", async () => {
        // The bot's commonest combat answer is "no attack" / "no block". A
        // batch that persisted a version for it would ADD a write where the
        // per-toggle loop (which ran zero times) spent none.
        const attack = makeMutationCtx("p1", [
            gameStateSeed(declareAttackersState(3), SEED_SEQ),
        ]);
        const result = await runDeclareAttackers(attack, []);
        expect(result.declaredIds).toEqual([]);
        expect(stateVersions(attack)).toBe(0);
        expect(attack.doc("gs-1").seq).toBe(SEED_SEQ);

        const block = makeMutationCtx("p2", [
            gameStateSeed(declareBlockersState(2, 2), SEED_SEQ),
        ]);
        await runDeclareBlockers(block, []);
        expect(stateVersions(block)).toBe(0);
        expect(block.doc("gs-1").seq).toBe(SEED_SEQ);
    });

    it("re-declaring the selection already in place costs no version either", async () => {
        const h = makeMutationCtx("p1", [
            gameStateSeed(declareAttackersState(2), SEED_SEQ),
        ]);

        await runDeclareAttackers(h, ["a1", "a2"]);
        await runDeclareAttackers(h, ["a1", "a2"]);

        expect(h.state().combat!.attackerIds).toEqual(["a1", "a2"]);
        expect(stateVersions(h)).toBe(1);
    });

    it("is additive and idempotent — re-declaring an attacker neither toggles it off nor costs a version per id", async () => {
        const h = makeMutationCtx("p1", [
            gameStateSeed(declareAttackersState(3), SEED_SEQ),
        ]);

        await runDeclareAttackers(h, ["a1"]);
        const result = await runDeclareAttackers(h, ["a1", "a2", "a3"]);

        expect(result.declaredIds).toEqual(["a1", "a2", "a3"]);
        // One version per CALL, never per id: two calls, two versions.
        expect(stateVersions(h)).toBe(2);
    });
    it("a STALE planeswalker target drops the target, never the attacker (CR 508.1a)", async () => {
        // The planeswalker the caller planned to attack is gone. `applyMove`
        // drops the entry and keeps the creature attacking; the mutation must
        // agree, or — since the search points EVERY attacker at the same
        // planeswalker — one stale id would cancel the whole attack.
        const h = makeMutationCtx("p1", [
            gameStateSeed(declareAttackersState(2), SEED_SEQ),
        ]);

        const result = await runDeclareAttackers(h, ["a1", "a2"], {
            attackTargets: { a1: "gone", a2: "gone" },
        });

        expect(result.declaredIds).toEqual(["a1", "a2"]);
        expect(result.rejected).toEqual([]);
        expect(h.state().combat!.attackTargets).toBeUndefined();
        expect(stateVersions(h)).toBe(1);
    });

    it("enforces the battlefield-wide attacker cap inside the batch (CR 508.1a)", async () => {
        // Dueling Grounds: one attacker per combat. The batch must refuse the
        // rest exactly as `toggleAttacker` does — and still cost one version.
        const state = declareAttackersState(3);
        state.players[1].battlefield = [
            makeInstance(duelingGrounds.id, { id: "dg", controllerId: "p2" }),
        ];
        const h = makeMutationCtx("p1", [gameStateSeed(state, SEED_SEQ)]);

        const result = await runDeclareAttackers(h, ["a1", "a2", "a3"]);

        expect(result.declaredIds).toEqual(["a1"]);
        expect(result.rejected.map((r) => r.cardInstanceId)).toEqual([
            "a2",
            "a3",
        ]);
        expect(stateVersions(h)).toBe(1);
    });

    it("declareBlockers is ALL-OR-NOTHING — an illegal assignment persists no version", async () => {
        // CR 509.1b — a ground blocker cannot block a flier. The whole batch
        // is discarded, not the offending assignment alone, so the earlier
        // legal blocks never reach the row (the per-click path persisted
        // assignments 1..N-1 before throwing on N).
        const state = declareBlockersState(2, 2);
        state.players[0].battlefield[1] = makeInstance(serraAngel.id, {
            id: "a2",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
            isAttacking: true,
        });
        const h = makeMutationCtx("p2", [gameStateSeed(state, SEED_SEQ)]);

        await expect(
            runDeclareBlockers(h, [
                { blockerId: "b1", attackerId: "a1" },
                { blockerId: "b2", attackerId: "a2" },
            ])
        ).rejects.toThrow();

        expect(h.state().combat!.blockerAssignments).toEqual({});
        expect(stateVersions(h)).toBe(0);
    });
});
