import { useCallback, useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { VerdictReview } from "@convex/verdictReview";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import VerdictPositionDetail from "./verdict-position-detail";
import VerdictPositionRow from "./verdict-position-row";

/**
 * `/admin/verdicts` — every Contested Position, and the resolved ones beside
 * them (issue #3582, PRD #3574, ADR 0128 §6).
 *
 * An ACTION, not a reactive query: the positions are read from the Verdict
 * Store, which only a `"use node"` action can reach. So the list is a snapshot
 * taken on open and on Reload, and resolving reloads it.
 *
 * Renders nothing new for a regular player — the `/admin` section is behind
 * `AdminRouteGate`, and every function behind this panel asserts admin
 * server-side regardless.
 */
export default function VerdictReviewPanel() {
    const loadReview = useAction(api.verdictReviewActions.review);
    const [review, setReview] = useState<VerdictReview | undefined>(undefined);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [openKey, setOpenKey] = useState<string | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setReview((await loadReview({})) as VerdictReview);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not load");
        } finally {
            setLoading(false);
        }
    }, [loadReview]);

    useEffect(() => {
        void reload();
    }, [reload]);

    const positions = review?.positions ?? [];
    const open = positions.find((p) => p.positionKey === openKey) ?? null;
    const contested = positions.filter((p) => p.status === "contested").length;

    return (
        <Panel>
            <PanelHeader
                title="Positions"
                subtitle={
                    review === undefined
                        ? "Loading…"
                        : `${contested} contested · ${positions.length - contested} resolved · ${review.promotable} promotable`
                }
            />
            <PanelBody className="flex flex-col gap-3">
                {error && (
                    <p className="break-words text-sm text-danger-strong">
                        {error}
                    </p>
                )}
                {open !== null ? (
                    <VerdictPositionDetail
                        key={open.positionKey}
                        position={open}
                        onBack={() => setOpenKey(null)}
                        onResolved={() => void reload()}
                    />
                ) : (
                    <>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs text-text-muted">
                                {review === undefined
                                    ? "Reading the verdicts…"
                                    : review.storeRead
                                      ? "Read from the Verdict Store and this deployment's outbox."
                                      : "This deployment holds no store key: only its own outbox was read."}
                            </p>
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => void reload()}
                                disabled={loading}
                            >
                                {loading ? "Loading…" : "Reload"}
                            </Button>
                        </div>
                        {review !== undefined &&
                            review.unreadable.length > 0 && (
                                <p className="text-xs text-danger-strong">
                                    {review.unreadable.length} outbox row(s)
                                    could not be read as a judgement.
                                </p>
                            )}
                        {review !== undefined && positions.length === 0 ? (
                            <span className="text-sm text-text-disabled">
                                No judgements disagree.
                            </span>
                        ) : (
                            <ul className="flex flex-col gap-2">
                                {positions.map((position) => (
                                    <VerdictPositionRow
                                        key={position.positionKey}
                                        position={position}
                                        onOpen={() =>
                                            setOpenKey(position.positionKey)
                                        }
                                    />
                                ))}
                            </ul>
                        )}
                    </>
                )}
            </PanelBody>
        </Panel>
    );
}
