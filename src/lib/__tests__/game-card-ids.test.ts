// The board's art manifest (`gameArtCardIds`, issue #2506). The end-to-end
// path — creation → `games` row → manifest — is guarded in
// `src/lib/__tests__/game-art-manifest.test.ts` (deliberately client-side; see
// its own header for why it does not live under `convex/`); what is left here
// is the LEGACY
// branch, which that test cannot reach because every row it creates is already
// split. A game started before the migration still carries its decklists
// inline and no `cardIds`, and dropping the fallback would leave those boards
// preloading nothing at all.
import { describe, it, expect } from "vitest";
import type { Doc } from "@convex/_generated/dataModel";
import { gameArtCardIds } from "../game-card-ids";

function row(overrides: Partial<Doc<"games">>): Doc<"games"> {
    return {
        _id: "game-1",
        _creationTime: 0,
        name: "Game",
        status: "playing",
        players: [],
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    } as unknown as Doc<"games">;
}

const seat = (id: string, prints: string[]) => ({
    id,
    name: id,
    bgColor: "#000",
    deck: {
        id: `deck-${id}`,
        name: "Deck",
        format: "vintage",
        cards: prints.map((p) => ({ cardId: p, cardName: p })),
    },
});

describe("gameArtCardIds (issue #2506)", () => {
    it("returns undefined while the game document is still loading", () => {
        expect(gameArtCardIds(undefined)).toBeUndefined();
        expect(gameArtCardIds(null)).toBeUndefined();
    });

    it("prefers the row's own manifest", () => {
        expect(gameArtCardIds(row({ cardIds: ["a", "b"] }))).toEqual([
            "a",
            "b",
        ]);
    });

    it("falls back to the inline decklists of a pre-split row, deduped", () => {
        const legacy = row({
            players: [
                seat("p1", ["a", "a", "b"]),
                seat("p2", ["b", "c"]),
            ] as unknown as Doc<"games">["players"],
        });
        expect(gameArtCardIds(legacy)).toEqual(["a", "b", "c"]);
    });

    it("is empty — not undefined — for a split row with no cards at all", () => {
        expect(gameArtCardIds(row({ cardIds: [] }))).toEqual([]);
    });
});
