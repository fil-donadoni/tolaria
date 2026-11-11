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
 * SPECIMEN TABLES (issue #9226). A `*_SPECIMENS` table is a second home of
 * surface definitions: each of its rows becomes ONE surface through
 * `...X_SPECIMENS.map((spec) => dialogSpecimenSurface(SECTION, spec))` in the
 * array, with id `<SECTION.idPrefix>-<slug>`. A hunk wholly inside a row of
 * such a table selects that surface, by the same rule as a `SURFACES`
 * element. Fail-closed: a table no spread maps, a section whose `idPrefix`
 * cannot be read, or a row with no `slug` leaves the table unparsed, and a
 * hunk there is `shared`, as before.
 *
 * A row FIELD read outside its own surface is shared machinery (review of
 * issue #9226): `SPECIMEN_LAYERS` spreads every table and reads each row's
 * `layer`, which then decides page reuse for EVERY specimen surface. Any
 * other reference to a table must be a `...TABLE,` spread closed by
 * `].map((s) => s.<field>)`; that field is shared, and a hunk touching it is
 * `shared`. A reference of any other shape leaves the table unparsed.
 *
 * Pure: the caller supplies the NEW source and a `git diff -U0` of the file.
 */

export type SurfaceEdits =
    | { kind: "surfaces"; ids: string[] }
    /** `unreadable`: the registry diff could not be READ (doubt, issue #6144),
     *  as against a hunk that reads fine and sits in a shared helper (certain). */
    | { kind: "shared"; reason: string; unreadable?: boolean };

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
// A line that moves nothing: blank, a line comment, a one-line block comment
// with NOTHING after its close, a line that opens a block comment, a line
// inside one, or the line that closes it. A block comment CLOSED and followed
// by code (`/* x */ ...EXTRA,`) is code — the review of issue #4687 found the
// earlier `\/\*.*` alternative accepted it, a fail-open in a fail-closed
// classifier. (Line comments here: the pattern's own text would end a block one.)
const INERT_LINE =
    /^\s*(?:\/\/.*|\/\*.*\*\/\s*|\/\*(?!.*\*\/).*|\*\/\s*|\*(?!\/).*)?$/;

/** A bracketed list of surface definitions in the NEW source: the
 *  `SURFACES` array, or a specimen table mapped into it (issue #9226). */
interface Region {
    open: number;
    close: number;
    elements: ElementSpan[];
    /** Row fields other code reads across rows (a specimen table only). */
    sharedFields?: ReadonlySet<string>;
}

const SPECIMEN_TABLE_OPEN = /^const (\w+_SPECIMENS): readonly \w+\[\] = \[$/;
const SPECIMEN_SLUG = /^ {8}slug: "([^"]+)",?$/;
const SPECIMEN_SPREAD = /^ {4}\.\.\.(\w+_SPECIMENS)\.map\(\(spec\) =>$/;
const SPECIMEN_SURFACE_CALL = /^ {8}dialogSpecimenSurface\((\w+), spec\)$/;
const SECTION_OPEN = /^const (\w+): DialogSpecimenSection = \{$/;
const SECTION_ID_PREFIX = /^ {4}idPrefix: "([^"]+)",$/;
const SPECIMEN_FIELD = /^ {8}(\w+):/;
const SPREAD_FIELD_MAP = /^\s*\]\.map\(\((\w+)\) => \1\.(\w+)\),?$/;
/** How far a cross-row spread may run before its `].map(...)` closes it. */
const SPREAD_LOOKAHEAD = 8;

/** Elements of the list opened at line `open` (1-indexed), each id read by
 *  `idLine` and passed through `toId`; null when a row has no id or the list
 *  never closes. */
function parseList(
    lines: string[],
    open: number,
    idLine: RegExp,
    toId: (raw: string) => string
): Region | null {
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
        if (id === null) {
            const raw = idLine.exec(line)?.[1];
            if (raw !== undefined) id = toId(raw);
        }
        if (ELEMENT_CLOSE.test(line)) {
            if (id === null) return null; // an element with no id: unparseable
            elements.push({ id, start, end: n });
            start = 0;
        }
    }
    return null;
}

/** `idPrefix` of every `DialogSpecimenSection` constant, by its name. */
function sectionPrefixes(lines: string[]): Map<string, string> {
    const prefixes = new Map<string, string>();
    let section: string | null = null;
    for (const line of lines) {
        const open = SECTION_OPEN.exec(line);
        if (open) {
            section = open[1];
            continue;
        }
        if (section === null) continue;
        if (line === "};") section = null;
        else {
            const prefix = SECTION_ID_PREFIX.exec(line)?.[1];
            if (prefix !== undefined) prefixes.set(section, prefix);
        }
    }
    return prefixes;
}

/** Each specimen table the `SURFACES` array spreads through
 *  `dialogSpecimenSurface`, as a region whose ids are the surfaces it yields.
 *  A table that cannot be read whole is left out: its hunks stay `shared`. */
export function parseSpecimenTables(source: string): Region[] {
    const lines = source.split("\n");
    const prefixes = sectionPrefixes(lines);
    const sectionOf = new Map<string, string>();
    for (let n = 1; n < lines.length; n++) {
        const table = SPECIMEN_SPREAD.exec(lines[n - 1])?.[1];
        const section = SPECIMEN_SURFACE_CALL.exec(lines[n])?.[1];
        if (table !== undefined && section !== undefined) {
            // A table spread twice (two sections) is ambiguous: leave it out.
            sectionOf.set(table, sectionOf.has(table) ? "" : section);
        }
    }
    const regions: Region[] = [];
    lines.forEach((line, i) => {
        const table = SPECIMEN_TABLE_OPEN.exec(line)?.[1];
        if (table === undefined) return;
        const prefix = prefixes.get(sectionOf.get(table) ?? "");
        if (prefix === undefined) return;
        const sharedFields = crossRowFields(lines, table);
        if (sharedFields === null) return;
        const region = parseList(
            lines,
            i + 1,
            SPECIMEN_SLUG,
            (slug) => `${prefix}-${slug}`
        );
        if (region) regions.push({ ...region, sharedFields });
    });
    return regions;
}

