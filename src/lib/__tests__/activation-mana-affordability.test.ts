// Issue #10370 — full path GRE → projection → client enumerators: an activated
// ability whose mana cost the viewer cannot fund is neither listed nor counted
// toward the actionable ring (CR 602.2b / 601.2g), for a hand ability
// (Swampcycling) and a battlefield one (Pestilence's {B}); an affordable or
// mana-free ability is unchanged.
import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { projectPublicState } from "@convex/gameProjections";
import type { CardInstanceState, GameState } from "@convex/gre/state";
import type { CardInstance } from "~/types/game";
import { getHandStackAbilities, getStackAbilities } from "../card-utils";
import { cardHasLegalAction } from "../card-actionable";

const TROLL = getCardByName("Troll of Khazad-dûm").id;
const PESTILENCE = getCardByName("Pestilence").id;
const GLASSES = getCardByName("Glasses of Urza").id;
const SWAMP = getCardByName("Swamp").id;

function swamps(n: number, tapped: boolean): CardInstanceState[] {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(SWAMP, {
            id: `swamp-${tapped ? "t" : "u"}${i}`,
            controllerId: "p1",
            zone: "battlefield",
            isTapped: tapped,
        })
    );
}

function board(
    hand: CardInstanceState[],
    battlefield: CardInstanceState[]
): GameState {
    return makeState({
        phase: "POSTCOMBAT_MAIN",
        players: [makePlayer("p1", { hand, battlefield }), makePlayer("p2")],
    });
}

function projectedMe(state: GameState) {
    return projectPublicState(state, 1, "p1").players[0];
}

/** The hand card's options and its ring, exactly as `gre-hand-card` derives
 *  both from one list. */
function handAffordance(state: GameState, id: string) {
    const card = projectedMe(state).hand!.find(
        (c) => c?.id === id
    ) as unknown as CardInstance;
    const options = getHandStackAbilities(
        card,
        "POSTCOMBAT_MAIN",
        { players: [] },
        undefined,
        20
    );
    const ringed = cardHasLegalAction(true, {
        legalActions: card.legalActions,
        activatableAbilityCount: options.length,
    });
    return { options, ringed };
}

/** The permanent's options and its ring: the battlefield card rings off the
 *  same `activatableAbilities` list its menu opens. */
function permanentAffordance(state: GameState, id: string) {
    const card = projectedMe(state).battlefield.find(
        (c) => c.id === id
    ) as unknown as CardInstance;
    const options = getStackAbilities(card, "POSTCOMBAT_MAIN");
    const ringed = cardHasLegalAction(true, {
        activatableAbilityCount: options.length,
    });
    return { options, ringed };
}

describe("hand: Swampcycling {1} (CR 702.29e)", () => {
    const troll = () =>
        makeInstance(TROLL, { id: "troll", zone: "hand", controllerId: "p1" });

    it("all lands tapped, empty pool: no option, no ring", () => {
        const got = handAffordance(board([troll()], swamps(5, true)), "troll");
        expect(got.options).toEqual([]);
        expect(got.ringed).toBe(false);
    });

    it("one untapped land: the ability is offered and the card rings", () => {
        const got = handAffordance(
            board([troll()], [...swamps(4, true), ...swamps(1, false)]),
            "troll"
        );
        expect(got.options.map((o) => o.oracleText)).toEqual([
            expect.stringContaining("Swampcycling"),
        ]);
        expect(got.ringed).toBe(true);
    });
});

describe("battlefield: a {B}-cost activated ability", () => {
    const pest = () =>
        makeInstance(PESTILENCE, { id: "pest", controllerId: "p1" });

    it("no mana available: no option, no ring", () => {
        const got = permanentAffordance(
            board([], [pest(), ...swamps(2, true)]),
            "pest"
        );
        expect(got.options).toEqual([]);
        expect(got.ringed).toBe(false);
    });

    it("an untapped Swamp: the ability is offered and the permanent rings", () => {
        const got = permanentAffordance(
            board([], [pest(), ...swamps(1, false)]),
            "pest"
        );
        expect(got.options.map((o) => o.id)).toEqual(["pestilence-damage"]);
        expect(got.ringed).toBe(true);
    });

    it("a {T}-only ability still rings with zero mana available", () => {
        const got = permanentAffordance(
            board(
                [],
                [makeInstance(GLASSES, { id: "glasses", controllerId: "p1" })]
            ),
            "glasses"
        );
        expect(got.options).toHaveLength(1);
        expect(got.ringed).toBe(true);
    });
});
