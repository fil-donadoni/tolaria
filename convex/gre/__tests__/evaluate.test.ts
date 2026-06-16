// evaluate heuristic (issue #111, CR-agnostic position scoring). Asserts the
// ORDERING contract — winning > losing, and more life / board / cards / mana
// score higher all else equal — not the magnitudes (the weights are expected to
// be iterated). See `convex/gre/evaluate.ts`.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    cardValue,
    evaluate,
    evaluateCreature,
    materialMargin,
    WIN_SCORE,
} from "../evaluate";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const BEARS = getCardByName("Grizzly Bears").id; // 2/2 ground
const GIANT = getCardByName("Hill Giant").id; // 3/3 ground
const SPRITES = getCardByName("Scryb Sprites").id; // 1/1 flying
const MOUNTAIN = getCardByName("Mountain").id;

function bear(controllerId: string, id: string) {
    return makeInstance(BEARS, { controllerId, ownerId: controllerId, id });
}

describe("evaluate (issue #111)", () => {
    it("a won position outranks any non-won position", () => {
        const won = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { life: 0 })],
        });
        const even = makeState();
        expect(evaluate(won, "p1")).toBeGreaterThan(evaluate(even, "p1"));
        expect(evaluate(won, "p1")).toBeGreaterThanOrEqual(WIN_SCORE);
    });

    it("a lost position ranks below every non-lost position", () => {
        const lost = makeState({
            players: [makePlayer("p1", { life: 0 }), makePlayer("p2")],
        });
        const even = makeState();
        expect(evaluate(lost, "p1")).toBeLessThan(evaluate(even, "p1"));
        expect(evaluate(lost, "p1")).toBeLessThanOrEqual(-WIN_SCORE);
    });

    it("is zero-sum symmetric: my win is the opponent's loss", () => {
        const s = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { life: 0 })],
        });
        expect(evaluate(s, "p1")).toBeGreaterThanOrEqual(WIN_SCORE);
        expect(evaluate(s, "p2")).toBeLessThanOrEqual(-WIN_SCORE);
    });

    it("more life scores higher, all else equal", () => {
        const ahead = makeState({
            players: [makePlayer("p1", { life: 20 }), makePlayer("p2")],
        });
        const behind = makeState({
            players: [makePlayer("p1", { life: 10 }), makePlayer("p2")],
        });
        expect(evaluate(ahead, "p1")).toBeGreaterThan(evaluate(behind, "p1"));
    });

    it("more board presence scores higher", () => {
        const withBoard = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear("p1", "b1")] }),
                makePlayer("p2"),
            ],
        });
        const empty = makeState();
        expect(evaluate(withBoard, "p1")).toBeGreaterThan(
            evaluate(empty, "p1")
        );
        // The opponent having the same board flips the sign.
        const oppBoard = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear("p2", "b2")] }),
            ],
        });
        expect(evaluate(oppBoard, "p1")).toBeLessThan(evaluate(empty, "p1"));
    });

    it("card advantage (hand size) scores higher", () => {
        const moreCards = makeState({
            players: [
                makePlayer("p1", {
                    hand: [bear("p1", "h1"), bear("p1", "h2")],
                }),
                makePlayer("p2"),
            ],
        });
        const fewerCards = makeState({
            players: [
                makePlayer("p1", { hand: [bear("p1", "h1")] }),
                makePlayer("p2"),
            ],
        });
        expect(evaluate(moreCards, "p1")).toBeGreaterThan(
            evaluate(fewerCards, "p1")
        );
    });

    it("untapped mana sources count as available mana", () => {
        const untapped = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(MOUNTAIN, {
                            controllerId: "p1",
                            ownerId: "p1",
                            id: "m1",
                            isTapped: false,
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const tapped = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(MOUNTAIN, {
                            controllerId: "p1",
                            ownerId: "p1",
                            id: "m1",
                            isTapped: true,
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(evaluate(untapped, "p1")).toBeGreaterThan(
            evaluate(tapped, "p1")
        );
    });

    it("developing a land scores strictly higher than holding it in hand (issue #149)", () => {
        // Same land, all else equal: in hand vs in play. A land drop must be a
        // strictly positive evaluation delta or the bot ties play-land with pass
        // and stalls its own mana. Asserted for both the leaf heuristic
        // (`evaluate`) and the ISMCTS tie-break margin (`materialMargin`).
        const landInHand = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(MOUNTAIN, {
                            controllerId: "p1",
                            ownerId: "p1",
                            id: "m1",
                            zone: "hand",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const landInPlay = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(MOUNTAIN, {
                            controllerId: "p1",
                            ownerId: "p1",
                            id: "m1",
                            isTapped: false,
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(evaluate(landInPlay, "p1")).toBeGreaterThan(
            evaluate(landInHand, "p1")
        );
        expect(materialMargin(landInPlay, "p1")).toBeGreaterThan(
            materialMargin(landInHand, "p1")
        );
    });

    it("an evasive creature is worth more than a ground creature of equal power", () => {
        // 1/1 flyer vs an artificially-equal ground baseline: give p1 a flyer,
        // p2 a vanilla 1/1-equivalent. The flyer's evasion bonus tips p1 ahead.
        const flyer = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(SPRITES, {
                            controllerId: "p1",
                            ownerId: "p1",
                            id: "f1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(SPRITES, {
                            controllerId: "p2",
                            ownerId: "p2",
                            id: "f2",
                            staticAbilities: [], // strip flying → ground 1/1
                        }),
                    ],
                }),
            ],
        });
        expect(evaluate(flyer, "p1")).toBeGreaterThan(0);
    });
});

