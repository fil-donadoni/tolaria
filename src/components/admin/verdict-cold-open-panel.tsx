import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { ReviewVerdict } from "@convex/verdictReview";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import VerdictColdJudgement from "./verdict-cold-judgement";

/**
 * Open any single verdict by id and judge it cold (issue #3582) — the third of
 * the surface's uses (ADR 0128): a judgement given away from the table, where
 * no turn is waiting on it.
 */
export default function VerdictColdOpenPanel() {
    const openVerdict = useAction(api.verdictReviewActions.openVerdict);
    const [verdictId, setVerdictId] = useState("");
    const [opened, setOpened] = useState<ReviewVerdict | null | undefined>(
        undefined
    );
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function open() {
        if (loading || verdictId.trim() === "") return;
        setLoading(true);
        setError(null);
        try {
            setOpened(
                (await openVerdict({
                    verdictId: verdictId.trim(),
                })) as ReviewVerdict | null
            );
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not open");
        } finally {
            setLoading(false);
        }
    }

    return (
        <Panel>
            <PanelHeader
                title="Judge a verdict cold"
                subtitle="Open one verdict by id and give your own judgement"
            />
            <PanelBody className="flex flex-col gap-3">
                <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void open();
                    }}
                >
                    <label className="flex min-w-0 flex-1 basis-64 flex-col gap-1 text-sm text-text">
                        Verdict id
                        <input
                            type="text"
                            value={verdictId}
                            onChange={(event) =>
                                setVerdictId(event.target.value)
                            }
                            placeholder="v1-…"
                            className="input-field w-full px-2 py-1 font-mono text-sm"
                        />
                    </label>
                    <Button
                        type="submit"
                        variant="secondary"
                        size="sm"
                        disabled={loading || verdictId.trim() === ""}
                    >
                        {loading ? "Opening…" : "Open"}
                    </Button>
                </form>
                {error && (
                    <p className="break-words text-sm text-danger-strong">
                        {error}
                    </p>
                )}
                {opened === null && (
                    <span className="text-sm text-text-disabled">
                        No verdict has that id.
                    </span>
                )}
                {opened && (
                    <VerdictColdJudgement
                        key={opened.verdictId}
                        verdict={opened}
                    />
                )}
            </PanelBody>
        </Panel>
    );
}
