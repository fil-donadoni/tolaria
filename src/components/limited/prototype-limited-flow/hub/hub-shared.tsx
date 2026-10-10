// PROTOTYPE — throwaway. Shared mock data + small parts for the /limited hub variants.
import { useState, type ReactNode } from "react";
import { cn } from "~/lib/utils";
import ManaSymbol from "~/components/cards/mana-symbol";
import FeaturedDeckArt from "~/components/lobby/featured-deck-art";
import { protoCard } from "../proto-cards";

export type Phase = "open" | "drafting" | "building" | "playing";

export interface HubEvent {
    id: string;
    source: string; // Pack Source display name
    feature: string; // Feature Card name
    kind: "Draft" | "Sealed";
    format: "Bo1" | "Bo3";
    phase: Phase;
    filled: number;
    total: number;
    mine?: boolean;
    host?: string;
    /** one-liner for the phase (mine) */
    detail?: string;
    /** secondary stat chips (mine) */
    stats?: [string, string][];
    colors?: string[];
}

export interface HistoryEvent {
    id: string;
    source: string;
    feature: string;
    kind: "Draft" | "Sealed";
    record: string;
    place: string;
    date: string;
    colors: string[];
    won: boolean;
}

export const SOURCE_FEATURE: Record<string, string> = {
    "Vintage Cube": "Black Lotus",
    "Limited Edition Alpha": "Mox Sapphire",
    "Ice Age": "Necropotence",
    "The Dark": "Maze of Ith",
    Invasion: "Fact or Fiction",
    "Invasion Block": "Dromar, the Banisher",
};

export const artId = (feature: string) => protoCard(feature).id;

export const MINE: HubEvent[] = [
    {
        id: "m1",
        source: "Vintage Cube",
        feature: "Black Lotus",
        kind: "Draft",
        format: "Bo3",
        phase: "playing",
        filled: 8,
        total: 8,
        mine: true,
        detail: "Round 2 of 3 — vs Marta, table 2",
        stats: [
            ["Record", "1–0"],
            ["Seat", "#3"],
            ["Deadline", "Fri 21:00"],
        ],
        colors: ["U", "B"],
    },
    {
        id: "m2",
        source: "Invasion Block",
        feature: "Dromar, the Banisher",
        kind: "Draft",
        format: "Bo1",
        phase: "drafting",
        filled: 8,
        total: 8,
        mine: true,
        detail: "Pack 2, pick 5 of 45 — pack passes right",
        stats: [
            ["Pick", "19 / 45"],
            ["Seat", "#6"],
            ["Timer", "0:42"],
        ],
    },
    {
        id: "m3",
        source: "Limited Edition Alpha",
        feature: "Mox Sapphire",
        kind: "Sealed",
        format: "Bo1",
        phase: "building",
        filled: 6,
        total: 6,
        mine: true,
        detail: "Pool opened — 90 cards, 40 min to submit",
        stats: [
            ["Pool", "90"],
            ["Deck", "23 / 40"],
            ["Deadline", "38 min"],
        ],
        colors: ["U", "R"],
    },
];

export const OPEN: HubEvent[] = [
    {
        id: "o1",
        source: "Vintage Cube",
        feature: "Black Lotus",
        kind: "Draft",
        format: "Bo3",
        phase: "open",
        filled: 5,
        total: 8,
        host: "Marta",
    },
    {
        id: "o2",
        source: "Ice Age",
        feature: "Necropotence",
        kind: "Draft",
        format: "Bo1",
        phase: "open",
        filled: 2,
        total: 8,
        host: "Giulio",
    },
    {
        id: "o3",
        source: "The Dark",
        feature: "Maze of Ith",
        kind: "Sealed",
        format: "Bo1",
        phase: "open",
        filled: 3,
        total: 4,
        host: "Sofia",
    },
    {
        id: "o4",
        source: "Invasion",
        feature: "Fact or Fiction",
        kind: "Draft",
        format: "Bo3",
        phase: "open",
        filled: 7,
        total: 8,
        host: "Luca",
    },
];