/** The fields of `table`'s rows that code outside its own surface reads:
 *  every reference other than its declaration and its `dialogSpecimenSurface`
 *  spread must be a `...TABLE,` spread closed by `].map((s) => s.<field>)`.
 *  Null when a reference has any other shape: the table cannot be narrowed. */
function crossRowFields(lines: string[], table: string): Set<string> | null {
    const fields = new Set<string>();
    const name = new RegExp(`\\b${table}\\b`);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!name.test(line)) continue;
        if (SPECIMEN_TABLE_OPEN.exec(line)?.[1] === table) continue;
        if (SPECIMEN_SPREAD.exec(line)?.[1] === table) continue;
        if (line.trim() !== `...${table},`) return null;
        let field: string | undefined;
        for (
            let j = i + 1;
            j <= i + SPREAD_LOOKAHEAD && j < lines.length;
            j++
        ) {
            field = SPREAD_FIELD_MAP.exec(lines[j])?.[2];
            if (field !== undefined) break;
        }
        if (field === undefined) return null;
        fields.add(field);
    }
    return fields;
}

/** The row field line `n` belongs to: the nearest `        field:` at or
 *  above it inside `row`; null on the row's own brace lines. */
function fieldAt(lines: string[], row: ElementSpan, n: number): string | null {
    for (let k = n; k > row.start; k--) {
        const field = SPECIMEN_FIELD.exec(lines[k - 1] ?? "")?.[1];
        if (field !== undefined) return field;
    }
    return null;
}

/** The `SURFACES` array's bracket lines and its elements, in the NEW source. */
export function parseSurfaceElements(source: string): Region | null {
    const lines = source.split("\n");
    const open = lines.findIndex((l) => ARRAY_OPEN.test(l)) + 1;
    if (open === 0) return null;
    return parseList(lines, open, ELEMENT_ID, (id) => id);
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

/** A shared field the hunk adds, removes or edits inside `rows`, else null.
 *  A pure deletion belongs to the field of the line it follows, and any
 *  removed line that opens a field names that field too. */
function sharedFieldTouched(
    hunk: Hunk,
    rows: ElementSpan[],
    newLines: string[],
    sharedFields: ReadonlySet<string>
): string | null {
    const { newStart: c, newCount: d } = hunk;
    const fields: (string | null)[] = [];
    for (const row of rows) {
        const span = d > 0 ? [c, c + d - 1] : [c, c];
        for (
            let n = Math.max(span[0], row.start);
            n <= Math.min(span[1], row.end);
            n++
        ) {
            fields.push(fieldAt(newLines, row, n));
        }
    }
    for (const l of hunk.removed)
        fields.push(SPECIMEN_FIELD.exec(l)?.[1] ?? null);
    return fields.find((f) => f !== null && sharedFields.has(f)) ?? null;
}

const shared = (reason: string, unreadable = false): SurfaceEdits =>
    unreadable
        ? { kind: "shared", reason, unreadable }
        : { kind: "shared", reason };

export function classifySurfaceEdits(
    newSource: string,
    zeroContextDiff: string
): SurfaceEdits {
    const parsed = parseSurfaceElements(newSource);
    if (!parsed) return shared("the SURFACES array could not be parsed", true);
    const regions = [parsed, ...parseSpecimenTables(newSource)];
    const newLines = newSource.split("\n");
    const ids = new Set<string>();

    const hunks = parseHunks(zeroContextDiff);
    // The caller listed the file as changed; a diff with no hunk was read
    // from a tree that is not the PR's (a standalone `verify:ui-receipt`
    // from another checkout). Walk MORE, never less.
    if (hunks.length === 0) {
        return shared(
            "the file is listed as changed but its diff has no hunk",
            true
        );
    }
    for (const hunk of hunks) {
        const { newStart: c, newCount: d } = hunk;
        const region = regions.find(({ open, close }) =>
            d > 0 ? c > open && c + d - 1 < close : c >= open && c < close
        );
        if (!region) {
            return shared(
                `the hunk at line ${c} is outside the SURFACES array and every specimen table (a shared helper, selector or table)`
            );
        }
        const { elements, sharedFields } = region;
        const touched =
            d > 0
                ? elements.filter((e) => e.start <= c + d - 1 && e.end >= c)
                : elements.filter((e) => e.start <= c && c < e.end);
        for (const e of touched) ids.add(e.id);

        if (sharedFields && sharedFields.size > 0) {
            const hit = sharedFieldTouched(
                hunk,
                touched,
                newLines,
                sharedFields
            );
            if (hit !== null) {
                return shared(
                    `the hunk at line ${c} edits \`${hit}\`, a specimen field read across every row`
                );
            }
        }

        // Lines no element accounts for must move nothing: comments, blanks.
        const inElement = (n: number) =>
            elements.some((e) => e.start <= n && n <= e.end);
        for (let n = c; n < c + d; n++) {
            if (!inElement(n) && !INERT_LINE.test(newLines[n - 1] ?? "")) {
                return shared(
                    `line ${n} is between list elements and is not a comment`
                );
            }
        }
        if (touched.length === 0) {
            const stray = hunk.removed.find((l) => !INERT_LINE.test(l));
            if (stray !== undefined) {
                return shared(
                    `a hunk at line ${c} removes code no list element accounts for`
                );
            }
        }
    }
    return { kind: "surfaces", ids: [...ids] };
}
