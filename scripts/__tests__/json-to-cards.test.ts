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
// MTGJSON rarity is not one of the three modelled values. These tests drive
// the script over synthetic MTGJSON fixtures and assert on the emitted file.

const SCRIPT = join(process.cwd(), "scripts", "json-to-cards.mjs");

/** Runs the generator on a synthetic MTGJSON set, returns the generated
 *  TypeScript source. The script writes to `convex/cards/sets/<code>.ts`, so we
 *  use a throwaway set code and clean it up. */
function generate(setCode: string, cards: unknown[]): string {
    const dir = mkdtempSync(join(tmpdir(), "json-to-cards-"));
    const jsonPath = join(dir, `${setCode}.json`);
    const outPath = join(
        process.cwd(),
        "convex",
        "cards",
        "sets",
        `${setCode}.ts`
    );
    writeFileSync(
        jsonPath,
        JSON.stringify({ data: { code: setCode, cards } }),
        "utf-8"
    );
    try {
        execFileSync("node", [SCRIPT, jsonPath], { encoding: "utf-8" });
        return readFileSync(outPath, "utf-8");
    } finally {
        if (existsSync(outPath)) rmSync(outPath);
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
        const src = generate("zzz", [baseCard({ rarity: "uncommon" })]);
        expect(src).toContain('rarity: "uncommon"');
    });

    it("skips a card whose rarity is not common/uncommon/rare", () => {
        // "mythic" is a real Scryfall value but not modelled here — the card
        // must be skipped rather than generated without a valid rarity.
        const src = generate("zzy", [
            baseCard({
                rarity: "mythic",
                identifiers: {
                    scryfallId: "00000000-0000-0000-0000-000000000002",
                },
            }),
        ]);
        expect(src).not.toContain("Test Bear");
        expect(src).not.toContain("rarity:");
    });
});
