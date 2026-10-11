// One row of a setup flow's recap rail (PRD #5334 stories 16–18, PRD #5383):
// shared by the Constructed and Limited setup flows, so the rail components
// know nothing about either flow's step keys.
export interface RecapStep<Key extends string = string> {
    key: Key;
    title: string;
    /** The answer as the rail shows it; `null` while unanswered. */
    answer: string | null;
}
