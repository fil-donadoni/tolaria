/**
 * The `merge=key-set` resolution (issue #6276), pure.
 *
 * `data/issue-log-comments-baseline.json` is a sorted JSON array of keys that
 * may only shrink. Two PRs that delete adjacent or overlapping rows conflict
 * under the default text merge although neither disagrees: the guard reds on
 * stale keys, so a PR drops rows of files it never touched and overlapping
 * deletions are the normal case. Merged as a SET the result is the base, minus
 * what either side removed, plus what either side added, sorted.
 *
 * The same set semantics merge a sorted array of ROWS keyed by a unique
 * `name` (issue #6648) — `data/card-index.json`, one object per card, where a
 * PR adds its cards' rows at their sorted places and two PRs adding adjacent
 * names conflict as text. Merged per key: a row only one side changed takes
 * that side, a row both changed identically takes it once, and a row both
 * changed DIFFERENTLY is a real disagreement — an error, left to a human.
 */

export type KeySetMerge =
    | { ok: true; keys: string[] }
    | { ok: false; error: string };

function parseKeys(text: string, side: string): string[] | string {
    if (text.trim() === "") return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (err) {
        return `the ${side} side is not valid JSON (${String(err)})`;
    }
    if (!Array.isArray(parsed) || parsed.some((k) => typeof k !== "string")) {
        return `the ${side} side is not a JSON array of strings`;
    }
    return parsed as string[];
}

/** Canonical form of the file: four-space JSON array, trailing newline. */
export function serializeKeys(keys: readonly string[]): string {
    return `${JSON.stringify(keys, null, 4)}\n`;
}

/** Merge three file texts; an empty base (add/add) reads as an empty set. */
export function mergeKeySets(
    baseText: string,
    oursText: string,
    theirsText: string
): KeySetMerge {
    const sides = {
        base: parseKeys(baseText, "base"),
        ours: parseKeys(oursText, "ours"),
        theirs: parseKeys(theirsText, "theirs"),
    };
    for (const v of Object.values(sides)) {
        if (typeof v === "string") return { ok: false, error: v };
    }
    const base = new Set(sides.base as string[]);
    const ours = new Set(sides.ours as string[]);
    const theirs = new Set(sides.theirs as string[]);
    const merged = new Set<string>();
    for (const k of base) if (ours.has(k) && theirs.has(k)) merged.add(k);
    for (const k of ours) if (!base.has(k)) merged.add(k);
    for (const k of theirs) if (!base.has(k)) merged.add(k);
    return { ok: true, keys: [...merged].sort() };
}

/** A row of a keyed file: a JSON object whose `name` is its key. */
export type KeyedRow = { readonly name: string } & Record<string, unknown>;

function parseRows(text: string, side: string): KeyedRow[] | string {
    if (text.trim() === "") return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (err) {
        return `the ${side} side is not valid JSON (${String(err)})`;
    }
    if (
        !Array.isArray(parsed) ||
        parsed.some(
            (r) =>
                typeof r !== "object" ||
                r === null ||
                typeof (r as { name?: unknown }).name !== "string"
        )
    ) {
        return `the ${side} side is not a JSON array of objects keyed by \`name\``;
    }
    const rows = parsed as KeyedRow[];
    if (new Set(rows.map((r) => r.name)).size !== rows.length)
        return `the ${side} side names a row twice`;
    return rows;
}

/**
 * Canonical form of a keyed file, as its writers emit it: sorted by
 * `name.localeCompare`, four-space JSON, trailing newline.
 */
export function serializeRows(rows: readonly KeyedRow[]): string {
    const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));
    return `${JSON.stringify(sorted, null, 4)}\n`;
}

/** Merge three texts of a keyed file, row by row (see the header). */
export function mergeKeyedRows(
    baseText: string,
    oursText: string,
    theirsText: string
): { ok: true; rows: KeyedRow[] } | { ok: false; error: string } {
    const sides = {
        base: parseRows(baseText, "base"),
        ours: parseRows(oursText, "ours"),
        theirs: parseRows(theirsText, "theirs"),
    };
    for (const v of Object.values(sides)) {
        if (typeof v === "string") return { ok: false, error: v };
    }
    const byName = (rows: KeyedRow[]) =>
        new Map(rows.map((r) => [r.name, r] as const));
    const base = byName(sides.base as KeyedRow[]);
    const ours = byName(sides.ours as KeyedRow[]);
    const theirs = byName(sides.theirs as KeyedRow[]);
    const same = (a: KeyedRow | undefined, b: KeyedRow | undefined) =>
        JSON.stringify(a) === JSON.stringify(b);
    const merged: KeyedRow[] = [];
    for (const name of new Set([
        ...base.keys(),
        ...ours.keys(),
        ...theirs.keys(),
    ])) {
        const [b, o, t] = [base.get(name), ours.get(name), theirs.get(name)];
        const row = same(o, t) || same(t, b) ? o : same(o, b) ? t : null;
        if (row === null)
            return {
                ok: false,
                error: `row "${name}" changed differently on both sides`,
            };
        if (row !== undefined) merged.push(row);
    }
    return { ok: true, rows: merged };
}

/**
 * The driver's entry: a file of keys or a file of keyed rows, decided by the
 * shape its sides hold, merged and rendered canonically.
 */
export function mergeKeySetFile(
    baseText: string,
    oursText: string,
    theirsText: string
): { ok: true; text: string } | { ok: false; error: string } {
    const keyed = [baseText, oursText, theirsText].some((t) =>
        /^\s*\[\s*\{/.test(t)
    );
    if (keyed) {
        const r = mergeKeyedRows(baseText, oursText, theirsText);
        return r.ok ? { ok: true, text: serializeRows(r.rows) } : r;
    }
    const r = mergeKeySets(baseText, oursText, theirsText);
    return r.ok ? { ok: true, text: serializeKeys(r.keys) } : r;
}
