// PROTOTYPE — throwaway. Variant C "Focus": one card at a time, big. Art
// left, Oracle + census rationale + chip pickers right, the queue as a strip
// of thumbnails below (click any to jump), progress on top. The catalogue is
// a drawer, not a column — the pass is the page. Keyboard: ⌘↵ reviewed &
// next, ← → previous/next.
import { useEffect, useMemo, useState } from "react";
import { Panel, PanelBody } from "~/components/ui/panel";
import { Button } from "~/components/ui/button";
import CardProfileOracleText from "~/components/lobby/card-profile-oracle-text";
import { ARCHETYPE_REGISTRY } from "@convex/limited/archetypeRegistry";
import { CAPABILITY_REGISTRY } from "@convex/limited/capabilityRegistry";
import type { ProfilesProtoApi } from "./card-profiles-prototype";
import { catalogueRows, splitDescription } from "./proto-data";
import { ArtTile, Chip, ColourBar, ManaCost, StatusBadge } from "./proto-bits";
import ProtoScopeTabs from "./proto-scope-tabs";

export const VARIANT_NAME = "Focus";

export default function ProfilesVariantCFocus({
    api,
}: {
    api: ProfilesProtoApi;
}) {
    const cards = api.cards;
    const [unreviewedOnly, setUnreviewedOnly] = useState(true);
    const [index, setIndex] = useState(0);
    const [drawer, setDrawer] = useState(false);

    const queue = useMemo(
        () =>
            (cards ?? []).filter((c) =>
                unreviewedOnly ? c.status !== "reviewed" : true
            ),
        [cards, unreviewedOnly]
    );
    const card = queue[Math.min(index, Math.max(0, queue.length - 1))];
    const rows = useMemo(() => (cards ? catalogueRows(cards) : []), [cards]);
    const profiled = cards?.filter((c) => c.profile).length ?? 0;
    const reviewed = cards?.filter((c) => c.status === "reviewed").length ?? 0;

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target;
            if (
                t instanceof Element &&
                t.closest("input, textarea, [contenteditable]")
            )
                return;
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && card) {
                e.preventDefault();
                api.markReviewed(card.cardId, true);
                if (!unreviewedOnly)
                    setIndex((i) => Math.min(i + 1, queue.length - 1));
            }
            if (e.key === "j")
                setIndex((i) => Math.min(i + 1, queue.length - 1));
            if (e.key === "k") setIndex((i) => Math.max(i - 1, 0));
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    return (
        <div className="flex flex-col gap-4">
            {/* Top bar */}
            <div className="flex items-center gap-4">
                <ProtoScopeTabs
                    scopes={api.scopes}
                    value={api.scope}
                    onChange={api.setScope}
                />
                <div className="flex flex-1 items-center gap-3">
                    <div className="h-2 flex-1 rounded-full bg-surface-elevated/60">
                        <div
                            className="h-full rounded-full bg-success-strong transition-all"
                            style={{
                                width: `${profiled ? (reviewed / profiled) * 100 : 0}%`,
                            }}
                        />
                    </div>
                    <span className="font-mono text-xs text-parchment">
                        {reviewed}/{profiled}
                    </span>
                </div>
                <label className="flex items-center gap-1 text-xs text-text-muted">
                    <input
                        type="checkbox"
                        checked={unreviewedOnly}
                        onChange={(e) => {
                            setUnreviewedOnly(e.currentTarget.checked);
                            setIndex(0);
                        }}
                    />
                    Queue: unreviewed only
                </label>
                <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setDrawer((d) => !d)}
                >
                    {drawer ? "Hide catalogue" : "Catalogue"}
                </Button>
            </div>

            <div
                className={
                    "grid gap-4 " +
                    (drawer ? "grid-cols-[minmax(0,1fr)_18rem]" : "grid-cols-1")
                }
            >
                {card ? (
                    <Panel density="comfortable">
                        <PanelBody className="grid grid-cols-[18rem_minmax(0,1fr)] gap-6">
                            <div className="flex flex-col gap-3">
                                <ArtTile
                                    cardId={card.cardId}
                                    name={card.name}
                                    sizes="288px"
                                />
                                <div className="flex items-center justify-between">
                                    <ManaCost symbols={card.costSymbols} />
                                    <StatusBadge status={card.status} />
                                </div>
                            </div>
                            <div className="flex min-w-0 flex-col gap-4">
                                <div>
                                    <h2 className="text-2xl text-parchment">
                                        {card.name}
                                    </h2>
                                    <p className="text-xs text-text-muted">
                                        {card.typeLine} · {card.rarity}
                                    </p>
                                </div>
                                <div className="text-sm">
                                    <CardProfileOracleText
                                        cardId={card.cardId}
                                    />
                                </div>
                                {card.rationale && (
                                    <blockquote className="border-l-2 border-accent-strong/60 pl-3 text-sm leading-snug text-text">
                                        <span className="block text-[10px] tracking-wide text-text-muted uppercase">
                                            Census says
                                        </span>
                                        {card.rationale}
                                    </blockquote>
                                )}
                                <Group
                                    legend="Archetypes"
                                    ids={ARCHETYPE_REGISTRY.map((r) => ({
                                        id: r.id,
                                        d: r.description,
                                    }))}
                                    value={card.profile?.archetypes ?? []}
                                    onToggle={(id) =>
                                        api.toggleTag(
                                            card.cardId,
                                            "archetypes",
                                            id
                                        )
                                    }
                                />
                                <div className="grid grid-cols-2 gap-4">
                                    <Group
                                        legend="Provides"
                                        tone="provides"
                                        ids={CAPABILITY_REGISTRY.map((r) => ({
                                            id: r.id,
                                            d: r.description,
                                        }))}
                                        value={card.profile?.provides ?? []}
                                        onToggle={(id) =>
                                            api.toggleTag(
                                                card.cardId,
                                                "provides",
                                                id
                                            )
                                        }
                                    />
                                    <Group
                                        legend="Requires"
                                        tone="requires"
                                        ids={CAPABILITY_REGISTRY.map((r) => ({
                                            id: r.id,
                                            d: r.description,
                                        }))}
                                        value={card.profile?.requires ?? []}
                                        onToggle={(id) =>
                                            api.toggleTag(
                                                card.cardId,
                                                "requires",
                                                id
                                            )
                                        }
                                    />
                                </div>
                                <div className="mt-auto flex items-center gap-2 border-t border-border-subtle/30 pt-4">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                            setIndex((i) => Math.max(0, i - 1))
                                        }
                                    >
                                        ← Prev
                                    </Button>
                                    <Button
                                        variant="primary"
                                        size="default"
                                        onClick={() => {
                                            api.markReviewed(card.cardId, true);
                                            if (!unreviewedOnly)
                                                setIndex((i) =>
                                                    Math.min(
                                                        i + 1,
                                                        queue.length - 1
                                                    )
                                                );
                                        }}
                                    >
                                        Mark reviewed & next
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                            setIndex((i) =>
                                                Math.min(
                                                    queue.length - 1,
                                                    i + 1
                                                )
                                            )
                                        }
                                    >
                                        Skip →
                                    </Button>
                                    <span className="ml-auto text-[10px] text-text-muted">
                                        ⌘↵ confirm · j/k move
                                    </span>
                                </div>
                            </div>
                        </PanelBody>
                    </Panel>
                ) : (
                    <Panel>
                        <PanelBody>
                            <p className="text-sm text-text-muted">
                                Queue empty — every card is reviewed.
                            </p>
                        </PanelBody>
                    </Panel>
                )}

                {drawer && (
                    <Panel density="compact" className="self-start">
                        <PanelBody className="flex flex-col gap-1">
                            <span className="text-[10px] tracking-wide text-text-muted uppercase">
                                Catalogue
                            </span>
                            {rows
                                .filter(
                                    (r) =>
                                        r.kind === "archetype" || r.tagged > 0
                                )
                                .map((r) => (
                                    <div
                                        key={r.kind + r.id}
                                        title={
                                            splitDescription(r.description).when
                                        }
                                        className="flex flex-col gap-0.5 px-1 py-1"
                                    >
                                        <span className="flex justify-between font-mono text-[11px]">
                                            <span className="text-text">
                                                {r.kind === "archetype"
                                                    ? ""
                                                    : r.kind + ":"}
                                                {r.id}
                                            </span>
                                            <span className="text-text-muted">
                                                {r.tagged}
                                            </span>
                                        </span>
                                        <ColourBar
                                            signature={r.signature}
                                            height="h-1"
                                        />
                                    </div>
                                ))}
                        </PanelBody>
                    </Panel>
                )}
            </div>

            {/* Queue strip */}
            <div className="flex gap-1.5 overflow-x-auto py-1">
                {queue.slice(Math.max(0, index - 6), index + 30).map((c, i) => {
                    const real = Math.max(0, index - 6) + i;
                    return (
                        <button
                            key={c.cardId}
                            type="button"
                            onClick={() => setIndex(real)}
                            className={
                                "shrink-0 transition " +
                                (real === index
                                    ? "ring-2 ring-accent-strong"
                                    : "opacity-60 hover:opacity-100")
                            }
                            title={c.name}
                        >
                            <ArtTile
                                cardId={c.cardId}
                                name={c.name}
                                width="w-12"
                                sizes="48px"
                            />
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function Group({
    legend,
    ids,
    value,
    onToggle,
    tone,
}: {
    legend: string;
    ids: { id: string; d: string }[];
    value: string[];
    onToggle: (id: string) => void;
    tone?: "provides" | "requires";
}) {
    return (
        <fieldset className="flex flex-col gap-1.5">
            <legend className="text-[10px] tracking-wide text-text-muted uppercase">
                {legend}
            </legend>
            <div className="flex flex-wrap gap-1.5">
                {ids.map(({ id, d }) => (
                    <Chip
                        key={id}
                        label={id}
                        on={value.includes(id)}
                        tone={tone}
                        title={splitDescription(d).when}
                        onClick={() => onToggle(id)}
                    />
                ))}
            </div>
        </fieldset>
    );
}
