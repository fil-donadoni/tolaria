// PROTOTYPE — throwaway. Variant D: variant A's workbench with (1) the rail
// COLLAPSIBLE to a thin strip so the table takes the width, (2) the card
// focus in a DIALOG (variant C's body) instead of a right-hand inspector,
// (3) an info tooltip on the catalogue counts.
import { useMemo, useState } from "react";
import {
    ArrowDown,
    ArrowUp,
    ArrowUpDown,
    Info,
    PanelLeftClose,
    PanelLeftOpen,
} from "lucide-react";
import { CAPABILITY_REGISTRY } from "@convex/limited/capabilityRegistry";
import { ARCHETYPE_REGISTRY } from "@convex/limited/archetypeRegistry";
import MultiCombobox from "~/components/lobby/deck-builder/multi-combobox";
import { Panel, PanelBody, PanelHeader } from "~/components/ui/panel";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "~/components/ui/tooltip";
import type { ProfilesProtoApi } from "./card-profiles-prototype";
import {
    catalogueRows,
    fieldOf,
    STATUS_LABEL,
    type CatalogueRow,
    type ProfileStatus,
    type ProtoCard,
    type RowKind,
} from "./proto-data";
import { ArtTile, ColourBar, ManaCost, StatusBadge } from "./proto-bits";
import ProtoScopeTabs from "./proto-scope-tabs";
import ProfilesFocusDialog from "./profiles-focus-dialog";

export const VARIANT_NAME = "Workbench + dialog";

