// Integration: enumerateMoves → executor sequence → server primitives
// (issue #110, ADR 0001). The project has no convex-test harness, so — like
// casting-flow.test.ts — this drives the SAME pure GRE primitives the game.ts
// mutations call, in the order the executor fires them, and asserts the
// resulting state matches what the move predicted. It also proves enumeration
// only emits moves the server's own coverage/legality checks accept, that an
// illegal move is rejected by that same check, and that the bot's view survives
// the wire projection (criterion 5).

import { describe, expect, it } from "vitest";
import { getCardByName, getInstanceManaCost } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { CardInstanceState } from "../state";
import {
    getBasicLandMana,
    getPlayer,
    isManaCostCovered,
    moveCard,
    normalizeManaCost,
    payManaCost,
} from "../state";
import { assertLegalAction } from "../rules";
import { enumerateMoves, type Move } from "../moves";
import {
    projectPublicState,
    type PublicGameState,
} from "../../gameProjections";
import type { GameState } from "../state";
import { applySourceStaticEffects } from "../state";
import {
    validateMinimumBlockers,
    getRequiredBlockerAssignments,
} from "../combat";
import { goblinWarDrums } from "../../cards/sets/fem";

// Mirror of src/lib/ai/state-adapter.ts (kept inline so this convex-side test
// doesn't pull the frontend module — and its @convex aliases — into the convex
// tsc project). The frontend adapter is unit-tested on its own.
function projectedToGameState(state: PublicGameState): GameState {
    return {
        ...state,
        players: state.players.map((p) => ({
            ...p,
            hand: p.hand.filter((c) => c !== null),
            library: [],
        })),
        stack: state.stack,
    } as unknown as GameState;
}

const FOREST = getCardByName("Forest").id;
const MOUNTAIN = getCardByName("Mountain").id;
const BEARS = getCardByName("Grizzly Bears").id; // 1G 2/2
const BOLT = getCardByName("Lightning Bolt").id; // R, target any

function land(cardId: string, controllerId: string): CardInstanceState {
    return makeInstance(cardId, { controllerId, ownerId: controllerId });
}

function hand(cardId: string, controllerId: string): CardInstanceState {
    return makeInstance(cardId, {
        controllerId,
        ownerId: controllerId,
        zone: "hand",
    });
}

