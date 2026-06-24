import { describe, expect, it } from "vitest";
import {
    parseWorklist,
    parseManaCost,
    selectFirstPaperPrint,
    classify,
    emitCardSource,
    dedupByOracle,
} from "../list-to-cards.mjs";

// `scripts/list-to-cards.mjs` is the list-mode card importer (ADR 0041): it
// takes a cross-set worklist of card names, resolves each from Scryfall, routes
// it to its earliest-paper-printing home set, and emits it as either an active
// `CardDefinition` (free cards) or a commented-out stub (cards needing a new
// engine capability). The Scryfall fetch is impure and lives behind the CLI
// main guard; these tests exercise only the pure transforms over fixtures, so
// they never hit the network.

describe("parseWorklist", () => {
    it("returns one name per non-blank, non-comment line", () => {
        const text = [
            "# Vintage Cube — white",
            "Mother of Runes",
            "",
            "Stoneforge Mystic   ",
            "  # inline section",
            "Solitude",
        ].join("\n");
        expect(parseWorklist(text)).toEqual([
            "Mother of Runes",
            "Stoneforge Mystic",
            "Solitude",
        ]);
    });
});

describe("parseManaCost (mirrors json-to-cards)", () => {
    it("splits coloured and generic pips", () => {
        expect(parseManaCost("{1}{G}")).toEqual({ X: 1, G: 1 });
        expect(parseManaCost("{W}{W}")).toEqual({ W: 2 });
    });
    it("returns undefined for no cost (e.g. lands)", () => {
        expect(parseManaCost(undefined)).toBeUndefined();
        expect(parseManaCost("")).toBeUndefined();
    });
});

describe("selectFirstPaperPrint (CR-irrelevant; 'prima stampa' = earliest paper)", () => {
    const prints = [
        // digital-only — must be ignored even though it is earliest by date
        {
            set: "vma",
            id: "digital-id",
            released_at: "2014-06-16",
            games: ["mtgo"],
            border_color: "black",
            set_type: "masters",
        },
        // gold-bordered oversized memorabilia — ignored
        {
            set: "30a",
            id: "gold-id",
            released_at: "1993-01-01",
            games: ["paper"],
            border_color: "gold",
            set_type: "memorabilia",
        },
        // the true earliest paper printing
        {
            set: "lea",
            id: "alpha-id",
            released_at: "1993-08-05",
            games: ["paper"],
            border_color: "black",
            set_type: "core",
            rarity: "rare",
        },
        // a later paper reprint
        {
            set: "3ed",
            id: "revised-id",
            released_at: "1994-04-01",
            games: ["paper"],
            border_color: "white",
            set_type: "core",
            rarity: "rare",
        },
    ];

    it("picks the earliest black/white-bordered paper printing", () => {
        const pick = selectFirstPaperPrint(prints);
        expect(pick.set).toBe("lea");
        expect(pick.id).toBe("alpha-id");
    });

    it("excludes promo sets even when they release earlier (Grief: pmh2 vs mh2)", () => {
        const pick = selectFirstPaperPrint([
            // prerelease promo, ships days BEFORE the main set
            {
                set: "pmh2",
                id: "promo-id",
                released_at: "2021-06-11",
                games: ["paper"],
                border_color: "black",
                set_type: "promo",
                promo: true,
                collector_number: "77p",
            },
            // the real original set
            {
                set: "mh2",
                id: "mh2-id",
                released_at: "2021-06-18",
                games: ["paper"],
                border_color: "black",
                set_type: "expansion",
                promo: false,
                collector_number: "77",
            },
        ]);
        expect(pick.set).toBe("mh2");
        expect(pick.id).toBe("mh2-id");
    });

    it("tie-breaks same-day printings by collector_number", () => {
        const pick = selectFirstPaperPrint([
            {
                set: "xxx",
                id: "high",
                released_at: "2020-01-01",
                games: ["paper"],
                border_color: "black",
                set_type: "expansion",
                collector_number: "250",
            },
            {
                set: "xxx",
                id: "low",
                released_at: "2020-01-01",
                games: ["paper"],
                border_color: "black",
                set_type: "expansion",
                collector_number: "12",
            },
        ]);
        expect(pick.id).toBe("low");
    });

    it("returns null when no paper printing exists", () => {
        expect(
            selectFirstPaperPrint([
                {
                    set: "vma",
                    id: "x",
                    released_at: "2014-06-16",
                    games: ["mtgo"],
                    border_color: "black",
                    set_type: "masters",
                },
            ])
        ).toBeNull();
    });
});

