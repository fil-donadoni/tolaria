import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchEditions, fetchTextSearch } from "../scryfallApi";

describe("fetchEditions", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('fetches editions from Scryfall with the !"exact" syntax', async () => {
        const prints = [
            {
                id: "f29ec16d-7fe8-47ab-8a10-22aabd3c6dd1",
                set: "lea",
                collector_number: "151",
            },
            {
                id: "3fbdd46c-c36c-4e6b-ae00-1e14097645b4",
                set: "leb",
                collector_number: "152",
            },
        ];

        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
            new Response(JSON.stringify({ data: prints }), { status: 200 })
        );

        const editions = await fetchEditions("Lightning Bolt");

        expect(fetch).toHaveBeenCalledWith(
            "https://api.scryfall.com/cards/search?q=!%22Lightning%20Bolt%22&unique=prints&order=released"
        );

        expect(editions).toHaveLength(2);
        expect(editions[0]).toEqual({
            printId: "f29ec16d7fe847ab8a1022aabd3c6dd1",
            setCode: "lea",
            label: "LEA",
        });
        expect(editions[1]).toEqual({
            printId: "3fbdd46cc36c4e6bae001e14097645b4",
            setCode: "leb",
            label: "LEB",
        });
    });

    it("throws on non-200 response", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
            new Response("Not Found", { status: 404 })
        );

        await expect(fetchEditions("Nonexistent")).rejects.toThrow(
            "Scryfall editions fetch failed: 404"
        );
    });

    it("handles cards with special characters in name", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
            new Response(JSON.stringify({ data: [] }), { status: 200 })
        );

        await fetchEditions("Juzám Djinn");

        expect(fetch).toHaveBeenCalledWith(
            "https://api.scryfall.com/cards/search?q=!%22Juz%C3%A1m%20Djinn%22&unique=prints&order=released"
        );
    });
});

describe("fetchTextSearch", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("searches Scryfall and returns matching card names", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
            new Response(
                JSON.stringify({
                    data: [
                        { name: "Lightning Bolt" },
                        { name: "Chain Lightning" },
                    ],
                }),
                { status: 200 }
            )
        );

        const names = await fetchTextSearch("lightning");

        expect(fetch).toHaveBeenCalledWith(
            "https://api.scryfall.com/cards/search?q=lightning&unique=cards"
        );

        expect(names).toEqual(new Set(["Lightning Bolt", "Chain Lightning"]));
    });

    it("throws on non-200 response", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
            new Response("Not Found", { status: 503 })
        );

        await expect(fetchTextSearch("nothing")).rejects.toThrow(
            "Scryfall text search failed: 503"
        );
    });

    it("returns an empty set when no cards match", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
            new Response(JSON.stringify({ data: [] }), { status: 200 })
        );

        const names = await fetchTextSearch("zzzxxx");
        expect(names.size).toBe(0);
    });
});
