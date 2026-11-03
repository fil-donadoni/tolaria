// CR 119.3 / 119.4 / 120.3a — the per-turn life-LOSS tally (issue #3237),
// `GameState.lifeLostThisTurn`, the `lifeGainedThisTurn` twin read by "each
// opponent who lost life this turn" (Kaito, Bane of Nightmares).
//
// What this suite pins:
//  1. every path that lowers a life total feeds it — a "lose life" effect,
//     combat damage to a player, and paid life (CR 119.4: "the player loses
//     that much life");
//  2. the one-authority invariant behind (1): no engine module lowers a life
//     total by hand, so a new life-cost leg cannot bypass the tally;
//  3. the tally survives a stable-point DB round trip and clears at the next
//     turn (it is per TURN);
//  4. the `{ lifeLostThisTurn: { of } }` EffectValue reads it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { loseLifeEmitting, payLifeCost, resolveTopOfStack } from "../state";
import type { GameState } from "../state";
import { advancePhase, applyAllCombatDamage } from "../phases";
import { compactState, expandState } from "../serialize";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";

function freshState(): GameState {
    return makeState({
        players: [makePlayer("p1"), makePlayer("p2")],
    });
}

describe("lifeLostThisTurn — every life-lowering path feeds it (CR 119.3 / 119.4)", () => {
    it("a 'lose life' effect is tallied per player, accumulating", () => {
        const state = freshState();
        loseLifeEmitting(state, "p2", 2);
        loseLifeEmitting(state, "p2", 1);
        expect(state.lifeLostThisTurn).toEqual({ p2: 3 });
    });

    it("combat damage to a player is tallied (CR 120.3a)", () => {
        const attacker = makeInstance(grizzlyBears().id, {
            id: "attacker",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
            isTapped: true,
        });
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2"),
            ],
            combat: {
                attackerIds: ["attacker"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });
        applyAllCombatDamage(state, {});
        expect(state.players[1].life).toBe(18);
        expect(state.lifeLostThisTurn).toEqual({ p2: 2 });
    });

    it("paid life is life lost (CR 119.4) — and paying 0 is not (CR 119.4b)", () => {
        const state = freshState();
        payLifeCost(state, state.players[0], 0);
        expect(state.lifeLostThisTurn).toBeUndefined();
        payLifeCost(state, state.players[0], 2);
        expect(state.players[0].life).toBe(18);
        expect(state.lifeLostThisTurn).toEqual({ p1: 2 });
    });
});

/** The engine modules that may lower a life total directly: the tally's own
 *  writers (`state.ts`: `payLifeCost`, `loseLifeEmitting`,
 *  `reduceLifeFromDamage`) and the Bot's benchmark fixture, which builds a
 *  position rather than playing a move. */
const LIFE_WRITER_ALLOWLIST = new Set(["gre/state.ts", "gre/searchBench.ts"]);

function engineSources(dir: string, root: string, out: string[]): string[] {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
            if (name === "__tests__" || name === "_generated") continue;
            engineSources(path, root, out);
        } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
            out.push(path.slice(root.length + 1));
        }
    }
    return out;
}

describe("lifeLostThisTurn — one authority lowers a life total (issue #3237)", () => {
    it("no engine module outside the tally's writers does `life -=` by hand", () => {
        const root = join(__dirname, "..", "..");
        const files = [
            "game.ts",
            ...engineSources(join(root, "gre"), root, []),
        ];
        const offenders = files
            .filter((f) => !LIFE_WRITER_ALLOWLIST.has(f))
            .filter((f) =>
                /\.life\s*-=/.test(readFileSync(join(root, f), "utf8"))
            );
        // A hand-written decrement skips `recordLifeLost`: route it through
        // `payLifeCost` (a cost) or `loseLifeEmitting` (an effect).
        expect(offenders).toEqual([]);
    });
});

describe("lifeLostThisTurn — per turn, and persisted within it", () => {
    it("survives the stable-point compact/expand round trip", () => {
        const state = freshState();
        loseLifeEmitting(state, "p2", 4);
        const back = expandState(compactState(state));
        expect(back.lifeLostThisTurn).toEqual({ p2: 4 });
    });

    it("clears when the next turn begins", () => {
        const state = freshState();
        loseLifeEmitting(state, "p2", 4);
        state.phase = "CLEANUP";
        advancePhase(state);
        expect(state.activePlayerId).toBe("p2");
        expect(state.lifeLostThisTurn).toBeUndefined();
    });
});

/** A sorcery whose whole script is "if <player> lost life this turn, deal 3
 *  damage to the opponent, else 1" — the predicate shape Kaito's 0 uses. */
function tallyProbe(of: "controller" | "opponent"): CardDefinition {
    return {
        id: `test-life-lost-probe-${of}`,
        name: "Life Lost Probe",
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        oracleText: "",
        effects: [
            {
                op: "if",
                predicate: {
                    left: { lifeLostThisTurn: { of } },
                    op: "ge",
                    right: 1,
                },
                then: [
                    { op: "dealDamage", amount: 3, to: { player: "opponent" } },
                ],
                else: [
                    { op: "dealDamage", amount: 1, to: { player: "opponent" } },
                ],
            },
        ],
    };
}

describe("{ lifeLostThisTurn: { of } } EffectValue (CR 119.3)", () => {
    it("reads the selected player's tally — the branch is taken once they lost life", () => {
        const def = tallyProbe("opponent");
        withTemporaryDefinition(def, () => {
            const state = freshState();
            loseLifeEmitting(state, "p2", 1);
            pushSpell(state, def.id, "p1");
            resolveTopOfStack(state);
            expect(state.players[1].life).toBe(16); // 20 - 1 - 3
        });
    });

    it("reads 0 for a player who lost no life — another player's loss is not theirs", () => {
        const def = tallyProbe("controller");
        withTemporaryDefinition(def, () => {
            const state = freshState();
            loseLifeEmitting(state, "p2", 1);
            pushSpell(state, def.id, "p1");
            resolveTopOfStack(state);
            expect(state.players[1].life).toBe(18); // 20 - 1 - 1, else branch
        });
    });
});
