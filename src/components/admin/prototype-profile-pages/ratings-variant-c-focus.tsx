// PROTOTYPE — throwaway. Ratings variant C "Focus": one card, big; rating
// as a row of large half-point buttons; the cards rated one step above and
// below as a calibration shelf; queue strip below. Keyboard: 0–5 digits
// set, +/- nudge, j/k move.
import { useEffect, useMemo, useState } from "react";
import { Panel, PanelBody } from "~/components/ui/panel";
import { Button } from "~/components/ui/button";
import type { RatingsProtoApi } from "./pick-ratings-prototype";
import { ArtTile, ColourPips, ManaCost } from "./proto-bits";
import ProtoScopeTabs from "./proto-scope-tabs";

export const VARIANT_NAME = "Focus";

const STEPS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

export default function RatingsVariantCFocus({
    api,
}: {
    api: RatingsProtoApi;
}) {
    const cards = api.cards;
    const [unratedFirst, setUnratedFirst] = useState(true);
    const [index, setIndex] = useState(0);
    const queue = useMemo(() => {
        const list = [...(cards ?? [])];
        if (unratedFirst)
            list.sort(
                (a, b) =>
                    Number(a.rating !== null) - Number(b.rating !== null) ||
                    a.name.localeCompare(b.name)
            );
        return list;
    }, [cards, unratedFirst]);
    const card = queue[Math.min(index, Math.max(0, queue.length - 1))];
    const r = card?.rating ?? null;

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target;
            if (
                t instanceof Element &&
                t.closest("input, textarea, [contenteditable]")
            )
                return;
            if (!card) return;
            if (/^[0-5]$/.test(e.key))
                api.setRating(card.cardId, Number(e.key));
            if (e.key === "+")
                api.setRating(card.cardId, Math.min(5, (r ?? 0) + 0.5));
            if (e.key === "-")
                api.setRating(card.cardId, Math.max(0, (r ?? 0) - 0.5));
            if (e.key === "j" || e.key === "Enter")
                setIndex((i) => Math.min(i + 1, queue.length - 1));
            if (e.key === "k") setIndex((i) => Math.max(i - 1, 0));
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    const shelf = (delta: number) =>
        r === null
            ? []
            : (cards ?? [])
                  .filter(
                      (c) =>
                          c.cardId !== card.cardId &&
                          c.rating !== null &&
                          Math.abs(c.rating - (r + delta)) < 0.01
                  )
                  .slice(0, 8);
    const rated = cards?.filter((c) => c.rating !== null).length ?? 0;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
                <ProtoScopeTabs
                    scopes={api.scopes}
                    value={api.scope}
                    onChange={api.setScope}
                />
                <span className="ml-auto font-mono text-xs text-parchment">
                    {rated}/{cards?.length ?? 0} rated
                </span>
                <label className="flex items-center gap-1 text-xs text-text-muted">
                    <input
                        type="checkbox"
                        checked={unratedFirst}
                        onChange={(e) => {
                            setUnratedFirst(e.currentTarget.checked);
                            setIndex(0);
                        }}
                    />
                    Unrated first
                </label>
            </div>

            {card && (
                <Panel density="comfortable">
                    <PanelBody className="grid grid-cols-[18rem_minmax(0,1fr)] gap-6">
                        <ArtTile
                            cardId={card.cardId}
                            name={card.name}
                            sizes="288px"
                        />
                        <div className="flex flex-col gap-5">
                            <div>
                                <h2 className="text-2xl text-parchment">
                                    {card.name}
                                </h2>
                                <div className="flex items-center gap-2 text-xs text-text-muted">
                                    <ManaCost symbols={card.costSymbols} />
                                    <ColourPips colors={card.colors} />
                                    <span className="uppercase">
                                        {card.rarity}
                                    </span>
                                    <span>· {card.source}</span>
                                </div>
                            </div>
                            <div className="flex gap-1">
                                {STEPS.map((s) => (
                                    <button
                                        key={s}
                                        type="button"
                                        onClick={() =>
                                            api.setRating(card.cardId, s)
                                        }
                                        className={
                                            "flex h-12 flex-1 items-center justify-center rounded-sm border font-mono text-sm transition " +
                                            (r === s
                                                ? "border-accent-strong bg-accent/40 text-parchment"
                                                : "border-border-subtle/30 text-text-muted hover:bg-surface-elevated/50 hover:text-text")
                                        }
                                    >
                                        {s.toFixed(1)}
                                    </button>
                                ))}
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                {[0.5, -0.5].map((d) => (
                                    <div key={d}>
                                        <span className="text-[10px] tracking-wide text-text-muted uppercase">
                                            {d > 0
                                                ? "Rated half a point higher"
                                                : "Rated half a point lower"}
                                        </span>
                                        <div className="mt-1 flex flex-wrap gap-1">
                                            {shelf(d).map((n) => (
                                                <ArtTile
                                                    key={n.cardId}
                                                    cardId={n.cardId}
                                                    name={n.name}
                                                    width="w-14"
                                                    sizes="56px"
                                                />
                                            ))}
                                            {shelf(d).length === 0 && (
                                                <span className="text-[11px] text-text-disabled">
                                                    none
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
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
                                    onClick={() =>
                                        setIndex((i) =>
                                            Math.min(queue.length - 1, i + 1)
                                        )
                                    }
                                >
                                    Next →
                                </Button>
                                <span className="ml-auto text-[10px] text-text-muted">
                                    0–5 set · +/− nudge · ↵ next
                                </span>
                            </div>
                        </div>
                    </PanelBody>
                </Panel>
            )}

            <div className="flex gap-1.5 overflow-x-auto py-1">
                {queue.slice(Math.max(0, index - 6), index + 30).map((c, i) => {
                    const real = Math.max(0, index - 6) + i;
                    return (
                        <button
                            key={c.cardId}
                            type="button"
                            onClick={() => setIndex(real)}
                            className={
                                "relative shrink-0 " +
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
                            >
                                <span className="absolute right-0 bottom-0 rounded-tl-sm bg-surface/90 px-1 font-mono text-[9px] text-parchment">
                                    {c.rating?.toFixed(1) ?? "—"}
                                </span>
                            </ArtTile>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
