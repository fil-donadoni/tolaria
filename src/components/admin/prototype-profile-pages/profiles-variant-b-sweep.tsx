// PROTOTYPE — throwaway. Variant B "Sweep board": the review goes ROW by
// row of the catalogue, not card by card. Pick one archetype / capability;
// the board shows every card of the scope in three lanes — tagged &
// reviewed, proposed by the census, not tagged — as art tiles. Clicking a
// tile moves it across. The row's own TAG WHEN / NOT rubric and computed
// colour signature sit at the top, so the boundary is judged while looking
// at the cards that sit on both sides of it.
import { useMemo, useState } from "react";
import { Panel, PanelBody, PanelHeader } from "~/components/ui/panel";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import type { ProfilesProtoApi } from "./card-profiles-prototype";
import {
    catalogueRows,
    splitDescription,
    type CatalogueRow,
    type ProtoCard,
    type RowKind,
} from "./proto-data";
import { ArtTile, ColourBar, ColourPips } from "./proto-bits";
import ProtoScopeTabs from "./proto-scope-tabs";

export const VARIANT_NAME = "Sweep board";

const KIND_LABEL: Record<RowKind, string> = {
    archetype: "Archetypes",
    provides: "Provides",
    requires: "Requires",
};

export default function ProfilesVariantBSweep({
    api,
}: {
    api: ProfilesProtoApi;
}) {
    const cards = api.cards;
    const rows = useMemo(() => (cards ? catalogueRows(cards) : []), [cards]);
    const [current, setCurrent] = useState<{ kind: RowKind; id: string }>({
        kind: "archetype",
        id: "aggro",
    });
    const [search, setSearch] = useState("");
    const [onlyColours, setOnlyColours] = useState(false);

    const row = rows.find(
        (r) => r.kind === current.kind && r.id === current.id
    );
    const field = current.kind === "archetype" ? "archetypes" : current.kind;
    const { when, not } = splitDescription(row?.description ?? "");

    const lanes = useMemo(() => {
        const all = (cards ?? []).filter((c) =>
            search ? c.name.toLowerCase().includes(search.toLowerCase()) : true
        );
        const carrying = all.filter((c) =>
            c.profile?.[field].includes(current.id)
        );
        const tagged = carrying.filter((c) => c.status === "reviewed");
        const proposed = carrying.filter((c) => c.status !== "reviewed");
        let untagged = all.filter(
            (c) => !c.profile?.[field].includes(current.id)
        );
        if (onlyColours && row) {
            const dominant = (
                Object.entries(row.signature) as [string, number][]
            )
                .filter(([, v]) => v >= 0.2)
                .map(([k]) => k);
            untagged = untagged.filter(
                (c) =>
                    c.colors.some((col) => dominant.includes(col)) ||
                    c.colors.length === 0
            );
        }
        return { tagged, proposed, untagged };
    }, [cards, field, current.id, search, onlyColours, row]);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
                <ProtoScopeTabs
                    scopes={api.scopes}
                    value={api.scope}
                    onChange={api.setScope}
                />
                <Input
                    placeholder="Search…"
                    aria-label="Search cards"
                    value={search}
                    onChange={(e) => setSearch(e.currentTarget.value)}
                    className="ml-auto max-w-xs"
                />
            </div>

            {/* Catalogue strip */}
            <div className="flex flex-col gap-2">
                {(["archetype", "provides", "requires"] as RowKind[]).map(
                    (kind) => (
                        <div
                            key={kind}
                            className="flex items-center gap-2 overflow-x-auto"
                        >
                            <span className="w-20 shrink-0 text-[10px] tracking-wide text-text-muted uppercase">
                                {KIND_LABEL[kind]}
                            </span>
                            {rows
                                .filter((r) => r.kind === kind)
                                .map((r) => (
                                    <RowTab
                                        key={r.id}
                                        row={r}
                                        on={
                                            current.kind === kind &&
                                            current.id === r.id
                                        }
                                        onClick={() =>
                                            setCurrent({ kind, id: r.id })
                                        }
                                    />
                                ))}
                            {kind === "archetype" && (
                                <button
                                    type="button"
                                    className="shrink-0 rounded-sm border border-dashed border-border-subtle/50 px-2 py-1 text-[11px] text-text-muted hover:text-text"
                                    onClick={() =>
                                        alert(
                                            "stub: new archetype row — TAG WHEN / NOT required"
                                        )
                                    }
                                >
                                    + row
                                </button>
                            )}
                        </div>
                    )
                )}
            </div>

            {/* Row header: rubric + signature */}
            {row && (
                <Panel density="compact">
                    <PanelHeader
                        title={
                            <span className="font-mono">
                                {row.kind === "archetype"
                                    ? ""
                                    : `${row.kind}: `}
                                {row.id}
                            </span>
                        }
                        subtitle={`${row.tagged} tagged · ${row.proposed} proposed · ${row.reviewed} reviewed`}
                    />
                    <PanelBody className="grid grid-cols-[1fr_1fr_16rem] gap-4">
                        <div>
                            <span className="text-[10px] tracking-wide text-success-strong uppercase">
                                Tag when
                            </span>
                            <p className="mt-1 text-xs leading-snug text-text">
                                {when}
                            </p>
                        </div>
                        <div>
                            <span className="text-[10px] tracking-wide text-danger-strong uppercase">
                                Not
                            </span>
                            <p className="mt-1 text-xs leading-snug text-text">
                                {not || "—"}
                            </p>
                        </div>
                        <div className="flex flex-col gap-2">
                            <span className="text-[10px] tracking-wide text-text-muted uppercase">
                                Colour signature (computed)
                            </span>
                            <ColourBar signature={row.signature} height="h-3" />
                            <label className="flex items-center gap-1 text-[11px] text-text-muted">
                                <input
                                    type="checkbox"
                                    checked={onlyColours}
                                    onChange={(e) =>
                                        setOnlyColours(e.currentTarget.checked)
                                    }
                                />
                                Candidates: only the row's colours
                            </label>
                            <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => alert("stub: edit rubric")}
                            >
                                Edit rubric
                            </Button>
                        </div>
                    </PanelBody>
                </Panel>
            )}

            {/* Lanes */}
            <div className="grid grid-cols-3 gap-4">
                <Lane
                    title="Tagged · reviewed"
                    tone="text-success-strong"
                    cards={lanes.tagged}
                    onTile={(c) => api.toggleTag(c.cardId, field, current.id)}
                    hint="click = untag"
                />
                <Lane
                    title="Proposed by the census"
                    tone="text-danger-strong"
                    cards={lanes.proposed}
                    onTile={(c) => api.markReviewed(c.cardId, true)}
                    onTileAlt={(c) =>
                        api.toggleTag(c.cardId, field, current.id)
                    }
                    hint="click = confirm · ⌥click = reject"
                    action={
                        lanes.proposed.length > 0 ? (
                            <Button
                                variant="secondary"
                                size="xs"
                                onClick={() =>
                                    lanes.proposed.forEach((c) =>
                                        api.markReviewed(c.cardId, true)
                                    )
                                }
                            >
                                Confirm all {lanes.proposed.length}
                            </Button>
                        ) : null
                    }
                />
                <Lane
                    title="Not tagged"
                    tone="text-text-muted"
                    cards={lanes.untagged}
                    onTile={(c) => api.toggleTag(c.cardId, field, current.id)}
                    hint="click = tag"
                    dim
                />
            </div>
        </div>
    );
}

