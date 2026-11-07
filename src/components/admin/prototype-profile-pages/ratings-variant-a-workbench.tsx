// PROTOTYPE — throwaway. Ratings variant A "Workbench": rail (scope, rating
// histogram as a filter, colour filter) · dense table with an inline rating
// stepper · inspector showing the card big with its rating NEIGHBOURS (the
// cards rated ±0.5), because a rating is only ever right relative to them.
import { useMemo, useState } from "react";
import { Panel, PanelBody, PanelHeader } from "~/components/ui/panel";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import type { Color } from "@convex/cards/types";
import type { RatingsProtoApi } from "./pick-ratings-prototype";
import { COLOR_SWATCH, WUBRG, type ProtoRatingCard } from "./proto-data";
import { ArtTile, ColourPips, ManaCost, RatingDots } from "./proto-bits";
import ProtoScopeTabs from "./proto-scope-tabs";

export const VARIANT_NAME = "Workbench";

const BUCKETS = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5, 0];

export default function RatingsVariantAWorkbench({
    api,
}: {
    api: RatingsProtoApi;
}) {
    const cards = api.cards;
    const [search, setSearch] = useState("");
    const [bucket, setBucket] = useState<number | null>(null);
    const [colour, setColour] = useState<Color | null>(null);
    const [selected, setSelected] = useState<string | null>(null);

    const histogram = useMemo(() => {
        const h = new Map<number, number>();
        for (const c of cards ?? []) {
            if (c.rating === null) continue;
            const b = Math.round(c.rating * 2) / 2;
            h.set(b, (h.get(b) ?? 0) + 1);
        }
        return h;
    }, [cards]);
    const maxBucket = Math.max(1, ...histogram.values());

    const filtered = useMemo(() => {
        const q = search.toLowerCase();
        return (cards ?? [])
            .filter((c) => (q ? c.name.toLowerCase().includes(q) : true))
            .filter((c) =>
                bucket === null
                    ? true
                    : c.rating !== null &&
                      Math.round(c.rating * 2) / 2 === bucket
            )
            .filter((c) => (colour ? c.colors.includes(colour) : true))
            .sort(
                (a, b) =>
                    (b.rating ?? -1) - (a.rating ?? -1) ||
                    a.name.localeCompare(b.name)
            );
    }, [cards, search, bucket, colour]);

    const sel = cards?.find((c) => c.cardId === selected) ?? null;

    return (
        <div className="grid min-h-[78vh] grid-cols-[16rem_minmax(0,1fr)_24rem] gap-4">
            <Panel density="compact" className="self-start">
                <PanelHeader title="Scope" />
                <PanelBody className="flex flex-col gap-4">
                    <ProtoScopeTabs
                        scopes={api.scopes}
                        value={api.scope}
                        onChange={api.setScope}
                    />
                    <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] tracking-wide text-text-muted uppercase">
                            Distribution · click to filter
                        </span>
                        {BUCKETS.map((b) => (
                            <button
                                key={b}
                                type="button"
                                onClick={() =>
                                    setBucket(bucket === b ? null : b)
                                }
                                className={
                                    "flex items-center gap-2 rounded-sm px-1 py-0.5 text-[11px] " +
                                    (bucket === b
                                        ? "bg-accent/20"
                                        : "hover:bg-surface-elevated/40")
                                }
                            >
                                <span className="w-6 font-mono text-parchment">
                                    {b.toFixed(1)}
                                </span>
                                <span className="h-2 flex-1 rounded-full bg-surface-elevated/60">
                                    <span
                                        className="block h-full rounded-full bg-accent-strong/70"
                                        style={{
                                            width: `${((histogram.get(b) ?? 0) / maxBucket) * 100}%`,
                                        }}
                                    />
                                </span>
                                <span className="w-6 text-right font-mono text-text-muted">
                                    {histogram.get(b) ?? 0}
                                </span>
                            </button>
                        ))}
                    </div>
                    <div className="flex gap-1">
                        {WUBRG.map((c) => (
                            <button
                                key={c}
                                type="button"
                                aria-pressed={colour === c}
                                onClick={() =>
                                    setColour(colour === c ? null : c)
                                }
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
                    <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => alert("stub: export seed JSON")}
                    >
                        Export scope as seed JSON
                    </Button>
                </PanelBody>
            </Panel>

            <Panel density="compact" className="min-w-0">
                <PanelHeader
                    title="Ratings"
                    subtitle={`${filtered.length} of ${cards?.length ?? 0}`}
                />
                <PanelBody className="flex flex-col gap-2">
                    <Input
                        placeholder="Search…"
                        aria-label="Search cards"
                        value={search}
                        onChange={(e) => setSearch(e.currentTarget.value)}
                        className="max-w-xs"
                    />
                    <div className="max-h-[66vh] overflow-auto">
                        <table className="w-full border-separate border-spacing-0 text-xs">
                            <thead className="sticky top-0 z-10 bg-surface text-[10px] tracking-wide text-text-muted uppercase">
                                <tr>
                                    <th className="px-2 py-1.5 text-left font-medium">
                                        Card
                                    </th>
                                    <th className="px-2 py-1.5 text-left font-medium">
                                        Cost
                                    </th>
                                    <th className="px-2 py-1.5 text-left font-medium">
                                        Rarity
                                    </th>
                                    <th className="px-2 py-1.5 text-left font-medium">
                                        Rating
                                    </th>
                                    <th className="px-2 py-1.5 text-left font-medium">
                                        Source
                                    </th>
                                    <th className="px-2 py-1.5"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((c) => (
                                    <tr
                                        key={c.cardId}
                                        onClick={() => setSelected(c.cardId)}
                                        className={
                                            "cursor-pointer border-b border-border-subtle/20 hover:bg-surface-elevated/40 " +
                                            (selected === c.cardId
                                                ? "bg-accent/15"
                                                : "")
                                        }
                                    >
                                        <td className="px-2 py-1">
                                            <div className="flex items-center gap-2">
                                                <ArtTile
                                                    cardId={c.cardId}
                                                    name={c.name}
                                                    width="w-7"
                                                    sizes="28px"
                                                />
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm text-text">
                                                        {c.name}
                                                    </div>
                                                    <ColourPips
                                                        colors={c.colors}
                                                    />
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-2 py-1">
                                            <ManaCost symbols={c.costSymbols} />
                                        </td>
                                        <td className="px-2 py-1 text-[10px] text-text-muted uppercase">
                                            {c.rarity}
                                        </td>
                                        <td className="px-2 py-1">
                                            <RatingDots rating={c.rating} />
                                        </td>
                                        <td className="px-2 py-1 text-[10px] text-text-muted">
                                            {c.source}
                                        </td>
                                        <td className="px-2 py-1">
                                            <span
                                                className="inline-flex gap-0.5"
                                                onClick={(e) =>
                                                    e.stopPropagation()
                                                }
                                            >
                                                <Button
                                                    variant="ghost"
                                                    size="xs"
                                                    onClick={() =>
                                                        api.setRating(
                                                            c.cardId,
                                                            Math.max(
                                                                0,
                                                                (c.rating ??
                                                                    0) - 0.5
                                                            )
                                                        )
                                                    }
                                                >
                                                    −
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="xs"
                                                    onClick={() =>
                                                        api.setRating(
                                                            c.cardId,
                                                            Math.min(
                                                                5,
                                                                (c.rating ??
                                                                    0) + 0.5
                                                            )
                                                        )
                                                    }
                                                >
                                                    +
                                                </Button>
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </PanelBody>
            </Panel>

            <Panel density="compact" className="self-start">
                {sel ? (
                    <Inspector card={sel} all={cards ?? []} api={api} />
                ) : (
                    <>
                        <PanelHeader
                            title="Inspector"
                            subtitle="Select a card"
                        />
                        <PanelBody>
                            <p className="text-xs text-text-muted">
                                Shows the card with its rating neighbours.
                            </p>
                        </PanelBody>
                    </>
                )}
            </Panel>
        </div>
    );
}

function Inspector({
    card,
    all,
    api,
}: {
    card: ProtoRatingCard;
    all: ProtoRatingCard[];
    api: RatingsProtoApi;
}) {
    const r = card.rating ?? 0;
    const neighbours = (delta: number) =>
        all
            .filter(
                (c) =>
                    c.cardId !== card.cardId &&
                    c.rating !== null &&
                    Math.abs(c.rating - (r + delta)) < 0.01
            )
            .slice(0, 6);
    return (
        <>
            <PanelHeader
                title={card.name}
                subtitle={`${card.source} · ${card.rarity}`}
            />
            <PanelBody className="flex flex-col gap-3">
                <div className="flex gap-3">
                    <ArtTile
                        cardId={card.cardId}
                        name={card.name}
                        width="w-36"
                        sizes="144px"
                    />
                    <div className="flex flex-1 flex-col gap-3">
                        <ManaCost symbols={card.costSymbols} />
                        <div className="flex items-center gap-2">
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() =>
                                    api.setRating(
                                        card.cardId,
                                        Math.max(0, r - 0.5)
                                    )
                                }
                            >
                                −0.5
                            </Button>
                            <span className="font-mono text-2xl text-parchment">
                                {card.rating?.toFixed(1) ?? "—"}
                            </span>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() =>
                                    api.setRating(
                                        card.cardId,
                                        Math.min(5, r + 0.5)
                                    )
                                }
                            >
                                +0.5
                            </Button>
                        </div>
                        <input
                            type="range"
                            min={0}
                            max={5}
                            step={0.5}
                            value={r}
                            onChange={(e) =>
                                api.setRating(
                                    card.cardId,
                                    Number(e.currentTarget.value)
                                )
                            }
                        />
                        {card.source === "override" && (
                            <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => api.setRating(card.cardId, null)}
                            >
                                Clear override
                            </Button>
                        )}
                    </div>
                </div>
                {[0.5, 0, -0.5].map((d) => (
                    <div key={d}>
                        <span className="text-[10px] tracking-wide text-text-muted uppercase">
                            {d > 0
                                ? "Just above"
                                : d === 0
                                  ? "Same rating"
                                  : "Just below"}{" "}
                            · {(r + d).toFixed(1)}
                        </span>
                        <div className="mt-1 flex gap-1">
                            {neighbours(d).map((n) => (
                                <ArtTile
                                    key={n.cardId}
                                    cardId={n.cardId}
                                    name={n.name}
                                    width="w-10"
                                    sizes="40px"
                                />
                            ))}
                            {neighbours(d).length === 0 && (
                                <span className="text-[11px] text-text-disabled">
                                    none
                                </span>
                            )}
                        </div>
                    </div>
                ))}
            </PanelBody>
        </>
    );
}
