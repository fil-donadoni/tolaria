import { describe, it, expect } from "vitest";
import { gzipSync } from "node:zlib";
import {
    decodeCatalogue,
    rehydrate,
    patchAvailability,
    type FullCatalogueRow,
} from "../fullCatalogue";
import { toDashedUuid } from "../scryfallId";
import { getImageUrl } from "../images";

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

/**
 * The transport-shape guard. The catalogue is gzip on disk, but whether the
 * bytes reaching the client are STILL gzip is the server's decision: Vite's
 * dev server infers `Content-Encoding: gzip` from the `.gz` extension and the
 * fetch layer inflates the body before we see it. The original loader piped
 * unconditionally through `DecompressionStream("gzip")`, so that (very normal)
 * server behaviour threw `TypeError` and the whole catalogue never loaded —
 * manual mode showed an empty pool and real mode showed no Unavailable Cards.
 */
describe("decodeCatalogue — gzip-magic sniffing", () => {
    const payload = JSON.stringify({ names: ["Lightning Bolt"] });

    it("inflates a body that is still gzip on the wire", async () => {
        const gz = gzipSync(Buffer.from(payload));
        const buffer = gz.buffer.slice(
            gz.byteOffset,
            gz.byteOffset + gz.byteLength
        ) as ArrayBuffer;
        expect(await decodeCatalogue(buffer)).toBe(payload);
    });

    it("passes through a body the transport already decompressed", async () => {
        // What arrives when the server sends `Content-Encoding: gzip`.
        const buffer = new TextEncoder().encode(payload).buffer as ArrayBuffer;
        expect(await decodeCatalogue(buffer)).toBe(payload);
    });

    it("handles an empty body without throwing", async () => {
        expect(await decodeCatalogue(new ArrayBuffer(0))).toBe("");
    });
});

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

/**
 * The id-space guard.
 *
 * The catalogue asset stores print UUIDs DASHLESS (the ADR 0080 size
 * reduction), but every other id in the project — `CardDefinition.id`,
 * `card-index.json`, a saved deck row — is the canonical dashed Scryfall print
 * UUID, and `cards.scryfall.io` puts that dashed form in its image path.
 * `rehydrate` handed the dashless id straight through, so every card the
 * catalogue contributed (the whole manual-mode pool, and real mode's
 * Unavailable Cards) rendered with a 404 image.
 *
 * The assertion runs THROUGH `getImageUrl`, not against the id: a shape check
 * on `printId` alone would still pass if the URL builder changed its path
 * layout underneath it.
 */
describe("rehydrate — canonical print ids (image path)", () => {
    const DASHLESS = "a7f2073b1c2d4e5f8091a2b3c4d5e6f7";
    const DASHED = "a7f2073b-1c2d-4e5f-8091-a2b3c4d5e6f7";

    function oneRow(printId: string): FullCatalogueRow {
        return rehydrate(
            wire({
                names: ["Sliver Queen"],
                printIds: [printId],
                typeLines: ["Legendary Creature — Sliver"],
                manaCosts: ["{2}{W}{U}{B}{R}{G}"],
                cmcs: [7],
                colourIdentities: ["WUBRG"],
                sets: ["stf"],
                rarities: ["rare"],
            })
        )[0];
    }

    it("restores the dashes a catalogue row was stored without", () => {
        expect(oneRow(DASHLESS).printId).toBe(DASHED);
    });

    it("builds the real Scryfall image path from a rehydrated row", () => {
        expect(getImageUrl(oneRow(DASHLESS).printId)).toBe(
            `https://cards.scryfall.io/grid/front/a/7/${DASHED}.webp`
        );
    });

    it("passes an already-dashed id through unchanged (idempotent)", () => {
        expect(oneRow(DASHED).printId).toBe(DASHED);
        expect(toDashedUuid(DASHED)).toBe(DASHED);
    });

    it("leaves a non-UUID id alone (synthetic token ids)", () => {
        expect(toDashedUuid("token:Wasp|1/1|artifact")).toBe(
            "token:Wasp|1/1|artifact"
        );
    });
});
