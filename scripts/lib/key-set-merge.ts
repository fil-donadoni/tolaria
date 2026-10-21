/**
 * The `merge=key-set` resolution (issue #6276), pure.
 *
 * `data/issue-log-comments-baseline.json` is a sorted JSON array of keys that
 * may only shrink. Two PRs that delete adjacent or overlapping rows conflict
 * under the default text merge although neither disagrees: the guard reds on
 * stale keys, so a PR drops rows of files it never touched and overlapping
 * deletions are the normal case. Merged as a SET the result is the base, minus
 * what either side removed, plus what either side added, sorted.
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
