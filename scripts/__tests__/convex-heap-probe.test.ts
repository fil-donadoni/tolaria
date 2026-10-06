/**
 * The search and arithmetic behind `scripts/convex-heap-probe.ts` (issue
 * #4852, ADR 0113 Amendment IV). The script needs the network and a cloud
 * deployment, so it runs in no suite; how it turns survived paddings into the
 * isolate's heap and the Node→isolate ratio is pure and pinned here.
 */
import { describe, expect, it } from "vitest";
import {
    CONVEX_CALL_RAM_BYTES,
    PAD_SEARCH_CEILING,
    isMemoryFailure,
    isolatePoolBytes,
    largestSurviving,
    nodeToIsolateRatios,
    poolJson,
    resultTable,
    smallestFailingRows,
    type SizeResult,
} from "../lib/convex-heap-probe";

const MIB = 1024 * 1024;

describe("largestSurviving — the room a call has left, in chunks", () => {
    it.each([0, 1, 2, 3, 511, 512, 513, 1000])(
        "finds a wall at %i chunks exactly",
        async (wall) => {
            const calls: number[] = [];
            const room = await largestSurviving(async (p) => {
                calls.push(p);
                return p <= wall;
            });
            expect(room).toBe(wall);
            expect(calls.length).toBeLessThanOrEqual(
                2 * Math.ceil(Math.log2(wall + 2)) + 2
            );
        }
    );

    it("is -1 when even a padless call fails", async () => {
        expect(await largestSurviving(async () => false)).toBe(-1);
    });

    it("throws when nothing fails below the ceiling", async () => {
        await expect(largestSurviving(async () => true)).rejects.toThrow(
            new RegExp(`${PAD_SEARCH_CEILING}-chunk ceiling`)
        );
    });
});

describe("isolatePoolBytes — the pool's share of the control's room", () => {
    it("is the wall times the room the pool took", () => {
        expect(isolatePoolBytes(1000, 750)).toBe(CONVEX_CALL_RAM_BYTES / 4);
        expect(isolatePoolBytes(1000, 1000)).toBe(0);
    });

    it("is null for a pool call that failed or never ran", () => {
        expect(isolatePoolBytes(1000, -1)).toBeNull();
        expect(isolatePoolBytes(1000, undefined)).toBeNull();
    });

    it("refuses a control with no room", () => {
        expect(() => isolatePoolBytes(0, 10)).toThrow(/control/);
    });
});

const size = (over: Partial<SizeResult> & { rows: number }): SizeResult => ({
    sourceBytes: over.rows * 1000,
    nodeHeapBytes: 8 * MIB,
    ...over,
});

describe("nodeToIsolateRatios", () => {
    it("divides isolate heap by Node heap, skipping sizes without both", () => {
        const ratios = nodeToIsolateRatios(1000, [
            size({ rows: 4000, roomChunks: 750 }), // 16 MiB iso / 8 MiB Node
            size({ rows: 9000, roomChunks: -1 }),
            size({ rows: 12000, pushError: "boom" }),
        ]);
        expect(ratios).toEqual([{ rows: 4000, ratio: 2 }]);
    });
});

describe("smallestFailingRows", () => {
    it("names the smallest size whose push or padless call failed", () => {
        expect(
            smallestFailingRows([
                size({ rows: 4000, roomChunks: 700 }),
                size({ rows: 35000, pushError: "too big" }),
                size({ rows: 12000, roomChunks: -1 }),
            ])
        ).toBe(12000);
        expect(
            smallestFailingRows([size({ rows: 4000, roomChunks: 1 })])
        ).toBeNull();
    });
});

describe("isMemoryFailure — only memory reads as 'no room'", () => {
    it.each([
        "JavaScript execution ran out of memory (maximum memory usage: 64 MB)",
        "Uncaught RangeError: Array buffer allocation failed: heap limit",
        "Server Error: OOM",
    ])("accepts %j", (m) => expect(isMemoryFailure(m)).toBe(true));

    it.each([
        "fetch failed",
        "[Request ID: abc] Server Error",
        "Could not find public function for 'pool:run'",
    ])("refuses %j", (m) => expect(isMemoryFailure(m)).toBe(false));
});

describe("poolJson — the deleted pool file's shape", () => {
    it("is a 4-space-indented JSON array", () => {
        expect(poolJson([{ id: "a" }])).toBe(
            '[\n    {\n        "id": "a"\n    }\n]\n'
        );
    });
});

describe("resultTable", () => {
    it("has one row per size and escapes error text", () => {
        const table = resultTable(1000, [
            size({
                rows: 4000,
                roomChunks: 750,
                latencyMedianMs: 12,
                latencyP90Ms: 30,
            }),
            size({
                rows: 35000,
                roomChunks: -1,
                callError: "out of memory | a\nb",
            }),
        ]);
        const lines = table.split("\n");
        expect(lines).toHaveLength(4);
        expect(lines[2]).toContain("| 4,000 |");
        expect(lines[2]).toContain("16.0 MiB");
        expect(lines[2]).toContain("| 2.00 |");
        expect(lines[3]).toContain("call fails");
        expect(lines[3]).toContain("out of memory \\| a b");
    });
});
