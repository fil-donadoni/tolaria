/**
 * A session's merged-PR count (PRD #3148 S3).
 *
 * The CELL is a count, because a session that opened nine pull requests would
 * otherwise be a cell wider than the rest of the table put together; the
 * `title` carries the list, which is the half a person follows up on. The
 * vanilla markup did the same with a `title="${prs.join(', ')}"` attribute
 * built by string concatenation.
 */
export function SessionsPrCell({ prs }: { prs: readonly string[] }) {
    return <span title={prs.join(", ")}>{prs.length}</span>;
}
