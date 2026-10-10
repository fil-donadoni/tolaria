// Steps 4–5 until their deck grids land (PRD #5334, issue #5340 → the next
// slice): the step is reachable in the rail, it just has nothing to pick yet.
export default function PendingStep() {
    return (
        <p className="text-sm text-text-muted">
            Deck choice arrives in the next update. Until then, start a match
            from the lobby.
        </p>
    );
}
