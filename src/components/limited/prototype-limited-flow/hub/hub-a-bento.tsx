// PROTOTYPE — throwaway. Variant A: bento grid, big hero tile for the first event.
import { cn } from "~/lib/utils";
import {
    Art,
    ChipBar,
    CtaButton,
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
    SectionTitle,
    SimToggle,
    useHub,
    type HubEvent,
    type HistoryEvent,
} from "./hub-shared";

function Hero({ e, big }: { e: HubEvent; big?: boolean }) {
    return (
        <div
            className={cn(
                "relative isolate flex flex-col justify-end overflow-hidden rounded-[var(--panel-radius)] border border-accent/50 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]",
                big
                    ? "min-h-[340px] lg:col-span-2 lg:row-span-2"
                    : "min-h-[200px] lg:col-span-2"
            )}
        >
            <Art feature={e.feature} className="absolute inset-0 -z-10" />
            <Scrim className="-z-10" />
            <div className="flex items-start justify-between p-4">
                <PhaseChip phase={e.phase} />
                <Pips colors={e.colors} className="size-5" />
            </div>
            <div className="mt-auto flex flex-col gap-3 p-4 pt-16">
                <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-parchment/80">
                        Your event · {e.format}
                    </div>
                    <div
                        className={cn(
                            "font-display leading-none text-parchment drop-shadow",
                            big ? "text-4xl" : "text-2xl"
                        )}
                    >
                        {eventName(e)}
                    </div>
                    <div className="mt-1.5 text-sm text-parchment/85">
                        {e.detail}
                    </div>
                </div>
                {big && (
                    <div className="flex flex-wrap gap-2">
                        {e.stats?.map(([k, v]) => (
                            <div
                                key={k}
                                className="rounded-md bg-black/45 px-2.5 py-1 backdrop-blur"
                            >
                                <div className="text-[9px] uppercase tracking-widest text-text-muted">
                                    {k}
                                </div>
                                <div className="text-sm font-semibold tabular-nums text-parchment">
                                    {v}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                <div className="flex items-center gap-3">
                    <CtaButton
                        event={e}
                        big={big}
                        className="flex-1 sm:flex-none"
                    />
                    {!big && (
                        <span className="text-xs text-parchment/80">
                            {e.stats?.[0]?.join(" ")}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

function OpenTile({ e }: { e: HubEvent }) {
    const free = e.total - e.filled;
    return (
        <div className="relative isolate flex min-h-[210px] flex-col justify-end overflow-hidden rounded-[var(--panel-radius)] border border-border-strong">
            <Art
                feature={e.feature}
                className="absolute inset-0 -z-10 opacity-90"
            />
            <Scrim className="-z-10" />
            <div className="absolute left-3 top-3">
                <PhaseChip phase="open" />
            </div>
            <div className="flex flex-col gap-2 p-3">
                <div>
                    <div className="font-display text-xl leading-tight text-parchment">
                        {eventName(e)}
                    </div>
                    <div className="text-[11px] text-text-muted">
                        {e.format} · host {e.host}
                    </div>
                </div>
                <SeatDots filled={e.filled} total={e.total} />
                <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-parchment">
                        {free} seat{free === 1 ? "" : "s"} free
                    </span>
                    <JoinButton event={e} />
                </div>
            </div>
        </div>
    );
}

function HistoryTile({ h }: { h: HistoryEvent }) {
    return (
        <div className="relative isolate flex min-h-[120px] flex-col justify-between overflow-hidden rounded-[var(--panel-radius)] border border-border-strong p-3">
            <Art
                feature={h.feature}
                className="absolute inset-0 -z-10 opacity-70 saturate-50"
            />
            <Scrim className="-z-10" />
            <div className="flex items-start justify-between">
                <ResultBadge h={h} />
                <Pips colors={h.colors} className="size-4" />
            </div>
            <div>
                <div className="font-display text-base leading-tight text-parchment">
                    {h.source} {h.kind}
                </div>
                <div className="text-[11px] text-parchment/80">
                    {h.place} · {h.date}
                </div>
            </div>
        </div>
    );
}

function NewEventButton() {
    return (
        <button
            type="button"
            onClick={() => console.log("[proto] New event")}
            className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 font-display text-base font-semibold text-surface-base shadow-[0_0_24px_-4px_var(--color-accent)] transition hover:scale-[1.03]"
        >
            <span className="text-xl leading-none">+</span> New event
        </button>
    );
}

/** Zero events in progress: the whole hero becomes the call to start one. */
function StartHero() {
    return (
        <div className="relative isolate flex min-h-[300px] flex-col justify-end overflow-hidden rounded-[var(--panel-radius)] border border-accent/60 sm:col-span-2 lg:col-span-4">
            <Art feature="Black Lotus" className="absolute inset-0 -z-10" />
            <Scrim className="-z-10" />
            <div className="flex flex-col gap-3 p-5 sm:p-7">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-parchment/80">
                    No event in progress
                </span>
                <span className="font-display text-3xl leading-none text-parchment drop-shadow sm:text-5xl">
                    Start a Draft
                </span>
                <span className="max-w-md text-sm text-parchment/85">
                    Vintage Cube, 8 seats, bots fill the empty ones. Ready in
                    one click — or change anything first.
                </span>
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={() => console.log("[proto] Quick start")}
                        className="rounded-full bg-accent px-6 py-3 font-display text-lg font-semibold text-surface-base shadow-[0_0_32px_-4px_var(--color-accent)] transition hover:scale-[1.03]"
                    >
                        Start Vintage Cube Draft
                    </button>
                    <button
                        type="button"
                        onClick={() => console.log("[proto] Customise")}
                        className="rounded-full border border-parchment/50 bg-black/40 px-5 py-3 text-sm font-semibold text-parchment backdrop-blur hover:border-parchment"
                    >
                        Customise…
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function HubBento() {
    const { count, setCount, view, setView, mine, counts } = useHub();
    const show = (e: HubEvent) => view === "all" || view === e.phase;
    const myShown = mine.filter(show);
    const openShown = OPEN.filter(show);
    const hist = view === "history";

    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
            <PageHeader aside={<NewEventButton />} />
            <div className="-mt-2 flex justify-end">
                <SimToggle count={count} setCount={setCount} />
            </div>
            <ChipBar view={view} setView={setView} counts={counts} />

            {hist ? (
                <>
                    <SectionTitle aside="closed events">History</SectionTitle>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                        {HISTORY.map((h) => (
                            <HistoryTile key={h.id} h={h} />
                        ))}
                    </div>
                </>
            ) : (
                <>
                    {myShown.length > 0 && (
                        <SectionTitle aside={`${myShown.length} in progress`}>
                            Your events
                        </SectionTitle>
                    )}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:auto-rows-[minmax(110px,auto)]">
                        {count === 0 && view === "all" && <StartHero />}
                        {myShown.map((e, i) => (
                            <Hero key={e.id} e={e} big={i === 0} />
                        ))}
                        {myShown.length > 0 && myShown.length < 3 && (
                            <div className="hidden" />
                        )}
                    </div>
                    <SectionTitle
                        aside={`${openShown.length} waiting for players`}
                    >
                        Join a table
                    </SectionTitle>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {openShown.map((e) => (
                            <OpenTile key={e.id} e={e} />
                        ))}
                    </div>
                    {view === "all" && (
                        <>
                            <SectionTitle
                                aside={
                                    <button
                                        type="button"
                                        className="underline"
                                        onClick={() => setView("history")}
                                    >
                                        see all
                                    </button>
                                }
                            >
                                Recent results
                            </SectionTitle>
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                                {HISTORY.slice(0, 3).map((h) => (
                                    <HistoryTile key={h.id} h={h} />
                                ))}
                            </div>
                        </>
                    )}
                </>
            )}
        </div>
    );
}
