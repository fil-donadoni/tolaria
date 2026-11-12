// Bot-play sweep (issue #8854) — a spell whose delayed trigger asks the holder
// to pay mana or lose the game (CR 603.7a, CR 104.3e: the Pact cycle) is posed
// with the lands for that payment, on top of the lands for its own cost.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { botReachSpec } from "../botReach";
import { delayedPayment, delayedPaymentLands } from "../botReachDelayedPayment";

describe("delayedPaymentLands", () => {
    it("adds a basic of the payment's colour per mana of Summoner's Pact's upkeep", () => {
        expect(delayedPaymentLands(getCardByName("Summoner's Pact")!)).toEqual([
            "Forest",
            "Forest",
            "Forest",
            "Forest",
        ]);
    });

    it("reads the largest delayed payment of the spell script", () => {
        expect(delayedPayment(getCardByName("Pact of Negation")!)).toEqual({
            X: 3,
            U: 2,
        });
    });

    it("adds nothing for a spell with no delayed payment", () => {
        expect(delayedPaymentLands(getCardByName("Lightning Bolt")!)).toEqual(
            []
        );
    });

    it("stands the payment lands beside the cast's own on the holder's battlefield", () => {
        const lands = botReachSpec(getCardByName("Summoner's Pact")!)
            .cards.filter(
                (c) =>
                    c.owner === "me" &&
                    c.zone === "battlefield" &&
                    (c.name === "Forest" || c.name === "Plains")
            )
            .map((c) => c.name);
        expect(lands.filter((n) => n === "Forest")).toHaveLength(4);
        expect(lands).toHaveLength(6);
    });
});
