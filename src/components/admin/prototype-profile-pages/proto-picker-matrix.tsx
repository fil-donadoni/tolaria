// PROTOTYPE — throwaway. The picker zone rethought: instead of two walls of
// slug chips, every catalogue row is a LINE with its toggle(s), a one-line
// gloss, and real examples drawn from the scope (cards already tagged with
// it, reviewed first). Capabilities are a matrix — one row, two toggles
// (Provides / Requires) — grouped by cluster; the full registry text opens
// on demand.
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ARCHETYPE_REGISTRY } from "@convex/limited/archetypeRegistry";
import { CAPABILITY_REGISTRY } from "@convex/limited/capabilityRegistry";
import type { ProfilesProtoApi } from "./card-profiles-prototype";
import type { ProtoCard } from "./proto-data";
import { ArtTile } from "./proto-bits";
import {
    ARCHETYPE_GLOSS,
    CAPABILITY_GLOSS,
    CLUSTER_ORDER,
} from "./proto-gloss";

// Inline: arbitrary Tailwind grid classes are not generated on the fly in
// this worktree (prototype-only workaround).
const ARCH_COLS = "2rem 9rem minmax(0, 1fr) minmax(0, 1fr) 9rem";
const CAP_COLS = "2rem 2rem 10rem minmax(0, 1fr) minmax(0, 1fr) 11rem";

function examples(
    cards: readonly ProtoCard[],
    field: "archetypes" | "provides" | "requires",
    id: string,
    exclude: string,
    n = 4
): ProtoCard[] {
    return cards
        .filter((c) => c.cardId !== exclude && c.profile?.[field].includes(id))
        .sort(
            (a, b) =>
                Number(b.status === "reviewed") -
                    Number(a.status === "reviewed") ||
                a.name.localeCompare(b.name)
        )
        .slice(0, n);
}

function Examples({ cards, label }: { cards: ProtoCard[]; label?: string }) {
    return (
        <span className="inline-flex items-center gap-1">
            {label && (
                <span className="text-[9px] tracking-wide text-text-muted uppercase">
                    {label}
                </span>
            )}
            {cards.length === 0 ? (
                <span className="text-[10px] text-text-disabled">—</span>
            ) : (
                cards.map((c) => (
                    <ArtTile
                        key={c.cardId}
                        cardId={c.cardId}
                        name={c.name}
                        width="w-7"
                        sizes="28px"
                    />
                ))
            )}
        </span>
    );
}

function Toggle({
    on,
    onClick,
    tone,
    label,
}: {
    on: boolean;
    onClick: () => void;
    tone: "archetype" | "provides" | "requires";
    label: string;
}) {
    const onTone =
        tone === "provides"
            ? "border-success-strong bg-success-soft text-success-strong"
            : tone === "requires"
              ? "border-secondary-accent-strong bg-secondary-accent-strong/20 text-secondary-accent-strong"
              : "border-accent-strong bg-accent/30 text-parchment";
    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={on}
            aria-label={label}
            onClick={onClick}
            className={
                "inline-flex h-6 min-w-6 items-center justify-center rounded-sm border px-1.5 font-mono text-[11px] transition " +
                (on
                    ? onTone
                    : "border-border-subtle/40 text-text-disabled hover:border-border-subtle hover:text-text-muted")
            }
        >
            {on ? "✓" : ""}
        </button>
    );
}

