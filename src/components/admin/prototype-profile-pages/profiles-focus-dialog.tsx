// PROTOTYPE — throwaway. The Focus view (variant C's body) inside a
// GameDialog: opened from a table row in variant D, walks the CURRENT
// filtered list with Prev / Next, ⌘↵ marks reviewed and advances.
import { useEffect } from "react";
import GameDialog from "~/components/ui/game-dialog";
import { Button } from "~/components/ui/button";
import CardProfileOracleText from "~/components/lobby/card-profile-oracle-text";
import { ARCHETYPE_REGISTRY } from "@convex/limited/archetypeRegistry";
import { CAPABILITY_REGISTRY } from "@convex/limited/capabilityRegistry";
import type { ProfilesProtoApi } from "./card-profiles-prototype";
import type { ProtoCard } from "./proto-data";
import { ArtTile, ManaCost, StatusBadge } from "./proto-bits";
import { ChipGroup } from "./profiles-variant-a-workbench";

export default function ProfilesFocusDialog({
    card,
    index,
    total,
    api,
    onClose,
    onPrev,
    onNext,
}: {
    card: ProtoCard | null;
    index: number;
    total: number;
    api: ProfilesProtoApi;
    onClose: () => void;
    onPrev: () => void;
    onNext: () => void;
}) {
    useEffect(() => {
        if (!card) return;
        const onKey = (e: KeyboardEvent) => {
            const t = e.target;
            if (
                t instanceof Element &&
                t.closest("input, textarea, [contenteditable]")
            )
                return;
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                api.markReviewed(card.cardId, true);
                onNext();
            }
            if (e.key === "j") onNext();
            if (e.key === "k") onPrev();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    return (
        <GameDialog
            open={card !== null}
            onOpenChange={(o) => {
                if (!o) onClose();
            }}
            title={card?.name ?? ""}
            subtitle={
                card
                    ? `${card.typeLine} · ${card.rarity} · ${index + 1} of ${total} in the current list`
                    : undefined
            }
            align="start"
            size="wide"
            className="max-w-[1100px]"
            density="comfortable"
            showCloseButton
            footer={
                card && (
                    <div className="flex w-full items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={onPrev}>
                            ← Prev
                        </Button>
                        <Button
                            variant="primary"
                            size="default"
                            onClick={() => {
                                api.markReviewed(card.cardId, true);
                                onNext();
                            }}
                        >
                            Mark reviewed & next
                        </Button>
                        <Button variant="ghost" size="sm" onClick={onNext}>
                            Skip →
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => api.markReviewed(card.cardId, false)}
                        >
                            Unreview
                        </Button>
                        <span className="ml-auto text-[10px] text-text-muted">
                            ⌘↵ confirm · j/k move · Esc close
                        </span>
                    </div>
                )
            }
        >
            {card && (
                <div
                    className="grid gap-6"
                    style={{ gridTemplateColumns: "16rem minmax(0, 1fr)" }}
                >
                    <div className="flex flex-col gap-3">
                        <ArtTile
                            cardId={card.cardId}
                            name={card.name}
                            sizes="256px"
                        />
                        <div className="flex items-center justify-between">
                            <ManaCost symbols={card.costSymbols} />
                            <StatusBadge status={card.status} />
                        </div>
                    </div>
                    <div className="flex min-w-0 flex-col gap-4">
                        <div className="text-sm">
                            <CardProfileOracleText cardId={card.cardId} />
                        </div>
                        {card.rationale && (
                            <blockquote className="border-l-2 border-accent-strong/60 pl-3 text-sm leading-snug text-text">
                                <span className="block text-[10px] tracking-wide text-text-muted uppercase">
                                    Census says
                                </span>
                                {card.rationale}
                            </blockquote>
                        )}
                        <ChipGroup
                            legend="Archetypes"
                            ids={ARCHETYPE_REGISTRY.map((r) => ({
                                id: r.id,
                                d: r.description,
                            }))}
                            value={card.profile?.archetypes ?? []}
                            onToggle={(id) =>
                                api.toggleTag(card.cardId, "archetypes", id)
                            }
                        />
                        <div className="grid grid-cols-2 gap-4">
                            <ChipGroup
                                legend="Provides"
                                tone="provides"
                                ids={CAPABILITY_REGISTRY.map((r) => ({
                                    id: r.id,
                                    d: r.description,
                                }))}
                                value={card.profile?.provides ?? []}
                                onToggle={(id) =>
                                    api.toggleTag(card.cardId, "provides", id)
                                }
                            />
                            <ChipGroup
                                legend="Requires"
                                tone="requires"
                                ids={CAPABILITY_REGISTRY.map((r) => ({
                                    id: r.id,
                                    d: r.description,
                                }))}
                                value={card.profile?.requires ?? []}
                                onToggle={(id) =>
                                    api.toggleTag(card.cardId, "requires", id)
                                }
                                hint="Empty is the norm."
                            />
                        </div>
                    </div>
                </div>
            )}
        </GameDialog>
    );
}