export const HISTORY: HistoryEvent[] = [
    {
        id: "h1",
        source: "Vintage Cube",
        feature: "Black Lotus",
        kind: "Draft",
        record: "2–1",
        place: "3rd of 8",
        date: "Oct 4",
        colors: ["W", "U"],
        won: false,
    },
    {
        id: "h2",
        source: "Ice Age",
        feature: "Necropotence",
        kind: "Draft",
        record: "3–0",
        place: "1st of 8",
        date: "Sep 28",
        colors: ["B", "G"],
        won: true,
    },
    {
        id: "h3",
        source: "Limited Edition Alpha",
        feature: "Mox Sapphire",
        kind: "Sealed",
        record: "1–2",
        place: "6th of 8",
        date: "Sep 21",
        colors: ["R"],
        won: false,
    },
    {
        id: "h4",
        source: "Invasion",
        feature: "Fact or Fiction",
        kind: "Draft",
        record: "2–1",
        place: "2nd of 6",
        date: "Sep 12",
        colors: ["U", "G"],
        won: false,
    },
    {
        id: "h5",
        source: "The Dark",
        feature: "Maze of Ith",
        kind: "Sealed",
        record: "3–0",
        place: "1st of 4",
        date: "Aug 30",
        colors: ["B", "R"],
        won: true,
    },
    {
        id: "h6",
        source: "Invasion Block",
        feature: "Dromar, the Banisher",
        kind: "Draft",
        record: "0–3",
        place: "8th of 8",
        date: "Aug 17",
        colors: ["W", "B"],
        won: false,
    },
];

export const PHASE_LABEL: Record<Phase, string> = {
    open: "Open",
    drafting: "Drafting",
    building: "Building",
    playing: "Playing",
};

export const PHASE_TONE: Record<Phase, string> = {
    open: "bg-emerald-500/20 text-emerald-200 border-emerald-400/40",
    drafting: "bg-sky-500/20 text-sky-200 border-sky-400/40",
    building: "bg-amber-500/20 text-amber-200 border-amber-400/40",
    playing: "bg-rose-500/20 text-rose-200 border-rose-400/40",
};

export function ctaFor(e: HubEvent): { label: string; disabled?: boolean } {
    if (e.phase === "drafting") return { label: "Enter draft room" };
    if (e.phase === "building") return { label: "Build your deck" };
    if (e.phase === "playing") return { label: "Play round 2" };
    return { label: `Waiting — ${e.filled}/${e.total} seats`, disabled: true };
}

export const eventName = (e: { source: string; kind: string }) =>
    `${e.source} ${e.kind}`;

export function PhaseChip({
    phase,
    className,
}: {
    phase: Phase;
    className?: string;
}) {
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
                PHASE_TONE[phase],
                className
            )}
        >
            <span
                className={cn(
                    "size-1.5 rounded-full bg-current",
                    phase !== "open" && "animate-pulse"
                )}
            />
            {PHASE_LABEL[phase]}
        </span>
    );
}

export function Pips({
    colors,
    className = "size-4",
}: {
    colors?: string[];
    className?: string;
}) {
    if (!colors || colors.length === 0) return null;
    return (
        <span className="inline-flex gap-0.5">
            {colors.map((c) => (
                <ManaSymbol key={c} symbol={c} className={className} />
            ))}
        </span>
    );
}

/** Row of seat dots: filled vs free. */
export function SeatDots({ filled, total }: { filled: number; total: number }) {
    return (
        <span
            className="inline-flex items-center gap-1"
            aria-label={`${filled} of ${total} seats`}
        >
            {Array.from({ length: total }, (_, i) => (
                <span
                    key={i}
                    className={cn(
                        "size-2 rounded-full",
                        i < filled
                            ? "bg-parchment"
                            : "border border-parchment/50"
                    )}
                />
            ))}
        </span>
    );
}

export function Art({
    feature,
    className,
}: {
    feature: string;
    className?: string;
}) {
    return (
        <FeaturedDeckArt
            featuredCardId={artId(feature)}
            className={className}
        />
    );
}

export function Scrim({ className }: { className?: string }) {
    return (
        <span
            aria-hidden
            className={cn("pointer-events-none absolute inset-0", className)}
            style={{
                background:
                    "linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.3) 40%, rgba(0,0,0,0.9) 100%)",
            }}
        />
    );
}

export function CtaButton({
    event,
    className,
    big,
}: {
    event: HubEvent;
    className?: string;
    big?: boolean;
}) {
    const c = ctaFor(event);
    return (
        <button
            type="button"
            disabled={c.disabled}
            onClick={() => console.log("[proto] CTA", event.id, c.label)}
            className={cn(
                "rounded-md bg-accent font-semibold text-surface-base shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-surface-elevated disabled:text-text-muted",
                big ? "px-6 py-3 text-base" : "px-4 py-2 text-sm",
                className
            )}
        >
            {c.label}
        </button>
    );
}

export function JoinButton({
    event,
    className,
}: {
    event: HubEvent;
    className?: string;
}) {
    return (
        <button
            type="button"
            onClick={() => console.log("[proto] Join", event.id)}
            className={cn(
                "rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-surface-base transition hover:brightness-110",
                className
            )}
        >
            Join
        </button>
    );
}

export function SectionTitle({
    children,
    aside,
}: {
    children: ReactNode;
    aside?: ReactNode;
}) {
    return (
        <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-lg tracking-wide text-parchment">
                {children}
            </h2>
            {aside && <span className="text-xs text-text-muted">{aside}</span>}
        </div>
    );
}

