// The same header the GitHub issue body already shows (`buildGameStateSection`,
// `convex/bugReports.ts`), rendered as UI instead of markdown. Both format
// `summarizeGameSnapshot` — the ONE derivation off the raw state
// (`convex/bugReportSummary.ts`, issue #2250) — so this component never reads
// `state.turn` / `state.phase` / … by hand.
import {
    summarizeGameSnapshot,
    type GameSnapshot,
} from "@convex/bugReportSummary";

export default function BugReportSnapshotHeader({
    snapshot,
}: {
    snapshot: GameSnapshot;
}) {
    const summary = summarizeGameSnapshot(snapshot);

    return (
        <div className="flex flex-col gap-1 text-sm">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-text-muted">
                <code className="rounded-sm bg-surface-elevated/60 px-1 py-0.5 text-text">
                    {summary.gameId}
                </code>
                <span>· seq {summary.seq}</span>
                <span>· turn {summary.turn}</span>
                <span>· {summary.phase}</span>
                <span>· active: {summary.activePlayerId}</span>
                <span>· priority: {summary.priorityPlayerId}</span>
            </div>
            {summary.owedInput.length > 0 && (
                <p className="text-text-muted">
                    <span className="font-semibold text-text">Owed input:</span>{" "}
                    {summary.owedInput.join(", ")}
                </p>
            )}
        </div>
    );
}
