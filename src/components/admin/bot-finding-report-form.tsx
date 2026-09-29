import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { adminErrorText } from "@/lib/botFindings";

/**
 * Report a Bot defect a human noticed (issue #4182, ADR 0141 § 7). Keyed by
 * its own source, so the measured row on the same card is untouched. With a
 * Reproducer label it is an ordinary row; without one it waits in triage —
 * visible, uncounted, no copy button.
 */
export default function BotFindingReportForm() {
    const report = useMutation(api.botFindings.reportFinding);
    const [name, setName] = useState("");
    const [oracleId, setOracleId] = useState("");
    const [note, setNote] = useState("");
    const [reproducers, setReproducers] = useState("");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const field =
        "rounded-sm border border-border-subtle bg-surface px-2 py-1 text-xs text-text";

    return (
        <form
            data-bot-finding-report=""
            className="flex flex-col gap-2"
            onSubmit={(e) => {
                e.preventDefault();
                setPending(true);
                setError(null);
                report({
                    name,
                    oracleId,
                    note,
                    reproducers: reproducers.split("\n"),
                })
                    .then(() => {
                        setName("");
                        setOracleId("");
                        setNote("");
                        setReproducers("");
                    })
                    .catch((err: unknown) => setError(adminErrorText(err)))
                    .finally(() => setPending(false));
            }}
        >
            <div className="flex flex-wrap gap-2">
                <input
                    aria-label="Card name"
                    placeholder="Card name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={field}
                />
                <input
                    aria-label="Oracle id"
                    placeholder="Scryfall oracle id"
                    value={oracleId}
                    onChange={(e) => setOracleId(e.target.value)}
                    className={`min-w-72 ${field}`}
                />
            </div>
            <Textarea
                aria-label="What the Bot gets wrong"
                placeholder="What the Bot gets wrong"
                value={note}
                onChange={(e) => setNote(e.target.value)}
            />
            <Textarea
                aria-label="Reproducer labels for the report"
                placeholder="Blade entry or saved scenario label, one per line — without one the report waits in triage"
                value={reproducers}
                onChange={(e) => setReproducers(e.target.value)}
            />
            <div className="flex items-center gap-2">
                <Button
                    type="submit"
                    size="sm"
                    disabled={
                        pending || name.trim() === "" || oracleId.trim() === ""
                    }
                >
                    Report finding
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