describe("enumerate → execute → state matches (issue #110)", () => {
    it("play-land: the executor's moveCard lands the card the move named", () => {
        const mountain = hand(MOUNTAIN, "p1");
        const p1 = makePlayer("p1", { hand: [mountain] });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        const move = enumerateMoves(state, "p1").find(
            (m): m is Extract<Move, { kind: "play-land" }> =>
                m.kind === "play-land"
        );
        expect(move).toBeDefined();

        // Replay exactly what the playCard mutation does (CR 305.2).
        const player = getPlayer(state, "p1");
        const card = moveCard(
            player,
            move!.cardInstanceId,
            "hand",
            "battlefield"
        );
        if (card.types.includes("Land")) {
            player.landsPlayedThisTurn = (player.landsPlayedThisTurn ?? 0) + 1;
        }

        expect(player.battlefield.map((c) => c.id)).toContain(
            move!.cardInstanceId
        );
        expect(player.hand).toHaveLength(0);
        expect(player.landsPlayedThisTurn).toBe(1);
    });

    it("cast: the move's tapPlan funds exactly the cost the server checks", () => {
        const bears = hand(BEARS, "p1");
        const p1 = makePlayer("p1", {
            hand: [bears],
            battlefield: [land(FOREST, "p1"), land(FOREST, "p1")],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        const move = enumerateMoves(state, "p1").find(
            (m): m is Extract<Move, { kind: "cast-spell" }> =>
                m.kind === "cast-spell"
        );
        expect(move).toBeDefined();

        // Simulate tapForPayment for each planned tap: add the land's mana to
        // the pool, then assert the SAME coverage primitive the server uses
        // (tryAutoCommitPendingCast) is satisfied — i.e. the spell commits.
        const player = getPlayer(state, "p1");
        const pool = { ...player.manaPool };
        for (const tap of move!.tapPlan) {
            const source = player.battlefield.find(
                (c) => c.id === tap.cardInstanceId
            )!;
            const color = getBasicLandMana(source)!;
            pool[color] = (pool[color] ?? 0) + 1;
        }
        const cost = normalizeManaCost(getInstanceManaCost(bears)!);
        expect(isManaCostCovered(pool, cost)).toBe(true);

        // And paying it drains the pool to zero (no over/under-tap).
        payManaCost(pool, getInstanceManaCost(bears)!);
        const leftover = Object.values(pool).reduce((s, n) => s + n, 0);
        expect(leftover).toBe(0);
    });

    it("cast with target: the move carries a legal target the server would accept", () => {
        const bolt = hand(BOLT, "p1");
        const dummy = makeInstance(BEARS, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const p1 = makePlayer("p1", {
            hand: [bolt],
            battlefield: [land(MOUNTAIN, "p1")],
        });
        const p2 = makePlayer("p2", { battlefield: [dummy] });
        const state = makeState({ players: [p1, p2] });

        const casts = enumerateMoves(state, "p1").filter(
            (m): m is Extract<Move, { kind: "cast-spell" }> =>
                m.kind === "cast-spell"
        );
        // Every enumerated target must be one the server's getLegalTargets
        // would also produce (enumerateMoves shares that helper) — assert each
        // target id resolves to a real permanent or player.
        const validIds = new Set([dummy.id, "p1", "p2"]);
        for (const c of casts) {
            expect(c.targets).toHaveLength(1);
            expect(validIds.has(c.targets[0].id)).toBe(true);
        }
    });
});

describe("illegal move rejected by the server check (issue #110)", () => {
    it("a play after the land drop is spent is rejected by assertLegalAction", () => {
        const mountain = hand(MOUNTAIN, "p1");
        const p1 = makePlayer("p1", {
            hand: [mountain],
            landsPlayedThisTurn: 1, // CR 305.2 — drop already used
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        // enumerateMoves must not offer it...
        expect(
            enumerateMoves(state, "p1").some((m) => m.kind === "play-land")
        ).toBe(false);
        // ...and even if a stale/forged move proposed it, the server rejects it.
        expect(() =>
            assertLegalAction(state, getPlayer(state, "p1"), mountain, "play")
        ).toThrow(/Illegal action/);
    });
});

describe("wire format: bot enumerates from its projected view (criterion 5)", () => {
    it("the bot's own hand survives projectPublicState; opponent hand hidden", () => {
        // p2 is the bot. It holds a castable spell and the mana to pay for it.
        const bears = hand(BEARS, "p2");
        const p1 = makePlayer("p1", { hand: [hand(BOLT, "p1")] });
        const p2 = makePlayer("p2", {
            hand: [bears],
            battlefield: [land(FOREST, "p2"), land(FOREST, "p2")],
        });
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p2",
            priorityPlayerId: "p2",
        });

        const projected = projectPublicState(state, 1, "p2");
        const slimP1 = projected.players.find((p) => p.id === "p1")!;
        const slimP2 = projected.players.find((p) => p.id === "p2")!;

        // Opponent hand is nulled; bot's own hand is visible.
        expect(slimP1.hand.every((c) => c === null)).toBe(true);
        expect(slimP2.hand.filter((c) => c !== null)).toHaveLength(1);

        // The bot enumerates a cast for Grizzly Bears straight from the wire
        // state — proving the projection preserves what the Brain consumes.
        const moves = enumerateMoves(projectedToGameState(projected), "p2");
        const cast = moves.find(
            (m): m is Extract<Move, { kind: "cast-spell" }> =>
                m.kind === "cast-spell" && m.cardInstanceId === bears.id
        );
        expect(cast).toBeDefined();
        expect(cast!.tapPlan).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// Menace, full path (GRE static-grant → confirmBlockers seam → wire). ADR 0038.
// Goblin War Drums grants menace to the attacker; the same merge-then-validate
// sequence game.ts's confirmBlockers runs (auto-assign must-blocks, then
// validateMinimumBlockers) rejects a lone blocker and accepts two. The granted
// keyword is then re-checked after projection (criterion 5).
// ---------------------------------------------------------------------------

/** Mirrors the confirmBlockers body: merge required (must-block) assignments,
 *  then validate minimum-blocker thresholds. Returns the rejection reason or
 *  null when the declaration is legal. */
function confirmBlockSeam(
    state: GameState,
    declared: Record<string, string[]>
): string | null {
    state.combat!.blockerAssignments = { ...declared };
    const activePlayer = getPlayer(state, state.activePlayerId);
    const defender = state.players.find((p) => p.id !== state.activePlayerId)!;
    const required = getRequiredBlockerAssignments(
        activePlayer.battlefield,
        defender.battlefield,
        state.combat!.attackerIds,
        state.combat!.blockerAssignments,
        state
    );
    for (const [blockerId, attackerIds] of Object.entries(required)) {
        const existing = state.combat!.blockerAssignments[blockerId] ?? [];
        state.combat!.blockerAssignments[blockerId] = [
            ...existing,
            ...attackerIds,
        ];
    }
    const check = validateMinimumBlockers(state);
    return check.ok ? null : check.reason;
}

describe("menace — Goblin War Drums grant through the confirm-blockers seam", () => {
    function boardWithWarDrums() {
        const drums = makeInstance(goblinWarDrums.id, {
            id: "drums",
            controllerId: "p1",
            ownerId: "p1",
        });
        const attacker = makeInstance(BEARS, {
            id: "atk",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const b1 = makeInstance(BEARS, {
            id: "blk-1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const b2 = makeInstance(BEARS, {
            id: "blk-2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            activePlayerId: "p1",
            phase: "DECLARE_BLOCKERS",
            players: [
                makePlayer("p1", { battlefield: [drums, attacker] }),
                makePlayer("p2", { battlefield: [b1, b2] }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        // ETB-time grant: War Drums pushes "menace" onto the controller's
        // creatures (replicated here for a hand-built board, as game.ts does on
        // PERMANENT_ENTERED).
        applySourceStaticEffects(state, drums);
        return { state };
    }

    it("grants menace to the attacker (printed keyword absent, granted present)", () => {
        const { state } = boardWithWarDrums();
        const atk = state.players[0].battlefield.find((c) => c.id === "atk")!;
        expect(atk.staticAbilities).toContain("menace");
    });

    it("rejects a single blocker at the confirm seam (CR 509.1c)", () => {
        const { state } = boardWithWarDrums();
        const reason = confirmBlockSeam(state, { "blk-1": ["atk"] });
        expect(reason).toMatch(/menace/i);
    });

    it("accepts two blockers at the confirm seam", () => {
        const { state } = boardWithWarDrums();
        const reason = confirmBlockSeam(state, {
            "blk-1": ["atk"],
            "blk-2": ["atk"],
        });
        expect(reason).toBeNull();
    });

    it("the granted menace keyword survives projection (criterion 5)", () => {
        const { state } = boardWithWarDrums();
        const projected = projectPublicState(state, 1, "p1");
        const slimAtk = projected.players[0].battlefield.find(
            (c) => c.id === "atk"
        )!;
        expect(slimAtk.staticAbilities).toContain("menace");
        // And the threshold check holds on the projected (slim) state too.
        const projectedState = projectedToGameState(projected);
        projectedState.activePlayerId = "p1";
        projectedState.combat = {
            attackerIds: ["atk"],
            confirmed: true,
            blockerAssignments: { "blk-1": ["atk"] },
            blockersConfirmed: false,
        };
        expect(validateMinimumBlockers(projectedState).ok).toBe(false);
    });
});
