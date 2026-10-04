import { useCallback, useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { PairListEntry, ReviewVerdict } from "@convex/verdictReview";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import VerdictColdJudgement from "./verdict-cold-judgement";
import VerdictPairFilter from "./verdict-pair-filter";
import VerdictPairRow from "./verdict-pair-row";
import { filterPairEntries, type PairFilter } from "./verdict-review-model";

/**
 * Every classified verdict, filtered by what the Minimal Pair rule makes of it
 * (issue #4801, PRD #4792, ADR 0148, user story 35): complete pairs, incomplete
 * Conditional Verdicts, Absolute Verdicts. The standing is the one Promotion
 * applies, so the list says what the fit would say. Opening an entry judges it
 * cold — beside its pair — through the surface's one cold judgement.
 *
 * An ACTION snapshot, like the position list: the Verdict Store is only
 * reachable from a `"use node"` action.
 */
export default function VerdictPairList() {
    const loadList = useAction(api.verdictReviewActions.pairList);
    const openVerdict = useAction(api.verdictReviewActions.openVerdict);
    const [entries, setEntries] = useState<PairListEntry[] | undefined>(
        undefined
    );
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<PairFilter>("all");
    const [opened, setOpened] = useState<ReviewVerdict | null>(null);

    const fetchList = useCallback(
        () =>
            loadList({})
                .then(
                    (result) => {
                        setEntries(result as PairListEntry[]);
                        setError(null);
                    },
                    (cause: unknown) =>
                        setError(
                            cause instanceof Error
                                ? cause.message
                                : "Could not load"
                        )
                )
                .finally(() => setLoading(false)),
        [loadList]
    );

    useEffect(() => {
        void fetchList();
    }, [fetchList]);

    async function open(verdictId: string) {
        try {
            setOpened(
                (await openVerdict({ verdictId })) as ReviewVerdict | null
            );
            setError(null);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not open");
        }
    }

    const all = entries ?? [];
    const counts: Record<PairFilter, number> = {
        all: all.length,
        "complete-pair": filterPairEntries(all, "complete-pair").length,
        incomplete: filterPairEntries(all, "incomplete").length,
        absolute: filterPairEntries(all, "absolute").length,
    };
    const shown = filterPairEntries(all, filter);

    return (
        <Panel>
            <PanelHeader
                title="Minimal Pairs"
                subtitle="Verdicts by what the pair rule makes of them"
            />
            <PanelBody className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <VerdictPairFilter
                        value={filter}
                        counts={counts}
                        onChange={setFilter}
                    />
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                            if (loading) return;
                            setLoading(true);
                            void fetchList();
                        }}
                        disabled={loading}
                    >
                        {loading ? "Loading…" : "Reload"}
                    </Button>
                </div>
                {error && (
                    <p className="break-words text-sm text-danger-strong">
                        {error}
                    </p>
                )}
                {opened !== null && (
                    <VerdictColdJudgement
                        key={opened.verdictId}
                        verdict={opened}
                    />
                )}
                {entries !== undefined && shown.length === 0 ? (
                    <span className="text-sm text-text-disabled">
                        No verdict matches this filter.
                    </span>
                ) : (
                    <ul className="flex flex-col gap-2">
                        {shown.map((entry) => (
                            <VerdictPairRow
                                key={entry.verdictId}
                                entry={entry}
                                onOpen={() => void open(entry.verdictId)}
                            />
                        ))}
                    </ul>
                )}
            </PanelBody>
        </Panel>
    );
}
