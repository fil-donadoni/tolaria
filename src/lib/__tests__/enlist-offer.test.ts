// CR 508.1g / 702.154a — the client's read of the enlist offer, off projected
// fields. The panel and the one-click attack both ask it.
import { describe, expect, it } from "vitest";
import type { CardInstance } from "~/types/game";
import { anyAttackerOffersEnlist, enlistOffers } from "../enlist-offer";

function card(id: string, over: Partial<CardInstance> = {}): CardInstance {
    return {
        id,
        card: { id: "any" },
        types: ["Creature"],
        staticAbilities: [],
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        ...over,
    } as CardInstance;
}

const enlister = () => card("attacker", { staticAbilities: ["enlist"] });

describe("enlistOffers (CR 702.154a)", () => {
    it("pairs a declared attacker with enlist and who it could tap", () => {
        const offers = enlistOffers(
            [enlister(), card("partner")],
            ["attacker"]
        );
        expect(offers.map((o) => o.attacker.id)).toEqual(["attacker"]);
        expect(offers[0].partners.map((c) => c.id)).toEqual(["partner"]);
    });

    it("leaves out an attacker not declared", () => {
        expect(enlistOffers([enlister(), card("partner")], [])).toEqual([]);
    });

    it("leaves out an attacker without enlist", () => {
        expect(
            enlistOffers([card("attacker"), card("partner")], ["attacker"])
        ).toEqual([]);
    });

    it.each([
        ["tapped", { isTapped: true }],
        ["summoning sick", { isSummoningSick: true }],
        ["not a creature", { types: ["Artifact"] }],
    ])("offers nothing when the only partner is %s", (_label, over) => {
        const battlefield = [enlister(), card("partner", over)];
        expect(enlistOffers(battlefield, ["attacker"])).toEqual([]);
        expect(anyAttackerOffersEnlist(battlefield, ["attacker"])).toBe(false);
    });

    it("a summoning-sick partner with haste can pay", () => {
        const battlefield = [
            enlister(),
            card("partner", {
                isSummoningSick: true,
                staticAbilities: ["haste"],
            }),
        ];
        expect(anyAttackerOffersEnlist(battlefield, ["attacker"])).toBe(true);
    });

    it("a creature chosen to attack can't pay", () => {
        expect(
            anyAttackerOffersEnlist(
                [enlister(), card("partner")],
                ["attacker", "partner"]
            )
        ).toBe(false);
    });
});
