// The player's Limited Deck Archive (PRD #8407, issue #8409): which decks it
// lists and how they group.
import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { LobbyDeck, UserLobbyDeck } from "../deckTypes";
import { limitedDeckArchiveGroups } from "../limitedDeckArchive";

function userDeck(id: string, extra: Partial<UserLobbyDeck> = {}): LobbyDeck {
    return {
        kind: "user",
        userDeckId: id as Id<"userDecks">,
        presetId: id,
        name: id,
        format: "limited",
        colors: [],
        cards: [],
        featuredCardId: null,
        isLegal: true,
        reasons: [],
        ...extra,
    };
}

const names = (decks: readonly LobbyDeck[]) =>
    limitedDeckArchiveGroups(decks).map((group) => ({
        label: group.label,
        decks: group.entries.map((entry) => entry.deck.name),
    }));

describe("limitedDeckArchiveGroups", () => {
    it("groups by Limited Origin, sorted by label, with the app's labels", () => {
        expect(
            names([
                userDeck("sealed", { limitedOrigin: "sealed:lea" }),
                userDeck("draft", { limitedOrigin: "draft:lea" }),
            ])
        ).toEqual([
            { label: "Limited Edition Alpha Draft", decks: ["draft"] },
            { label: "Limited Edition Alpha Sealed", decks: ["sealed"] },
        ]);
    });

    it("lists a deck with no origin in the unclassified group, last", () => {
        expect(
            names([
                userDeck("legacy"),
                userDeck("sealed", { limitedOrigin: "sealed:lea" }),
            ])
        ).toEqual([
            { label: "Limited Edition Alpha Sealed", decks: ["sealed"] },
            { label: "Unclassified", decks: ["legacy"] },
        ]);
    });

    it("lists only the player's own Limited decks: no preset, no other Format", () => {
        const preset: LobbyDeck = {
            ...userDeck("preset"),
            kind: "preset",
        } as LobbyDeck;
        expect(
            names([
                preset,
                userDeck("constructed", { format: "freeform" }),
                userDeck("mine"),
            ])
        ).toEqual([{ label: "Unclassified", decks: ["mine"] }]);
    });

    it("keeps a deck whose Event is gone: it never reads the Event", () => {
        expect(
            names([
                userDeck("orphan", {
                    limitedOrigin: "draft:lea",
                    limitedEventId: "deleted-event",
                }),
            ])
        ).toEqual([
            { label: "Limited Edition Alpha Draft", decks: ["orphan"] },
        ]);
    });
});
