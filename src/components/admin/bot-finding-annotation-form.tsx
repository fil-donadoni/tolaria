import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { adminErrorText, type BotFindingRow } from "@/lib/botFindings";

/**
 * The admin's note and linked issue on a finding (issue #4182). No workflow
 * state lives here: the linked GitHub issue already carries it (ADR 0141 §
 * 10). Both are human fields, so a re-seed never touches them.
 */
export default function BotFindingAnnotationForm({
    finding,
}: {
    finding: BotFindingRow;
}) {
    const annotate = useMutation(api.botFindings.annotateFinding);
    const [note, setNote] = useState(finding.note ?? "");
    const [issue, setIssue] = useState(
        finding.linkedIssue === undefined ? "" : String(finding.linkedIssue)
    );
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const issueNumber = issue.trim() === "" ? null : Number(issue.trim());
    const issueValid =
        issueNumber === null ||
        (Number.isInteger(issueNumber) && issueNumber > 0);

    return (
        <form
            data-bot-finding-annotation=""
            className="flex flex-col gap-2"
            onSubmit={(e) => {
                e.preventDefault();
                setPending(true);
                setError(null);
                annotate({ id: finding._id, note, linkedIssue: issueNumber })
                    .catch((err: unknown) => setError(adminErrorText(err)))
                    .finally(() => setPending(false));
            }}
        >
            <Textarea
                aria-label="Note"
                placeholder="Note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
            />
            <input
                aria-label="Linked issue number"
                inputMode="numeric"
                placeholder="Linked issue number"
                value={issue}
                onChange={(e) => setIssue(e.target.value)}
                className="w-48 rounded-sm border border-border-subtle bg-surface px-2 py-1 text-xs text-text"
            />
            <div className="flex items-center gap-2">
                <Button
                    type="submit"
                    size="sm"
                    disabled={pending || !issueValid}
                >
                    Save note and issue
                </Button>
                {error !== null && (
                    <span role="alert" className="text-xs text-danger-strong">
                        {error}
                    </span>
                )}
            </div>
        </form>
    );
}
