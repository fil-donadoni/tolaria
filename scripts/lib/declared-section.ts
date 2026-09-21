/**
 * A DECLARED section of an issue body — `## Unlocks` (issue #4052), `## Cards`
 * (issue #4086), `## Band` (issue #4230): a heading, then one list item per declaration, `None.` for
 * "nothing declared". Structured, no prose: every non-item line comes back as
 * prose for the caller to report, never to read.
 *
 * FENCED CODE IS NOT MARKDOWN HERE. A body that SHOWS the section — the
 * example `docs/agents/issue-tracker.md` teaches, a skill's template, a review
 * comment quoting one — carries the heading and its items inside a fence.
 * Read naively, the scan locks onto the example, reads its sample lines as
 * real declarations, reports the closing fence as residue, and then stops at
 * the GENUINE heading further down as if it were the section's end: the real
 * declarations are silently dropped. So the fence state is tracked for the
 * heading search and the item scan alike.
 */

const ANY_HEADING = /^#{1,6}\s+/;

/** The `## Cards` heading (issue #4086). Shared: `backlog:triage` reads the
 *  section, and the queue lint's `unlinked-card-name` exempts it — its items
 *  are bare lockfile names BY CONTRACT (issue #3666). */
export const CARDS_HEADING = /^#{1,6}\s+cards\s*$/i;
/** The `## Band` heading (ADR 0143, issue #4230): a hand ruling on an issue,
 *  one line, `P2 — <reason>`. `backlog:triage` reads it as `user-decision`. */
export const BAND_HEADING = /^#{1,6}\s+band\s*$/i;
const LIST_ITEM = /^[-*]\s+(.*)$/;
/** "nothing declared", the shape `## Blocked by` already uses. */
const DECLARES_NOTHING = /^none\.?$/i;

/** The indexes of the lines inside (or opening/closing) a code fence. */
export function fencedLines(lines: readonly string[]): Set<number> {
    const fenced = new Set<number>();
    let open: string | null = null;
    lines.forEach((line, i) => {
        const fence = /^\s*(`{3,}|~{3,})/.exec(line);
        if (fence !== null) {
            const marker = fence[1]![0]!;
            if (open === null) open = marker;
            else if (open === marker) open = null;
            fenced.add(i);
            return;
        }
        if (open !== null) fenced.add(i);
    });
    return fenced;
}

/** One declared line: `item` is the list item's text, `null` for prose. */
export interface DeclaredLine {
    readonly raw: string;
    readonly item: string | null;
}

/**
 * The first unfenced section whose heading matches `heading`, as its declared
 * lines — `None.` (bare or as an item) and blank lines dropped. `null` when
 * the body has no such section, which is not the same as one declaring
 * nothing (`[]`).
 */
export function declaredSection(
    body: string,
    heading: RegExp
): DeclaredLine[] | null {
    const all = body.split("\n");
    const fenced = fencedLines(all);
    const start = all.findIndex(
        (l, i) => !fenced.has(i) && heading.test(l.trim())
    );
    if (start === -1) return null;
    const lines: DeclaredLine[] = [];
    for (const [offset, line] of all.slice(start + 1).entries()) {
        const trimmed = line.trim();
        if (fenced.has(start + 1 + offset)) continue;
        if (ANY_HEADING.test(trimmed)) break;
        if (trimmed === "") continue;
        if (DECLARES_NOTHING.test(trimmed)) continue;
        const item = LIST_ITEM.exec(trimmed);
        if (item === null) {
            // Prose. The section's own preamble is the only prose a reader
            // could excuse, and excusing it is what "guess a declaration from
            // a sentence" starts as — so every non-item line is refused.
            lines.push({ raw: trimmed, item: null });
            continue;
        }
        if (DECLARES_NOTHING.test(item[1]!.trim())) continue;
        lines.push({ raw: trimmed, item: item[1]! });
    }
    return lines;
}
