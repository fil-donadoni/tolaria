// The alternative cost's GRAVEYARD exile leg (CR 118.9 / 701.13 / 404.2) —
// Spinning Darkness's "You may exile the top three black cards of your
// graveyard rather than pay this spell's mana cost": the selection is the
// three TOPMOST black cards (a non-black card above them is passed over), the
// payer picks nothing, and fewer than three makes the alternative
// unaffordable. The may-pay path refuses the exile action (it returns cards).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { makePlayer, makeState } from "../../cards/__tests__/setup.helper";
import type { AlternativeCost, CostLegs } from "../../cards/types";
import {
    affordableAlternativeCosts,
    altCostGraveyardExileCards,
    canPayAlternativeCost,
    withAlternativeCostGraveyardExile,
} from "../alternativeCost";
import { canPayMayPayCost, getPlayer } from "../state";
import type { GameState } from "../state";
import {
    ALT_GRAVEYARD_EXILE_UNTARGETED_ID,
    EXILE_TOP_THREE_BLACK,
    ownedCard,
} from "./fixtures/altCostGraveyardExileProbe.fixture";

const RITUAL = getCardByName("Dark Ritual").id;
const TERROR = getCardByName("Terror").id;
const VAMPIRE = getCardByName("Sengir Vampire").id;
const BEARS = getCardByName("Grizzly Bears").id;
const LIONS = getCardByName("Savannah Lions").id;

/** p1's graveyard, BOTTOM first (CR 404.2 — the last element is the top). */
function board(graveyard: [string, string][]): GameState {
    return makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                hand: [
                    ownedCard(
                        ALT_GRAVEYARD_EXILE_UNTARGETED_ID,
                        "probe",
                        "p1",
                        "hand"
                    ),
                ],
                graveyard: graveyard.map(([def, id]) =>
                    ownedCard(def, id, "p1", "graveyard")
                ),
            }),
            makePlayer("p2"),
        ],
    });
}

/** Four black cards, two non-black ones interleaved; the top is a white card. */
const FOUR_BLACK: [string, string][] = [
    [RITUAL, "oldest-black"],
    [RITUAL, "ritual"],
    [TERROR, "terror"],
    [BEARS, "bears"],
    [VAMPIRE, "vampire"],
    [LIONS, "lions"],
];

const ids = (cards: readonly { id: string }[] | undefined) =>
    cards?.map((c) => c.id);

describe("alternative cost — graveyard exile leg (CR 118.9 / 701.13)", () => {
    it("takes the three TOPMOST black cards, passing over non-black ones above them (CR 404.2)", () => {
        const p1 = getPlayer(board(FOUR_BLACK), "p1");
        expect(
            ids(altCostGraveyardExileCards(p1, EXILE_TOP_THREE_BLACK, "probe"))
        ).toEqual(["vampire", "terror", "ritual"]);
    });

    it("is unpayable with fewer than three black cards, and the cast option is withdrawn", () => {
        const state = board([
            [RITUAL, "ritual"],
            [BEARS, "bears"],
            [TERROR, "terror"],
            [LIONS, "lions"],
        ]);
        const p1 = getPlayer(state, "p1");
        expect(
            altCostGraveyardExileCards(p1, EXILE_TOP_THREE_BLACK, "probe")
        ).toBeUndefined();
        expect(
            canPayAlternativeCost(state, "p1", EXILE_TOP_THREE_BLACK, "probe")
        ).toBe(false);
        expect(affordableAlternativeCosts(state, p1, p1.hand[0]!)).toEqual([]);
        expect(() =>
            withAlternativeCostGraveyardExile(
                p1,
                EXILE_TOP_THREE_BLACK,
                "probe",
                undefined
            )
        ).toThrow(/Not enough matching cards/);
    });

    it("offers the cast option once three black cards sit in the graveyard", () => {
        const state = board(FOUR_BLACK);
        const p1 = getPlayer(state, "p1");
        expect(
            affordableAlternativeCosts(state, p1, p1.hand[0]!).map((a) => a.id)
        ).toEqual([EXILE_TOP_THREE_BLACK.id]);
    });

    it("never counts the cast card itself (CR 601.2a)", () => {
        // The probe is black ({B}{B}) and sits on TOP of the graveyard, as on
        // a cast from the graveyard: it is on the stack before costs are paid.
        const state = board([
            [RITUAL, "ritual"],
            [TERROR, "terror"],
            [VAMPIRE, "vampire"],
            [ALT_GRAVEYARD_EXILE_UNTARGETED_ID, "self"],
        ]);
        const p1 = getPlayer(state, "p1");
        expect(
            ids(altCostGraveyardExileCards(p1, EXILE_TOP_THREE_BLACK, "self"))
        ).toEqual(["vampire", "terror", "ritual"]);
        const twoOthers = board([
            [TERROR, "terror"],
            [VAMPIRE, "vampire"],
            [ALT_GRAVEYARD_EXILE_UNTARGETED_ID, "self"],
        ]);
        expect(
            canPayAlternativeCost(
                twoOthers,
                "p1",
                EXILE_TOP_THREE_BLACK,
                "self"
            )
        ).toBe(false);
    });

    it("pre-fills the cast's graveyard-exile picker with the top-N pick", () => {
        const p1 = getPlayer(board(FOUR_BLACK), "p1");
        expect(
            withAlternativeCostGraveyardExile(
                p1,
                EXILE_TOP_THREE_BLACK,
                "probe",
                undefined
            )
        ).toEqual({
            count: 3,
            excludeInstanceId: "probe",
            pickedCardIds: ["vampire", "terror", "ritual"],
            // CR 601.2h — positional: re-derived at payment.
            topMatching: { color: "B" },
        });
        // A cost with no graveyard leg leaves the slot as it was.
        const existing = { count: 1, excludeInstanceId: "probe" };
        expect(
            withAlternativeCostGraveyardExile(
                p1,
                { life: 1 },
                "probe",
                existing
            )
        ).toBe(existing);
        expect(() =>
            withAlternativeCostGraveyardExile(
                p1,
                EXILE_TOP_THREE_BLACK,
                "probe",
                existing
            )
        ).toThrow(/cannot be paid together/);
    });

    it("still refuses the may-pay-only RETURN action as an alternative cost", () => {
        const returnLeg: AlternativeCost = {
            id: "return-three-black",
            description: "Return three black cards",
            graveyard: { action: "return", filter: { color: "B" }, count: 3 },
        };
        expect(
            canPayAlternativeCost(board(FOUR_BLACK), "p1", returnLeg, "probe")
        ).toBe(false);
    });

    it("a may-pay refuses the exile action even when the graveyard could cover it", () => {
        const exileLeg: CostLegs = {
            graveyard: EXILE_TOP_THREE_BLACK.graveyard,
        };
        expect(canPayMayPayCost(board(FOUR_BLACK), "p1", exileLeg)).toBe(false);
        // The same count as a return is affordable — the refusal is the action.
        const returnLeg: CostLegs = {
            graveyard: { action: "return", filter: { color: "B" }, count: 3 },
        };
        expect(canPayMayPayCost(board(FOUR_BLACK), "p1", returnLeg)).toBe(true);
    });
});
