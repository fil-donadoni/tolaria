import { describe, it, expect, vi } from "vitest";
import type { CardInstance, Player } from "~/types/game";
import { attachmentLabel, findAttachmentHost } from "~/lib/attachment";

import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) =>
        mockInstanceManaCost(
            c,
            (id: string) =>
                ({
                    "def-bear": { id: "def-bear", name: "Grizzly Bears" },
                    "def-armor": { id: "def-armor", name: "Holy Strength" },
                    "def-leak": { id: "def-leak", name: "Power Leak" },
                })[id]
        ),
    tryGetDefinition: (id: string) =>
        ({
            "def-bear": { id: "def-bear", name: "Grizzly Bears" },
            "def-armor": { id: "def-armor", name: "Holy Strength" },
            "def-leak": { id: "def-leak", name: "Power Leak" },
        })[id],
}));

function card(id: string, defId: string, attachedTo?: string): CardInstance {
    return {
        id,
        card: { id: defId },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        attachedTo,
    } as CardInstance;
}

function player(id: string, battlefield: CardInstance[]): Player {
    return {
        id,
        name: id === "me" ? "Me" : "Opponent",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    } as unknown as Player;
}

describe("attachment host labelling (CR 303.4 Aura / CR 301.5 Equipment)", () => {
    const bear = card("bear", "def-bear");
    const armor = card("armor", "def-armor", "bear");
    const leak = card("leak", "def-leak", "armor");

    it("names the DIRECT host of an Aura enchanting an Aura, not the root", () => {
        // Power Leak ("Enchant enchantment") on Holy Strength on a bear: the
        // chain's second link must read "Holy Strength", never "Grizzly Bears".
        const players = [player("me", [bear, armor, leak])];
        expect(attachmentLabel(armor, players)).toBe(
            "Attached to: Grizzly Bears"
        );
        expect(attachmentLabel(leak, players)).toBe(
            "Attached to: Holy Strength"
        );
    });

    it("finds a host on the OTHER player's battlefield", () => {
        // An Aura's controller may differ from its host's (Control Magic).
        const players = [player("me", [leak]), player("opp", [bear, armor])];
        expect(findAttachmentHost(leak, players)?.id).toBe("armor");
        expect(attachmentLabel(leak, players)).toBe(
            "Attached to: Holy Strength"
        );
    });

    it("names the PLAYER for an enchant-player Aura (CR 303.4)", () => {
        const curse = card("curse", "def-leak", "opp");
        const players = [player("me", [curse]), player("opp", [])];
        expect(findAttachmentHost(curse, players)).toBeUndefined();
        expect(attachmentLabel(curse, players)).toBe("Attached to: Opponent");
    });

    it("says nothing for an unattached permanent or a vanished host", () => {
        const players = [player("me", [bear])];
        expect(attachmentLabel(bear, players)).toBeNull();
        expect(
            attachmentLabel(card("orphan", "def-leak", "gone"), players)
        ).toBeNull();
    });
});