describe("classify (mechanical pre-split, ADR 0041)", () => {
    const card = (o: Record<string, unknown>) => ({
        name: "X",
        layout: "normal",
        type_line: "Creature — Bear",
        oracle_text: "",
        ...o,
    });

    it("vanilla creature (no oracle text) → free", () => {
        expect(classify(card({})).bucket).toBe("free");
    });

    it("keyword-only card (all clauses supported) → free", () => {
        expect(classify(card({ oracle_text: "Flying" })).bucket).toBe("free");
        expect(
            classify(card({ oracle_text: "Flying, vigilance" })).bucket
        ).toBe("free");
    });

    it("card with an unsupported mechanic → capability (needs triage)", () => {
        const c = classify(card({ oracle_text: "Cascade" }));
        expect(c.bucket).toBe("capability");
    });

    it("non-normal layout → out-of-scope with the layout as reason", () => {
        const c = classify(card({ layout: "transform" }));
        expect(c.bucket).toBe("out-of-scope");
        expect(c.reason).toContain("transform");
    });

    it("planeswalker → capability (no loyalty system yet)", () => {
        const c = classify(
            card({
                type_line: "Legendary Planeswalker — Jace",
                oracle_text: "+1: Draw a card.",
            })
        );
        expect(c.bucket).toBe("capability");
        expect(c.reason).toContain("planeswalker");
    });
});

describe("emitCardSource", () => {
    const free = {
        name: "Savannah Lions",
        layout: "normal",
        type_line: "Creature — Cat",
        oracle_text: "",
        mana_cost: "{W}",
        power: "2",
        toughness: "1",
        rarity: "rare",
        id: "free-scryfall-id",
    };

    it("emits an active CardDefinition for a free card (id, name, rarity)", () => {
        const src = emitCardSource(free);
        expect(src).toContain("CardDefinition");
        expect(src).toContain('id: "free-scryfall-id"');
        expect(src).toContain('name: "Savannah Lions"');
        expect(src).toContain('rarity: "rare"');
        expect(src).not.toMatch(/^\s*\/\//m); // not commented out
    });

    it("emits a commented-out stub for a capability card", () => {
        const src = emitCardSource({
            ...free,
            name: "Cascade Guy",
            oracle_text: "Cascade",
            id: "cap-id",
        });
        // every non-blank line is a comment
        for (const line of src.split("\n")) {
            if (line.trim() === "") continue;
            expect(line.trimStart().startsWith("//")).toBe(true);
        }
        expect(src).toContain('id: "cap-id"');
    });

    it("bails loudly on an unmodelled rarity", () => {
        expect(() => emitCardSource({ ...free, rarity: "special" })).toThrow(
            /rarity/i
        );
    });
});

describe("dedupByOracle", () => {
    it("splits worklist cards into missing vs already-implemented by oracleId", () => {
        const cards = [
            { name: "A", oracleId: "oa" },
            { name: "B", oracleId: "ob" },
            { name: "C", oracleId: "oc" },
        ];
        const lockfile = [{ name: "B", oracleId: "ob" }];
        const { missing, done } = dedupByOracle(cards, lockfile);
        expect(missing.map((c) => c.name)).toEqual(["A", "C"]);
        expect(done.map((c) => c.name)).toEqual(["B"]);
    });
});
