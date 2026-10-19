/**
 * Guard C's baseline only shrinks — the diff half (issue #5942).
 *
 * `compilerRoundTrip.test.ts` holds every baseline row to the frozen original
 * amnesty, which stops a NEW failing card being parked there. It cannot stop a
 * card that already graduated from coming back — after a compiler regression,
 * say — because the amnesty still names it. Only the diff can tell a row that
 * was always there from one a PR adds back. A regressed card owes a
 * `compiler-gap:` marker naming the fragment, never a baseline row.
 *
 * Name-based, not line-based: moving a row between the three direction arrays
 * deletes and re-adds the same name, which is free.
 *
 * Pure; `scripts/check-baseline-shrink.ts` feeds it the two revisions.
 */

/** The baseline file Guard C reads. */
export const ROUND_TRIP_BASELINE_PATH =
    "convex/cards/__tests__/compilerRoundTrip.baseline.ts";

/** Every row name in a baseline source: one JSON-quoted string per line. */
export function baselineNames(src: string): Set<string> {
    const names = new Set<string>();
    for (const m of src.matchAll(/^ {4}("(?:[^"\\]|\\.)*"),?$/gm)) {
        names.add(JSON.parse(m[1]!) as string);
    }
    return names;
}

/** Names `after` holds that `before` did not, sorted. */
export function baselineAdditions(before: string, after: string): string[] {
    const was = baselineNames(before);
    return [...baselineNames(after)].filter((n) => !was.has(n)).sort();
}
