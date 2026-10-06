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
    isSizeOrMemoryPushFailure,
    isolateCalibration,
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

const KIB = 1024;
// Node's chunk is 128 KiB (no pointer compression); a 64 MiB wall holds 512.
const SAME = isolateCalibration(400, 128 * KIB); // 50 MiB of room, 14 MiB baseline
const COMPRESSED = isolateCalibration(800, 128 * KIB); // 100 MiB at Node's size

describe("isolateCalibration — chunks to the isolate's bytes", () => {
    it("keeps Node's chunk when the room fits the wall, the rest is baseline", () => {
        expect(SAME.compressed).toBe(false);
        expect(SAME.chunkBytes).toBe(128 * KIB);
        expect(SAME.baselineBytes).toBe(CONVEX_CALL_RAM_BYTES - 50 * MIB);
    });

    it("halves the chunk when only half of it fits (pointer compression)", () => {
        expect(COMPRESSED.compressed).toBe(true);
        expect(COMPRESSED.chunkBytes).toBe(64 * KIB);
        expect(COMPRESSED.baselineBytes).toBe(CONVEX_CALL_RAM_BYTES - 50 * MIB);
    });

    it("refuses a room even half-size chunks cannot fit, or none", () => {
        expect(() => isolateCalibration(1100, 128 * KIB)).toThrow(/wall/);
        expect(() => isolateCalibration(0, 128 * KIB)).toThrow(/control/);
    });
});

describe("isolatePoolBytes — the room the pool took, never the baseline", () => {
    it("is the chunks taken at the isolate's chunk size", () => {
        expect(isolatePoolBytes(SAME, 300)).toBe(100 * 128 * KIB);
        expect(isolatePoolBytes(COMPRESSED, 600)).toBe(200 * 64 * KIB);
        expect(isolatePoolBytes(SAME, 400)).toBe(0);
    });

    it("is null for a pool call that failed or never ran", () => {
        expect(isolatePoolBytes(SAME, -1)).toBeNull();
        expect(isolatePoolBytes(SAME, undefined)).toBeNull();
    });
});

const size = (over: Partial<SizeResult> & { rows: number }): SizeResult => ({
    sourceBytes: over.rows * 1000,
    nodeHeapBytes: 8 * MIB,
    ...over,
});

describe("nodeToIsolateRatios", () => {
    it("divides isolate heap by Node heap, skipping sizes without both", () => {
        const ratios = nodeToIsolateRatios(SAME, [
            size({ rows: 4000, roomChunks: 272 }), // 128 × 128 KiB = 16 MiB iso / 8 MiB Node
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
        const table = resultTable(SAME, [
            size({
                rows: 4000,
                roomChunks: 272,
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

describe("isSizeOrMemoryPushFailure — a refused push is a result only for size or memory", () => {
    it.each([
        "Error: module is too large",
        "JavaScript execution ran out of memory",
    ])("accepts %j", (m) => expect(isSizeOrMemoryPushFailure(m)).toBe(true));
    it.each([
        "fetch failed",
        "You are not logged in",
        "esbuild: Could not resolve",
    ])("refuses %j", (m) => expect(isSizeOrMemoryPushFailure(m)).toBe(false));
});
