// One row of a setup flow's recap rail (PRD #5334 stories 16–18, PRD #5383):
// shared by the Constructed and Limited setup flows, so the rail components
// know nothing about either flow's step keys.
export interface RecapStep<Key extends string = string> {
    key: Key;
    title: string;
    /** The answer as the rail shows it; `null` while unanswered. */
    answer: string | null;
}

/** The step after `current` in walk order; `null` on the last step (or an
 *  unknown key) — the last step has nothing to advance to. */
export function stepAfter<Key extends string>(
    keys: readonly Key[],
    current: Key
): Key | null {
    const i = keys.indexOf(current);
    return i === -1 ? null : (keys[i + 1] ?? null);
}
