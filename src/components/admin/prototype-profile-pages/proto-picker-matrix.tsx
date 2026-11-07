// PROTOTYPE — throwaway. The picker zone, second pass: one compact LINE per
// catalogue row — toggle(s) · id · one gloss · ? tooltip (the full registry
// text, its two halves on separate lines) · related cards from the scope,
// right-aligned, hover/right-click = the app's CardPreview, left click =
// a quick peek. No Oracle column, no collapsible: the tooltip is the one
// place the long text lives.
import { useMemo, useState } from "react";
import { CircleHelp } from "lucide-react";
import { ARCHETYPE_REGISTRY } from "@convex/limited/archetypeRegistry";
import { CAPABILITY_REGISTRY } from "@convex/limited/capabilityRegistry";
import CardPreview from "~/components/cards/card-preview";
import CardImage from "~/components/cards/card-image";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "~/components/ui/tooltip";
import type { ProfilesProtoApi } from "./card-profiles-prototype";
import type { ProtoCard } from "./proto-data";
import {
    ARCHETYPE_GLOSS,
    CAPABILITY_GLOSS,
    CLUSTER_ORDER,
} from "./proto-gloss";

// Inline grid templates: arbitrary Tailwind classes are not generated on the
// fly in this worktree (prototype-only workaround).
const ARCH_COLS = "1.75rem 8rem minmax(0, 1fr) 1.25rem 9.5rem";
const CAP_COLS = "1.75rem 1.75rem 9.5rem minmax(0, 1fr) 1.25rem 9.5rem";

function related(
    cards: readonly ProtoCard[],
    field: "archetypes" | "provides" | "requires",
    id: string,
    exclude: string,
    n: number
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

/** Splits a registry description into its two halves on the given marker. */
function halves(text: string, marker: string): [string, string] {
    const i = text.indexOf(marker);
    if (i === -1) return [text, ""];
    return [text.slice(0, i).trim(), text.slice(i + marker.length).trim()];
}

function HelpTip({
    first,
    second,
}: {
    first: { label: string; text: string; tone: string };
    second: { label: string; text: string; tone: string };
}) {
    return (
        <Tooltip>
            <TooltipTrigger
                aria-label={`${first.label} / ${second.label}`}
                className="text-text-muted hover:text-text"
            >
                <CircleHelp className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-md">
                <div className="flex flex-col gap-3 py-1 text-xs leading-snug">
                    <div>
                        <span
                            className={`block text-[10px] tracking-wide uppercase ${first.tone}`}
                        >
                            {first.label}
                        </span>
                        <p className="mt-0.5">{first.text}</p>
                    </div>
                    {second.text && (
                        <div>
                            <span
                                className={`block text-[10px] tracking-wide uppercase ${second.tone}`}
                            >
                                {second.label}
                            </span>
                            <p className="mt-0.5">{second.text}</p>
                        </div>
                    )}
                </div>
            </TooltipContent>
        </Tooltip>
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
                "inline-flex h-5 w-5 items-center justify-center rounded-sm border text-[10px] transition " +
                (on
                    ? onTone
                    : "border-border-subtle/40 text-transparent hover:border-border-subtle")
            }
        >
            ✓
        </button>
    );
}

