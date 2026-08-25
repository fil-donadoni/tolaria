// The Oracle grammar's CR 205.3 subtype tables, re-derived from the vendored
// Comprehensive Rules (ADR 0098).
//
// `convex/oracle/grammar/shared/subtypes.ts` transcribes five lists out of the
// CR so the compiler can tell "Wall" (a creature type) from "Aura" (an
// enchantment type) from "Zzyzx" (not a type at all). Transcriptions rot: the
// oracle module is PURE (no `node:fs`), so it cannot read the document itself,
// and Wizards adds subtypes with most sets. This test lives in `scripts/`
// precisely because it MAY read the file — it re-parses each list and asserts
// the transcription still matches, so a `bun run cr:sync` that brings in a new
// set reds here instead of silently leaving a new creature type unparseable.
//
// The failure it prevents is one-sided and quiet: a MISSING subtype makes the
// grammar refuse a card it should read (visible only as a lockfile count that
// did not move), while a subtype the CR has RETIRED makes it accept a noun that
// is no longer a type. Only the document can say which.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
    ARTIFACT_SUBTYPES,
    CREATURE_SUBTYPES,
    ENCHANTMENT_SUBTYPES,
    LAND_SUBTYPES,
    SPELL_SUBTYPES,
} from "../../convex/oracle/grammar/shared/subtypes";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..");
const CR = readFileSync(
    join(ROOT, "data", "cr", "comprehensive-rules.txt"),
    "utf8"
).replace(/\r/g, "");

/**
 * Pull one list out of its rule.
 *
 * `normalize.ts` folds curly apostrophes to straight ones before any rule sees
 * a card's text, so the table stores the straight form and the expectation is
 * folded the same way — "C'tan" must match the token the grammar will actually
 * be handed.
 */
function subtypeList(rule: string, marker: string): string[] {
    const line = CR.split("\n").find((l) => l.startsWith(`${rule} `));
    if (line === undefined)
        throw new Error(`CR ${rule} is not in the document`);
    const at = line.indexOf(marker);
    if (at === -1) throw new Error(`CR ${rule} no longer reads "${marker}"`);
    let rest = line.slice(at + marker.length);
    const end = rest.indexOf(". ");
    if (end !== -1) rest = rest.slice(0, end);
    return rest
        .replace(/\s*\(see rule [^)]*\)/g, "")
        .split(/,\s*|\s+and\s+/)
        .map((word) => word.trim().replace(/\.$/, "").replace(/’/g, "'"))
        .map((word) => word.replace(/^and /, ""))
        .filter((word) => word.length > 0);
}

const CASES: readonly [string, string, string, ReadonlySet<string>][] = [
    [
        "creature",
        "205.3m",
        "All other creature types are one word long: ",
        CREATURE_SUBTYPES,
    ],
    ["land", "205.3i", "The land types are ", LAND_SUBTYPES],
    ["artifact", "205.3g", "The artifact types are ", ARTIFACT_SUBTYPES],
    [
        "enchantment",
        "205.3h",
        "The enchantment types are ",
        ENCHANTMENT_SUBTYPES,
    ],
    ["spell", "205.3k", "The spell types are ", SPELL_SUBTYPES],
];

describe("CR 205.3 subtype tables match the vendored document", () => {
    for (const [name, rule, marker, table] of CASES) {
        it(`${name} types match CR ${rule}`, () => {
            const expected = subtypeList(rule, marker);
            // CR 205.3m names "Time Lord" separately as the one two-word
            // creature type; the sentence the marker points at excludes it.
            if (rule === "205.3m") expected.push("Time Lord");
            expect([...table].sort()).toEqual([...expected].sort());
        });
    }

    it("the parse is not vacuous — every list has a plausible size", () => {
        expect(CREATURE_SUBTYPES.size).toBeGreaterThan(200);
        expect(LAND_SUBTYPES.size).toBeGreaterThan(10);
        expect(ARTIFACT_SUBTYPES.size).toBeGreaterThan(10);
        expect(ENCHANTMENT_SUBTYPES.size).toBeGreaterThan(5);
        expect(SPELL_SUBTYPES.size).toBeGreaterThan(3);
    });

    it("the lists do not overlap, so a bare noun has ONE card type", () => {
        // The grammar reads a bare subtype noun ("target Wall") by looking the
        // word up in these tables; a word in two of them would have two
        // readings and the descriptor's unique-split rule would report it as
        // ambiguous rather than pick one.
        const seen = new Map<string, string>();
        for (const [name, , , table] of CASES) {
            for (const subtype of table) {
                const previous = seen.get(subtype);
                expect(
                    previous === undefined
                        ? `${subtype}: ${name}`
                        : `${subtype}: ${previous} and ${name}`
                ).toBe(`${subtype}: ${name}`);
                seen.set(subtype, name);
            }
        }
    });
});