export default function ProfilesVariantDDialog({
    api,
}: {
    api: ProfilesProtoApi;
}) {
    const [railOpen, setRailOpen] = useState(true);
    const [search, setSearch] = useState("");
    const [unreviewedOnly, setUnreviewedOnly] = useState(false);
    const [rowFilter, setRowFilter] = useState<{
        kind: RowKind;
        id: string;
    } | null>(null);
    const [openIndex, setOpenIndex] = useState<number | null>(null);
    const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
        key: "name",
        dir: 1,
    });
    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [archFilter, setArchFilter] = useState<string[]>([]);
    const [provFilter, setProvFilter] = useState<string[]>([]);
    const [reqFilter, setReqFilter] = useState<string[]>([]);
    const toggleIn =
        (set: React.Dispatch<React.SetStateAction<string[]>>) => (v: string) =>
            set((xs) =>
                xs.includes(v) ? xs.filter((x) => x !== v) : [...xs, v]
            );

    const cards = api.cards;
    const rows = useMemo(() => (cards ? catalogueRows(cards) : []), [cards]);

    function toggleSort(key: SortKey) {
        setSort((s) =>
            s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }
        );
    }

    const filtered = useMemo(() => {
        if (!cards) return [];
        const q = search.trim().toLowerCase();
        const list = cards.filter((c) => {
            if (q && !c.name.toLowerCase().includes(q)) return false;
            if (unreviewedOnly && c.status === "reviewed") return false;
            // Within a combobox OR, across comboboxes AND.
            if (statusFilter.length && !statusFilter.includes(c.status))
                return false;
            if (
                archFilter.length &&
                !archFilter.some((a) => c.profile?.archetypes.includes(a))
            )
                return false;
            if (
                provFilter.length &&
                !provFilter.some((a) => c.profile?.provides.includes(a))
            )
                return false;
            if (
                reqFilter.length &&
                !reqFilter.some((a) => c.profile?.requires.includes(a))
            )
                return false;
            if (
                rowFilter &&
                !c.profile?.[fieldOf(rowFilter.kind)].includes(rowFilter.id)
            )
                return false;
            return true;
        });
        const cmp = SORTERS[sort.key];
        return [...list].sort(
            (a, b) => sort.dir * cmp(a, b) || a.name.localeCompare(b.name)
        );
    }, [
        cards,
        search,
        unreviewedOnly,
        rowFilter,
        statusFilter,
        archFilter,
        provFilter,
        reqFilter,
        sort,
    ]);

    const profiled = cards?.filter((c) => c.profile).length ?? 0;
    const reviewed = cards?.filter((c) => c.status === "reviewed").length ?? 0;
    const openCard = openIndex === null ? null : (filtered[openIndex] ?? null);

    return (
        <div
            className="grid min-h-[78vh] gap-4"
            style={{
                gridTemplateColumns: railOpen
                    ? "16rem minmax(0, 1fr)"
                    : "2.75rem minmax(0, 1fr)",
            }}
        >
            {/* Rail */}
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
                        <div>
                            <div className="flex items-baseline justify-between text-xs">
                                <span className="text-text-muted">
                                    Reviewed
                                </span>
                                <span className="font-mono text-parchment">
                                    {reviewed}/{profiled}
                                </span>
                            </div>
                            <div className="mt-1 h-1.5 w-full rounded-full bg-surface-elevated/60">
                                <div
                                    className="h-full rounded-full bg-success-strong"
                                    style={{
                                        width: `${profiled ? (reviewed / profiled) * 100 : 0}%`,
                                    }}
                                />
                            </div>
                        </div>
                        <RailGroupInfo
                            title="Archetypes"
                            rows={rows.filter((r) => r.kind === "archetype")}
                            active={rowFilter}
                            onPick={setRowFilter}
                            addLabel="+ archetype"
                        />
                        <RailGroupInfo
                            title="Provides"
                            rows={rows.filter(
                                (r) => r.kind === "provides" && r.tagged > 0
                            )}
                            active={rowFilter}
                            onPick={setRowFilter}
                        />
                        <RailGroupInfo
                            title="Requires"
                            rows={rows.filter(
                                (r) => r.kind === "requires" && r.tagged > 0
                            )}
                            active={rowFilter}
                            onPick={setRowFilter}
                        />
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
                        · {reviewed}/{profiled}
                        {rowFilter ? ` · ${rowFilter.id}` : ""}
                    </span>
                </div>
            )}

            {/* Table */}
            <Panel density="compact" className="min-w-0">
                <PanelHeader
                    title={
                        rowFilter
                            ? `${rowFilter.kind}: ${rowFilter.id}`
                            : "All cards"
                    }
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
                        <label className="flex items-center gap-1 text-xs text-text-muted">
                            <input
                                type="checkbox"
                                checked={unreviewedOnly}
                                onChange={(e) =>
                                    setUnreviewedOnly(e.currentTarget.checked)
                                }
                            />
                            Unreviewed only
                        </label>
                        <MultiCombobox
                            options={(
                                Object.keys(STATUS_LABEL) as ProfileStatus[]
                            ).map((k) => ({
                                value: k,
                                label: STATUS_LABEL[k],
                            }))}
                            selected={statusFilter}
                            onToggle={toggleIn(setStatusFilter)}
                            placeholder="Status"
                            searchPlaceholder="Status…"
                            emptyText="No status"
                            labelClassName=""
                        />
                        <MultiCombobox
                            options={ARCHETYPE_REGISTRY.map((r) => ({
                                value: r.id,
                                label: r.id,
                            }))}
                            selected={archFilter}
                            onToggle={toggleIn(setArchFilter)}
                            placeholder="Archetype"
                            searchPlaceholder="Archetype…"
                            emptyText="No archetype"
                            labelClassName="font-mono"
                        />
                        <MultiCombobox
                            options={CAPABILITY_REGISTRY.map((r) => ({
                                value: r.id,
                                label: r.id,
                            }))}
                            selected={provFilter}
                            onToggle={toggleIn(setProvFilter)}
                            placeholder="Provides"
                            searchPlaceholder="Capability…"
                            emptyText="No capability"
                            labelClassName="font-mono"
                        />
                        <MultiCombobox
                            options={CAPABILITY_REGISTRY.map((r) => ({
                                value: r.id,
                                label: r.id,
                            }))}
                            selected={reqFilter}
                            onToggle={toggleIn(setReqFilter)}
                            placeholder="Requires"
                            searchPlaceholder="Capability…"
                            emptyText="No capability"
                            labelClassName="font-mono"
                        />
                        {rowFilter && (
                            <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => setRowFilter(null)}
                            >
                                Clear row filter
                            </Button>
                        )}
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
                                    {COLUMNS.map((col) => (
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
                                {filtered.map((c, i) => (
                                    <tr
                                        key={c.cardId}
                                        onClick={() => setOpenIndex(i)}
                                        className={
                                            "cursor-pointer border-b border-border-subtle/20 transition hover:bg-surface-elevated/40 " +
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
                                                    <div className="truncate text-[10px] text-text-muted">
                                                        {c.typeLine}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-2 py-1">
                                            <ManaCost symbols={c.costSymbols} />
                                        </td>
                                        <td className="px-2 py-1 font-mono text-[11px] text-parchment">
                                            {c.profile?.archetypes.join(
                                                ", "
                                            ) || (
                                                <span className="text-text-disabled">
                                                    —
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-2 py-1 font-mono text-[11px] text-success-strong">
                                            {c.profile?.provides.join(", ") || (
                                                <span className="text-text-disabled">
                                                    —
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-2 py-1 font-mono text-[11px] text-secondary-accent-strong">
                                            {c.profile?.requires.join(", ") || (
                                                <span className="text-text-disabled">
                                                    —
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-2 py-1">
                                            <StatusBadge status={c.status} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </PanelBody>
            </Panel>

            <ProfilesFocusDialog
                card={openCard}
                index={openIndex ?? 0}
                total={filtered.length}
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

function RailGroupInfo({
    title,
    rows,
    active,
    onPick,
    addLabel,
}: {
    title: string;
    rows: CatalogueRow[];
    active: { kind: RowKind; id: string } | null;
    onPick: (r: { kind: RowKind; id: string } | null) => void;
    addLabel?: string;
}) {
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-[10px] tracking-wide text-text-muted uppercase">
                    {title}
                    <Tooltip>
                        <TooltipTrigger
                            aria-label={`What the ${title} counts mean`}
                            className="text-text-muted hover:text-text"
                        >
                            <Info className="size-3" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-64">
                            <p className="text-xs leading-snug">
                                <strong>First number</strong>: cards of this
                                scope tagged with the row (reviewed or not).
                                <br />
                                <strong>Second number with ?</strong>: how many
                                of those are still census proposals nobody has
                                reviewed — the row's open work.
                                <br />
                                The bar is the row's colour signature, computed
                                from the tagged cards. Click a row to filter the
                                table to it.
                            </p>
                        </TooltipContent>
                    </Tooltip>
                </span>
                {addLabel && (
                    <button
                        type="button"
                        className="text-[10px] text-accent-strong hover:underline"
                        onClick={() =>
                            alert(
                                "stub: new catalogue row (TAG WHEN / NOT required)"
                            )
                        }
                    >
                        {addLabel}
                    </button>
                )}
            </div>
            {rows.map((r) => {
                const on = active?.kind === r.kind && active.id === r.id;
                return (
                    <button
                        key={r.kind + r.id}
                        type="button"
                        title={`${r.tagged} tagged · ${r.proposed} still proposed · ${r.reviewed} reviewed\n\n${r.description}`}
                        onClick={() =>
                            onPick(on ? null : { kind: r.kind, id: r.id })
                        }
                        className={
                            "flex flex-col gap-1 rounded-sm px-2 py-1 text-left transition " +
                            (on
                                ? "bg-accent/20"
                                : "hover:bg-surface-elevated/40")
                        }
                    >
                        <span className="flex items-baseline justify-between font-mono text-[11px]">
                            <span
                                className={on ? "text-parchment" : "text-text"}
                            >
                                {r.id}
                            </span>
                            <span className="text-text-muted">
                                {r.tagged}
                                {r.proposed > 0 && (
                                    <span className="text-danger-strong">
                                        {" "}
                                        · {r.proposed}?
                                    </span>
                                )}
                            </span>
                        </span>
                        <ColourBar signature={r.signature} height="h-1" />
                    </button>
                );
            })}
        </div>
    );
}

type SortKey =
    | "name"
    | "cost"
    | "archetypes"
    | "provides"
    | "requires"
    | "status";

const STATUS_ORDER: Record<ProfileStatus, number> = {
    proposed: 0,
    override: 1,
    unprofiled: 2,
    reviewed: 3,
};

const joined = (xs: string[] | undefined) => (xs ?? []).join(",");

const SORTERS: Record<SortKey, (a: ProtoCard, b: ProtoCard) => number> = {
    name: (a, b) => a.name.localeCompare(b.name),
    cost: (a, b) => a.manaValue - b.manaValue,
    // Tagged rows first, then alphabetical by the tag list.
    archetypes: (a, b) =>
        Number(!a.profile?.archetypes.length) -
            Number(!b.profile?.archetypes.length) ||
        joined(a.profile?.archetypes).localeCompare(
            joined(b.profile?.archetypes)
        ),
    provides: (a, b) =>
        Number(!a.profile?.provides.length) -
            Number(!b.profile?.provides.length) ||
        joined(a.profile?.provides).localeCompare(joined(b.profile?.provides)),
    requires: (a, b) =>
        Number(!a.profile?.requires.length) -
            Number(!b.profile?.requires.length) ||
        joined(a.profile?.requires).localeCompare(joined(b.profile?.requires)),
    status: (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
};

const COLUMNS: { key: SortKey; label: string }[] = [
    { key: "name", label: "Card" },
    { key: "cost", label: "Cost" },
    { key: "archetypes", label: "Archetypes" },
    { key: "provides", label: "Provides" },
    { key: "requires", label: "Requires" },
    { key: "status", label: "Status" },
];
