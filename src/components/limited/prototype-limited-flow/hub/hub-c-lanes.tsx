// PROTOTYPE — throwaway. Variant C: phase lanes (kanban on desktop, one lane at a time on phones).
import { cn } from "~/lib/utils";
import {
    Art,
    ChipBar,
    CreateTile,
    CtaButton,
    EmptyHero,
    eventName,
    HISTORY,
    JoinButton,
    OPEN,
    PageHeader,
    PhaseChip,
    Pips,
    ResultBadge,
    Scrim,
    SeatDots,
    SimToggle,
    useHub,
    PHASE_LABEL,
    type HubEvent,
    type Phase,
    type View,
} from "./hub-shared";

const LANES: Phase[] = ["open", "drafting", "building", "playing"];

function Card({ e }: { e: HubEvent }) {
    const mine = !!e.mine;
    return (
        <div
            className={cn(
                "relative isolate overflow-hidden rounded-xl border",
                mine
                    ? "border-accent shadow-[0_0_24px_-6px] shadow-accent/50"
                    : "border-border-strong"
            )}
        >
            <Art
                feature={e.feature}
                className={cn("absolute inset-0 -z-10", !mine && "opacity-60")}
            />
            <Scrim className="-z-10" />
            <div
                className={cn(
                    "flex flex-col gap-2 p-3",
                    mine ? "pt-20" : "pt-10"
                )}
            >
                {mine && (
                    <span className="absolute left-3 top-3 rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-surface-base">
                        You
                    </span>
                )}
                {mine && (
                    <Pips
                        colors={e.colors}
                        className="absolute right-3 top-3 size-5"
                    />
                )}
                <div className="font-display text-lg leading-tight text-parchment">
                    {eventName(e)}
                </div>
                <div className="text-xs text-parchment/85">
                    {mine ? e.detail : `${e.format} · host ${e.host}`}
                </div>
                {mine ? (
                    <CtaButton event={e} className="w-full" />
                ) : (
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-col gap-1">
                            <SeatDots filled={e.filled} total={e.total} />
                            <span className="text-[11px] text-text-muted">
                                {e.total - e.filled} free
                            </span>
                        </div>
                        <JoinButton event={e} />
                    </div>
                )}
            </div>
        </div>
    );
}

export default function HubLanes() {
    const { count, setCount, view, setView, mine, counts } = useHub();
    const all = [...mine, ...OPEN];
    const lane = (view === "all" ? "playing" : view) as View;
    const hist = view === "history";

    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
            <PageHeader
                aside={<SimToggle count={count} setCount={setCount} />}
            />
            <ChipBar view={view} setView={setView} counts={counts} />
            <p className="-mt-2 text-[11px] text-text-muted lg:hidden">
                Pick a status above — on a wide screen all lanes show side by
                side.
            </p>

            {count === 0 && !hist && <EmptyHero className="min-h-[150px]" />}

            {hist ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {HISTORY.map((h) => (
                        <div
                            key={h.id}
                            className="flex items-center gap-3 overflow-hidden rounded-xl border border-border-strong bg-surface-base/60 pr-3"
                        >
                            <div className="relative h-16 w-24 shrink-0">
                                <Art
                                    feature={h.feature}
                                    className="absolute inset-0 saturate-50"
                                />
                                <Scrim />
                                <span className="absolute bottom-1 left-1.5">
                                    <ResultBadge h={h} />
                                </span>
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="truncate font-display text-base text-parchment">
                                    {h.source} {h.kind}
                                </div>
                                <div
                                    className={cn(
                                        "text-xs",
                                        h.won
                                            ? "font-bold text-amber-300"
                                            : "text-text-muted"
                                    )}
                                >
                                    {h.place} · {h.date}
                                </div>
                            </div>
                            <Pips colors={h.colors} className="size-4" />
                        </div>
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                    {LANES.map((p) => {
                        const items = all.filter((e) => e.phase === p);
                        const sel =
                            view === p || (view === "all" && p === "playing");
                        return (
                            <section
                                key={p}
                                className={cn(
                                    "flex-col gap-3 rounded-2xl bg-surface-base/40 p-2.5 lg:flex",
                                    sel ? "flex" : "hidden"
                                )}
                            >
                                <header className="flex items-center justify-between px-1">
                                    <PhaseChip phase={p} />
                                    <span className="text-xs text-text-muted">
                                        {items.length}
                                    </span>
                                </header>
                                {items.map((e) => (
                                    <Card key={e.id} e={e} />
                                ))}
                                {items.length === 0 && (
                                    <div className="rounded-xl border border-dashed border-border-strong p-4 text-center text-xs text-text-muted">
                                        No {PHASE_LABEL[p].toLowerCase()} events
                                    </div>
                                )}
                                {p === "open" && (
                                    <CreateTile
                                        compact
                                        className="min-h-[110px]"
                                    />
                                )}
                            </section>
                        );
                    })}
                </div>
            )}
            {!hist && view === "all" && lane && (
                <p className="text-center text-[11px] text-text-muted lg:hidden">
                    Showing Playing — tap Open / Drafting / Building for other
                    lanes.
                </p>
            )}
        </div>
    );
}