function Related({
    cards,
    onPeek,
}: {
    cards: ProtoCard[];
    onPeek: (c: ProtoCard, e: React.MouseEvent) => void;
}) {
    return (
        <span className="flex items-center justify-end gap-0.5">
            {cards.length === 0 && (
                <span className="text-[10px] text-text-disabled">—</span>
            )}
            {cards.map((c) => (
                <CardPreview
                    key={c.cardId}
                    cardId={c.cardId}
                    cardName={c.name}
                    holdPreview={false}
                >
                    <button
                        type="button"
                        onClick={(e) => onPeek(c, e)}
                        className="relative aspect-5/7 w-6 overflow-hidden rounded-xs ring-border-subtle/40 hover:ring-1"
                        title={c.name}
                    >
                        <CardImage card={{ id: c.cardId }} lazy sizes="24px" />
                    </button>
                </CardPreview>
            ))}
        </span>
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
    const [peek, setPeek] = useState<{
        card: ProtoCard;
        x: number;
        y: number;
    } | null>(null);

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

    const onPeek = (c: ProtoCard, e: React.MouseEvent) => {
        e.preventDefault();
        setPeek((cur) =>
            cur?.card.cardId === c.cardId
                ? null
                : { card: c, x: e.clientX, y: e.clientY }
        );
    };

    return (
        <div className="flex flex-col gap-4">
            {/* Archetypes */}
            <section className="flex flex-col">
                <header
                    style={{ gridTemplateColumns: ARCH_COLS }}
                    className="grid items-center gap-2 px-1 pb-1 text-[9px] tracking-wide text-text-muted uppercase"
                >
                    <span />
                    <span>Archetype</span>
                    <span>Tag when</span>
                    <span />
                    <span className="text-right">Also tagged</span>
                </header>
                {ARCHETYPE_REGISTRY.map((row) => {
                    const on = p?.archetypes.includes(row.id) ?? false;
                    const g = ARCHETYPE_GLOSS[row.id];
                    const [when, not] = halves(
                        row.description.replace(/^TAG WHEN:\s*/, ""),
                        "NOT:"
                    );
                    return (
                        <div
                            key={row.id}
                            style={{ gridTemplateColumns: ARCH_COLS }}
                            className={
                                "grid items-center gap-2 rounded-sm px-1 py-0.5 " +
                                (on
                                    ? "bg-accent/10"
                                    : "hover:bg-surface-elevated/30")
                            }
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
                            <span
                                className={
                                    "truncate font-mono text-xs " +
                                    (on ? "text-parchment" : "text-text")
                                }
                            >
                                {row.id}
                            </span>
                            <span
                                className="truncate text-[11px] text-text-muted"
                                title={g?.when}
                            >
                                {g?.when}
                            </span>
                            <HelpTip
                                first={{
                                    label: "Tag when",
                                    text: when,
                                    tone: "text-success-strong",
                                }}
                                second={{
                                    label: "Not",
                                    text: not,
                                    tone: "text-danger-strong",
                                }}
                            />
                            <Related
                                cards={related(
                                    cards,
                                    "archetypes",
                                    row.id,
                                    card.cardId,
                                    4
                                )}
                                onPeek={onPeek}
                            />
                        </div>
                    );
                })}
            </section>

            {/* Capabilities */}
            <section className="flex flex-col">
                <header
                    style={{ gridTemplateColumns: CAP_COLS }}
                    className="grid items-center gap-2 px-1 pb-1 text-[9px] tracking-wide text-text-muted uppercase"
                >
                    <span className="text-success-strong">Prov</span>
                    <span className="text-secondary-accent-strong">Req</span>
                    <span>Capability</span>
                    <span>Providing it means</span>
                    <span />
                    <span className="text-right">Offers · needs</span>
                </header>
                {clusters.map(({ cluster, rows }) => (
                    <div key={cluster} className="flex flex-col">
                        <div className="px-1 pt-1.5 pb-0.5 text-[9px] tracking-wide text-text-disabled uppercase">
                            {cluster}
                        </div>
                        {rows.map((row) => {
                            const prov = p?.provides.includes(row.id) ?? false;
                            const req = p?.requires.includes(row.id) ?? false;
                            const g = CAPABILITY_GLOSS[row.id];
                            const derived = row.bound !== undefined;
                            const [provides, requires] = halves(
                                row.description.replace(/^PROVIDES:\s*/, ""),
                                "REQUIRES:"
                            );
                            const offers = related(
                                cards,
                                "provides",
                                row.id,
                                card.cardId,
                                2
                            );
                            const needs = related(
                                cards,
                                "requires",
                                row.id,
                                card.cardId,
                                2
                            );
                            return (
                                <div
                                    key={row.id}
                                    style={{ gridTemplateColumns: CAP_COLS }}
                                    className={
                                        "grid items-center gap-2 rounded-sm px-1 py-0.5 " +
                                        (prov || req
                                            ? "bg-surface-elevated/40"
                                            : "hover:bg-surface-elevated/30")
                                    }
                                >
                                    {derived ? (
                                        <span
                                            className="inline-flex h-5 w-5 items-center justify-center text-[10px] text-text-disabled"
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
                                    <span
                                        className={
                                            "truncate font-mono text-xs " +
                                            (prov || req
                                                ? "text-parchment"
                                                : "text-text")
                                        }
                                    >
                                        {row.id}
                                    </span>
                                    <span
                                        className="truncate text-[11px] text-text-muted"
                                        title={g?.provides}
                                    >
                                        {g?.provides}
                                    </span>
                                    <HelpTip
                                        first={{
                                            label: `Provides · e.g. ${g?.example.provider ?? ""}`,
                                            text: provides,
                                            tone: "text-success-strong",
                                        }}
                                        second={{
                                            label: `Requires · e.g. ${g?.example.requirer ?? ""}`,
                                            text: requires,
                                            tone: "text-secondary-accent-strong",
                                        }}
                                    />
                                    <span className="flex items-center justify-end gap-1.5">
                                        <Related
                                            cards={offers}
                                            onPeek={onPeek}
                                        />
                                        <span className="h-4 w-px bg-border-subtle/40" />
                                        <Related
                                            cards={needs}
                                            onPeek={onPeek}
                                        />
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                ))}
                <p className="px-1 pt-1.5 text-[10px] text-text-disabled">
                    Empty{" "}
                    <span className="text-secondary-accent-strong">Req</span> is
                    the norm. ∂ = derived, never set by hand. Related cards:
                    hover or right-click for the full preview, click for a peek.
                </p>
            </section>

            {/* Left-click peek */}
            {peek && (
                <button
                    type="button"
                    aria-label="Close peek"
                    onClick={() => setPeek(null)}
                    className="fixed inset-0 z-modal cursor-default bg-transparent"
                >
                    <span
                        className="absolute block w-56 overflow-hidden rounded-md shadow-2xl ring-1 ring-border-subtle/60"
                        style={{
                            left: Math.min(
                                peek.x + 12,
                                window.innerWidth - 240
                            ),
                            top: Math.min(
                                peek.y - 160,
                                window.innerHeight - 330
                            ),
                        }}
                    >
                        <span className="relative block aspect-5/7 w-full">
                            <CardImage
                                card={{ id: peek.card.cardId }}
                                sizes="224px"
                            />
                        </span>
                    </span>
                </button>
            )}
        </div>
    );
}
