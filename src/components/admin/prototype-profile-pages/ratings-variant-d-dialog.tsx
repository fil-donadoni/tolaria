// PROTOTYPE — throwaway. The Pick Ratings page in Card Profiles D's form:
// collapsible scope rail + sortable table with MultiCombobox filters (OR within
// a filter, AND across), a row opens the dialog. The dialog comes in as a prop:
// it is the question this prototype answers. The dialog walks a list FROZEN at
// open, because a rating change re-sorts the table under a rating sort.
import { useMemo, useState } from "react";
import {
    ArrowDown,
    ArrowUp,
    ArrowUpDown,
    Info,
    PanelLeftClose,
    PanelLeftOpen,
} from "lucide-react";
import MultiCombobox from "~/components/lobby/deck-builder/multi-combobox";
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
import { SourceBadge, type RatingDialogProps } from "./ratings-dialog-shared";
import { RATING_STEPS, SOURCE_LABEL, toStep } from "./ratings-dialog-utils";

type RailFilter =
    | { kind: "bucket"; value: number }
    | { kind: "colour"; value: Color }
    | null;

const uniqueSorted = (xs: string[]) => [...new Set(xs)].sort();

const asOptions = (xs: string[], label?: (x: string) => string) =>
    xs.map((x) => ({ value: x, label: label ? label(x) : x }));

