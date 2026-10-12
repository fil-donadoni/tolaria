#!/usr/bin/env bun
/**
 * `bun run check:ui:calibrate <receipt-a> <receipt-b>` — compare two
 * `check:ui` receipts of the SAME tip (the MacBook's and a Linux machine's)
 * Floor by Floor and cell by cell, and print every divergent cell (issue
 * #5465, ADR 0154 §9). The Linux walk stays advisory (`ui-walk.gating`
 * false) until a calibration reports zero divergence.
 *
 * WHAT A RECEIPT SAYS ABOUT A FLOOR. The verdict block prints `PASS` for a
 * cell with every Floor at zero and `FAIL … broken floor: <floor> <n>, …` for
 * a cell that broke some, so a cell's Floor readings are recoverable from its
 * row alone: `PASS` is nine zeros, `FAIL` names the non-zero ones. A cell that
 * is `INFRA` or `UNWALKED` (or absent) has NO reading — it is unproven, and
 * a cell proven on one machine and unproven on the other is a divergence too:
 * promotion needs both sides measured. The Named Assertions are compared the
 * same way. Shape Readings are printed and never compared (`floors.ts`).
 *
 * Pure parsing and comparison; `main` is the CLI. Exit 0 identical, 1 on any
 * divergent cell, 2 on a receipt that cannot be read (usage, or the digest
 * form, which carries no rows).
 */
import { readFileSync } from "node:fs";
import { FLOORS, type Floor } from "./floors.ts";
import { SURFACE_IDS } from "./surfaces.ts";
import { VIEWPORT_IDS } from "./viewports.ts";
import { parseAssertRowLine, parseResultRowLine } from "./verify-receipt.ts";

/** What a receipt says about one surface × viewport cell. */
export interface CellReading {
    /** `null`: the cell is unproven (INFRA / UNWALKED / not in the receipt). */
    floors: Record<Floor, number> | null;
    /** The row's verdict, for the message when a side is unproven. */
    verdict: string;
    /** Named Assertion label → passed. */
    asserts: Map<string, boolean>;
}

export type ParsedReceipt = Map<string, CellReading>;

export interface Divergence {
    surface: string;
    viewport: string;
    /** A Floor name, `assert <label>`, or `measured` when one side is unproven. */
    floor: string;
    a: string;
    b: string;
}

export const cellKey = (surface: string, viewport: string): string =>
    `${surface} @ ${viewport}`;

const BROKEN_FLOOR = /^broken floor: (.*)$/;

/** `cardsZero 2, hOverflow 1` → the nine Floors, the unnamed ones at zero. */
export function floorsFromDetail(detail: string): Record<Floor, number> | null {
    const m = BROKEN_FLOOR.exec(detail);
    if (m === null) return null;
    const out = Object.fromEntries(FLOORS.map((f) => [f, 0])) as Record<
        Floor,
        number
    >;
    for (const part of m[1].split(", ")) {
        const [name, n] = part.split(" ");
        if (!(FLOORS as readonly string[]).includes(name)) return null;
        out[name as Floor] = Number(n);
    }
    return out;
}

/** Every cell's reading from a receipt's text (the verdict block's rows and
 *  assertion lines; the diagnostic block is not read). */
export function parseReceipt(
    text: string,
    surfaceIds: readonly string[] = SURFACE_IDS,
    viewportIds: readonly string[] = VIEWPORT_IDS
): ParsedReceipt {
    const cells: ParsedReceipt = new Map();
    const cell = (surface: string, viewport: string): CellReading => {
        const key = cellKey(surface, viewport);
        let c = cells.get(key);
        if (c === undefined) {
            c = { floors: null, verdict: "absent", asserts: new Map() };
            cells.set(key, c);
        }
        return c;
    };
    for (const line of text.split("\n")) {
        const row = parseResultRowLine(line, surfaceIds, viewportIds);
        if (row !== null && row.viewport !== null) {
            const c = cell(row.surface, row.viewport);
            c.verdict = row.verdict;
            c.floors =
                row.verdict === "PASS"
                    ? (Object.fromEntries(FLOORS.map((f) => [f, 0])) as Record<
                          Floor,
                          number
                      >)
                    : row.verdict === "FAIL"
                      ? floorsFromDetail(row.detail)
                      : null;
            continue;
        }
        const a = parseAssertRowLine(line, surfaceIds, viewportIds);
        if (a !== null)
            cell(a.surface, a.viewport).asserts.set(
                a.label,
                a.verdict === "PASS"
            );
    }
    return cells;
}

/** Every divergent cell between two receipts, in (surface, viewport, Floor)
 *  order of first appearance in `a` then `b`. Empty ⇔ identical. */
export function calibrate(a: ParsedReceipt, b: ParsedReceipt): Divergence[] {
    const keys = [...new Set([...a.keys(), ...b.keys()])];
    const out: Divergence[] = [];
    for (const key of keys) {
        const [surface, viewport] = key.split(" @ ");
        const x = a.get(key);
        const y = b.get(key);
        const push = (floor: string, av: string, bv: string) =>
            out.push({ surface, viewport, floor, a: av, b: bv });
        if (x?.floors == null || y?.floors == null) {
            // Unproven on a side — even on both: nothing was compared.
            push("measured", x?.verdict ?? "absent", y?.verdict ?? "absent");
            continue;
        }
        for (const floor of FLOORS)
            if (x.floors[floor] !== y.floors[floor])
                push(floor, String(x.floors[floor]), String(y.floors[floor]));
        const labels = new Set([...x.asserts.keys(), ...y.asserts.keys()]);
        for (const label of labels) {
            const av = x.asserts.get(label);
            const bv = y.asserts.get(label);
            if (av !== bv)
                push(
                    `assert ${label}`,
                    av === undefined ? "absent" : av ? "PASS" : "FAIL",
                    bv === undefined ? "absent" : bv ? "PASS" : "FAIL"
                );
        }
    }
    return out;
}

/** The line the CLI prints for one divergent cell. */
export function formatDivergence(d: Divergence): string {
    return `DIVERGE  ${d.surface.padEnd(20)} ${d.viewport.padEnd(12)} ${d.floor}: ${d.a} ≠ ${d.b}`;
}

function main(): number {
    const [pa, pb] = process.argv.slice(2);
    if (!pa || !pb) {
        console.error(
            "usage: bun run check:ui:calibrate <receipt-a> <receipt-b>"
        );
        return 2;
    }
    const parsed = [pa, pb].map((p) => parseReceipt(readFileSync(p, "utf8")));
    for (const [i, p] of [pa, pb].entries()) {
        if (parsed[i].size === 0) {
            console.error(
                `check:ui:calibrate: ${p} holds no cell rows — pass the full receipt block, not the digest form`
            );
            return 2;
        }
    }
    const diverged = calibrate(parsed[0], parsed[1]);
    for (const d of diverged) console.log(formatDivergence(d));
    console.log(
        diverged.length === 0
            ? `calibration: identical — ${parsed[0].size} cell(s), 0 divergent`
            : `calibration: ${diverged.length} divergent reading(s) — Linux stays advisory (ui-walk.gating false)`
    );
    return diverged.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(main());
