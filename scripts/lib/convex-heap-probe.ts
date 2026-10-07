/**
 * The pure half of `scripts/convex-heap-probe.ts` (issue #4852, PRD issue
 * #4849, ADR 0113 Amendment IV): the harness sources it pushes, the search
 * for the largest padding a call survives, and the arithmetic that turns
 * those paddings into the isolate's heap and the Node→isolate ratio.
 * Everything here is a function of its arguments — no network, no child
 * process — so the arithmetic is testable without a deployment.
 *
 * Why padding: a Convex call exposes no heap counter, only its failure at the
 * 64 MiB wall. So every harness mutation first allocates `pad` CHUNKS of a
 * fixed shape and then answers; the largest `pad` a call survives is the room
 * its module left. The control module's room minus the pool module's room is
 * what the pool costs the isolate, in chunks.
 *
 * Chunks to bytes, MEASURED: a chunk is an array of small integers, 8 B per
 * element without pointer compression and half with it, so its isolate size
 * is unknown. A DOUBLE chunk (same length, unboxed doubles) is 8 B per
 * element under both layouts. The control's room in double chunks over its
 * room in integer chunks is the integer chunk's size in double chunks — no
 * assumption about the wall's size or the isolate's build, and the control's
 * own baseline (runtime, `convex/server`, args) is never billed to the pool.
 * (The first run, 2026-10-06, inferred the layout from the 64 MiB wall
 * instead; the two readings differ by 2x, so the probe measures it.)
 */

/** The wall ADR 0113 Amendment IV is drawn against: RAM of one Convex query or
 *  mutation (docs.convex.dev/production/state/limits). */
export const CONVEX_CALL_RAM_BYTES = 64 * 1024 * 1024;

/** The pool sizes the probe pushes when the operator names none (PRD #4849
 *  User Story 5: today, the projected wall, past it, the target scale). */
export const DEFAULT_PROBE_ROWS: readonly number[] = [
    4_000, 9_000, 12_000, 35_000,
];

/** Elements per padding chunk by default: 16,384 — 64 KiB of small integers
 *  under pointer compression, 128 KiB without; above V8's regular-object
 *  size, so it lives in large-object space (`--chunk-elements 1024` keeps it
 *  in regular space, beside the pool's objects). The search resolves to one
 *  chunk. */
export const PAD_CHUNK_ELEMENTS = 16_384;

/** One double chunk's bytes, the same under every V8 layout: unboxed
 *  doubles, 8 B each (the array header is noise at this length). */
export const doubleChunkBytes = (elements: number = PAD_CHUNK_ELEMENTS) =>
    elements * 8;

/** Above any room a 64 MiB call can have, whatever the chunk's layout. */
export const PAD_SEARCH_CEILING = 4_096;

/** The ceiling for a chunk of `elements`: the default's, scaled. */
export const padSearchCeiling = (elements: number): number =>
    Math.ceil((PAD_SEARCH_CEILING * PAD_CHUNK_ELEMENTS) / elements);

/** `convex/pad.ts` of the harness — shared by the control and the pool module
 *  so both pay the same padding code. Distinct arrays, each filled with its own
 *  index, so nothing is shared or folded away. */
export function padModule(elements: number = PAD_CHUNK_ELEMENTS): string {
    return `// Allocates \`chunks\` arrays of ${elements} small integers and keeps them
// reachable until the call returns: the room a call has left, in chunks.
export function pad(chunks: number): number {
    const held: number[][] = [];
    for (let i = 0; i < chunks; i++) held.push(new Array(${elements}).fill(i));
    let total = 0;
    for (const a of held) total += a.length;
    return total;
}
// The same in unboxed doubles: 8 B per element under every V8 layout — the
// yardstick that sizes the integer chunk.
export function padDoubles(chunks: number): number {
    const held: number[][] = [];
    for (let i = 0; i < chunks; i++) held.push(new Array(${elements}).fill(i + 0.5));
    let total = 0;
    for (const a of held) total += a.length;
    return total;
}
`;
}

