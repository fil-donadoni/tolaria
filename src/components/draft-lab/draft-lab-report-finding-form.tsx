// "Report finding" on a Draft Lab seat's built deck (issue #8900): files a
// Bot Finding carrying the draft context — seed, scope, seat, scorer version
// — and an optional note, so a bad build becomes a reproducible record on the
// Admin Bot Findings page. The Draft Lab's ONE write (ADR 0074, Amendment I):
// it changes no draft, event, rating or profile, and
// `draft-lab-no-mutation.test.ts` allows exactly this file this one mutation.
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { DraftContext } from "@convex/botFindingsCore";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { adminErrorText } from "@/lib/botFindings";

export default function DraftLabReportFindingForm({
    draftContext,
}: {
    draftContext: DraftContext;
}) {
    const report = useMutation(api.botFindings.reportDraftFinding);
    const [note, setNote] = useState("");
    const [pending, setPending] = useState(false);
    const [reported, setReported] = useState(false);
    const [error, setError] = useState<string | null>(null);

    return (
        <form
            data-draft-lab-report-finding=""
            className="mt-3 flex flex-col gap-2"
            onSubmit={(e) => {
                e.preventDefault();
                setPending(true);
                setError(null);
                report({ draftContext, note })
                    .then(() => {
                        setReported(true);
                        setNote("");
                    })
                    .catch((err: unknown) => setError(adminErrorText(err)))
                    .finally(() => setPending(false));
            }}
        >
            <Textarea
                aria-label="What is wrong with this build"
                placeholder="What is wrong with this build (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={pending || reported}>
                    Report finding
                </Button>
                {reported && (
                    <span role="status" className="text-xs text-text-muted">
                        Reported — listed on the Bot Findings page
                    </span>
                )}
                {error !== null && (
                    <span role="alert" className="text-xs text-danger-strong">
                        {error}
                    </span>
                )}
            </div>
        </form>
    );
}
