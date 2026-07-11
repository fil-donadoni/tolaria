import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CheckCircle2, Loader2 } from "lucide-react";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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

            const result = await submitBugReport({
                name: nameValue,
                email: emailValue,
                description,
                attachmentId,
                attachmentName,
                route: window.location.pathname,
                userAgent: navigator.userAgent,
            });
            setIssueUrl(result.issueUrl);
        } catch (err) {
            setError(
                err instanceof Error ? err.message : "Something went wrong"
            );
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="w-[min(28rem,90vw)]">
                <DialogHeader>
                    <DialogTitle>Report a bug</DialogTitle>
                    <DialogDescription>
                        Describe the problem. It is filed directly as a GitHub
                        issue for the maintainers.
                    </DialogDescription>
                </DialogHeader>

                {issueUrl ? (
                    <div className="flex flex-col items-center gap-3 py-4 text-center">
                        <CheckCircle2 className="size-8 text-primary" />
                        <p className="text-sm">
                            Thanks — your report was filed.
                        </p>
                        <a
                            href={issueUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm text-primary underline underline-offset-4"
                        >
                            View issue on GitHub
                        </a>
                        <DialogClose
                            render={<Button variant="outline" />}
                            onClick={() => handleOpenChange(false)}
                        >
                            Done
                        </DialogClose>
                    </div>
                ) : (
                    <form
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
                            <p className="text-sm text-destructive">{error}</p>
                        )}

                        <DialogFooter>
                            <DialogClose
                                render={
                                    <Button variant="outline" type="button" />
                                }
                                disabled={submitting}
                            >
                                Cancel
                            </DialogClose>
                            <Button type="submit" disabled={!canSubmit}>
                                {submitting && (
                                    <Loader2 className="animate-spin" />
                                )}
                                {submitting ? "Filing…" : "Submit"}
                            </Button>
                        </DialogFooter>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}
