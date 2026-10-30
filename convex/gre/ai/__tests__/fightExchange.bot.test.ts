// The Bot prices a fight by the power/toughness exchange (issue #5609,
// CR 701.14a). Every board assertion runs through the REAL card-value path —
// `evaluateBreakdown`'s `hand` term over a registered definition and a real
// board — so a lens nothing wires up cannot pass.
import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../../cards/registry";
import type { CardDefinition, EffectOp } from "../../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import { evaluateBreakdown } from "../../evaluate";
import { contextFreeGrounding, valueOp } from "../index";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { targetSlotBeneficence } from "../beneficence";

const FIGHT: EffectOp = {
    op: "fight",
    creature: { target: 0 },
    other: { target: 1 },
};

const body = (
    id: string,
    power: number,
    toughness: number,
    staticAbilities: string[] = []
): CardDefinition => ({
    id: `fight-exchange-test:${id}`,
    name: `Fight Exchange ${id}`,
    rarity: "common",
    manaCost: { generic: 2 },
    types: ["Creature"],
    power,
    toughness,
    staticAbilities,
});

/** "Target creature you control fights target creature an opponent
 *  controls" — both slots restricted. */
const RESTRICTED: CardDefinition = {
    id: "fight-exchange-test:restricted",
    name: "Fight Exchange Restricted",
    rarity: "common",
    manaCost: { generic: 2 },
    types: ["Sorcery"],
    targetRequirement: { type: "Creature", count: 1, controller: "you" },
    additionalTargetRequirements: [
        { type: "Creature", count: 1, controller: "opponent" },
    ],
    effects: [FIGHT],
};

/** "Target creature fights another target creature" — slot 0 unrestricted. */
const UNRESTRICTED: CardDefinition = {
    ...RESTRICTED,
    id: "fight-exchange-test:unrestricted",
    name: "Fight Exchange Unrestricted",
    targetRequirement: { type: "Creature", count: 1 },
    additionalTargetRequirements: [{ type: "Creature", count: 1 }],
};

function withBodies<T>(defs: CardDefinition[], fn: () => T): T {
    return defs.reduceRight<() => T>(
        (inner, def) => () => withTemporaryDefinition(def, inner),
        fn
    )();
}

type Board = { mine: CardDefinition[]; theirs: CardDefinition[] };

/** The `hand` term of p1 holding `spell`, over `board`. */
function latentInHand(spell: CardDefinition, board: Board): number {
    return withBodies([spell, ...board.mine, ...board.theirs], () => {
        const hand = makeInstance(spell.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [hand],
                    battlefield: board.mine.map((d) =>
                        makeInstance(d.id, {
                            controllerId: "p1",
                            ownerId: "p1",
                        })
                    ),
                }),
                makePlayer("p2", {
                    battlefield: board.theirs.map((d) =>
                        makeInstance(d.id, {
                            controllerId: "p2",
                            ownerId: "p2",
                        })
                    ),
                }),
            ],
        });
        return evaluateBreakdown(state, "p1").self.hand;
    });
}

