/** Board spatial variants (PRD #249).
 *
 * `classic` is the current spatial board; `next` is the DOM-only rewrite
 * (issue #250 walking skeleton, filled in by later slices #251–257). The
 * variant is selected by the `?board=next` search param, defaulting to
 * `classic` so live games are never affected unless the flag is set. */
export type BoardVariant = "classic" | "next";

/** Pure selector: reads the `board` search param and returns the spatial
 *  variant to mount. Anything other than the exact string `"next"` (including
 *  an absent param) falls back to the current board. */
export function resolveBoardVariant(
    search: Record<string, unknown> | undefined | null
): BoardVariant {
    return search?.board === "next" ? "next" : "classic";
}