export default function ProtoPickerMatrix({
    card,
    api,
}: {
    card: ProtoCard;
    api: ProfilesProtoApi;
}) {
    const cards = api.cards ?? [];
    const p = card.profile;
    const [expanded, setExpanded] = useState<string | null>(null);

    const clusters = useMemo(() => {
        const by = new Map<string, typeof CAPABILITY_REGISTRY>();
        for (const row of CAPABILITY_REGISTRY) {
            const k = CAPABILITY_GLOSS[row.id]?.cluster ?? "Other";
            by.set(k, [...(by.get(k) ?? []), row]);
        }
        return [
            ...CLUSTER_ORDER,
            ...[...by.keys()].filter((k) => !CLUSTER_ORDER.includes(k)),
        ]
            .filter((k) => by.has(k))
            .map((k) => ({ cluster: k, rows: by.get(k)! }));
    }, []);

    return (
        <div className="flex flex-col gap-5">
            {/* Archetypes */}
            <section className="flex flex-col gap-1">
                <header
                    style={{ gridTemplateColumns: ARCH_COLS }}
                    className="grid gap-3 px-1 text-[9px] tracking-wide text-text-muted uppercase"
                >
                    <span />
                    <span>Archetype</span>
                    <span className="text-success-strong">Tag when</span>
                    <span className="text-danger-strong">Not</span>
                    <span>In this scope</span>
                </header>
                {ARCHETYPE_REGISTRY.map((row) => {
                    const on = p?.archetypes.includes(row.id) ?? false;
                    const g = ARCHETYPE_GLOSS[row.id];
                    const isOpen = expanded === `a:${row.id}`;
                    return (
                        <div
                            key={row.id}
                            className={
                                "rounded-sm px-1 py-1 transition " +
                                (on
                                    ? "bg-accent/10"
                                    : "hover:bg-surface-elevated/30")
                            }
                        >
                            <div
                                style={{ gridTemplateColumns: ARCH_COLS }}
                                className="grid items-center gap-3"
                            >
                                <Toggle
                                    on={on}
                                    tone="archetype"
                                    label={`${row.id} for ${card.name}`}
                                    onClick={() =>
                                        api.toggleTag(
                                            card.cardId,
                                            "archetypes",
                                            row.id
                                        )
                                    }
                                />
                                <button
                                    type="button"
                                    onClick={() =>
                                        setExpanded(
                                            isOpen ? null : `a:${row.id}`
                                        )
                                    }
                                    className={
                                        "flex items-center gap-1 text-left font-mono text-xs " +
                                        (on ? "text-parchment" : "text-text")
                                    }
                                >
                                    {isOpen ? (
                                        <ChevronDown className="size-3 opacity-60" />
                                    ) : (
                                        <ChevronRight className="size-3 opacity-60" />
                                    )}
                                    {row.id}
                                </button>
                                <span className="text-[11px] leading-snug text-text">
                                    {g?.when}
                                </span>
                                <span className="text-[11px] leading-snug text-text-muted">
                                    {g?.not}
                                </span>
                                <Examples
                                    cards={examples(
                                        cards,
                                        "archetypes",
                                        row.id,
                                        card.cardId
                                    )}
                                />
                            </div>
                            {isOpen && (
                                <p className="mt-1 ml-11 border-l border-border-subtle/40 pl-3 text-[11px] leading-snug text-text-muted">
                                    {row.description}
                                </p>
                            )}
                        </div>
                    );
                })}
            </section>

            {/* Capabilities matrix */}
            <section className="flex flex-col gap-1">
                <header
                    style={{ gridTemplateColumns: CAP_COLS }}
                    className="grid gap-3 px-1 text-[9px] tracking-wide text-text-muted uppercase"
                >
                    <span className="text-success-strong">Prov.</span>
                    <span className="text-secondary-accent-strong">Req.</span>
                    <span>Capability</span>
                    <span className="text-success-strong">
                        Providing it means…
                    </span>
                    <span className="text-secondary-accent-strong">
                        Requiring it means…
                    </span>
                    <span>In this scope · offers / needs</span>
                </header>
                {clusters.map(({ cluster, rows }) => (
                    <div key={cluster} className="flex flex-col gap-0.5">
                        <div className="mt-1 px-1 text-[10px] tracking-wide text-text-muted uppercase">
                            {cluster}
                        </div>
                        {rows.map((row) => {
                            const prov = p?.provides.includes(row.id) ?? false;
                            const req = p?.requires.includes(row.id) ?? false;
                            const g = CAPABILITY_GLOSS[row.id];
                            const derived = row.bound !== undefined;
                            const isOpen = expanded === `c:${row.id}`;
                            return (
                                <div
                                    key={row.id}
                                    className={
                                        "rounded-sm px-1 py-1 transition " +
                                        (prov || req
                                            ? "bg-surface-elevated/40"
                                            : "hover:bg-surface-elevated/30")
                                    }
                                >
                                    <div
                                        style={{
                                            gridTemplateColumns: CAP_COLS,
                                        }}
                                        className="grid items-center gap-3"
                                    >
                                        {derived ? (
                                            <span
                                                className="inline-flex h-6 w-6 items-center justify-center text-[10px] text-text-disabled"
                                                title="Derived from the base capability and mana value — never set by hand"
                                            >
                                                ∂
                                            </span>
                                        ) : (
                                            <Toggle
                                                on={prov}
                                                tone="provides"
                                                label={`Provides ${row.id} for ${card.name}`}
                                                onClick={() =>
                                                    api.toggleTag(
                                                        card.cardId,
                                                        "provides",
                                                        row.id
                                                    )
                                                }
                                            />
                                        )}
                                        <Toggle
                                            on={req}
                                            tone="requires"
                                            label={`Requires ${row.id} for ${card.name}`}
                                            onClick={() =>
                                                api.toggleTag(
                                                    card.cardId,
                                                    "requires",
                                                    row.id
                                                )
                                            }
                                        />
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setExpanded(
                                                    isOpen
                                                        ? null
                                                        : `c:${row.id}`
                                                )
                                            }
                                            className={
                                                "flex items-center gap-1 text-left font-mono text-xs " +
                                                (prov || req
                                                    ? "text-parchment"
                                                    : "text-text")
                                            }
                                        >
                                            {isOpen ? (
                                                <ChevronDown className="size-3 opacity-60" />
                                            ) : (
                                                <ChevronRight className="size-3 opacity-60" />
                                            )}
                                            {row.id}
                                        </button>
                                        <span className="text-[11px] leading-snug text-text">
                                            {g?.provides}
                                            {g && (
                                                <span className="text-text-muted">
                                                    {" "}
                                                    e.g. {g.example.provider}
                                                </span>
                                            )}
                                        </span>
                                        <span className="text-[11px] leading-snug text-text">
                                            {g?.requires}
                                            {g && (
                                                <span className="text-text-muted">
                                                    {" "}
                                                    e.g. {g.example.requirer}
                                                </span>
                                            )}
                                        </span>
                                        <span className="flex flex-col gap-0.5">
                                            <Examples
                                                label="offers"
                                                cards={examples(
                                                    cards,
                                                    "provides",
                                                    row.id,
                                                    card.cardId,
                                                    3
                                                )}
                                            />
                                            <Examples
                                                label="needs"
                                                cards={examples(
                                                    cards,
                                                    "requires",
                                                    row.id,
                                                    card.cardId,
                                                    3
                                                )}
                                            />
                                        </span>
                                    </div>
                                    {isOpen && (
                                        <p className="mt-1 ml-[5.5rem] border-l border-border-subtle/40 pl-3 text-[11px] leading-snug text-text-muted">
                                            {row.description}
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ))}
                <p className="px-1 pt-1 text-[10px] text-text-muted">
                    An empty{" "}
                    <span className="text-secondary-accent-strong">
                        Requires
                    </span>{" "}
                    column is the norm: only reanimation spells, cheat-into-play
                    effects, storm/metalcraft payoffs and graveyard-scaling
                    costs require anything. ∂ rows are derived, never set by
                    hand.
                </p>
            </section>
        </div>
    );
}
