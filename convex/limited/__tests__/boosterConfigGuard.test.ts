// CI guard (ADR 0059, supersedes ADR 0056; issue #1108/#1242 acceptance
// criteria): every checked-in Booster Config under `data/boosters/**` must
// currently be a Draftable Set under the per-sheet ≥80% gate — i.e. no
// config with a sheet below the floor is ever checked in. This is the
// "pipeline guard" the PRD calls for, in the style of
// `scripts/check-card-index.ts`: a drift test between committed repo data
// and the live card registry, so a card getting un-implemented (or a config
// hand-edited to add ids the registry doesn't have) fails the gate
// immediately instead of silently shipping a booster with a hole in it.
//
// `convex/` files run in a V8 isolate with no Node builtins (no `fs`), so
// this can't `readdirSync("data/boosters")` — the file list is a small
// hand-maintained registry instead. Add one line here for every new
// checked-in Booster Config.
import { describe, it, expect } from "vitest";
import leaConfigJson from "../../../data/boosters/lea.json";
import iceConfigJson from "../../../data/boosters/ice.json";
import drkConfigJson from "../../../data/boosters/drk.json";
import { computeDraftability } from "../draftable";
import type { BoosterConfig } from "../boosterTypes";

const CHECKED_IN_CONFIGS: { file: string; config: BoosterConfig }[] = [
    { file: "lea.json", config: leaConfigJson as BoosterConfig },
    { file: "ice.json", config: iceConfigJson as BoosterConfig },
    { file: "drk.json", config: drkConfigJson as BoosterConfig },
];

describe("Booster Config CI guard (ADR 0059)", () => {
    it("has at least the LEA/ICE/DRK checked-in Booster Configs", () => {
        expect(CHECKED_IN_CONFIGS.length).toBeGreaterThan(0);
        expect(CHECKED_IN_CONFIGS.map((c) => c.file)).toEqual(
            expect.arrayContaining(["lea.json", "ice.json", "drk.json"])
        );
    });

    for (const { file, config } of CHECKED_IN_CONFIGS) {
        it(`${file}: every Booster Sheet retains ≥80% implemented CardDefinitions (ADR 0059)`, () => {
            const result = computeDraftability(config);
            if (!result.draftable) {
                const failing = result.sheets
                    .filter((s) => !s.passes)
                    .map(
                        (s) =>
                            `${s.sheetName} (${(s.coverage * 100).toFixed(1)}%, ${s.missingCardIds.length} missing)`
                    )
                    .join(", ");
                throw new Error(
                    `data/boosters/${file} has sheet(s) below the ≥80% floor: ${failing}`
                );
            }
            expect(result.draftable).toBe(true);
        });
    }
});
