// PROTOTYPE — throwaway. Variant A "Workbench": a desktop three-column
// tool. Left rail = scope, progress, the catalogue (archetype / capability
// rows with counts + computed colour bar; clicking one filters the table).
// Centre = dense card table. Right = inspector for the selected card: big
// art, Oracle, census rationale, chip toggles, Mark reviewed & next.
import { useMemo, useState } from "react";
import { Panel, PanelBody, PanelHeader } from "~/components/ui/panel";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import CardProfileOracleText from "~/components/lobby/card-profile-oracle-text";
import { ARCHETYPE_REGISTRY } from "@convex/limited/archetypeRegistry";
import { CAPABILITY_REGISTRY } from "@convex/limited/capabilityRegistry";
import type { ProfilesProtoApi } from "./card-profiles-prototype";
import {
    catalogueRows,
    splitDescription,
    type CatalogueRow,
    type ProtoCard,
    type RowKind,
} from "./proto-data";
import {
    ArtTile,
    Chip,
    ColourBar,
    ColourPips,
    ManaCost,
    StatusBadge,
} from "./proto-bits";
import ProtoScopeTabs from "./proto-scope-tabs";

export const VARIANT_NAME = "Workbench";

export default function ProfilesVariantAWorkbench({
    api,
}: {
    api: ProfilesProtoApi;
}) {
    const [search, setSearch] = useState("");
    const [unreviewedOnly, setUnreviewedOnly] = useState(false);
    const [rowFilter, setRowFilter] = useState<{
        kind: RowKind;
        id: string;
    } | null>(null);
    const [selected, setSelected] = useState<string | null>(null);

    const cards = api.cards;
    const rows = useMemo(() => (cards ? catalogueRows(cards) : []), [cards]);

    const filtered = useMemo(() => {
        if (!cards) return [];
        const q = search.trim().toLowerCase();
        return cards.filter((c) => {
            if (q && !c.name.toLowerCase().includes(q)) return false;
            if (unreviewedOnly && c.status === "reviewed") return false;
            if (
                rowFilter &&
                !c.profile?.[
                    rowFilter.kind === "archetype"
                        ? "archetypes"
                        : rowFilter.kind
                ].includes(rowFilter.id)
            )
                return false;
            return true;
        });
    }, [cards, search, unreviewedOnly, rowFilter]);

    const selectedCard = cards?.find((c) => c.cardId === selected) ?? null;
    const profiled = cards?.filter((c) => c.profile).length ?? 0;
    const reviewed = cards?.filter((c) => c.status === "reviewed").length ?? 0;

    function advance() {
        const i = filtered.findIndex((c) => c.cardId === selected);
        setSelected(filtered[i + 1]?.cardId ?? null);
    }

    return (
        <div className="grid min-h-[78vh] grid-cols-[16rem_minmax(0,1fr)_24rem] gap-4">
            {/* Rail */}
            <Panel density="compact" className="self-start">
                <PanelHeader title="Scope" />
                <PanelBody className="flex flex-col gap-4">
                    <ProtoScopeTabs
                        scopes={api.scopes}
                        value={api.scope}
                        onChange={api.setScope}
                    />
                    <div>
                        <div className="flex items-baseline justify-between text-xs">
                            <span className="text-text-muted">Reviewed</span>
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
                    <RailGroup
                        title="Archetypes"
                        rows={rows.filter((r) => r.kind === "archetype")}
                        active={rowFilter}
                        onPick={setRowFilter}
                        addLabel="+ archetype"
                    />
                    <RailGroup
                        title="Provides"
                        rows={rows.filter(
                            (r) => r.kind === "provides" && r.tagged > 0
                        )}
                        active={rowFilter}
                        onPick={setRowFilter}
                    />
                    <RailGroup
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
                        <span className="text-[10px] text-text-muted">
                            Backup = the checked-in seed file format.
                        </span>
                    </div>
                </PanelBody>
            </Panel>

            {/* Table */}
            <Panel density="compact" className="min-w-0">
                <PanelHeader
                    title={
                        rowFilter
                            ? `${rowFilter.kind}: ${rowFilter.id}`
                            : "All cards"
                    }
                    subtitle={`${filtered.length} of ${cards?.length ?? 0}`}
                />
                <PanelBody className="flex min-h-0 flex-col gap-2">
                    <div className="flex items-center gap-2">
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
                        {rowFilter && (
                            <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => setRowFilter(null)}
                            >
                                Clear row filter
                            </Button>
                        )}
                    </div>
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
                                        Archetypes
                                    </th>
                                    <th className="px-2 py-1.5 text-left font-medium">
                                        Provides
                                    </th>
                                    <th className="px-2 py-1.5 text-left font-medium">
                                        Requires
                                    </th>
                                    <th className="px-2 py-1.5 text-left font-medium">
                                        Status
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((c) => (
                                    <tr
                                        key={c.cardId}
                                        onClick={() => setSelected(c.cardId)}
                                        className={
                                            "cursor-pointer border-b border-border-subtle/20 transition hover:bg-surface-elevated/40 " +
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
                                                    <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
                                                        <ColourPips
                                                            colors={c.colors}
                                                        />
                                                        <span className="truncate">
                                                            {c.typeLine}
                                                        </span>
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

            {/* Inspector */}
            <Panel density="compact" className="self-start">
                {selectedCard ? (
                    <Inspector
                        card={selectedCard}
                        api={api}
                        onAdvance={advance}
                    />
                ) : (
                    <>
                        <PanelHeader
                            title="Inspector"
                            subtitle="Select a card"
                        />
                        <PanelBody>
                            <p className="text-xs text-text-muted">
                                Click a row. ⌘/Ctrl+Enter marks reviewed and
                                moves to the next row in the current filter.
                            </p>
                        </PanelBody>
                    </>
                )}
            </Panel>
        </div>
    );
}

function RailGroup({
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
            <div className="flex items-baseline justify-between">
                <span className="text-[10px] tracking-wide text-text-muted uppercase">
                    {title}
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
                        title={r.description}
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

function Inspector({
    card,
    api,
    onAdvance,
}: {
    card: ProtoCard;
    api: ProfilesProtoApi;
    onAdvance: () => void;
}) {
    const p = card.profile;
    return (
        <div
            tabIndex={-1}
            onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    api.markReviewed(card.cardId, true);
                    onAdvance();
                }
            }}
        >
            <PanelHeader title={card.name} subtitle={card.typeLine} />
            <PanelBody className="flex flex-col gap-3">
                <div className="flex gap-3">
                    <ArtTile
                        cardId={card.cardId}
                        name={card.name}
                        width="w-40"
                        sizes="160px"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <ManaCost symbols={card.costSymbols} />
                            <span className="text-[10px] text-text-muted uppercase">
                                {card.rarity}
                            </span>
                            <StatusBadge status={card.status} />
                        </div>
                        <div className="max-h-40 overflow-auto">
                            <CardProfileOracleText cardId={card.cardId} />
                        </div>
                    </div>
                </div>
                {card.rationale && (
                    <div className="rounded-sm border-l-2 border-accent-strong/60 bg-surface-elevated/40 px-2 py-1.5 text-[11px] leading-snug text-text">
                        <span className="text-[10px] tracking-wide text-text-muted uppercase">
                            Census rationale
                        </span>
                        <p>{card.rationale}</p>
                    </div>
                )}
                <ChipGroup
                    legend="Archetypes"
                    ids={ARCHETYPE_REGISTRY.map((r) => ({
                        id: r.id,
                        d: r.description,
                    }))}
                    value={p?.archetypes ?? []}
                    onToggle={(id) =>
                        api.toggleTag(card.cardId, "archetypes", id)
                    }
                />
                <ChipGroup
                    legend="Provides"
                    tone="provides"
                    ids={CAPABILITY_REGISTRY.map((r) => ({
                        id: r.id,
                        d: r.description,
                    }))}
                    value={p?.provides ?? []}
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
                    value={p?.requires ?? []}
                    onToggle={(id) =>
                        api.toggleTag(card.cardId, "requires", id)
                    }
                    hint="Empty is the norm."
                />
                <div className="flex items-center gap-2 border-t border-border-subtle/30 pt-3">
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => {
                            api.markReviewed(card.cardId, true);
                            onAdvance();
                        }}
                    >
                        Mark reviewed & next
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => api.markReviewed(card.cardId, false)}
                    >
                        Unreview
                    </Button>
                    <span className="ml-auto text-[10px] text-text-muted">
                        ⌘↵
                    </span>
                </div>
            </PanelBody>
        </div>
    );
}

function ChipGroup({
    legend,
    ids,
    value,
    onToggle,
    tone,
    hint,
}: {
    legend: string;
    ids: { id: string; d: string }[];
    value: string[];
    onToggle: (id: string) => void;
    tone?: "provides" | "requires";
    hint?: string;
}) {
    return (
        <fieldset className="flex flex-col gap-1.5">
            <legend className="flex items-baseline gap-2 text-[10px] tracking-wide text-text-muted uppercase">
                {legend}
                {hint && (
                    <span className="normal-case tracking-normal">{hint}</span>
                )}
            </legend>
            <div className="flex flex-wrap gap-1">
                {ids.map(({ id, d }) => (
                    <Chip
                        key={id}
                        label={id}
                        on={value.includes(id)}
                        title={splitDescription(d).when}
                        tone={tone}
                        onClick={() => onToggle(id)}
                    />
                ))}
            </div>
        </fieldset>
    );
}
