// The 404 page's card pool: every Magic card whose name contains "Lost in"
// (Scryfall `name:/\blost in\b/`, unique=cards, July 2026 — 9 results). The
// joke is the point: a page that can't be found shows a card about being lost.
//
// These are NOT catalogue cards — the engine implements none of them — so they
// are pinned Scryfall print ids used purely as artwork, resolved through the
// same `images.ts` helpers every card surface uses. That is also why the list
// is a checked-in constant rather than a Scryfall query: a 404 page must
// render with no network call beyond the image itself, and a live search would
// make the page depend on a third-party API to tell the user a page is
// missing.
//
// One of the nine results is deliberately absent: "Totally Lost in Translation"
// (mafr) is a double-faced Alchemy card with no single-face `image_uris`, so
// the shared single-image helpers can't render it.

export interface LostInCard {
    /** Scryfall print id — the artwork actually fetched. */
    id: string;
    /** Card name, used as the image's alt text and the page caption. */
    name: string;
}

export const LOST_IN_CARDS: readonly LostInCard[] = [
    { id: "09aa7744-680f-4c2a-8fa0-9cb0c176ae8f", name: "Lost in a Labyrinth" },
    { id: "00cc4de5-f9b2-4a46-a410-b39446a9eaee", name: "Lost in Memories" },
    { id: "6d9d7979-97af-4c85-86f5-1b3704f74e8b", name: "Lost in Space" },
    { id: "6308dc62-d945-4761-aa4c-ef8e9271e901", name: "Lost in the Maze" },
    { id: "1e5fc39d-590a-436b-ab90-a1741d2ae3da", name: "Lost in the Mist" },
    {
        id: "88745474-d8e7-407e-80df-02541ad1ab0b",
        name: "Lost in the Spirit World",
    },
    { id: "5865603c-0a5e-45c3-84e3-2dc3b4cf0cf7", name: "Lost in the Woods" },
    { id: "f5fb391a-2687-461d-b5ef-a494287ddb5d", name: "Lost in Thought" },
];

/** One card at random. Extracted (rather than inlined in the page) so the
 *  randomness has a seam a test can drive: `Math.random()` is injectable, and
 *  the caller picks ONCE per mount rather than on every render. */
export function pickLostInCard(random: () => number = Math.random): LostInCard {
    const index = Math.floor(random() * LOST_IN_CARDS.length);
    // Guard the `random() === 1` / out-of-range edge rather than trusting the
    // contract: a bad injection must not return `undefined` on a 404 page.
    return LOST_IN_CARDS[Math.min(index, LOST_IN_CARDS.length - 1)];
}