/** `convex/empty.ts`: the control — imports nothing but the padding. */
export const EMPTY_MODULE = `import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { pad, padDoubles } from "./pad";
export const run = mutationGeneric({
    args: { pad: v.number() },
    handler: async (_ctx, args) => ({ rows: 0, padded: pad(args.pad) }),
});
export const runDoubles = mutationGeneric({
    args: { pad: v.number() },
    handler: async (_ctx, args) => ({ rows: 0, padded: padDoubles(args.pad) }),
});
// Where the deployment says it is — the verdict's evidence, not the operator's word.
export const where = queryGeneric({
    args: {},
    handler: async () => process.env.CONVEX_CLOUD_URL ?? null,
});
`;

/** `convex/pool.ts`: the compiled pool as the object literal the server
 *  carried until issue #4168 — a JSON import, which the bundler inlines. */
export const POOL_MODULE = `import { mutationGeneric } from "convex/server";
import { v } from "convex/values";
import { pad } from "./pad";
import pool from "./pool.json";
export const run = mutationGeneric({
    args: { pad: v.number() },
    handler: async (_ctx, args) => ({
        rows: (pool as unknown[]).length,
        padded: pad(args.pad),
    }),
});
`;

/** Every function the harness pushes, as `convex function-spec` names them. */
export const PROBE_FUNCTIONS: readonly string[] = [
    "empty.js:run",
    "empty.js:runDoubles",
    "empty.js:where",
    "pool.js:run",
];

/** The pool file the deleted `data/oracle-compiled-pool.json` was: a JSON
 *  array, 4-space indented. */
export function poolJson(rows: readonly unknown[]): string {
    return `${JSON.stringify(rows, null, 4)}\n`;
}

/** Whether a failed call's text names memory — the only failure the search
 *  may read as "no room". Anything else (network, a bad push) stops the run. */
export function isMemoryFailure(message: string): boolean {
    return /out of memory|memory limit|heap|\bOOM\b|maximum memory/i.test(
        message
    );
}

/** Whether a failed PUSH's output says the module is too big or ran out of
 *  memory while the deployment analysed it — a result; anything else (login,
 *  network, a bundler error) is not, and stops the run. */
export function isSizeOrMemoryPushFailure(output: string): boolean {
    return (
        isMemoryFailure(output) ||
        /too large|size limit|exceeds|maximum size|payload/i.test(output)
    );
}

/**
 * The largest `pad` in [0, ceiling] for which `survives(pad)` holds, assuming
 * survival is monotone (more padding never helps): `-1` when even 0 fails.
 * Doubling up from 1, then bisecting — ~2·log2(answer) calls.
 */
export async function largestSurviving(
    survives: (pad: number) => Promise<boolean>,
    ceiling: number = PAD_SEARCH_CEILING
): Promise<number> {
    if (!(await survives(0))) return -1;
    let ok = 0;
    let bad = -1;
    for (let p = 1; p <= ceiling; p *= 2) {
        if (await survives(p)) ok = p;
        else {
            bad = p;
            break;
        }
    }
    if (bad < 0) {
        throw new Error(
            `a call survived ${ok} chunks — over the ${ceiling}-chunk ceiling; the wall is not where it should be`
        );
    }
    while (bad - ok > 1) {
        const mid = Math.floor((ok + bad) / 2);
        if (await survives(mid)) ok = mid;
        else bad = mid;
    }
    return ok;
}

export interface SizeResult {
    /** Rows in the pushed pool. */
    readonly rows: number;
    /** Bytes of `pool.json` pushed. */
    readonly sourceBytes: number;
    /** Node heap delta of the pool module over the control, bytes. */
    readonly nodeHeapBytes: number;
    /** Push failure text, when the deployment refused the module itself for
     *  its size or memory (any other push failure stops the run). */
    readonly pushError?: string;
    /** Error text of a padless call that failed, when it failed. */
    readonly callError?: string;
    /** Largest padding a pool call survived; -1 when a padless call fails. */
    readonly roomChunks?: number;
    /** Median / p90 of `pool − control` per round, ms (padless calls). */
    readonly latencyMedianMs?: number;
    readonly latencyP90Ms?: number;
}

/** How chunks convert to the isolate's bytes, from the control's room. */
export interface Calibration {
    /** Largest integer padding the control call survived. */
    readonly controlRoomChunks: number;
    /** Largest double padding the control call survived. */
    readonly controlDoubleRoomChunks: number;
    /** One integer chunk's bytes in the isolate, measured. */
    readonly chunkBytes: number;
    /** Whether that chunk is half a double one (pointer compression). */
    readonly compressed: boolean;
    /** The control's room in bytes: the wall minus what a call holds before
     *  padding. Over 64 MiB means the documented wall is not the real one. */
    readonly roomBytes: number;
}

