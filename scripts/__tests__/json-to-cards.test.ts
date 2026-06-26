import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
    mkdtempSync,
    writeFileSync,
    readFileSync,
    rmSync,
    existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The card generator (`scripts/json-to-cards.mjs`) must emit a `rarity` field
// for every card (CR 206, issue #511) and refuse to generate a card whose
// MTGJSON rarity is not one of the three modelled values. It also emits a
// colour-split set DIRECTORY (`sets/<code>/<colour>.ts` + index.ts barrel,
// ADR 0043), never a single file. These tests drive the script over synthetic
// MTGJSON fixtures and assert on the emitted directory.

const SCRIPT = join(process.cwd(), "scripts", "json-to-cards.mjs");
const COLOUR_MODULES = [
    "white",
    "blue",
    "black",
    "red",
    "green",
    "multicolor",
    "colorless",
];

/** Runs the generator on a synthetic MTGJSON set and returns the emitted set
 *  directory: the concatenation of every colour module's source plus the
 *  index.ts barrel. The script runs under `bun` (it imports the TypeScript
 *  colour helper) and writes to `convex/cards/sets/<code>/`, so we use a
 *  throwaway set code and clean up the whole directory. */
function generate(
    setCode: string,
    cards: unknown[]
): { combined: string; modules: Record<string, string>; barrel: string } {
    const dir = mkdtempSync(join(tmpdir(), "json-to-cards-"));
    const jsonPath = join(dir, `${setCode}.json`);
    const outDir = join(process.cwd(), "convex", "cards", "sets", setCode);
    writeFileSync(
        jsonPath,
        JSON.stringify({ data: { code: setCode, cards } }),
        "utf-8"
    );
    try {
        execFileSync("bun", [SCRIPT, jsonPath], { encoding: "utf-8" });
        const modules: Record<string, string> = {};
        for (const m of COLOUR_MODULES) {
            modules[m] = readFileSync(join(outDir, `${m}.ts`), "utf-8");
        }
        const barrel = readFileSync(join(outDir, "index.ts"), "utf-8");
        return {
            combined: Object.values(modules).join("\n") + "\n" + barrel,
            modules,
            barrel,
        };
    } finally {
        if (existsSync(outDir))
            rmSync(outDir, { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
    }
}

const baseCard = (overrides: Record<string, unknown>) => ({
    name: "Test Bear",
    rarity: "common",
    types: ["Creature"],
    subtypes: ["Bear"],
    power: "2",
    toughness: "2",
    manaCost: "{1}{G}",
    identifiers: { scryfallId: "00000000-0000-0000-0000-000000000001" },
    ...overrides,
});

describe("json-to-cards generator rarity emission (issue #511)", () => {
    it("emits the rarity field for a card with a valid rarity", () => {
        const { combined } = generate("zzz", [
            baseCard({ rarity: "uncommon" }),
        ]);
        expect(combined).toContain('rarity: "uncommon"');
    });

    it("skips a card whose rarity is not common/uncommon/rare", () => {
        // "mythic" is a real Scryfall value but not modelled here — the card
        // must be skipped rather than generated without a valid rarity.
        const { combined } = generate("zzy", [
            baseCard({
                rarity: "mythic",
                identifiers: {
                    scryfallId: "00000000-0000-0000-0000-000000000002",
                },
            }),
        ]);
        expect(combined).not.toContain("Test Bear");
        expect(combined).not.toContain("rarity:");
    });
});

describe("json-to-cards colour-split directory layout (ADR 0043)", () => {
    it("emits all seven colour modules + an index.ts barrel", () => {
        const { modules, barrel } = generate("zzx", [baseCard({})]);
        for (const m of COLOUR_MODULES) {
            expect(modules[m]).toBeTypeOf("string");
        }
        // The barrel re-exports every colour module so the registry's
        // `import * as <code> from "./sets/<code>"` resolves through index.ts.
        for (const m of COLOUR_MODULES) {
            expect(barrel).toContain(`export * from "./${m}";`);
        }
    });

    it("routes a card to the colour module matching its mana cost (CR 202.2)", () => {
        // {1}{G} → green; every other module is empty (header + `export {}`).
        const { modules } = generate("zzw", [baseCard({})]);
        expect(modules.green).toContain(
            "export const testBear: CardDefinition"
        );
        expect(modules.green).toContain(
            'import type { CardDefinition } from "../../types";'
        );
        expect(modules.white).toContain("export {};");
        expect(modules.white).not.toContain("testBear");
    });

    it("routes lands / colourless artifacts to colorless.ts", () => {
        // No coloured cost → colorless module.
        const { modules } = generate("zzv", [
            baseCard({
                name: "Test Mox",
                types: ["Artifact"],
                subtypes: undefined,
                power: undefined,
                toughness: undefined,
                manaCost: "{0}",
                identifiers: {
                    scryfallId: "00000000-0000-0000-0000-000000000003",
                },
            }),
        ]);
        expect(modules.colorless).toContain("Test Mox");
        expect(modules.green).not.toContain("Test Mox");
    });

    it("routes a multicolour card to multicolor.ts", () => {
        const { modules } = generate("zzu", [
            baseCard({
                name: "Test Hybrid",
                manaCost: "{W}{U}",
                identifiers: {
                    scryfallId: "00000000-0000-0000-0000-000000000004",
                },
            }),
        ]);
        expect(modules.multicolor).toContain("Test Hybrid");
        expect(modules.white).not.toContain("Test Hybrid");
        expect(modules.blue).not.toContain("Test Hybrid");
    });
});
