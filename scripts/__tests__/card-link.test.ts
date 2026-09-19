import { describe, it, expect } from "vitest";
import {
    cardLinks,
    formatCardLink,
    loadCardLinkSources,
    type CardLinkSources,
    type ScryfallCard,
    type ScryfallFetch,
} from "../lib/card-link";

/**
 * `bun run card:link` — the one builder of the issue-body card link
 * (issue #3666, docs/agents/issue-tracker.md § Card names are Scryfall links).
 *
 * The Scryfall API is injected: every case here runs offline, and the fake
 * records the paths it was asked for so a test can prove the tree was
 * consulted FIRST and the network only for what the tree lacks.
 */

const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";

const sources: CardLinkSources = {
    ids: new Map([
        ["Lightning Bolt", BOLT_ID],
        ["Indexed Without Tooltip", "11111111-1111-1111-1111-111111111111"],
    ]),
    tooltips: new Map([
        ["Lightning Bolt", { manaCost: "{R}", typeLine: "Instant" }],
    ]),
};

function fakeScryfall(cards: Record<string, ScryfallCard>): {
    fetch: ScryfallFetch;
    asked: string[];
} {
    const asked: string[] = [];
    return {
        asked,
        fetch: async (apiPath) => {
            asked.push(apiPath);
            return cards[apiPath] ?? null;
        },
    };
}

describe("card:link (issue #3666)", () => {
    it("links an indexed card by its Scryfall id, tooltip = mana · type, no network", async () => {
        const api = fakeScryfall({});
        const out = await cardLinks(["Lightning Bolt"], sources, api.fetch);
        expect(out).toEqual({
            links: [
                `[Lightning Bolt](https://scryfall.com/card/${BOLT_ID} "{R} · Instant")`,
            ],
            unresolved: [],
        });
        expect(api.asked).toEqual([]);
    });

    it("falls back to Scryfall's exact-name API for an unindexed card", async () => {
        const api = fakeScryfall({
            "/cards/named?exact=Delver%20of%20Secrets": {
                id: "6904ea20-e504-47da-95a0-08739fdde260",
                name: "Delver of Secrets // Insectile Aberration",
                card_faces: [
                    { mana_cost: "{U}", type_line: "Creature — Human Wizard" },
                    { mana_cost: "", type_line: "Creature — Human Insect" },
                ],
            },
        });
        const out = await cardLinks(["Delver of Secrets"], sources, api.fetch);
        expect(out.links).toEqual([
            '[Delver of Secrets](https://scryfall.com/card/6904ea20-e504-47da-95a0-08739fdde260 "{U} · Creature — Human Wizard // Creature — Human Insect")',
        ]);
    });

    it("keeps the index id when only the tooltip has to come from Scryfall", async () => {
        const api = fakeScryfall({
            "/cards/11111111-1111-1111-1111-111111111111": {
                id: "22222222-2222-2222-2222-222222222222",
                name: "Indexed Without Tooltip",
                type_line: "Land",
            },
        });
        const out = await cardLinks(
            ["Indexed Without Tooltip"],
            sources,
            api.fetch
        );
        expect(out.links).toEqual([
            '[Indexed Without Tooltip](https://scryfall.com/card/11111111-1111-1111-1111-111111111111 "Land")',
        ]);
    });

    it("fails closed on an unknown name — named, never a guessed URL", async () => {
        const api = fakeScryfall({});
        const out = await cardLinks(
            ["Lightning Bolt", "Nonexistent Cardz"],
            sources,
            api.fetch
        );
        expect(out.unresolved).toEqual(["Nonexistent Cardz"]);
        expect(out.links.join("\n")).not.toContain("Nonexistent");
    });

    it("escapes the characters that would break the link", () => {
        expect(
            formatCardLink({
                name: "Odd [Name]",
                scryfallId: "x",
                manaCost: "",
                typeLine: 'Type "quoted"',
            })
        ).toBe(
            '[Odd \\[Name\\]](https://scryfall.com/card/x "Type \\"quoted\\"")'
        );
    });

    it("resolves Lightning Bolt from the committed tree with no network", async () => {
        const offline: ScryfallFetch = async (p) => {
            throw new Error(`network touched: ${p}`);
        };
        const out = await cardLinks(
            ["Lightning Bolt"],
            loadCardLinkSources(),
            offline
        );
        expect(out.links).toEqual([
            `[Lightning Bolt](https://scryfall.com/card/${BOLT_ID} "{R} · Instant")`,
        ]);
    });
});
