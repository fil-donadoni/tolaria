import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "~/components/ui/button";
import type {
    EditableCardProfile,
    ScopeCardProfile,
} from "~/hooks/useCardProfiles";
import CardProfilesSweepLane from "./card-profiles-sweep-lane";
import {
    confirmProfile,
    SWEEP_KIND_LABEL,
    sweepLanes,
    toggleRowTag,
    type SweepRow,
} from "./card-profiles-sweep-model";

interface CardProfilesSweepBoardProps {
    row: SweepRow;
    /** The row's registry / catalogue text — the rubric judged on the board. */
    description: string | undefined;
    /** Every card of the scope (never a filtered view: a certification is
     *  over the whole scope). */
    cards: ScopeCardProfile[];
    onSave: (cardId: string, profile: EditableCardProfile) => Promise<unknown>;
    onClose: () => void;
}

/** The per-row sweep board (PRD #8772, issue #8905; prototype variant B):
 *  one catalogue row across the scope in three lanes — tagged and reviewed,
 *  proposed by the census, not tagged. Each tile's toggle writes the row's
 *  own field; "Confirm all proposed" marks the whole middle lane reviewed in
 *  one action. The lanes are recomputed from the query's rows, so a write
 *  moves its tile once the server echoes it. Every control is disabled while
 *  a write is in flight. */
export default function CardProfilesSweepBoard({
    row,
    description,
    cards,
    onSave,
    onClose,
}: CardProfilesSweepBoardProps) {
    const lanes = useMemo(() => sweepLanes(cards, row), [cards, row]);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const rowLabel =
        row.kind === "archetype"
            ? row.id
            : `${SWEEP_KIND_LABEL[row.kind]} ${row.id}`;

    async function write(
        writes: { cardId: string; profile: EditableCardProfile }[]
    ) {
        setPending(true);
        setError(null);
        try {
            await Promise.all(
                writes.map(({ cardId, profile }) => onSave(cardId, profile))
            );
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setPending(false);
        }
    }

    const toggle = (card: ScopeCardProfile) =>
        write([{ cardId: card.cardId, profile: toggleRowTag(card, row) }]);
    const confirm = (card: ScopeCardProfile) =>
        write([
            { cardId: card.cardId, profile: confirmProfile(card, row.kind) },
        ]);
    const confirmAll = () =>
        write(
            lanes.proposed.map((card) => ({
                cardId: card.cardId,
                profile: confirmProfile(card, row.kind),
            }))
        );

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start gap-3">
                <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={onClose}
                >
                    <ArrowLeft className="size-4" aria-hidden="true" />
                    Back to table
                </Button>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <h2 className="text-sm text-parchment">
                        <span className="text-label mr-2">
                            {SWEEP_KIND_LABEL[row.kind]}
                        </span>
                        <span className="font-mono">{row.id}</span>
                    </h2>
                    {description && (
                        <p className="max-w-prose text-xs leading-snug text-text-muted">
                            {description}
                        </p>
                    )}
                </div>
            </div>
            {error && (
                <p role="alert" className="text-xs text-danger-strong">
                    {error}
                </p>
            )}
            <div className="grid gap-3 lg:grid-cols-3">
                <CardProfilesSweepLane
                    lane="reviewed"
                    cards={lanes.reviewed}
                    rowLabel={rowLabel}
                    onToggleTag={toggle}
                    disabled={pending}
                />
                <CardProfilesSweepLane
                    lane="proposed"
                    cards={lanes.proposed}
                    rowLabel={rowLabel}
                    onToggleTag={toggle}
                    onConfirm={confirm}
                    disabled={pending}
                    action={
                        lanes.proposed.length > 0 && (
                            <Button
                                type="button"
                                variant="secondary"
                                size="xs"
                                className="self-start"
                                disabled={pending}
                                onClick={confirmAll}
                            >
                                Confirm all proposed ({lanes.proposed.length})
                            </Button>
                        )
                    }
                />
                <CardProfilesSweepLane
                    lane="untagged"
                    cards={lanes.untagged}
                    rowLabel={rowLabel}
                    onToggleTag={toggle}
                    disabled={pending}
                />
            </div>
        </div>
    );
}
