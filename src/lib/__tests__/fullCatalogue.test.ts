import { describe, it, expect } from "vitest";
import {
    rehydrate,
    patchAvailability,
    type FullCatalogueRow,
} from "../fullCatalogue";

// FullCatalogueWire is not exported — define a local minimal shape.
interface Wire {
    names: string[];
    printIds: string[];
    typeLines: string[];
    manaCosts: string[];
    cmcs: number[];
    colourIdentities: string[];
    sets: string[];
    rarities: string[];
}

function wire(overrides: Partial<Wire> = {}): Wire {
    return {
        names: [],
        printIds: [],
        typeLines: [],
        manaCosts: [],
        cmcs: [],
        colourIdentities: [],
        sets: [],
        rarities: [],
        ...overrides,
    };
}

describe("rehydrate", () => {
    it("converts columnar arrays to rows with folded names", () => {
        const rows = rehydrate(
            wire({
                names: ["Lightning Bolt", "Séance", "Forest"],
                printIds: ["aa", "bb", "cc"],
                typeLines: ["Instant", "Enchantment", "Basic Land — Forest"],
                manaCosts: ["{R}", "{2}{W}{W}", ""],
                cmcs: [1, 4, 0],
                colourIdentities: ["R", "W", "G"],
                sets: ["LEA", "DKA", "LEA"],
                rarities: ["common", "rare", "common"],
            })
        );
        expect(rows).toHaveLength(3);
        expect(rows[0].name).toBe("Lightning Bolt");
        expect(rows[0].nameFold).toBe("lightning bolt");
        expect(rows[0].printId).toBe("aa");
        expect(rows[0].cmc).toBe(1);

        expect(rows[1].name).toBe("Séance");
        expect(rows[1].nameFold).toBe("seance"); // accent folded
        expect(rows[1].colourIdentity).toBe("W");

        expect(rows[2].nameFold).toBe("forest");
    });

    it("all rows start with available === false", () => {
        const rows = rehydrate(
            wire({
                names: ["Lightning Bolt"],
                printIds: ["aa"],
                typeLines: ["Instant"],
                manaCosts: ["{R}"],
                cmcs: [1],
                colourIdentities: ["R"],
                sets: ["LEA"],
                rarities: ["common"],
            })
        );
        expect(rows[0].available).toBe(false);
    });

    it("handles an empty catalogue", () => {
        const rows = rehydrate(wire());
        expect(rows).toEqual([]);
    });
});

describe("patchAvailability", () => {
    const row = (nameFold: string): FullCatalogueRow => ({
        name: nameFold,
        printId: "aa",
        typeLine: "",
        manaCost: "",
        cmc: 0,
        colourIdentity: "",
        set: "",
        rarity: "",
        nameFold,
        available: false,
    });

    it("marks a row available when its nameFold is in the set", () => {
        const rows = [row("lightning bolt"), row("black lotus")];
        const available = new Set(["lightning bolt"]);
        const patched = patchAvailability(rows, available);
        expect(patched[0].available).toBe(true);
        expect(patched[1].available).toBe(false);
    });

    it("accent-folded names match across the boundary", () => {
        const rows = [row("seance")]; // "Séance" → nameFold = "seance"
        const available = new Set(["seance"]);
        const patched = patchAvailability(rows, available);
        expect(patched[0].available).toBe(true);
    });

    it("all rows are unavailable when the available set is empty", () => {
        const rows = [row("lightning bolt"), row("giant growth")];
        const patched = patchAvailability(rows, new Set());
        for (const r of patched) expect(r.available).toBe(false);
    });

    it("returns a new array (does not mutate input)", () => {
        const rows = [row("lightning bolt")];
        const patched = patchAvailability(rows, new Set(["lightning bolt"]));
        expect(patched).not.toBe(rows);
        expect(rows[0].available).toBe(false);
    });
});
