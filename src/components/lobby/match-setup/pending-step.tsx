// The table step until Join a table lands (PRD #5334 story 27): no stored
// setup reaches it today (`OFFERED_OPPONENTS` omits Join), but the step key
// exists, so it renders something rather than nothing.
export default function PendingStep() {
    return (
        <p className="text-sm text-text-muted">
            Joining a table arrives in a later update.
        </p>
    );
}
