// The registry parser against the real registry (issue #5078): imports the
// registry itself, a bot-only module, hence the `.bot.test.ts` suite.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BLADE_SCENARIOS } from "../../convex/gre/ai/blade/registry";
import { entryTier, parseRegistryEntries } from "../lib/blade-registry-entries";

describe("parseRegistryEntries on the real registry", () => {
    it("reads the real registry: every entry, every must", () => {
        const src = readFileSync(
            join(__dirname, "../../convex/gre/ai/blade/registry.ts"),
            "utf8"
        );
        const parsed = parseRegistryEntries(src)!;
        expect([...parsed.blocks.keys()].sort()).toEqual(
            BLADE_SCENARIOS.map((s) => s.label).sort()
        );
        const must = [...parsed.blocks.values()].filter(
            (b) => entryTier(b) === "must"
        );
        expect(must.length).toBe(
            BLADE_SCENARIOS.filter((s) => s.tier === "must").length
        );
    });
});