// Forge `evaluateCreature` port + Forge-scale magnitudes (ADR 0018, issue #194).
// Ordering asserts only — the weights are expected to be re-tuned.
describe("evaluateCreature — Forge scale & keyword vocabulary (ADR 0018)", () => {
    /** A bare creature instance in a one-creature state, so `evaluateCreature`
     *  can read effective P/T through the layer system. */
    function loneCreature(
        cardId: string,
        overrides: Partial<Parameters<typeof makeInstance>[1]> = {}
    ) {
        const inst = makeInstance(cardId, {
            controllerId: "p1",
            ownerId: "p1",
            id: "c",
            ...overrides,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst] }),
                makePlayer("p2"),
            ],
        });
        return { state, inst };
    }

    it("is Forge-scale: a vanilla 2/2 is worth in the hundreds", () => {
        const { state, inst } = loneCreature(BEARS);
        expect(evaluateCreature(state, inst)).toBeGreaterThan(100);
    });

    it("a bigger body is worth more (power + toughness weighted)", () => {
        const bears = loneCreature(BEARS); // 2/2
        const giant = loneCreature(GIANT); // 3/3
        expect(evaluateCreature(giant.state, giant.inst)).toBeGreaterThan(
            evaluateCreature(bears.state, bears.inst)
        );
    });

    it("higher mana value adds worth, all else equal", () => {
        // Same body (2/2), different embedded mana cost — `getInstanceManaCost`
        // reads the embedded cost first, so this isolates the MV term.
        const cheap = loneCreature(BEARS, {
            card: { id: BEARS, manaCost: { G: 1, C: 1 } }, // MV 2
        });
        const pricey = loneCreature(BEARS, {
            card: { id: BEARS, manaCost: { G: 1, C: 5 } }, // MV 6
        });
        expect(evaluateCreature(pricey.state, pricey.inst)).toBeGreaterThan(
            evaluateCreature(cheap.state, cheap.inst)
        );
    });

    it("evasion is power-scaled: the flying bonus grows with power", () => {
        // Flying on a 3/3 is worth more than flying on a 1/1 — the bonus tracks
        // the damage the evasion pushes through (CR 509.1b).
        const bigFlyer = loneCreature(GIANT, { staticAbilities: ["flying"] });
        const bigGround = loneCreature(GIANT, { staticAbilities: [] });
        const smallFlyer = loneCreature(SPRITES, {
            staticAbilities: ["flying"],
        });
        const smallGround = loneCreature(SPRITES, { staticAbilities: [] });
        const bigBonus =
            evaluateCreature(bigFlyer.state, bigFlyer.inst) -
            evaluateCreature(bigGround.state, bigGround.inst);
        const smallBonus =
            evaluateCreature(smallFlyer.state, smallFlyer.inst) -
            evaluateCreature(smallGround.state, smallGround.inst);
        expect(bigBonus).toBeGreaterThan(smallBonus);
        expect(smallBonus).toBeGreaterThan(0);
    });

    it("defender is penalised: it can't attack, so its power is dead weight", () => {
        const wall = loneCreature(GIANT, { staticAbilities: ["defender"] });
        const attacker = loneCreature(GIANT, { staticAbilities: [] });
        expect(evaluateCreature(wall.state, wall.inst)).toBeLessThan(
            evaluateCreature(attacker.state, attacker.inst)
        );
    });

    it("an unimplemented keyword is zero-cost (no entry → no bonus)", () => {
        // Structured so a new keyword drops in at one weight entry: a keyword the
        // table doesn't know adds nothing, equalling the vanilla value.
        const known = loneCreature(GIANT, { staticAbilities: [] });
        const unknown = loneCreature(GIANT, {
            staticAbilities: ["totally-made-up-keyword"],
        });
        expect(evaluateCreature(unknown.state, unknown.inst)).toBe(
            evaluateCreature(known.state, known.inst)
        );
    });

    it("WIN_SCORE dominates even a wide Forge-scale board", () => {
        // Ten 3/3s a side is a far wider board than the engine's card pool
        // supports; the material margin must still be a small fraction of
        // WIN_SCORE so a win always outranks any material lead.
        const ten = (owner: string) =>
            [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) =>
                makeInstance(GIANT, {
                    controllerId: owner,
                    ownerId: owner,
                    id: `${owner}-g${i}`,
                })
            );
        const wide = makeState({
            players: [
                makePlayer("p1", { battlefield: ten("p1") }),
                makePlayer("p2"),
            ],
        });
        expect(Math.abs(materialMargin(wide, "p1"))).toBeLessThan(WIN_SCORE);
    });
});

