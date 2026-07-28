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
    // Emit into a throwaway tmp dir (JSON_TO_CARDS_OUT_DIR override) instead of
    // the live `convex/cards/sets` tree, so the create/cleanup here can never
    // race a concurrent worker walking the real catalogue (sacrificeGuard).
    const outRoot = join(dir, "sets");
    const outDir = join(outRoot, setCode);
    writeFileSync(
        jsonPath,
        JSON.stringify({ data: { code: setCode, cards } }),
        "utf-8"
    );
    try {
        execFileSync("bun", [SCRIPT, jsonPath], {
            encoding: "utf-8",
            env: { ...process.env, JSON_TO_CARDS_OUT_DIR: outRoot },
        });
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

    // Issue #1742: `parseManaCost` used to drop guild-hybrid/Phyrexian pips
    // silently, so a card like Vibrance ({R/G}...) lost its coloured pips
    // entirely and misfiled into colorless.ts. These assert the fixed parse
    // both emits the `hybrid`/`phyrexian` fields AND routes correctly.
    it("routes a guild-hybrid card ({R/W}) to multicolor.ts, never colorless.ts", () => {
        const { modules } = generate("zzt", [
            baseCard({
                name: "Test Guild Hybrid",
                manaCost: "{R/W}",
                identifiers: {
                    scryfallId: "00000000-0000-0000-0000-000000000005",
                },
            }),
        ]);
        expect(modules.multicolor).toContain("Test Guild Hybrid");
        expect(modules.multicolor).toContain('hybrid: [["R", "W"]]');
        expect(modules.colorless).not.toContain("Test Guild Hybrid");
        expect(modules.red).not.toContain("Test Guild Hybrid");
        expect(modules.white).not.toContain("Test Guild Hybrid");
    });

    it("routes a single-colour Phyrexian card ({B/P}) to its own colour module", () => {
        const { modules } = generate("zzs", [
            baseCard({
                name: "Test Phyrexian",
                manaCost: "{1}{B/P}{B/P}",
                identifiers: {
                    scryfallId: "00000000-0000-0000-0000-000000000006",
                },
            }),
        ]);
        expect(modules.black).toContain("Test Phyrexian");
        expect(modules.black).toContain("phyrexian: { B: 2 }");
        expect(modules.colorless).not.toContain("Test Phyrexian");
    });

    it("raises instead of silently dropping an unmodelled symbol ({S} snow), naming the offending card", () => {
        const dir = mkdtempSync(join(tmpdir(), "json-to-cards-"));
        const jsonPath = join(dir, "zzr.json");
        const outRoot = join(dir, "sets");
        writeFileSync(
            jsonPath,
            JSON.stringify({
                data: {
                    code: "zzr",
                    cards: [
                        baseCard({
                            name: "Test Snow",
                            manaCost: "{1}{S}",
                            identifiers: {
                                scryfallId:
                                    "00000000-0000-0000-0000-000000000007",
                            },
                        }),
                    ],
                },
            }),
            "utf-8"
        );
        try {
            // A bare `.toThrow()` on `execFileSync` passes on ANY non-zero
            // exit (missing `bun`, a bad fixture, an unrelated crash) — it
            // doesn't pin down that THIS card/symbol pair is what raised.
            // Capture stderr and assert on its content instead (PR #1771
            // review fixup).
            let stderr = "";
            expect(() => {
                try {
                    execFileSync("bun", [SCRIPT, jsonPath], {
                        encoding: "utf-8",
                        stdio: ["ignore", "pipe", "pipe"],
                        env: {
                            ...process.env,
                            JSON_TO_CARDS_OUT_DIR: outRoot,
                        },
                    });
                } catch (err) {
                    stderr = String((err as { stderr?: unknown }).stderr ?? "");
                    throw err;
                }
            }).toThrow();
            expect(stderr).toMatch(/unrecognised mana symbol/);
            // Issue #1742 fixup: the error now names the offending card, not
            // just the symbol — pin that behaviour here too.
            expect(stderr).toContain('Card "Test Snow"');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