function RowTab({
    row,
    on,
    onClick,
}: {
    row: CatalogueRow;
    on: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={row.description}
            className={
                "flex shrink-0 flex-col gap-1 rounded-sm border px-2 py-1 text-left transition " +
                (on
                    ? "border-accent-strong/70 bg-accent/25"
                    : "border-border-subtle/30 hover:bg-surface-elevated/40")
            }
        >
            <span className="flex items-baseline gap-2 font-mono text-[11px]">
                <span className={on ? "text-parchment" : "text-text"}>
                    {row.id}
                </span>
                <span className="text-text-muted">{row.tagged}</span>
                {row.proposed > 0 && (
                    <span className="text-danger-strong">{row.proposed}?</span>
                )}
            </span>
            <ColourBar signature={row.signature} height="h-1" />
        </button>
    );
}

function Lane({
    title,
    tone,
    cards,
    onTile,
    onTileAlt,
    hint,
    action,
    dim,
}: {
    title: string;
    tone: string;
    cards: ProtoCard[];
    onTile: (c: ProtoCard) => void;
    onTileAlt?: (c: ProtoCard) => void;
    hint: string;
    action?: React.ReactNode;
    dim?: boolean;
}) {
    return (
        <Panel density="compact" className="min-w-0">
            <PanelHeader
                title={<span className={tone}>{title}</span>}
                subtitle={`${cards.length} · ${hint}`}
            />
            <PanelBody>
                {action && <div className="mb-2">{action}</div>}
                <div className="grid max-h-[52vh] grid-cols-4 gap-2 overflow-auto pr-1 xl:grid-cols-5">
                    {cards.map((c) => (
                        <button
                            key={c.cardId}
                            type="button"
                            className={
                                "group text-left " +
                                (dim ? "opacity-70 hover:opacity-100" : "")
                            }
                            onClick={(e) =>
                                e.altKey && onTileAlt ? onTileAlt(c) : onTile(c)
                            }
                            title={`${c.name}\n${c.profile?.archetypes.join(", ") ?? ""}`}
                        >
                            <ArtTile
                                cardId={c.cardId}
                                name={c.name}
                                sizes="120px"
                            >
                                <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-surface/85 px-1 py-0.5 text-[10px] text-text opacity-0 transition group-hover:opacity-100">
                                    <ColourPips colors={c.colors} />
                                    <span className="truncate">{c.name}</span>
                                </span>
                            </ArtTile>
                        </button>
                    ))}
                </div>
            </PanelBody>
        </Panel>
    );
}
