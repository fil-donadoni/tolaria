/**
 * The search and arithmetic behind `scripts/convex-heap-probe.ts` (issue
 * #4852, ADR 0113 Amendment IV). The script needs the network and a cloud
 * deployment, so it runs in no suite; how it turns survived paddings into the
 * isolate's heap and the Node→isolate ratio is pure and pinned here.
 */
import { describe, expect, it } from "vitest";
import {
    doubleChunkBytes,
    PAD_SEARCH_CEILING,
    padModule,
    padSearchCeiling,
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
// A double chunk is 128 KiB under every layout. Same layout: the control
// fits as many integer chunks as double ones; compressed: twice as many.
const SAME = isolateCalibration(400, 400); // 50 MiB of room
const COMPRESSED = isolateCalibration(800, 400);

describe("isolateCalibration — the integer chunk sized by the double one", () => {
    it("is a double chunk when both shapes fill the same room", () => {
        expect(SAME.compressed).toBe(false);
        expect(SAME.chunkBytes).toBe(doubleChunkBytes());
        expect(SAME.roomBytes).toBe(50 * MIB);
    });

    it("is half a double chunk when twice as many fit (pointer compression)", () => {
        expect(COMPRESSED.compressed).toBe(true);
        expect(COMPRESSED.chunkBytes).toBe(64 * KIB);
        expect(COMPRESSED.roomBytes).toBe(50 * MIB);
    });

    it("refuses a control with no room in either shape", () => {
        expect(() => isolateCalibration(0, 400)).toThrow(/control/);
        expect(() => isolateCalibration(400, 0)).toThrow(/control/);
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

describe("chunk length — a smaller chunk scales the yardstick and the ceiling", () => {
    it("sizes a 1,024-element chunk at 8 KiB of doubles and scales the ceiling", () => {
        const cal = isolateCalibration(10_000, 10_000, 1024);
        expect(cal.chunkBytes).toBe(8 * 1024);
        expect(padSearchCeiling(1024)).toBe(PAD_SEARCH_CEILING * 16);
        expect(padModule(1024)).toContain("new Array(1024)");
    });
});
