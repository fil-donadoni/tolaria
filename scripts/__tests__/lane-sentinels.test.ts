// The lane's sentinel set (issue #7651): the committed file is GENERATED —
// its header says so and re-deriving it from its own recorded candidates
// under the configured cap is a no-op — and each step of the derivation.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
    SENTINELS_HEADER,
    SENTINELS_PATH,
    buildLaneSentinels,
    collectCandidates,
    deriveSentinels,
    laneRedFiles,
    readLaneSentinels,
    readSentinelConfig,
    renderSentinels,
    sameSentinels,
} from "../lib/lane-sentinels";

const ROOT = resolve(__dirname, "..", "..");

describe("data/lane-sentinels.json is generated, never hand-edited (issue #7651)", () => {
    const committed = readLaneSentinels(ROOT);

    it("carries the provenance header", () => {
        expect(committed?.$generated).toBe(SENTINELS_HEADER);
        expect(committed?.version).toBe(1);
    });

    it("re-deriving it from its candidates under tolaria.config.json's cap is a no-op", () => {
        const text = readFileSync(join(ROOT, SENTINELS_PATH), "utf8");
        const again = buildLaneSentinels(
            committed!.candidates,
            readSentinelConfig(ROOT),
            committed!.through
        );
        // Red here: a hand edit, or `laneSentinels` changed without
        // `bun run lane:sentinels --recap`.
        expect(renderSentinels(again)).toBe(text);
    });
});

describe("the sentinel derivation (issue #7651)", () => {
    const A = "convex/gre/__tests__/a.bot.test.ts";
    const B = "convex/gre/__tests__/b.bot.test.ts";
    const C = "scripts/__tests__/c.test.ts";

    it("counts each list once per file, joins the cost and keeps only what the tree keeps", () => {
        const got = collectCandidates(
            [[A, A, B], [A]],
            [[C], ["convex/gre/sba.ts"]],
            { [A]: 16, [B]: 1_101 },
            (f) => f !== "convex/gre/sba.ts"
        );
        expect(got).toEqual([
            { file: A, reds: 2, laneReds: 0, ms: 16 },
            { file: B, reds: 1, laneReds: 0, ms: 1_101 },
            { file: C, reds: 0, laneReds: 1, ms: null },
        ]);
    });

    it("admits cheapest first under the cap and names the rest", () => {
        const got = deriveSentinels(
            [
                { file: A, reds: 1, laneReds: 0, ms: 3_000 },
                { file: B, reds: 1, laneReds: 0, ms: 2_500 },
                { file: C, reds: 0, laneReds: 1, ms: null },
                { file: "d.bot.test.ts", reds: 1, laneReds: 0, ms: 2_000 },
            ],
            5_000
        );
        expect(got).toEqual({
            sentinels: [
                { file: "d.bot.test.ts", ms: 2_000 },
                { file: B, ms: 2_500 },
            ],
            overCap: [{ file: A, ms: 3_000 }],
            unmeasured: [C],
        });
    });

    it("a refresh that moves only the counts or the window is no change", () => {
        const cfg = { windowDays: 30, capMs: 5_000 };
        const one = buildLaneSentinels(
            [{ file: A, reds: 1, laneReds: 0, ms: 16 }],
            cfg,
            "2026-10-24"
        );
        const two = buildLaneSentinels(
            [{ file: A, reds: 4, laneReds: 2, ms: 16 }],
            cfg,
            "2026-10-31"
        );
        expect(sameSentinels(two, one)).toBe(true);
        expect(
            sameSentinels(
                buildLaneSentinels(
                    [{ file: A, reds: 1, laneReds: 0, ms: 17 }],
                    cfg,
                    "2026-10-31"
                ),
                one
            )
        ).toBe(false);
        expect(sameSentinels(one, null)).toBe(false);
    });

    it("a lane record's red files are its FAILED steps' files, never a green record's or a cured flake's", () => {
        const rec = (o: unknown) => JSON.stringify(o);
        expect(
            laneRedFiles(
                rec({
                    ok: false,
                    outcomes: [
                        {
                            id: "vitest(bot)",
                            status: "fail",
                            failedFiles: [B, A],
                        },
                        {
                            id: "vitest(related)",
                            status: "pass",
                            failedFiles: [C],
                        },
                    ],
                })
            )
        ).toEqual([A, B]);
        expect(
            laneRedFiles(
                rec({
                    ok: true,
                    outcomes: [{ status: "fail", failedFiles: [A] }],
                })
            )
        ).toEqual([]);
        expect(laneRedFiles(null)).toEqual([]);
        expect(laneRedFiles("{torn")).toEqual([]);
    });
});
