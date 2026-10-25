/**
 * The Bot's declared-combat predictor honours the attack target (issue #2798).
 *
 * CR 508.1b: the active player announces which player or planeswalker each
 * attacker is attacking. CR 510.1b: an unblocked creature assigns its combat
 * damage to what it is attacking — and to nothing once that planeswalker has
 * left the battlefield. CR 120.3c: damage dealt to a planeswalker removes that
 * many loyalty counters. So damage aimed at a walker is never the defending
 * player's life, and each consumer of `predictCombatOutcome` must price the
 * two resources apart.
 */
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    declaredBlockDelta,
    declaredCombatDelta,
    permanentRealisedValue,
} from "../evaluate";
import { predictCombatOutcome } from "../dangerClock";
import { applyMoveInSearch, isWastefulAttack } from "../search";
import { cloneGameState } from "../clone";
import type { CardInstanceState, GameState } from "../state";
import type { Move } from "../moves";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const BEARS = getCardByName("Grizzly Bears").id; // 2/2 ground
const GIANT = getCardByName("Hill Giant").id; // 3/3 ground
const IRONROOT = getCardByName("Ironroot Treefolk").id; // 3/5 ground
const SPIDER = getCardByName("Giant Spider").id; // 2/4 reach
const WALKER = getCardByName("Garruk Wildspeaker").id; // loyalty 3

const attacker = (cardId: string, id: string): CardInstanceState =>
    makeInstance(cardId, {
        controllerId: "p1",
        ownerId: "p1",
        id,
        isSummoningSick: false,
        isAttacking: true,
        isTapped: true,
    });
const defenderCreature = (cardId: string, id: string): CardInstanceState =>
    makeInstance(cardId, {
        controllerId: "p2",
        ownerId: "p2",
        id,
        isSummoningSick: false,
    });
const walker = (loyalty: number): CardInstanceState =>
    makeInstance(WALKER, {
        controllerId: "p2",
        ownerId: "p2",
        id: "pw",
        counters: { loyalty },
    });

/** p1 has declared `attackers`; `atWalker` lists the ones aimed at "pw". */
function declared(
    attackers: CardInstanceState[],
    defenderBoard: CardInstanceState[],
    atWalker: string[],
    blockersConfirmed = false
): GameState {
    return makeState({
        phase: "DECLARE_BLOCKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: attackers }),
            makePlayer("p2", { battlefield: defenderBoard }),
        ],
        combat: {
            attackerIds: attackers.map((a) => a.id),
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed,
            ...(atWalker.length > 0
                ? {
                      attackTargets: Object.fromEntries(
                          atWalker.map((id) => [id, "pw"])
                      ),
                  }
                : {}),
        },
    });
}

describe("predictCombatOutcome — the declared attack target (CR 508.1b, CR 510.1b)", () => {
    it("an unblocked attacker aimed at a planeswalker deals the player nothing", () => {
        const state = declared([attacker(GIANT, "g")], [walker(5)], ["g"]);
        const out = predictCombatOutcome(state, "p1", "p2");
        expect(out.faceDamage).toBe(0);
        expect(out.facePoison).toBe(0);
        expect(out.walkerDamage).toEqual({ pw: 3 });
    });

    it("splits a mixed attack — the player's share and the walker's, not all or nothing", () => {
        const state = declared(
            [attacker(GIANT, "g"), attacker(BEARS, "b")],
            [walker(5)],
            ["b"]
        );
        const out = predictCombatOutcome(state, "p1", "p2");
        expect(out.faceDamage).toBe(3);
        expect(out.walkerDamage).toEqual({ pw: 2 });
    });
});

