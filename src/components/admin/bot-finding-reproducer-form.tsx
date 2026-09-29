import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { adminErrorText, type BotFindingRow } from "@/lib/botFindings";

/**
 * A finding's Reproducer labels, one per line — each a blade entry or a saved
 * scenario, checked server-side (issue #4182, ADR 0141 § 7). Saving a first
 * label is how a triage report is admitted to the counted list.
 */
export default function BotFindingReproducerForm({
    finding,
}: {
    finding: BotFindingRow;
}) {
    const setReproducers = useMutation(api.botFindings.setFindingReproducers);
    const [text, setText] = useState((finding.reproducers ?? []).join("\n"));
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    return (
        <form
            data-bot-finding-reproducers=""
            className="flex flex-col gap-2"
            onSubmit={(e) => {
                e.preventDefault();
                setPending(true);
                setError(null);
                setReproducers({
                    id: finding._id,
                    reproducers: text.split("\n"),
                })
                    .catch((err: unknown) => setError(adminErrorText(err)))
                    .finally(() => setPending(false));
            }}
        >
            <Textarea
                aria-label="Reproducer labels"
                placeholder="Blade entry or saved scenario label, one per line"
                value={text}
                onChange={(e) => setText(e.target.value)}
            />
            <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={pending}>
                    Save reproducers
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