// Latent `cardValue` primitive + hand term (ADR 0018, issue #195). Ordering
// asserts only.
describe("cardValue — latent worth + aiValue override (ADR 0018)", () => {
    const state = makeState();
    const inHand = (cardId: string, extra = {}) =>
        makeInstance(cardId, {
            controllerId: "p1",
            ownerId: "p1",
            id: "h",
            zone: "hand",
            ...extra,
        });

    it("a creature outranks a basic land (a bomb is not pitched for a land)", () => {
        expect(cardValue(state, inHand(BEARS))).toBeGreaterThan(
            cardValue(state, inHand(MOUNTAIN))
        );
    });

    it("a bigger creature is worth more latent than a smaller one", () => {
        expect(cardValue(state, inHand(GIANT))).toBeGreaterThan(
            cardValue(state, inHand(BEARS))
        );
    });

    it("latent creature worth is a discount of its realized board worth", () => {
        // A creature in hand still has to be cast and survive, so its latent
        // worth is below the realized `evaluateCreature` — which keeps deploying
        // it a strictly positive move.
        const onBoard = makeInstance(GIANT, {
            controllerId: "p1",
            ownerId: "p1",
            id: "b",
        });
        const boardState = makeState({
            players: [
                makePlayer("p1", { battlefield: [onBoard] }),
                makePlayer("p2"),
            ],
        });
        expect(cardValue(state, inHand(GIANT))).toBeLessThan(
            evaluateCreature(boardState, onBoard)
        );
    });

    it("aiValue on the card overrides the derived value verbatim", () => {
        // Embedded override (the registry path is the production source; fixtures
        // may inline it). A duct-taped 1 beats nothing, a 9999 bomb beats a land.
        const dud = inHand(GIANT, { card: { id: GIANT, aiValue: 1 } });
        const bomb = inHand(MOUNTAIN, {
            card: { id: MOUNTAIN, aiValue: 9999 },
        });
        expect(cardValue(state, dud)).toBe(1);
        expect(cardValue(state, bomb)).toBe(9999);
        // Override flips the natural order: the "bomb land" now outranks a real
        // creature, the "dud giant" falls below a basic land.
        expect(cardValue(state, bomb)).toBeGreaterThan(
            cardValue(state, inHand(GIANT))
        );
        expect(cardValue(state, dud)).toBeLessThan(
            cardValue(state, inHand(MOUNTAIN))
        );
    });

    it("the hand term sums cardValue: a hand of bombs out-scores a hand of lands", () => {
        const bombs = makeState({
            players: [
                makePlayer("p1", {
                    hand: [inHand(GIANT), makeInstance(GIANT, { id: "h2" })],
                }),
                makePlayer("p2"),
            ],
        });
        const lands = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        inHand(MOUNTAIN),
                        makeInstance(MOUNTAIN, { id: "h2" }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(evaluate(bombs, "p1")).toBeGreaterThan(evaluate(lands, "p1"));
    });
});
