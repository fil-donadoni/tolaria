import { Checkbox } from "@/components/ui/checkbox";
import JsonTreeView from "@/components/ui/json-tree-view";
import type { BugReportDiagnostics } from "@convex/bugReportConsent";
import { describeDiagnosticPayload } from "./diagnostic-payload";

type BugReportConsentProps = {
    /** The payload about to be submitted — previewed here VERBATIM, never a
     *  hand-written description of it. */
    payload: BugReportDiagnostics;
    /** Whether the diagnostic payload may travel. Pre-accepted when the account
     *  already consented to THIS disclosure version, unchecked otherwise. */
    accepted: boolean;
    onAcceptedChange: (accepted: boolean) => void;
    disabled?: boolean;
};

/**
 * The bug-report disclosure gate (issue #3255).
 *
 * Shown on every report, not only the first: the acknowledgement arrives
 * pre-accepted once an account has consented to the current version, but what
 * is being sent is never invisible. Three things it must keep saying, because
 * none of them is guessable from the button that opened the dialog:
 *
 * 1. the report is read by a maintainer AND filed as a **public** GitHub issue,
 *    with a documented line between what goes to each;
 * 2. a report filed mid-game carries the authoritative board, which in a
 *    two-player game includes what the opponent is holding — information the
 *    reporter does not hold themselves;
 * 3. Sentry, a third-party monitoring service, receives console output and
 *    uncaught errors CONTINUOUSLY, report or no report. Disclosing that is not
 *    the same as consenting to it, and declining below does not stop it —
 *    saying otherwise would be the lie this gate exists to remove.
 *
 * The payload preview renders the very value the submission sends
 * (`collectDiagnosticPayload`), through the JSON viewer the admin report detail
 * and the Debug panel already use — a second renderer would be a second thing
 * to keep true.
 */
export default function BugReportConsent({
    payload,
    accepted,
    onAcceptedChange,
    disabled,
}: BugReportConsentProps) {
    return (
        <section className="flex flex-col gap-2 rounded-md border border-border-subtle bg-surface-elevated/30 p-3">
            <h3 className="text-sm font-medium text-text">
                What this report sends
            </h3>
            <p className="text-sm text-text-muted">
                {describeDiagnosticPayload(payload, accepted)}
            </p>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-text-muted">
                <li>
                    Your report is stored in Tolaria&rsquo;s database, where a
                    maintainer reads it, and is also filed as an issue on the
                    project&rsquo;s public GitHub repository. The public issue
                    carries your description, your name, the page and the
                    browser &mdash; never your email, your attachment or the
                    board.
                </li>
                <li>
                    Filed during a two-player game, the report carries the full
                    authoritative board, including the cards your opponent is
                    holding &mdash; information you do not have yourself.
                </li>
                <li>
                    Separately from this report, Tolaria sends console output
                    and uncaught errors to Sentry, a third-party monitoring
                    service, on every session. That happens whether or not you
                    file a report, and declining below does not stop it.
                </li>
            </ul>
            <details className="text-xs text-text-muted">
                <summary className="cursor-pointer select-none">
                    Show the exact payload
                </summary>
                <div className="mt-1 max-h-48 overflow-auto rounded-sm bg-surface p-2">
                    <JsonTreeView data={payload} />
                </div>
            </details>
            <label className="flex items-start gap-2.5 text-sm font-medium text-text">
                <Checkbox
                    checked={accepted}
                    onCheckedChange={(checked) => onAcceptedChange(!!checked)}
                    disabled={disabled}
                    className="mt-0.5"
                />
                <span>Send this diagnostic payload with my report</span>
            </label>
            <p className="text-xs text-text-muted">
                Decline and the report is still filed &mdash; your description
                and contact details only.
            </p>
        </section>
    );
}
