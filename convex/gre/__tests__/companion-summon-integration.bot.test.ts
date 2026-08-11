// Integration: the `summon-companion` special action (CR 116.2 / 702.139a,
// ADR 0064) — GRE move loop (enumerateMoves/applyMoveForSearch) AND the
// authoritative `summonCompanion` mutation (game.ts). The project has no
// convex-test harness (see moves-integration.test.ts's own header), so the
// mutation's core sequence is replicated here against the SAME pure
// primitives the real mutation calls, in the same order — proving offered ⇔
// applied legality can never diverge between the human and Bot paths.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { canSummonCompanion, COMPANION_SUMMON_COST } from "../companion";
import {
    getManaSubstitutions,
    payManaCostForSpell,
    commitLandsForCost,
} from "../state";
import {
    buildAutoTapSources,
    solveSmartAutoTap,
    manaFromPlan,
} from "../autoTap";
import { MANA_COLORS } from "../constants";
import { enumerateMoves } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { lutri } from "../../cards/sets/iko/multicolor";
import { getCardByName } from "../../cards";
import type { GameState, PlayerState } from "../state";

const MOUNTAIN = getCardByName("Mountain").id;

function playerWithCompanion(
    overrides: Partial<PlayerState> = {}
): PlayerState {
    return makePlayer("p1", {
        battlefield: [
            makeInstance(MOUNTAIN, { controllerId: "p1", ownerId: "p1" }),
            makeInstance(MOUNTAIN, { controllerId: "p1", ownerId: "p1" }),
            makeInstance(MOUNTAIN, { controllerId: "p1", ownerId: "p1" }),
        ],
        companion: {
            instance: makeInstance(lutri.id, {
                controllerId: "p1",
                ownerId: "p1",
            }),
            used: false,
        },
        ...overrides,
    });
}

/** Replicates the `summonCompanion` mutation's core sequence (game.ts) against
 *  a plain GameState, exactly as the mutation does it — solve, tap, pay, move,
 *  mark used. Returns false when `canSummonCompanion` rejects it up front. */
function applySummonCompanionMutation(
    state: GameState,
    playerId: string
): boolean {
    const player = state.players.find((p) => p.id === playerId)!;
    if (!canSummonCompanion(state, player)) return false;
    const subs = getManaSubstitutions(state, player.id);
    const sources = buildAutoTapSources(player.battlefield);
    const plan = solveSmartAutoTap(
        player.manaPool,
        COMPANION_SUMMON_COST,
        subs,
        sources
    );
    if (plan === null) return false;
    const tappedIds = new Set(plan.map((step) => step.cardId));
    for (const src of player.battlefield) {
        if (tappedIds.has(src.id)) src.isTapped = true;
    }
    const produced = manaFromPlan(sources, plan);
    for (const color of MANA_COLORS) {
        const v = produced[color];
        if (v) player.manaPool[color] = (player.manaPool[color] ?? 0) + v;
    }
    payManaCostForSpell(player, COMPANION_SUMMON_COST, [], subs);
    commitLandsForCost(player, COMPANION_SUMMON_COST);
    const companion = player.companion!;
    player.hand.push({ ...companion.instance, zone: "hand" });
    companion.used = true;
    return true;
}

describe("summon-companion — GRE move loop (CR 116.2, ADR 0064)", () => {
    it("enumerateMoves offers summon-companion at sorcery timing with an unused, affordable slot", () => {
        const state = makeState({
            players: [playerWithCompanion(), makePlayer("p2")],
        });
        const moves = enumerateMoves(state, "p1");
        expect(moves.some((m) => m.kind === "summon-companion")).toBe(true);
    });

    it("does not offer summon-companion once used", () => {
        const state = makeState({
            players: [
                playerWithCompanion({
                    companion: {
                        instance: makeInstance(lutri.id, {
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        used: true,
                    },
                }),
                makePlayer("p2"),
            ],
        });
        const moves = enumerateMoves(state, "p1");
        expect(moves.some((m) => m.kind === "summon-companion")).toBe(false);
    });

    it("does not offer summon-companion outside sorcery timing", () => {
        const state = makeState({
            players: [playerWithCompanion(), makePlayer("p2")],
        });
        state.phase = "DECLARE_ATTACKERS";
        const moves = enumerateMoves(state, "p1");
        expect(moves.some((m) => m.kind === "summon-companion")).toBe(false);
    });

    it("applyMoveForSearch: taps sources, moves the companion to hand, marks it used, adds no stack item", () => {
        const state = makeState({
            players: [playerWithCompanion(), makePlayer("p2")],
        });
        const next = applyMoveForSearch(state, "p1", {
            kind: "summon-companion",
        });
        const p1 = next.players[0];
        expect(p1.companion?.used).toBe(true);
        expect(
            p1.hand.some(
                (c) => c.card && (c.card as { id: string }).id === lutri.id
            )
        ).toBe(true);
        expect(next.stack).toHaveLength(0);
        // The original (pre-move) state is untouched — pure simulation.
        expect(state.players[0].companion?.used).toBe(false);
    });
});

describe("summon-companion — authoritative mutation sequence (game.ts summonCompanion)", () => {
    it("pays {3} (auto-tapped), moves the companion to hand, sets used, no stack item, never offered twice", () => {
        const state = makeState({
            players: [playerWithCompanion(), makePlayer("p2")],
        });
        const applied = applySummonCompanionMutation(state, "p1");
        expect(applied).toBe(true);

        const p1 = state.players[0];
        expect(p1.companion?.used).toBe(true);
        expect(
            p1.hand.some((c) => (c.card as { id: string }).id === lutri.id)
        ).toBe(true);
        // {3} generic paid from the three tapped Mountains.
        expect(p1.battlefield.every((c) => c.isTapped)).toBe(true);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingCompanionPay).toBeUndefined();

        // A second summon attempt is illegal (used, and no untapped mana left).
        expect(canSummonCompanion(state, p1)).toBe(false);
        expect(applySummonCompanionMutation(state, "p1")).toBe(false);
    });

    it("rejects the summon when {3} is unaffordable", () => {
        const state = makeState({
            players: [
                playerWithCompanion({ battlefield: [] }),
                makePlayer("p2"),
            ],
        });
        expect(applySummonCompanionMutation(state, "p1")).toBe(false);
        expect(state.players[0].companion?.used).toBe(false);
        expect(state.players[0].hand).toHaveLength(0);
    });

    it("rejects the summon outside the player's own main phase", () => {
        const state = makeState({
            players: [playerWithCompanion(), makePlayer("p2")],
        });
        state.phase = "POSTCOMBAT_MAIN";
        state.stack.push({
            ...makeInstance(MOUNTAIN, { controllerId: "p2", ownerId: "p2" }),
            castById: "p2",
        });
        expect(applySummonCompanionMutation(state, "p1")).toBe(false);
    });
});
