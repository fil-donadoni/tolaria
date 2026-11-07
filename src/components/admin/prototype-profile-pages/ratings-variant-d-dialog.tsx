// PROTOTYPE — throwaway. Ratings variant D: variant A's workbench with a
// collapsible rail and the focus in a dialog (see profiles-variant-d).
import { useMemo, useState } from "react";
import {
    ArrowDown,
    ArrowUp,
    ArrowUpDown,
    Info,
    PanelLeftClose,
    PanelLeftOpen,
} from "lucide-react";
import { Panel, PanelBody, PanelHeader } from "~/components/ui/panel";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "~/components/ui/tooltip";
import type { Color } from "@convex/cards/types";
import type { RatingsProtoApi } from "./pick-ratings-prototype";
import { COLOR_SWATCH, WUBRG, type ProtoRatingCard } from "./proto-data";
import { ArtTile, ManaCost, RatingDots } from "./proto-bits";
import ProtoScopeTabs from "./proto-scope-tabs";
import RatingsFocusDialog from "./ratings-focus-dialog";

export const VARIANT_NAME = "Workbench + dialog";

const BUCKETS = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5, 0];

export default function RatingsVariantDDialog({
    api,
}: {
    api: RatingsProtoApi;
}) {
    const cards = api.cards;
    const [railOpen, setRailOpen] = useState(true);
    const [search, setSearch] = useState("");
    const [bucket, setBucket] = useState<number | null>(null);
    const [colour, setColour] = useState<Color | null>(null);
    const [openIndex, setOpenIndex] = useState<number | null>(null);
    const [sort, setSort] = useState<{ key: RSortKey; dir: 1 | -1 }>({
        key: "rating",
        dir: -1,
    });
    function toggleSort(key: RSortKey) {
        setSort((s) =>
            s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }
        );
    }

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
                    sort.dir * RSORTERS[sort.key](a, b) ||
                    a.name.localeCompare(b.name)
            );
    }, [cards, search, bucket, colour, sort]);

    const openCard = openIndex === null ? null : (filtered[openIndex] ?? null);
    const rated = cards?.filter((c) => c.rating !== null).length ?? 0;

    return (
        <div
            className="grid min-h-[78vh] gap-4"
            style={{
                gridTemplateColumns: railOpen
                    ? "16rem minmax(0, 1fr)"
                    : "2.75rem minmax(0, 1fr)",
            }}
        >
            {railOpen ? (
                <Panel density="compact" className="self-start">
                    <PanelHeader title="Scope" />
                    <PanelBody className="flex flex-col gap-4">
                        <div className="flex items-start justify-between gap-2">
                            <ProtoScopeTabs
                                scopes={api.scopes}
                                value={api.scope}
                                onChange={api.setScope}
                            />
                            <button
                                type="button"
                                aria-label="Collapse the rail"
                                title="Collapse the rail"
                                onClick={() => setRailOpen(false)}
                                className="shrink-0 rounded-sm p-1 text-text-muted hover:bg-surface-elevated/50 hover:text-text"
                            >
                                <PanelLeftClose className="size-4" />
                            </button>
                        </div>
                        <div className="flex flex-col gap-0.5">
                            <span className="flex items-center gap-1 text-[10px] tracking-wide text-text-muted uppercase">
                                Distribution
                                <Tooltip>
                                    <TooltipTrigger
                                        aria-label="What the distribution shows"
                                        className="text-text-muted hover:text-text"
                                    >
                                        <Info className="size-3" />
                                    </TooltipTrigger>
                                    <TooltipContent
                                        side="right"
                                        className="max-w-64"
                                    >
                                        <p className="text-xs leading-snug">
                                            How many cards of this scope sit at
                                            each half-point rating. Click a bar
                                            to filter the table to that rating;
                                            the bar length is relative to the
                                            fullest bucket.
                                        </p>
                                    </TooltipContent>
                                </Tooltip>
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
            ) : (
                <div className="flex flex-col items-center gap-3 self-start rounded-md border border-border-subtle/30 bg-surface/60 py-2">
                    <button
                        type="button"
                        aria-label="Expand the rail"
                        title="Expand the rail"
                        onClick={() => setRailOpen(true)}
                        className="rounded-sm p-1 text-text-muted hover:bg-surface-elevated/50 hover:text-text"
                    >
                        <PanelLeftOpen className="size-4" />
                    </button>
                    <span
                        className="font-mono text-[10px] text-parchment"
                        style={{ writingMode: "vertical-rl" }}
                    >
                        {api.scopes.find((s) => s.setCode === api.scope)
                            ?.label ?? ""}{" "}
                        · {rated}/{cards?.length ?? 0} rated
                        {bucket !== null ? ` · ${bucket.toFixed(1)}` : ""}
                        {colour ? ` · ${colour}` : ""}
                    </span>
                </div>
            )}

            <Panel density="compact" className="min-w-0">
                <PanelHeader
                    title="Ratings"
                    subtitle={`${filtered.length} of ${cards?.length ?? 0} · click a row to open it`}
                />
                <PanelBody className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <Input
                            placeholder="Search…"
                            aria-label="Search cards"
                            value={search}
                            onChange={(e) => setSearch(e.currentTarget.value)}
                            className="max-w-xs"
                        />
                        <Button
                            variant="secondary"
                            size="xs"
                            className="ml-auto"
                            disabled={filtered.length === 0}
                            onClick={() => setOpenIndex(0)}
                        >
                            Start the pass from the top
                        </Button>
                    </div>
                    <div className="max-h-[70vh] overflow-auto">
                        <table className="w-full border-separate border-spacing-0 text-xs">
                            <thead className="sticky top-0 z-10 bg-surface text-[10px] tracking-wide text-text-muted uppercase">
                                <tr>
                                    {RCOLUMNS.map((col) => (
                                        <th
                                            key={col.key}
                                            className="px-2 py-1.5 text-left font-medium"
                                        >
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    toggleSort(col.key)
                                                }
                                                className={
                                                    "inline-flex items-center gap-1 uppercase hover:text-text " +
                                                    (sort.key === col.key
                                                        ? "text-parchment"
                                                        : "")
                                                }
                                            >
                                                {col.label}
                                                {sort.key === col.key ? (
                                                    sort.dir === 1 ? (
                                                        <ArrowUp className="size-3" />
                                                    ) : (
                                                        <ArrowDown className="size-3" />
                                                    )
                                                ) : (
                                                    <ArrowUpDown className="size-3 opacity-40" />
                                                )}
                                            </button>
                                        </th>
                                    ))}
                                    <th className="px-2 py-1.5"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((c, i) => (
                                    <tr
                                        key={c.cardId}
                                        onClick={() => setOpenIndex(i)}
                                        className={
                                            "cursor-pointer border-b border-border-subtle/20 hover:bg-surface-elevated/40 " +
                                            (openIndex === i
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

            <RatingsFocusDialog
                card={openCard}
                index={openIndex ?? 0}
                total={filtered.length}
                all={cards ?? []}
                api={api}
                onClose={() => setOpenIndex(null)}
                onPrev={() =>
                    setOpenIndex((i) =>
                        i === null ? null : Math.max(0, i - 1)
                    )
                }
                onNext={() =>
                    setOpenIndex((i) =>
                        i === null
                            ? null
                            : i + 1 >= filtered.length
                              ? null
                              : i + 1
                    )
                }
            />
        </div>
    );
}

type RSortKey = "name" | "cost" | "rarity" | "rating" | "source";

const RARITY_ORDER: Record<string, number> = {
    common: 0,
    uncommon: 1,
    rare: 2,
    mythic: 3,
};

const RSORTERS: Record<
    RSortKey,
    (a: ProtoRatingCard, b: ProtoRatingCard) => number
> = {
    name: (a, b) => a.name.localeCompare(b.name),
    cost: (a, b) => a.manaValue - b.manaValue,
    rarity: (a, b) =>
        (RARITY_ORDER[a.rarity] ?? -1) - (RARITY_ORDER[b.rarity] ?? -1),
    rating: (a, b) => (a.rating ?? -1) - (b.rating ?? -1),
    source: (a, b) => a.source.localeCompare(b.source),
};

const RCOLUMNS: { key: RSortKey; label: string }[] = [
    { key: "name", label: "Card" },
    { key: "cost", label: "Cost" },
    { key: "rarity", label: "Rarity" },
    { key: "rating", label: "Rating" },
    { key: "source", label: "Source" },
];
