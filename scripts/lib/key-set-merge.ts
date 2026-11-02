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
 *
 * A third shape, a JSON object read as a keyed map, merges the
 * same way key by key — `data/pick-ratings/*.json`, `{ setCode, ratings }`,
 * where every card PR appends a rating at the tail of `ratings` and two PRs
 * conflict on the moved trailing comma.
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

/** A JSON object read as a keyed map: each key an independent fact. */
type KeyedMap = Record<string, unknown>;

const isPlainObject = (v: unknown): v is KeyedMap =>
    typeof v === "object" && v !== null && !Array.isArray(v);

function parseMap(text: string, side: string): KeyedMap | string {
    if (text.trim() === "") return {};
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (err) {
        return `the ${side} side is not valid JSON (${String(err)})`;
    }
    if (!isPlainObject(parsed)) return `the ${side} side is not a JSON object`;
    return parsed;
}

/**
 * Merge three keyed maps key by key (issue #7871), recursing into a key whose
 * value is an object on every side that holds it — so `{ setCode, ratings }`
 * merges `ratings` per Scryfall id. A key only one side changed takes that
 * side, both changed identically takes it once, both changed DIFFERENTLY is a
 * real disagreement. Order is canonical: the base's keys in the base's order,
 * then every new key sorted — so tail appends never reorder the file and the
 * next merge starts from the same form.
 */
function mergeMaps(
    base: KeyedMap,
    ours: KeyedMap,
    theirs: KeyedMap,
    path: string
): { ok: true; map: KeyedMap } | { ok: false; error: string } {
    const same = (a: unknown, b: unknown) =>
        JSON.stringify(a) === JSON.stringify(b);
    const added = [...new Set([...Object.keys(ours), ...Object.keys(theirs)])]
        .filter((k) => !Object.hasOwn(base, k))
        .sort();
    const merged: KeyedMap = {};
    for (const key of [...Object.keys(base), ...added]) {
        const [b, o, t] = [base[key], ours[key], theirs[key]];
        const keyPath = path === "" ? key : `${path}.${key}`;
        if (
            isPlainObject(o) &&
            isPlainObject(t) &&
            (b === undefined || isPlainObject(b))
        ) {
            const r = mergeMaps(b ?? {}, o, t, keyPath);
            if (!r.ok) return r;
            merged[key] = r.map;
            continue;
        }
        const value = same(o, t) || same(t, b) ? o : same(o, b) ? t : null;
        if (value === null)
            return {
                ok: false,
                error: `key "${keyPath}" changed differently on both sides`,
            };
        if (value !== undefined) merged[key] = value;
    }
    return { ok: true, map: merged };
}

/** Merge three texts of a keyed-map file; canonical four-space JSON out. */
export function mergeKeyedMapFile(
    baseText: string,
    oursText: string,
    theirsText: string
): { ok: true; text: string } | { ok: false; error: string } {
    const sides = {
        base: parseMap(baseText, "base"),
        ours: parseMap(oursText, "ours"),
        theirs: parseMap(theirsText, "theirs"),
    };
    for (const v of Object.values(sides)) {
        if (typeof v === "string") return { ok: false, error: v };
    }
    const r = mergeMaps(
        sides.base as KeyedMap,
        sides.ours as KeyedMap,
        sides.theirs as KeyedMap,
        ""
    );
    return r.ok ? { ok: true, text: `${JSON.stringify(r.map, null, 4)}\n` } : r;
}

/**
 * The driver's entry: a file of keys, a file of keyed rows, or a keyed map
 * (issue #7871), decided by the shape its sides hold, merged and rendered
 * canonically.
 */
export function mergeKeySetFile(
    baseText: string,
    oursText: string,
    theirsText: string
): { ok: true; text: string } | { ok: false; error: string } {
    if ([baseText, oursText, theirsText].some((t) => /^\s*\{/.test(t)))
        return mergeKeyedMapFile(baseText, oursText, theirsText);
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
