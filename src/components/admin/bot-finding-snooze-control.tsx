import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { adminErrorText, type BotFindingRow } from "@/lib/botFindings";

/**
 * Snooze a finding with a mandatory reason, or bring a snoozed one back
 * (issue #4182, ADR 0141 § 10). A snoozed row leaves every count but stays on
 * the record and reachable by the visibility filter. The button stays off
 * until a reason is typed; the server refuses a blank one regardless.
 */
export default function BotFindingSnoozeControl({
    finding,
}: {
    finding: BotFindingRow;
}) {
    const snooze = useMutation(api.botFindings.snoozeFinding);
    const unsnooze = useMutation(api.botFindings.unsnoozeFinding);
    const [reason, setReason] = useState("");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const run = (action: Promise<unknown>) => {
        setPending(true);
        setError(null);
        action
            .then(() => setReason(""))
            .catch((err: unknown) => setError(adminErrorText(err)))
            .finally(() => setPending(false));
    };

    return (
        <div data-bot-finding-snooze="" className="flex flex-col gap-2">
            {finding.snoozedAt === undefined ? (
                <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        run(snooze({ id: finding._id, reason }));
                    }}
                >
                    <input
                        aria-label="Snooze reason"
                        placeholder="Why is this out of scope?"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className="min-w-56 flex-1 rounded-sm border border-border-subtle bg-surface px-2 py-1 text-xs text-text"
                    />
                    <Button
                        type="submit"
                        size="sm"
                        variant="secondary"
                        disabled={pending || reason.trim() === ""}
                    >
                        Snooze
                    </Button>
                </form>
            ) : (
                <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => run(unsnooze({ id: finding._id }))}
                >
                    Unsnooze
                </Button>
            )}
            {error !== null && (
                <span role="alert" className="text-xs text-danger-strong">
                    {error}
                </span>
            )}
        </div>
    );
}
