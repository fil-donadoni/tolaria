// The fault block of a SYSTEM bug report (issue #9000): what the Bot was owed,
// what went wrong, and how the game was recovered — the step log, with the
// forced discard (the owner-ruled CR deviation) called out. The admin page is
// private, so unlike the public issue it shows the raw error message and the
// per-step messages too. Recovery is read through `botFaultRecovery`, the same
// derivation the issue body uses.
import { botFaultRecovery, type BotFault } from "@convex/botFaultReport";

export default function BugReportFault({
    fault,
    fingerprint,
    filingSkipped,
}: {
    fault: BotFault;
    fingerprint?: string;
    filingSkipped?: string;
}) {
    const kind = fault.choiceKind ?? fault.targetType;
    return (
        <div className="flex flex-col gap-2 border-t border-border-subtle pt-3 text-sm">
            <span className="text-label">Bot fault</span>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-text-muted">Window</dt>
                <dd className="text-text">
                    {fault.expectedKind}
                    {kind ? ` / ${kind}` : ""}
                </dd>
                <dt className="text-text-muted">Source card</dt>
                <dd className="text-text">{fault.sourceCardName ?? "—"}</dd>
                <dt className="text-text-muted">Fault class</dt>
                <dd className="text-text">{fault.faultClass}</dd>
                <dt className="text-text-muted">Recovered by</dt>
                <dd className="text-text">
                    {fault.origin} → {botFaultRecovery(fault)}
                </dd>
                {fingerprint && (
                    <>
                        <dt className="text-text-muted">Fingerprint</dt>
                        <dd className="font-mono break-all text-text">
                            {fingerprint}
                        </dd>
                    </>
                )}
                {filingSkipped && (
                    <>
                        <dt className="text-text-muted">Issue skipped</dt>
                        <dd className="text-text">{filingSkipped}</dd>
                    </>
                )}
            </dl>
            {fault.errorMessage && (
                <pre className="overflow-auto rounded-sm border border-border-subtle p-2 font-mono text-xs whitespace-pre-wrap text-text">
                    {fault.errorMessage}
                </pre>
            )}
            {fault.steps.length > 0 && (
                <ol className="flex list-decimal flex-col gap-0.5 pl-5 text-xs text-text-muted">
                    {fault.steps.map((step, i) => (
                        <li key={i}>
                            <code className="text-text">{step.step}</code> —{" "}
                            {step.ok ? "ok" : "failed"}
                            {step.discarded && " (forced discard)"}
                            {step.message && `: ${step.message}`}
                        </li>
                    ))}
                </ol>
            )}
        </div>
    );
}
