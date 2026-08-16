import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import GameDialog from "@/components/ui/game-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getStoredSession } from "~/lib/session";
import { collectAiDiagnostics } from "~/lib/ai/diagnostics";
import { describeSubmitError } from "./describe-submit-error";

type BugReportDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

// Upload cap for the optional attachment (5 MB) — keeps a stray large file from
// stalling the report. GitHub only ever receives a link to the Convex blob.
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * In-app bug-report form. Collects reporter name/email (prefilled from the
 * signed-in account, editable), a required description and an optional single
 * file, then files a GitHub issue via the `bugReports` Convex functions. The
 * attachment is uploaded to Convex storage first; only its storageId is passed
 * to the issue-creating action.
 */
export default function BugReportDialog({
    open,
    onOpenChange,
}: BugReportDialogProps) {
    const currentUser = useQuery(api.users.currentUser);
    const generateUploadUrl = useMutation(api.bugReports.generateUploadUrl);
    const submitBugReport = useAction(api.bugReports.submitBugReport);

    // Prefill once from the account; `undefined` lets the fields fall back to
    // account values on each render until the user types (tracked via `dirty`).
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [nameDirty, setNameDirty] = useState(false);
    const [emailDirty, setEmailDirty] = useState(false);
    const [description, setDescription] = useState("");
    const [file, setFile] = useState<File | null>(null);

    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [issueUrl, setIssueUrl] = useState<string | null>(null);

    const nameValue = nameDirty ? name : (currentUser?.nickname ?? "");
    const emailValue = emailDirty ? email : (currentUser?.email ?? "");
    const canSubmit = description.trim().length > 0 && !submitting;

    function resetForm() {
        setDescription("");
        setFile(null);
        setError(null);
        setIssueUrl(null);
        setNameDirty(false);
        setEmailDirty(false);
        setName("");
        setEmail("");
    }

    function handleOpenChange(next: boolean) {
        // Reset on close so a reopened dialog starts fresh (and drops a stale
        // success/error state).
        if (!next) resetForm();
        onOpenChange(next);
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!canSubmit) return;
        setSubmitting(true);
        setError(null);
        try {
            let attachmentId: Id<"_storage"> | undefined;
            let attachmentName: string | undefined;
            if (file) {
                if (file.size > MAX_FILE_BYTES) {
                    throw new Error("File too large (max 5 MB)");
                }
                const uploadUrl = await generateUploadUrl();
                const res = await fetch(uploadUrl, {
                    method: "POST",
                    headers: { "Content-Type": file.type },
                    body: file,
                });
                if (!res.ok) throw new Error("File upload failed");
                const { storageId } = (await res.json()) as {
                    storageId: Id<"_storage">;
                };
                attachmentId = storageId;
                attachmentName = file.name;
            }

            // Most in-app reports are about something happening on the board
            // right now, and the description alone is rarely actionable (#1728
            // was one sentence with no card, phase or game id). Send the id of
            // the game the reporter is sitting in — the server reads the state
            // itself, and only for a participant of that game. Read at submit
            // time, not at mount: this dialog is mounted at the router root for
            // the whole session, so a value captured on mount would go stale
            // the moment the user starts a different game.
            const { gameId } = getStoredSession();

            const result = await submitBugReport({
                name: nameValue,
                email: emailValue,
                description,
                attachmentId,
                attachmentName,
                route: window.location.pathname,
                userAgent: navigator.userAgent,
                gameId: gameId ?? undefined,
                // The AI rings (issue #2470). Read at submit time like the game
                // id above, and for a stronger reason: the play bot runs in
                // THIS tab (ADR 0074), so nothing server-side can reconstruct
                // why one of its decisions failed. Omitted entirely when both
                // rings are empty, so a report from the lobby or from a
                // human-vs-human game carries no empty scaffolding.
                clientDiagnostics: collectAiDiagnostics(),
            });
            setIssueUrl(result.issueUrl);
        } catch (err) {
            setError(describeSubmitError(err));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <GameDialog
            open={open}
            onOpenChange={handleOpenChange}
            title="Report a bug"
            subtitle="Describe the problem. It is filed directly as a GitHub issue for the maintainers."
            showCloseButton
            footer={
                issueUrl ? (
                    <Button
                        variant="secondary"
                        onClick={() => handleOpenChange(false)}
                    >
                        Done
                    </Button>
                ) : (
                    <>
                        <Button
                            variant="secondary"
                            type="button"
                            onClick={() => handleOpenChange(false)}
                            disabled={submitting}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            form="bug-report-form"
                            disabled={!canSubmit}
                        >
                            {submitting && <Loader2 className="animate-spin" />}
                            {submitting ? "Filing…" : "Submit"}
                        </Button>
                    </>
                )
            }
        >
            {issueUrl ? (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                    <CheckCircle2 className="size-8 text-primary" />
                    <p className="text-sm">Thanks — your report was filed.</p>
                    <a
                        href={issueUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-primary underline underline-offset-4"
                    >
                        View issue on GitHub
                    </a>
                </div>
            ) : (
                <form
                    id="bug-report-form"
                    onSubmit={handleSubmit}
                    className="flex flex-col gap-3"
                >
                    <label className="flex flex-col gap-1 text-sm font-medium">
                        Name
                        <Input
                            value={nameValue}
                            onChange={(e) => {
                                setNameDirty(true);
                                setName(e.target.value);
                            }}
                            placeholder="Your name"
                            disabled={submitting}
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium">
                        Email
                        <Input
                            type="email"
                            value={emailValue}
                            onChange={(e) => {
                                setEmailDirty(true);
                                setEmail(e.target.value);
                            }}
                            placeholder="you@example.com"
                            disabled={submitting}
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium">
                        Description
                        <Textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="What happened? What did you expect?"
                            rows={5}
                            required
                            disabled={submitting}
                        />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium">
                        Attachment (optional)
                        <Input
                            type="file"
                            onChange={(e) =>
                                setFile(e.target.files?.[0] ?? null)
                            }
                            disabled={submitting}
                        />
                    </label>

                    {error && (
                        <Banner tone="danger" role="alert">
                            {error}
                        </Banner>
                    )}
                </form>
            )}
        </GameDialog>
    );
}
