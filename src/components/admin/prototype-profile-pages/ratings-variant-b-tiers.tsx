// PROTOTYPE — throwaway. Ratings variant B "Tier board": the whole scope as
// a tier list — one column per half-point, art tiles, click a tile and use
// ▲/▼ (or drag) to move it. Colour chips filter the board. A rating is
// judged by what sits beside it, so the board IS the editor.
import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import type { Color } from "@convex/cards/types";
import type { RatingsProtoApi } from "./pick-ratings-prototype";
import { COLOR_SWATCH, WUBRG } from "./proto-data";
import { ArtTile } from "./proto-bits";
import ProtoScopeTabs from "./proto-scope-tabs";

export const VARIANT_NAME = "Tier board";

const TIERS = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5, 0];

export default function RatingsVariantBTiers({
    api,
}: {
    api: RatingsProtoApi;
}) {
    const cards = api.cards;
    const [colour, setColour] = useState<Color | null>(null);
    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState<string | null>(null);
    const [dragging, setDragging] = useState<string | null>(null);

    const visible = useMemo(
        () =>
            (cards ?? []).filter(
                (c) =>
                    (colour ? c.colors.includes(colour) : true) &&
                    (search
                        ? c.name.toLowerCase().includes(search.toLowerCase())
                        : true)
            ),
        [cards, colour, search]
    );
    const byTier = useMemo(() => {
        const m = new Map<number | null, typeof visible>();
        for (const t of TIERS) m.set(t, []);
        m.set(null, []);
        for (const c of visible) {
            const t = c.rating === null ? null : Math.round(c.rating * 2) / 2;
            (m.get(t) ?? m.get(null))!.push(c);
        }
        return m;
    }, [visible]);

    const sel = cards?.find((c) => c.cardId === selected);

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
                <ProtoScopeTabs
                    scopes={api.scopes}
                    value={api.scope}
                    onChange={api.setScope}
                />
                <div className="flex gap-1">
                    {WUBRG.map((c) => (
                        <button
                            key={c}
                            type="button"
                            aria-pressed={colour === c}
                            onClick={() => setColour(colour === c ? null : c)}
                            className={
                                "size-6 rounded-full border-2 " +
                                (colour === c
                                    ? "border-parchment"
                                    : "border-transparent opacity-70 hover:opacity-100")
                            }
                            style={{ background: COLOR_SWATCH[c] }}
                            title={c}
                        />
                    ))}
                </div>
                <Input
                    placeholder="Search…"
                    aria-label="Search cards"
                    value={search}
                    onChange={(e) => setSearch(e.currentTarget.value)}
                    className="max-w-xs"
                />
                <div className="ml-auto flex items-center gap-2 text-xs text-text-muted">
                    {sel ? (
                        <>
                            <span className="text-parchment">{sel.name}</span>
                            <span className="font-mono">
                                {sel.rating?.toFixed(1) ?? "—"}
                            </span>
                            <Button
                                variant="secondary"
                                size="xs"
                                onClick={() =>
                                    api.setRating(
                                        sel.cardId,
                                        Math.min(5, (sel.rating ?? 0) + 0.5)
                                    )
                                }
                            >
                                ▲
                            </Button>
                            <Button
                                variant="secondary"
                                size="xs"
                                onClick={() =>
                                    api.setRating(
                                        sel.cardId,
                                        Math.max(0, (sel.rating ?? 0) - 0.5)
                                    )
                                }
                            >
                                ▼
                            </Button>
                        </>
                    ) : (
                        <span>
                            Click a tile, then ▲/▼ — or drag it onto a tier.
                        </span>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-[repeat(12,minmax(0,1fr))] gap-1.5">
                {[...TIERS, null].map((t) => {
                    const list = byTier.get(t) ?? [];
                    return (
                        <div
                            key={String(t)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => {
                                if (dragging && t !== null)
                                    api.setRating(dragging, t);
                                setDragging(null);
                            }}
                            className="flex min-h-[70vh] flex-col gap-1 rounded-md border border-border-subtle/30 bg-surface-elevated/20 p-1"
                        >
                            <div className="flex items-baseline justify-between px-1">
                                <span className="font-mono text-sm text-parchment">
                                    {t === null ? "—" : t.toFixed(1)}
                                </span>
                                <span className="font-mono text-[10px] text-text-muted">
                                    {list.length}
                                </span>
                            </div>
                            <div className="flex flex-col gap-1 overflow-auto">
                                {list.map((c) => (
                                    <button
                                        key={c.cardId}
                                        type="button"
                                        draggable
                                        onDragStart={() =>
                                            setDragging(c.cardId)
                                        }
                                        onClick={() => setSelected(c.cardId)}
                                        className={
                                            "shrink-0 " +
                                            (selected === c.cardId
                                                ? "ring-2 ring-accent-strong"
                                                : "")
                                        }
                                        title={c.name}
                                    >
                                        <ArtTile
                                            cardId={c.cardId}
                                            name={c.name}
                                            sizes="90px"
                                        />
                                    </button>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