describe("fight pricing reads the exchange (CR 701.14a, CR 704.5g)", () => {
    const victim = body("victim44", 4, 4);

    it("a fighter that cannot kill the victim is worth less than one that can", () => {
        const small = body("small11", 1, 1);
        const big = body("big66", 6, 6);
        const cannot = latentInHand(RESTRICTED, {
            mine: [small],
            theirs: [victim],
        });
        const can = latentInHand(RESTRICTED, { mine: [big], theirs: [victim] });
        expect(can).toBeGreaterThan(cannot);
    });

    it("a fight that loses the fighter and kills nothing is worth nothing in hand", () => {
        const small = body("small11b", 1, 1);
        expect(
            latentInHand(RESTRICTED, { mine: [small], theirs: [victim] })
        ).toBeLessThanOrEqual(0);
    });

    it("a mutual kill is worth less than a fighter that survives", () => {
        const trader = body("trader44", 4, 4);
        const big = body("big66b", 6, 6);
        const trade = latentInHand(RESTRICTED, {
            mine: [trader],
            theirs: [victim],
        });
        const clean = latentInHand(RESTRICTED, {
            mine: [big],
            theirs: [victim],
        });
        expect(clean).toBeGreaterThan(trade);
    });

    it("deathtouch on the fighter makes a 1/1 lethal", () => {
        const plain = body("plain11", 1, 1);
        const toucher = body("toucher11", 1, 1, ["deathtouch"]);
        const without = latentInHand(RESTRICTED, {
            mine: [plain],
            theirs: [victim],
        });
        const withIt = latentInHand(RESTRICTED, {
            mine: [toucher],
            theirs: [victim],
        });
        expect(withIt).toBeGreaterThan(without);
    });

    it("deathtouch on the victim makes the fighter's loss lethal", () => {
        const big = body("big66c", 6, 6);
        const toucherVictim = body("toucherVictim", 1, 1, ["deathtouch"]);
        const plainVictim = body("plainVictim", 1, 1);
        const against = latentInHand(RESTRICTED, {
            mine: [big],
            theirs: [toucherVictim],
        });
        const free = latentInHand(RESTRICTED, {
            mine: [big],
            theirs: [plainVictim],
        });
        expect(free).toBeGreaterThan(against);
    });

    it("an indestructible victim survives lethal damage (CR 702.12b)", () => {
        const big = body("big66e", 6, 6);
        const solid = body("solid44", 4, 4, ["indestructible"]);
        const plain = latentInHand(RESTRICTED, {
            mine: [big],
            theirs: [victim],
        });
        const shielded = latentInHand(RESTRICTED, {
            mine: [big],
            theirs: [solid],
        });
        expect(plain).toBeGreaterThan(shielded);
    });

    it("an unrestricted slot 0 pairs two opposing creatures when they trade well", () => {
        const small = body("small11c", 1, 1);
        const bigOpp = body("bigOpp66", 6, 6);
        const smallOpp = body("smallOpp11", 1, 1);
        // The Bot's only creature cannot kill anything; two opposing ones can.
        const pair = latentInHand(UNRESTRICTED, {
            mine: [small],
            theirs: [bigOpp, smallOpp],
        });
        const alone = latentInHand(UNRESTRICTED, {
            mine: [small],
            theirs: [victim],
        });
        expect(pair).toBeGreaterThan(alone);
    });

    it("an unrestricted slot 0 uses the Bot's own lethal creature when no opposing pair trades", () => {
        const big = body("big66d", 6, 6);
        const withOwn = latentInHand(UNRESTRICTED, {
            mine: [big],
            theirs: [victim],
        });
        const without = latentInHand(UNRESTRICTED, {
            mine: [],
            theirs: [victim],
        });
        expect(withOwn).toBeGreaterThan(without);
    });
});

describe("the fight valuer (CR 701.14a)", () => {
    const grounding = (fightUnits?: (a: number, b: number) => number) => {
        const base = contextFreeGrounding();
        return {
            ...base,
            latent: { ...base.latent, fightUnits },
        };
    };

    it("prices a net-positive exchange as boardRemoval units", () => {
        const v = valueOp(
            FIGHT,
            grounding(() => 2)
        );
        expect(v.points).toBe(2 * DEFAULT_EVAL_WEIGHTS.latent.boardRemoval);
    });

    it("prices a net-negative exchange at or below zero", () => {
        const v = valueOp(
            FIGHT,
            grounding(() => -1)
        );
        expect(v.points).toBeLessThanOrEqual(0);
    });

    it("keeps today's half-removal constant when the pair is unreadable", () => {
        const v = valueOp(FIGHT, contextFreeGrounding());
        expect(v.points).toBe(DEFAULT_EVAL_WEIGHTS.latent.boardRemoval / 2);
    });
});

describe("the fight sign is split per slot", () => {
    it("signs only the fought creature harmful, leaving the fighter to the valuer", () => {
        expect(targetSlotBeneficence(RESTRICTED, undefined, 0)).toBe("neutral");
        expect(targetSlotBeneficence(RESTRICTED, undefined, 1)).toBe("harmful");
    });
});
