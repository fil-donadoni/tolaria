// The missing-halves queue (issue #4801, PRD #4792, ADR 0148, user stories 10
// and 11): Conditional Verdicts a judge deferred, waiting for whoever knows the
// right-hand position. Any tester may open one and write the half.
//
// An ACTION, not a reactive query: the verdicts live in the Verdict Store, which
// only a `"use node"` action reaches, so the list is a snapshot taken on open
// and after each half is stored. Shown to testers only — the action asserts it
// server-side regardless — and it carries no author: a tester sees no one else's
// name.

import { useCallback, useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { PairQueue } from "@convex/verdictReview";
import { canSubmitVerdicts } from "~/lib/adminGating";
import DebugButton from "./debug-button";
import MissingHalfRow from "./missing-half-row";
import MissingHalfWriter from "./missing-half-writer";
import PairHalvesReview from "./pair-halves-review";

export default function MissingHalvesQueue() {
    const currentUser = useQuery(api.users.currentUser);
    const loadQueue = useAction(api.verdictReviewActions.pairQueue);
    const [queue, setQueue] = useState<PairQueue | undefined>(undefined);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [openId, setOpenId] = useState<string | null>(null);
    const allowed = canSubmitVerdicts(currentUser);

    const fetchQueue = useCallback(
        () =>
            loadQueue({})
                .then(
                    (result) => {
                        setQueue(result as PairQueue);
                        setError(null);
                    },
                    (cause: unknown) =>
                        setError(
                            cause instanceof Error
                                ? cause.message
                                : "Could not load the queue"
                        )
                )
                .finally(() => setLoading(false)),
        [loadQueue]
    );

    useEffect(() => {
        if (allowed) void fetchQueue();
    }, [allowed, fetchQueue]);

    if (!allowed) return null;

    const missing = queue?.missing;
    const open = missing?.find((h) => h.anchorId === openId) ?? null;

    function reload() {
        if (loading) return;
        setLoading(true);
        void fetchQueue();
    }

    return (
        <div
            data-testid="missing-halves-queue"
            className="flex flex-col gap-1.5"
        >
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-label">
                    Missing halves
                    {missing === undefined ? "" : ` (${missing.length})`}
                </span>
                <DebugButton onClick={reload} disabled={loading}>
                    {loading ? "Loading…" : "Reload"}
                </DebugButton>
            </div>
            {error && (
                <p className="break-words text-[10px] text-danger-strong">
                    {error}
                </p>
            )}
            {open !== null ? (
                <MissingHalfWriter
                    key={open.anchorId}
                    half={open}
                    onDone={() => {
                        setOpenId(null);
                        reload();
                    }}
                    onClose={() => setOpenId(null)}
                />
            ) : missing !== undefined && missing.length === 0 ? (
                <span className="text-[11px] text-text-disabled">
                    No right-hand half is owed.
                </span>
            ) : (
                <ul className="flex flex-col gap-1">
                    {(missing ?? []).map((half) => (
                        <MissingHalfRow
                            key={half.anchorId}
                            half={half}
                            onOpen={() => setOpenId(half.anchorId)}
                        />
                    ))}
                </ul>
            )}
            {open === null && <PairHalvesReview halves={queue?.halves ?? []} />}
        </div>
    );
}
