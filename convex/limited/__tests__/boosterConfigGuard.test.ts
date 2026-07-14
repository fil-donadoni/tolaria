// CI guard (ADR 0056, issue #1108 acceptance criteria): every checked-in
// Booster Config under `data/boosters/**` must currently be a fully
// Draftable Set — i.e. no config referencing an unimplemented card is ever
// checked in. This is the "pipeline guard" the PRD calls for, in the style
// of `scripts/check-card-index.ts`: a drift test between committed repo data
// and the live card registry, so a card getting un-implemented (or a config
// hand-edited to add an id the registry doesn't have) fails the gate
// immediately instead of silently shipping a booster with a hole in it.
//
// `convex/` files run in a V8 isolate with no Node builtins (no `fs`), so
// this can't `readdirSync("data/boosters")` — the file list is a small
// hand-maintained registry instead, same pattern as `DATA_SETS` in
// `scripts/backfill-rarity.mjs`. Add one line here for every new checked-in
// Booster Config.
import { describe, it, expect } from "vitest";
import leaConfigJson from "../../../data/boosters/lea.json";
import { computeDraftability } from "../draftable";
import type { BoosterConfig } from "../boosterTypes";

const CHECKED_IN_CONFIGS: { file: string; config: BoosterConfig }[] = [
    { file: "lea.json", config: leaConfigJson as BoosterConfig },
];

describe("Booster Config CI guard (ADR 0056)", () => {
    it("has at least one checked-in Booster Config (LEA)", () => {
        expect(CHECKED_IN_CONFIGS.length).toBeGreaterThan(0);
        expect(CHECKED_IN_CONFIGS.map((c) => c.file)).toContain("lea.json");
    });

    for (const { file, config } of CHECKED_IN_CONFIGS) {
        it(`${file}: every sheet card resolves to an implemented CardDefinition`, () => {
            const result = computeDraftability(config);
            if (!result.draftable) {
                throw new Error(
                    `data/boosters/${file} references ${result.missingCardIds.length} unimplemented card(s): ` +
                        `${result.missingCardIds.slice(0, 10).join(", ")}` +
                        (result.missingCardIds.length > 10 ? ", …" : "")
                );
            }
            expect(result.draftable).toBe(true);
        });
    }
});