describe("declaredCombatDelta — walker damage is loyalty, not life (CR 120.3c)", () => {
    it("the defender's view of an attack at its own walker carries no life term", () => {
        // CR 510.1b — the walker already left the battlefield, so the attack
        // deals nothing at all: the defender's clock is untouched.
        const gone = declared([attacker(GIANT, "g")], [], ["g"]);
        expect(declaredCombatDelta(gone, "p2")).toBeCloseTo(0, 6);
        expect(declaredCombatDelta(gone, "p1")).toBeCloseTo(0, 6);
    });

    it("prices a lethal attack at the walker as the walker's whole worth (CR 704.5i)", () => {
        const pw = walker(3);
        const state = declared([attacker(GIANT, "g")], [pw], ["g"]);
        const worth = permanentRealisedValue(state, pw, DEFAULT_EVAL_WEIGHTS);
        expect(worth).toBeGreaterThan(0);
        expect(declaredCombatDelta(state, "p2")).toBeCloseTo(-worth, 6);
        expect(declaredCombatDelta(state, "p1")).toBeCloseTo(worth, 6);
    });
});

describe("declaredCombatDelta — a walker that survives loses only loyalty", () => {
    it("prices loyalty removed short of zero as part of the walker's worth", () => {
        // 2 damage at loyalty 3 leaves it at 1 (CR 120.3c): part of its
        // worth, never the whole of it, and never life.
        const pw = walker(3);
        const state = declared([attacker(BEARS, "b")], [pw], ["b"]);
        const worth = permanentRealisedValue(state, pw, DEFAULT_EVAL_WEIGHTS);
        const delta = declaredCombatDelta(state, "p2");
        expect(delta).toBeLessThan(0);
        expect(delta).toBeGreaterThan(-worth);
    });
});

describe("declaredBlockDelta — an unblocked attacker at a walker is not face damage", () => {
    it("is zero when the attacked walker has left the battlefield (CR 510.1b)", () => {
        const state = declared([attacker(GIANT, "g")], [], ["g"], true);
        expect(declaredBlockDelta(state, "p2")).toBeCloseTo(0, 6);
    });

    it("costs the defender the walker it lets die (CR 704.5i)", () => {
        const pw = walker(3);
        const state = declared([attacker(GIANT, "g")], [pw], ["g"], true);
        const worth = permanentRealisedValue(state, pw, DEFAULT_EVAL_WEIGHTS);
        expect(declaredBlockDelta(state, "p2")).toBeCloseTo(-worth, 6);
    });
});

describe("isWastefulAttack — a walker attack on its own merits (issue #2798)", () => {
    function attackDecision(defenderBoard: CardInstanceState[]): GameState {
        const g = makeInstance(IRONROOT, {
            controllerId: "p1",
            ownerId: "p1",
            id: "ir",
            isSummoningSick: false,
        });
        return makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [g] }),
                makePlayer("p2", { battlefield: defenderBoard }),
            ],
            combat: {
                attackerIds: [],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
    }
    const atWalker: Move = {
        kind: "declare-attackers",
        attackerIds: ["ir"],
        attackTargets: { ir: "pw" },
    };

    it("the in-tree declaration keeps the announced planeswalker target (CR 508.1b)", () => {
        const probe = cloneGameState(attackDecision([walker(5)]));
        applyMoveInSearch(probe, "p1", atWalker);
        expect(probe.combat?.attackTargets).toEqual({ ir: "pw" });
        // A walker the defender no longer controls is no target at all.
        const gone = cloneGameState(attackDecision([]));
        applyMoveInSearch(gone, "p1", atWalker);
        expect(gone.combat?.attackTargets).toBeUndefined();
    });

    it("an unblocked attack on a planeswalker is NOT wasteful", () => {
        expect(isWastefulAttack(attackDecision([walker(5)]), atWalker)).toBe(
            false
        );
    });

    it("an attack on a planeswalker a blocker absorbs for free IS wasteful", () => {
        // Giant Spider (2/4) survives the 3/5 and takes every point: nothing
        // reaches the walker, nothing dies.
        const state = attackDecision([
            walker(5),
            defenderCreature(SPIDER, "spider"),
        ]);
        expect(isWastefulAttack(state, atWalker)).toBe(true);
    });
});
