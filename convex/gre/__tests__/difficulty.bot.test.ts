// vs-AI difficulty presets (issue #114). Two things to prove: the presets are
// one knob (just budgets — no separate logic), and a higher preset measurably
// plays better than a lower one on a fixed seeded scenario. See
// `convex/gre/difficulty.ts`.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { search } from "../search";
import {
    DIFFICULTIES,
    DIFFICULTY_BUDGETS,
    DEFAULT_DIFFICULTY,
    budgetFor,
} from "../difficulty";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const GIANT = getCardByName("Hill Giant").id; // 3/3
const BOLT = getCardByName("Lightning Bolt").id; // R: 3 dmg any target
const MOUNTAIN = getCardByName("Mountain").id;

describe("difficulty presets — one knob (issue #114)", () => {
    it("defines a budget for every difficulty", () => {
        for (const d of DIFFICULTIES) {
            expect(DIFFICULTY_BUDGETS[d]).toBeDefined();
        }
    });

    it("presets differ only by search effort, strictly increasing", () => {
        const iters = DIFFICULTIES.map(
            (d) => DIFFICULTY_BUDGETS[d].iterations ?? 0
        );
        const times = DIFFICULTIES.map(
            (d) => DIFFICULTY_BUDGETS[d].timeMs ?? 0
        );
        // Monotonic: each step up searches more (and no other effort field is
        // set on a preset — `SearchBudget.minIterations` (issue #2685) is left
        // unset here so every preset inherits the same default early-stop
        // behaviour).
        for (let i = 1; i < iters.length; i++) {
            expect(iters[i]).toBeGreaterThan(iters[i - 1]);
            expect(times[i]).toBeGreaterThan(times[i - 1]);
        }
    });

    it("budgetFor maps a difficulty and falls back to the default for junk", () => {
        expect(budgetFor("hard")).toBe(DIFFICULTY_BUDGETS.hard);
        expect(budgetFor("easy")).toBe(DIFFICULTY_BUDGETS.easy);
        expect(budgetFor(null)).toBe(DIFFICULTY_BUDGETS[DEFAULT_DIFFICULTY]);
        expect(budgetFor("nonsense")).toBe(
            DIFFICULTY_BUDGETS[DEFAULT_DIFFICULTY]
        );
    });
});

describe("difficulty — a higher preset plays measurably better (issue #114)", () => {
    // Survive-lethal: p1 attacks with a lethal 3/3 and p2 (the bot) sits at 3
    // life with a Bolt + an untapped Mountain and no blocker. The ONLY survival
    // is to Bolt the attacker; passing is death (a huge negative for the bot, so
    // the engine's evaluation reads this cleanly and monotonically). A deeper
    // search finds the response reliably; a very shallow one (the `easy` preset)
    // explores too little of the tree and misreads it on many seeds — exactly
    // what makes `easy` beatable.
    const creature = (cardId: string, controllerId: string, id: string) =>
        makeInstance(cardId, {
            controllerId,
            ownerId: controllerId,
            id,
            isSummoningSick: false,
        });
    const land = (controllerId: string, id: string) =>
        makeInstance(MOUNTAIN, { controllerId, ownerId: controllerId, id });
    const bolt = (controllerId: string, id: string) =>
        makeInstance(BOLT, {
            controllerId,
            ownerId: controllerId,
            id,
            zone: "hand",
        });

    const makePos = () =>
        makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p2",
            players: [
                makePlayer("p1", {
                    life: 6,
                    battlefield: [
                        {
                            ...creature(GIANT, "p1", "ogre"),
                            isAttacking: true,
                            isTapped: true,
                        },
                    ],
                }),
                makePlayer("p2", {
                    life: 3,
                    hand: [bolt("p2", "b")],
                    battlefield: [land("p2", "m")],
                }),
            ],
            combat: {
                attackerIds: ["ogre"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });

    // Iteration-only budgets (drop the preset's wall-clock bound so the test is
    // deterministic regardless of CI speed); the relative effort is the preset's.
    const itersOnly = (n: number) => ({ iterations: n });
    const EASY = itersOnly(DIFFICULTY_BUDGETS.easy.iterations ?? 1);
    const HARD = itersOnly(DIFFICULTY_BUDGETS.hard.iterations ?? 1);

    const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

    const survives = (budget: { iterations: number }, seed: number) => {
        const move = search(makePos(), "p2", budget, seed);
        return move?.kind === "cast-spell" && move.targets[0]?.id === "ogre";
    };

    it("the hard preset survives the lethal attack on more seeds than easy", () => {
        const hardHits = SEEDS.filter((s) => survives(HARD, s)).length;
        const easyHits = SEEDS.filter((s) => survives(EASY, s)).length;
        // Hard reads the forced response every time; easy misses it often.
        expect(hardHits).toBe(SEEDS.length);
        expect(hardHits).toBeGreaterThan(easyHits);
    });
});