/** The isolate's integer chunk size, from the control's room in both chunk
 *  shapes: `doubleRoom` double chunks fill what `room` integer chunks fill. */
export function isolateCalibration(
    controlRoomChunks: number,
    controlDoubleRoomChunks: number,
    elements: number = PAD_CHUNK_ELEMENTS
): Calibration {
    const double = doubleChunkBytes(elements);
    if (controlRoomChunks <= 0 || controlDoubleRoomChunks <= 0) {
        throw new Error(
            `the control survived ${controlRoomChunks} integer / ${controlDoubleRoomChunks} double chunks`
        );
    }
    const chunkBytes = (double * controlDoubleRoomChunks) / controlRoomChunks;
    return {
        controlRoomChunks,
        controlDoubleRoomChunks,
        chunkBytes,
        compressed: chunkBytes < 0.75 * double,
        roomBytes: controlDoubleRoomChunks * double,
    };
}

/** The pool's isolate heap: the chunks of room it took from the control,
 *  at the isolate's chunk size. `null` when the pool call has no room to
 *  compare (it failed, or was never pushed). */
export function isolatePoolBytes(
    cal: Calibration,
    poolRoomChunks: number | undefined
): number | null {
    if (poolRoomChunks === undefined || poolRoomChunks < 0) return null;
    return (cal.controlRoomChunks - poolRoomChunks) * cal.chunkBytes;
}

/** Isolate heap over Node heap, for the sizes where both exist. */
export function nodeToIsolateRatios(
    cal: Calibration,
    sizes: readonly SizeResult[]
): { rows: number; ratio: number }[] {
    const out: { rows: number; ratio: number }[] = [];
    for (const s of sizes) {
        const iso = isolatePoolBytes(cal, s.roomChunks);
        if (iso === null || s.nodeHeapBytes <= 0) continue;
        out.push({ rows: s.rows, ratio: iso / s.nodeHeapBytes });
    }
    return out;
}

/** The smallest pushed size whose padless call (or push) failed, or `null`. */
export function smallestFailingRows(
    sizes: readonly SizeResult[]
): number | null {
    const failing = sizes
        .filter((s) => s.pushError !== undefined || s.roomChunks === -1)
        .map((s) => s.rows);
    return failing.length === 0 ? null : Math.min(...failing);
}

const MIB = 1024 * 1024;
const mib = (n: number): string => `${(n / MIB).toFixed(1)} MiB`;
const ms = (n: number | undefined): string =>
    n === undefined ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)} ms`;
const oneLine = (s: string): string =>
    s.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim().slice(0, 160);

/** The Markdown table the research file and the PR quote. */
export function resultTable(
    cal: Calibration | null,
    sizes: readonly SizeResult[]
): string {
    const lines = [
        "| rows | pool.json | cloud result | OOM error text | latency delta (median / p90) | room left | isolate heap | Node heap | isolate / Node |",
        "| ---: | ---: | --- | --- | --- | ---: | ---: | ---: | ---: |",
    ];
    for (const s of sizes) {
        const iso = cal === null ? null : isolatePoolBytes(cal, s.roomChunks);
        const failed = s.pushError ?? s.callError;
        const result =
            s.pushError !== undefined
                ? "push fails"
                : s.roomChunks === -1
                  ? "call fails"
                  : "ok";
        lines.push(
            `| ${s.rows.toLocaleString("en-US")} | ${mib(s.sourceBytes)} | ${result} | ` +
                `${failed === undefined ? "—" : oneLine(failed)} | ` +
                `${s.latencyMedianMs === undefined ? "—" : `${ms(s.latencyMedianMs)} / ${ms(s.latencyP90Ms)}`} | ` +
                `${s.roomChunks === undefined || s.roomChunks < 0 ? "—" : `${s.roomChunks} / ${cal?.controlRoomChunks ?? "?"}`} | ` +
                `${iso === null ? "—" : mib(iso)} | ${mib(s.nodeHeapBytes)} | ` +
                `${iso === null || s.nodeHeapBytes <= 0 ? "—" : (iso / s.nodeHeapBytes).toFixed(2)} |`
        );
    }
    return lines.join("\n");
}
