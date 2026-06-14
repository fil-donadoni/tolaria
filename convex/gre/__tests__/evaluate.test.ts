// evaluate heuristic (issue #111, CR-agnostic position scoring). Asserts the
// ORDERING contract — winning > losing, and more life / board / cards / mana
// score higher all else equal — not the magnitudes (the weights are expected to
// be iterated). See `convex/gre/evaluate.ts`.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { evaluate, WIN_SCORE } from "../evaluate";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const BEARS = getCardByName("Grizzly Bears").id; // 2/2 ground
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