export type View = "all" | Phase | "history";
export const VIEWS: { key: View; label: string }[] = [
    { key: "all", label: "All" },
    { key: "open", label: "Open" },
    { key: "drafting", label: "Drafting" },
    { key: "building", label: "Building" },
    { key: "playing", label: "Playing" },
    { key: "history", label: "History" },
];

/** Local state: how many of my events are in progress (0 / 1 / 3) + status view. */
export function useHub(initialView: View = "all") {
    const [count, setCount] = useState(3);
    const [view, setView] = useState<View>(initialView);
    const mine = MINE.slice(0, count);
    const counts: Record<string, number> = {
        all: mine.length + OPEN.length,
        history: HISTORY.length,
    };
    for (const p of ["open", "drafting", "building", "playing"] as Phase[])
        counts[p] = [...mine, ...OPEN].filter((e) => e.phase === p).length;
    return { count, setCount, view, setView, mine, counts };
}

export function ChipBar({
    view,
    setView,
    counts,
    className,
}: {
    view: View;
    setView: (v: View) => void;
    counts: Record<string, number>;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]",
                className
            )}
        >
            {VIEWS.map((v) => (
                <button
                    key={v.key}
                    type="button"
                    onClick={() => setView(v.key)}
                    className={cn(
                        "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                        v.key === "history" && "ml-auto",
                        view === v.key
                            ? "border-accent bg-accent/20 text-parchment"
                            : "border-border-strong bg-surface-base/60 text-text-muted hover:text-parchment"
                    )}
                >
                    {v.label}
                    <span className="rounded-full bg-black/30 px-1.5 text-[10px]">
                        {counts[v.key] ?? 0}
                    </span>
                </button>
            ))}
        </div>
    );
}

export function SimToggle({
    count,
    setCount,
}: {
    count: number;
    setCount: (n: number) => void;
}) {
    return (
        <div className="flex items-center gap-2 self-end rounded-full border border-dashed border-fuchsia-500/50 px-2 py-1 text-[10px] text-fuchsia-200">
            simulate: my events in progress
            {[0, 1, 3].map((n) => (
                <button
                    key={n}
                    type="button"
                    onClick={() => setCount(n)}
                    className={cn(
                        "rounded-full px-2 py-0.5 font-semibold",
                        count === n
                            ? "bg-fuchsia-600 text-white"
                            : "text-fuchsia-200"
                    )}
                >
                    {n}
                </button>
            ))}
        </div>
    );
}

export function PageHeader({ aside }: { aside?: ReactNode }) {
    return (
        <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
                <h1 className="font-display text-3xl leading-none text-parchment">
                    Limited
                </h1>
                <p className="mt-1 text-xs text-text-muted">
                    Draft and Sealed events with friends and bots.
                </p>
            </div>
            {aside}
        </div>
    );
}

/** Empty "nothing in progress" hero. */
export function EmptyHero({ className }: { className?: string }) {
    return (
        <div
            className={cn(
                "relative isolate flex min-h-[200px] flex-col justify-end overflow-hidden rounded-[var(--panel-radius)] border border-dashed border-border-strong p-5",
                className
            )}
        >
            <Art
                feature="Black Lotus"
                className="absolute inset-0 -z-10 opacity-40 grayscale"
            />
            <Scrim className="-z-10" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                Nothing in progress
            </span>
            <span className="font-display text-2xl text-parchment">
                You are not in any event
            </span>
            <span className="mt-1 text-sm text-text-muted">
                Join an open table below, or start your own.
            </span>
        </div>
    );
}

export function CreateTile({
    className,
    compact,
}: {
    className?: string;
    compact?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={() => console.log("[proto] Create event")}
            className={cn(
                "group flex flex-col items-center justify-center gap-2 rounded-[var(--panel-radius)] border-2 border-dashed border-accent/50 bg-accent/5 p-4 text-parchment transition hover:border-accent hover:bg-accent/10",
                className
            )}
        >
            <span className="grid size-10 place-items-center rounded-full bg-accent text-2xl font-bold leading-none text-surface-base transition group-hover:scale-110">
                +
            </span>
            <span className="font-display text-lg">Create event</span>
            {!compact && (
                <span className="text-center text-xs text-text-muted">
                    Draft or Sealed · pick a Pack Source · seats, bots, timers
                </span>
            )}
        </button>
    );
}

export function ResultBadge({ h }: { h: HistoryEvent }) {
    return (
        <span
            className={cn(
                "rounded px-1.5 py-0.5 text-xs font-bold tabular-nums",
                h.won ? "bg-amber-400 text-black" : "bg-black/60 text-parchment"
            )}
        >
            {h.record}
        </span>
    );
}
