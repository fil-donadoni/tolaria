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
 * what the pool costs the isolate, in chunks — and the control's room is the
 * whole wall, which converts chunks to bytes without assuming the isolate's
 * V8 lays a chunk out as Node's does (pointer compression differs between
 * builds).
 */

/** The wall ADR 0113 Amendment IV is drawn against: RAM of one Convex query or
 *  mutation (docs.convex.dev/production/state/limits). */
export const CONVEX_CALL_RAM_BYTES = 64 * 1024 * 1024;

/** The pool sizes the probe pushes when the operator names none (PRD #4849
 *  User Story 5: today, the projected wall, past it, the target scale). */
export const DEFAULT_PROBE_ROWS: readonly number[] = [
    4_000, 9_000, 12_000, 35_000,
];

/** Elements per padding chunk: 16,384 small integers — 64 KiB under pointer
 *  compression, 128 KiB without. The search resolves to one chunk. */
export const PAD_CHUNK_ELEMENTS = 16_384;

/** Above any room a 64 MiB call can have, whatever the chunk's layout. */
export const PAD_SEARCH_CEILING = 4_096;

/** `convex/pad.ts` of the harness — shared by the control and the pool module
 *  so both pay the same padding code. Distinct arrays, each filled with its own
 *  index, so nothing is shared or folded away. */
export const PAD_MODULE = `// Allocates \`chunks\` arrays of ${PAD_CHUNK_ELEMENTS} small integers and keeps them
// reachable until the call returns: the room a call has left, in chunks.
export function pad(chunks: number): number {
    const held: number[][] = [];
    for (let i = 0; i < chunks; i++) held.push(new Array(${PAD_CHUNK_ELEMENTS}).fill(i));
    let total = 0;
    for (const a of held) total += a.length;
    return total;
}
`;

/** `convex/empty.ts`: the control — imports nothing but the padding. */
export const EMPTY_MODULE = `import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { pad } from "./pad";
export const run = mutationGeneric({
    args: { pad: v.number() },
    handler: async (_ctx, args) => ({ rows: 0, padded: pad(args.pad) }),
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
    /** Push failure text, when the deployment refused the module itself. */
    readonly pushError?: string;
    /** Error text of a padless call that failed, when it failed. */
    readonly callError?: string;
    /** Largest padding a pool call survived; -1 when a padless call fails. */
    readonly roomChunks?: number;
    /** Median / p90 of `pool − control` per round, ms (padless calls). */
    readonly latencyMedianMs?: number;
    readonly latencyP90Ms?: number;
}

/** The pool's isolate heap, anchored on the wall: the share of the control's
 *  room the pool took, times the call's RAM. `null` when the pool call has no
 *  room to compare (it failed, or was never pushed). */
export function isolatePoolBytes(
    controlRoomChunks: number,
    poolRoomChunks: number | undefined,
    wallBytes: number = CONVEX_CALL_RAM_BYTES
): number | null {
    if (controlRoomChunks <= 0) {
        throw new Error(`the control survived ${controlRoomChunks} chunks`);
    }
    if (poolRoomChunks === undefined || poolRoomChunks < 0) return null;
    return (
        ((controlRoomChunks - poolRoomChunks) / controlRoomChunks) * wallBytes
    );
}

/** Isolate heap over Node heap, for the sizes where both exist. */
export function nodeToIsolateRatios(
    controlRoomChunks: number,
    sizes: readonly SizeResult[]
): { rows: number; ratio: number }[] {
    const out: { rows: number; ratio: number }[] = [];
    for (const s of sizes) {
        const iso = isolatePoolBytes(controlRoomChunks, s.roomChunks);
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
    controlRoomChunks: number,
    sizes: readonly SizeResult[]
): string {
    const lines = [
        "| rows | pool.json | cloud result | OOM error text | latency delta (median / p90) | room left | isolate heap | Node heap | isolate / Node |",
        "| ---: | ---: | --- | --- | --- | ---: | ---: | ---: | ---: |",
    ];
    for (const s of sizes) {
        const iso = isolatePoolBytes(controlRoomChunks, s.roomChunks);
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
                `${s.roomChunks === undefined || s.roomChunks < 0 ? "—" : `${s.roomChunks} / ${controlRoomChunks}`} | ` +
                `${iso === null ? "—" : mib(iso)} | ${mib(s.nodeHeapBytes)} | ` +
                `${iso === null || s.nodeHeapBytes <= 0 ? "—" : (iso / s.nodeHeapBytes).toFixed(2)} |`
        );
    }
    return lines.join("\n");
}
