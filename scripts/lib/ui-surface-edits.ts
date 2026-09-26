/**
 * Which surfaces a diff to `scripts/ui-gate/surfaces.ts` edits (issue #4687).
 *
 * WHY. `ui-scope.ts` treats the whole lane directory as "changes what every
 * surface's measurement means" and forces the FULL lane. That is right for the
 * probe, the floors, the settle predicate and every shared walk helper — but
 * `surfaces.ts` is also where each surface's own definition lives, so a census
 * -debt slice that adds four surfaces paid 60 surfaces × 5 viewports to prove
 * four rows.
 *
 * THE RULE, FAIL-CLOSED. `surfaces.ts` is one file with two kinds of line:
 * the elements of the `SURFACES` array (one object per surface, at a fixed
 * indent) and everything else — the helpers, selectors and closures those
 * elements call, and `UNWALKED_SURFACES`. A hunk that lies wholly inside
 * element(s) of the array selects exactly those surfaces. A hunk anywhere else
 * (a shared helper, a constant, the array's own declaration), or one that
 * removes lines no element accounts for, is shared machinery: the answer is
 * `shared` and the caller runs the full lane. Comment and blank lines between
 * elements are the one thing outside an element that moves nothing.
 *
 * Pure: the caller supplies the NEW source and a `git diff -U0` of the file.
 */

export type SurfaceEdits =
    | { kind: "surfaces"; ids: string[] }
    | { kind: "shared"; reason: string };

interface ElementSpan {
    id: string;
    /** 1-indexed, inclusive: the `    {` line and the `    },` line. */
    start: number;
    end: number;
}

const ARRAY_OPEN = /^export const SURFACES\b.*=\s*\[$/;
const ELEMENT_OPEN = /^ {4}\{$/;
const ELEMENT_CLOSE = /^ {4}\},$/;
const ELEMENT_ID = /^ {8}id: "([^"]+)",?$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const INERT_LINE = /^\s*(?:\/\/.*|\/\*.*|\*.*)?$/;

/** The `SURFACES` array's bracket lines and its elements, in the NEW source. */
export function parseSurfaceElements(source: string): {
    open: number;
    close: number;
    elements: ElementSpan[];
} | null {
    const lines = source.split("\n");
    const open = lines.findIndex((l) => ARRAY_OPEN.test(l)) + 1;
    if (open === 0) return null;
    const elements: ElementSpan[] = [];
    let start = 0;
    let id: string | null = null;
    for (let n = open + 1; n <= lines.length; n++) {
        const line = lines[n - 1];
        if (start === 0) {
            if (line === "];") return { open, close: n, elements };
            if (ELEMENT_OPEN.test(line)) {
                start = n;
                id = null;
            }
            continue;
        }
        if (id === null) id = ELEMENT_ID.exec(line)?.[1] ?? null;
        if (ELEMENT_CLOSE.test(line)) {
            if (id === null) return null; // an element with no id: unparseable
            elements.push({ id, start, end: n });
            start = 0;
        }
    }
    return null;
}

interface Hunk {
    newStart: number;
    newCount: number;
    added: string[];
    removed: string[];
}

function parseHunks(diff: string): Hunk[] {
    const hunks: Hunk[] = [];
    let cur: Hunk | null = null;
    for (const line of diff.split("\n")) {
        const m = HUNK_HEADER.exec(line);
        if (m) {
            cur = {
                newStart: Number(m[3]),
                newCount: m[4] === undefined ? 1 : Number(m[4]),
                added: [],
                removed: [],
            };
            hunks.push(cur);
        } else if (cur && line.startsWith("+")) cur.added.push(line.slice(1));
        else if (cur && line.startsWith("-")) cur.removed.push(line.slice(1));
    }
    return hunks;
}

const shared = (reason: string): SurfaceEdits => ({ kind: "shared", reason });

export function classifySurfaceEdits(
    newSource: string,
    zeroContextDiff: string
): SurfaceEdits {
    const parsed = parseSurfaceElements(newSource);
    if (!parsed) return shared("the SURFACES array could not be parsed");
    const { open, close, elements } = parsed;
    const newLines = newSource.split("\n");
    const ids = new Set<string>();

    for (const hunk of parseHunks(zeroContextDiff)) {
        const { newStart: c, newCount: d } = hunk;
        const inside =
            d > 0 ? c > open && c + d - 1 < close : c >= open && c < close;
        if (!inside) {
            return shared(
                `the hunk at line ${c} is outside the SURFACES array (a shared helper, selector or table)`
            );
        }
        const touched =
            d > 0
                ? elements.filter((e) => e.start <= c + d - 1 && e.end >= c)
                : elements.filter((e) => e.start <= c && c < e.end);
        for (const e of touched) ids.add(e.id);

        // Lines no element accounts for must move nothing: comments, blanks.
        const inElement = (n: number) =>
            elements.some((e) => e.start <= n && n <= e.end);
        for (let n = c; n < c + d; n++) {
            if (!inElement(n) && !INERT_LINE.test(newLines[n - 1] ?? "")) {
                return shared(
                    `line ${n} is between SURFACES elements and is not a comment`
                );
            }
        }
        if (touched.length === 0) {
            const stray = hunk.removed.find((l) => !INERT_LINE.test(l));
            if (stray !== undefined) {
                return shared(
                    `a hunk at line ${c} removes code no SURFACES element accounts for`
                );
            }
        }
    }
    return { kind: "surfaces", ids: [...ids] };
}
