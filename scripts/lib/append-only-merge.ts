/**
 * The `merge=append-only` resolution (issue #5942), pure.
 *
 * A hand-written list that every slice appends to — the blade entries, the
 * grammar golden fixtures — conflicts under the default text merge whenever two
 * branches append at the same end, although neither disagrees with the other.
 * git's built-in `union` driver does NOT absorb that: inside a conflict hunk it
 * keeps the lines both sides share ONCE, so two appended entries that share
 * `{`, `tier: "must",`, `},` collapse into one object with two `label:` keys.
 *
 * So the driver runs the merge in diff3 style, where git leaves every conflict
 * hunk whole (no common-line reduction), and resolves exactly ONE shape: a hunk
 * whose BASE section is empty. That is two pure insertions at the same point,
 * and the resolution is ours, whole, followed by theirs, whole. A hunk with a
 * non-empty base edits or deletes existing lines, and is left as a conflict
 * for a human, exactly as the default merge would — with ONE exception.
 *
 * A hunk where both sides only DELETED (issue #6648): each side is the base
 * with lines dropped, in order, and the base's lines are distinct. That is the
 * shrink-only list's shape — Guard C's round-trip baseline, where every PR
 * deletes the rows it graduates and two PRs graduating adjacent names
 * conflict as text — and the resolution is the base lines BOTH sides kept.
 * Distinct lines make it unambiguous which lines each side dropped; a hunk
 * with a repeated line (`},` in a list of objects) stays a conflict.
 */

/** Longer than any run of `<`/`=`/`>` a source file plausibly holds, so the
 *  parser never mistakes file content for a marker. */
export const APPEND_ONLY_MARKER_SIZE = 31;

const OURS = "<".repeat(APPEND_ONLY_MARKER_SIZE);
const BASE = "|".repeat(APPEND_ONLY_MARKER_SIZE);
const SEP = "=".repeat(APPEND_ONLY_MARKER_SIZE);
const THEIRS = ">".repeat(APPEND_ONLY_MARKER_SIZE);

const isMarker = (line: string, marker: string): boolean =>
    line === marker || line.startsWith(`${marker} `);

export interface AppendOnlyResolution {
    /** The merged text: pure-insertion hunks concatenated, every other hunk
     *  left in diff3 conflict form. */
    text: string;
    /** Hunks left as conflicts (a side edited a line, or the hunk did not parse). */
    unresolved: number;
}

/** Is `side` the distinct-lined `base` with lines dropped, order kept? */
function deletesOnly(
    base: readonly string[],
    side: readonly string[]
): boolean {
    let j = 0;
    for (const line of base) if (j < side.length && side[j] === line) j++;
    return j === side.length;
}

function isPureDeletion(
    base: readonly string[],
    ours: readonly string[],
    theirs: readonly string[]
): boolean {
    return (
        new Set(base).size === base.length &&
        deletesOnly(base, ours) &&
        deletesOnly(base, theirs)
    );
}

/**
 * Resolve the pure-insertion (and pure-deletion) hunks of a `git merge-file --diff3
 * --marker-size=APPEND_ONLY_MARKER_SIZE` output.
 */
export function resolveAppendOnly(diff3: string): AppendOnlyResolution {
    const lines = diff3.split("\n");
    const out: string[] = [];
    let unresolved = 0;
    let i = 0;
    while (i < lines.length) {
        if (!isMarker(lines[i]!, OURS)) {
            out.push(lines[i]!);
            i++;
            continue;
        }
        const start = i;
        const ours: string[] = [];
        const base: string[] = [];
        const theirs: string[] = [];
        let section: string[] = ours;
        let sawBase = false;
        let sawSep = false;
        let closed = false;
        for (i = start + 1; i < lines.length; i++) {
            const line = lines[i]!;
            if (!sawBase && !sawSep && isMarker(line, BASE)) {
                sawBase = true;
                section = base;
            } else if (sawBase && !sawSep && line === SEP) {
                sawSep = true;
                section = theirs;
            } else if (sawSep && isMarker(line, THEIRS)) {
                closed = true;
                i++;
                break;
            } else {
                section.push(line);
            }
        }
        if (closed && base.length === 0) {
            out.push(...ours, ...theirs);
        } else if (closed && isPureDeletion(base, ours, theirs)) {
            out.push(
                ...base.filter((l) => ours.includes(l) && theirs.includes(l))
            );
        } else {
            unresolved++;
            out.push(...lines.slice(start, i));
        }
    }
    return { text: out.join("\n"), unresolved };
}