export default function RatingsVariantDDialog({
    api,
    Dialog,
}: {
    api: RatingsProtoApi;
    Dialog: (p: RatingDialogProps) => React.ReactNode;
}) {
    const cards = api.cards;
    const [railOpen, setRailOpen] = useState(true);
    const [search, setSearch] = useState("");
    const [rail, setRail] = useState<RailFilter>(null);
    const [sourceFilter, setSourceFilter] = useState<string[]>([]);
    const [rarityFilter, setRarityFilter] = useState<string[]>([]);
    const [typeFilter, setTypeFilter] = useState<string[]>([]);
    const [archFilter, setArchFilter] = useState<string[]>([]);
    const [walk, setWalk] = useState<string[]>([]);
    const [openId, setOpenId] = useState<string | null>(null);
    // Cards to come back to after opening a neighbour from the ladder.
    const [detour, setDetour] = useState<string[]>([]);
    const [sort, setSort] = useState<{ key: RSortKey; dir: 1 | -1 }>({
        key: "rating",
        dir: -1,
    });
    const toggleIn =
        (set: React.Dispatch<React.SetStateAction<string[]>>) => (v: string) =>
            set((xs) =>
                xs.includes(v) ? xs.filter((x) => x !== v) : [...xs, v]
            );
    function toggleSort(key: RSortKey) {
        setSort((s) =>
            s.key === key
                ? { key, dir: s.dir === 1 ? -1 : 1 }
                : { key, dir: key === "rating" ? -1 : 1 }
        );
    }

    const histogram = useMemo(() => {
        const h = new Map<number, number>();
        for (const c of cards ?? []) {
            if (c.rating === null) continue;
            const b = toStep(c.rating);
            h.set(b, (h.get(b) ?? 0) + 1);
        }
        return h;
    }, [cards]);
    const maxBucket = Math.max(1, ...histogram.values());

    const colourRows = useMemo(
        () =>
            WUBRG.map((colour) => {
                const of = (cards ?? []).filter((c) =>
                    c.colors.includes(colour)
                );
                const avg = of.length
                    ? of.reduce((s, c) => s + (c.rating ?? 0), 0) / of.length
                    : 0;
                return { colour, count: of.length, avg };
            }),
        [cards]
    );

    const facets = useMemo(() => {
        const list = cards ?? [];
        return {
            rarities: uniqueSorted(list.map((c) => c.rarity)),
            types: uniqueSorted(list.flatMap((c) => c.types)),
            archetypes: uniqueSorted(list.flatMap((c) => c.archetypes)),
        };
    }, [cards]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        const list = (cards ?? []).filter((c) => {
            if (q && !c.name.toLowerCase().includes(q)) return false;
            if (
                rail?.kind === "bucket" &&
                (c.rating === null || toStep(c.rating) !== rail.value)
            )
                return false;
            if (rail?.kind === "colour" && !c.colors.includes(rail.value))
                return false;
            if (sourceFilter.length && !sourceFilter.includes(c.source))
                return false;
            if (rarityFilter.length && !rarityFilter.includes(c.rarity))
                return false;
            if (
                typeFilter.length &&
                !typeFilter.some((t) => c.types.includes(t))
            )
                return false;
            if (
                archFilter.length &&
                !archFilter.some((a) => c.archetypes.includes(a))
            )
                return false;
            return true;
        });
        const cmp = RSORTERS[sort.key];
        return [...list].sort(
            (a, b) => sort.dir * cmp(a, b) || a.name.localeCompare(b.name)
        );
    }, [
        cards,
        search,
        rail,
        sourceFilter,
        rarityFilter,
        typeFilter,
        archFilter,
        sort,
    ]);

    const open = (cardId: string) => {
        setWalk(filtered.map((c) => c.cardId));
        setOpenId(cardId);
    };
    const openCard =
        openId === null
            ? null
            : ((cards ?? []).find((c) => c.cardId === openId) ?? null);
    const openIndex = openId === null ? -1 : walk.indexOf(openId);

    const seeded = cards?.filter((c) => c.source !== "fallback").length ?? 0;
    const overrides = cards?.filter((c) => c.source === "override").length ?? 0;
    const railLabel =
        rail?.kind === "bucket"
            ? `Rated ${rail.value.toFixed(1)}`
            : rail?.kind === "colour"
              ? `Colour ${rail.value}`
              : "All cards";

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
                        <div className="flex flex-col gap-1">
                            <div className="flex items-baseline justify-between text-xs">
                                <span className="text-text-muted">
                                    Hand-rated
                                </span>
                                <span className="font-mono text-parchment">
                                    {seeded}/{cards?.length ?? 0}
                                </span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-surface-elevated/60">
                                <div
                                    className="h-full rounded-full bg-success-strong"
                                    style={{
                                        width: `${cards?.length ? (seeded / cards.length) * 100 : 0}%`,
                                    }}
                                />
                            </div>
                            <div className="flex items-baseline justify-between text-[11px] text-text-muted">
                                <span>Overrides over the seed</span>
                                <span className="font-mono">{overrides}</span>
                            </div>
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
                            {[...RATING_STEPS].reverse().map((b) => {
                                const on =
                                    rail?.kind === "bucket" && rail.value === b;
                                return (
                                    <button
                                        key={b}
                                        type="button"
                                        onClick={() =>
                                            setRail(
                                                on
                                                    ? null
                                                    : {
                                                          kind: "bucket",
                                                          value: b,
                                                      }
                                            )
                                        }
                                        className={
                                            "flex items-center gap-2 rounded-sm px-1 py-0.5 text-[11px] " +
                                            (on
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
                                );
                            })}
                        </div>
                        <div className="flex flex-col gap-0.5">
                            <span className="flex items-center gap-1 text-[10px] tracking-wide text-text-muted uppercase">
                                Colours
                                <Tooltip>
                                    <TooltipTrigger
                                        aria-label="What the colour rows show"
                                        className="text-text-muted hover:text-text"
                                    >
                                        <Info className="size-3" />
                                    </TooltipTrigger>
                                    <TooltipContent
                                        side="right"
                                        className="max-w-64"
                                    >
                                        <p className="text-xs leading-snug">
                                            Cards of each colour identity and
                                            their average rating, a multicolour
                                            card counting in each. A colour
                                            sitting well above the others is a
                                            calibration smell. Click to filter.
                                        </p>
                                    </TooltipContent>
                                </Tooltip>
                            </span>
                            {colourRows.map((row) => {
                                const on =
                                    rail?.kind === "colour" &&
                                    rail.value === row.colour;
                                return (
                                    <button
                                        key={row.colour}
                                        type="button"
                                        onClick={() =>
                                            setRail(
                                                on
                                                    ? null
                                                    : {
                                                          kind: "colour",
                                                          value: row.colour,
                                                      }
                                            )
                                        }
                                        className={
                                            "flex items-center gap-2 rounded-sm px-1 py-0.5 text-[11px] " +
                                            (on
                                                ? "bg-accent/20"
                                                : "hover:bg-surface-elevated/40")
                                        }
                                    >
                                        <span className="w-6 font-mono text-parchment">
                                            {row.colour}
                                        </span>
                                        <span className="h-2 flex-1 rounded-full bg-surface-elevated/60">
                                            <span
                                                className="block h-full rounded-full"
                                                style={{
                                                    width: `${(row.avg / 5) * 100}%`,
                                                    background:
                                                        COLOR_SWATCH[
                                                            row.colour
                                                        ],
                                                }}
                                            />
                                        </span>
                                        <span className="w-6 text-right font-mono text-text">
                                            {row.avg.toFixed(1)}
                                        </span>
                                        <span className="w-6 text-right font-mono text-text-muted">
                                            {row.count}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex flex-col gap-1 border-t border-border-subtle/30 pt-3">
                            <Button
                                variant="secondary"
                                size="xs"
                                onClick={() => alert("stub: export seed JSON")}
                            >
                                Export scope as seed JSON
                            </Button>
                        </div>
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
                        · {seeded}/{cards?.length ?? 0}
                        {rail ? ` · ${railLabel}` : ""}
                    </span>
                </div>
            )}

            <Panel density="compact" className="min-w-0">
                <PanelHeader
                    title={railLabel}
                    subtitle={`${filtered.length} of ${cards?.length ?? 0} · click a row to open it`}
                />
                <PanelBody className="flex min-h-0 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <Input
                            placeholder="Search…"
                            aria-label="Search cards"
                            value={search}
                            onChange={(e) => setSearch(e.currentTarget.value)}
                            className="max-w-xs"
                        />
                        <MultiCombobox
                            options={asOptions(
                                ["override", "seed", "fallback"],
                                (x) =>
                                    SOURCE_LABEL[x as keyof typeof SOURCE_LABEL]
                            )}
                            selected={sourceFilter}
                            onToggle={toggleIn(setSourceFilter)}
                            placeholder="Source"
                            searchPlaceholder="Source…"
                            emptyText="No source"
                            labelClassName=""
                        />
                        <MultiCombobox
                            options={asOptions(facets.rarities)}
                            selected={rarityFilter}
                            onToggle={toggleIn(setRarityFilter)}
                            placeholder="Rarity"
                            searchPlaceholder="Rarity…"
                            emptyText="No rarity"
                            labelClassName=""
                        />
                        <MultiCombobox
                            options={asOptions(facets.types)}
                            selected={typeFilter}
                            onToggle={toggleIn(setTypeFilter)}
                            placeholder="Type"
                            searchPlaceholder="Type…"
                            emptyText="No type"
                            labelClassName=""
                        />
                        <MultiCombobox
                            options={asOptions(facets.archetypes)}
                            selected={archFilter}
                            onToggle={toggleIn(setArchFilter)}
                            placeholder="Archetype"
                            searchPlaceholder="Archetype…"
                            emptyText="No archetype"
                            labelClassName="font-mono"
                        />
                        {rail && (
                            <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => setRail(null)}
                            >
                                Clear rail filter
                            </Button>
                        )}
                        <Button
                            variant="secondary"
                            size="xs"
                            className="ml-auto"
                            disabled={filtered.length === 0}
                            onClick={() => {
                                const first = filtered[0]?.cardId;
                                if (first) open(first);
                            }}
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
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((c) => (
                                    <tr
                                        key={c.cardId}
                                        onClick={() => open(c.cardId)}
                                        className={
                                            "cursor-pointer border-b border-border-subtle/20 transition hover:bg-surface-elevated/40 " +
                                            (openId === c.cardId
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
                                                    <div className="truncate text-[10px] text-text-muted">
                                                        {c.typeLine}
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
                                        <td className="px-2 py-1 font-mono text-[11px] text-parchment">
                                            {c.archetypes.join(", ") || (
                                                <span className="text-text-disabled">
                                                    —
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-2 py-1">
                                            <RatingDots rating={c.rating} />
                                        </td>
                                        <td className="px-2 py-1">
                                            <SourceBadge source={c.source} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </PanelBody>
            </Panel>

            <Dialog
                card={openCard}
                index={Math.max(0, openIndex)}
                total={walk.length}
                all={cards ?? []}
                api={api}
                backToName={
                    (cards ?? []).find((c) => c.cardId === detour.at(-1))
                        ?.name ?? null
                }
                onJump={(cardId) => {
                    if (openId !== null) setDetour((d) => [...d, openId]);
                    setOpenId(cardId);
                }}
                onClose={() => {
                    setOpenId(null);
                    setDetour([]);
                }}
                onPrev={() => {
                    if (detour.length > 0) {
                        setOpenId(detour.at(-1) ?? null);
                        setDetour((d) => d.slice(0, -1));
                        return;
                    }
                    setOpenId((id) =>
                        id === null
                            ? null
                            : (walk[Math.max(0, walk.indexOf(id) - 1)] ?? id)
                    );
                }}
                onNext={() => {
                    if (detour.length > 0) {
                        setOpenId(detour.at(-1) ?? null);
                        setDetour((d) => d.slice(0, -1));
                        return;
                    }
                    setOpenId((id) =>
                        id === null
                            ? null
                            : (walk[walk.indexOf(id) + 1] ?? null)
                    );
                }}
            />
        </div>
    );
}

type RSortKey = "name" | "cost" | "rarity" | "archetypes" | "rating" | "source";

const RARITY_ORDER: Record<string, number> = {
    common: 0,
    uncommon: 1,
    rare: 2,
    mythic: 3,
};

const SOURCE_ORDER: Record<ProtoRatingCard["source"], number> = {
    override: 0,
    seed: 1,
    fallback: 2,
    unrated: 3,
};

const RSORTERS: Record<
    RSortKey,
    (a: ProtoRatingCard, b: ProtoRatingCard) => number
> = {
    name: (a, b) => a.name.localeCompare(b.name),
    cost: (a, b) => a.manaValue - b.manaValue,
    rarity: (a, b) =>
        (RARITY_ORDER[a.rarity] ?? -1) - (RARITY_ORDER[b.rarity] ?? -1),
    // Tagged rows first, then alphabetical by the tag list.
    archetypes: (a, b) =>
        Number(!a.archetypes.length) - Number(!b.archetypes.length) ||
        a.archetypes.join(",").localeCompare(b.archetypes.join(",")),
    rating: (a, b) => (a.rating ?? -1) - (b.rating ?? -1),
    source: (a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source],
};

const RCOLUMNS: { key: RSortKey; label: string }[] = [
    { key: "name", label: "Card" },
    { key: "cost", label: "Cost" },
    { key: "rarity", label: "Rarity" },
    { key: "archetypes", label: "Archetypes" },
    { key: "rating", label: "Rating" },
    { key: "source", label: "Source" },
];
