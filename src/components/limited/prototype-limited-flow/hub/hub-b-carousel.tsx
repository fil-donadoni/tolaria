// PROTOTYPE — throwaway. Variant B: horizontal "now playing" poster carousel, then board-like rails.
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
    SectionTitle,
    SimToggle,
    useHub,
    type HubEvent,
} from "./hub-shared";

function Poster({ e }: { e: HubEvent }) {
    return (
        <div className="relative isolate flex h-[400px] w-[82vw] max-w-[340px] shrink-0 snap-center flex-col justify-end overflow-hidden rounded-2xl border border-accent/50 sm:w-[340px]">
            <Art feature={e.feature} className="absolute inset-0 -z-10" />
            <Scrim className="-z-10" />
            <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
                <PhaseChip phase={e.phase} />
                <Pips colors={e.colors} className="size-5" />
            </div>
            <div className="flex flex-col gap-3 p-4">
                <div>
                    <div className="font-display text-3xl leading-none text-parchment">
                        {eventName(e)}
                    </div>
                    <div className="mt-1 text-sm text-parchment/85">
                        {e.detail}
                    </div>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                    {e.stats?.map(([k, v]) => (
                        <div
                            key={k}
                            className="rounded-md bg-black/50 px-2 py-1"
                        >
                            <div className="text-[9px] uppercase tracking-widest text-text-muted">
                                {k}
                            </div>
                            <div className="truncate text-sm font-semibold tabular-nums text-parchment">
                                {v}
                            </div>
                        </div>
                    ))}
                </div>
                <CtaButton event={e} big className="w-full" />
            </div>
        </div>
    );
}

function Ticket({ e }: { e: HubEvent }) {
    const free = e.total - e.filled;
    return (
        <div className="flex w-[260px] shrink-0 snap-start overflow-hidden rounded-xl border border-border-strong bg-surface-base/70">
            <Art feature={e.feature} className="w-20 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
                <div className="truncate font-display text-base text-parchment">
                    {eventName(e)}
                </div>
                <div className="text-[11px] text-text-muted">
                    {e.format} · {e.host}
                </div>
                <SeatDots filled={e.filled} total={e.total} />
                <div className="mt-1 flex items-center justify-between">
                    <span className="text-xs text-parchment">{free} free</span>
                    <JoinButton event={e} className="px-3 py-1 text-xs" />
                </div>
            </div>
        </div>
    );
}

export default function HubCarousel() {
    const { count, setCount, view, setView, mine, counts } = useHub();
    const show = (e: HubEvent) => view === "all" || view === e.phase;
    const myShown = mine.filter(show);
    const openShown = OPEN.filter(show);
    const hist = view === "history";
    const rail =
        "-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none]";

    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
            <PageHeader
                aside={<SimToggle count={count} setCount={setCount} />}
            />
            <ChipBar view={view} setView={setView} counts={counts} />

            {hist ? (
                <>
                    <SectionTitle aside="swipe →">History</SectionTitle>
                    <div className={rail}>
                        {HISTORY.map((h) => (
                            <div
                                key={h.id}
                                className="relative isolate flex h-[190px] w-[170px] shrink-0 snap-start flex-col justify-between overflow-hidden rounded-xl border border-border-strong p-3"
                            >
                                <Art
                                    feature={h.feature}
                                    className="absolute inset-0 -z-10 saturate-50"
                                />
                                <Scrim className="-z-10" />
                                <div className="flex items-start justify-between">
                                    <ResultBadge h={h} />
                                    <Pips
                                        colors={h.colors}
                                        className="size-4"
                                    />
                                </div>
                                <div>
                                    <div
                                        className={cn(
                                            "text-[11px] font-bold uppercase tracking-wider",
                                            h.won
                                                ? "text-amber-300"
                                                : "text-parchment/80"
                                        )}
                                    >
                                        {h.place}
                                    </div>
                                    <div className="font-display text-base leading-tight text-parchment">
                                        {h.source} {h.kind}
                                    </div>
                                    <div className="text-[11px] text-text-muted">
                                        {h.date}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            ) : (
                <>
                    {(view === "all" || myShown.length > 0) && (
                        <>
                            <SectionTitle
                                aside={myShown.length ? "swipe →" : undefined}
                            >
                                Now playing
                            </SectionTitle>
                            {myShown.length === 0 ? (
                                <EmptyHero />
                            ) : (
                                <div className={rail}>
                                    {myShown.map((e) => (
                                        <Poster key={e.id} e={e} />
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                    <SectionTitle aside={`${openShown.length} tables`}>
                        Open tables
                    </SectionTitle>
                    <div className={rail}>
                        <CreateTile
                            compact
                            className="h-auto w-[150px] shrink-0 snap-start"
                        />
                        {openShown.map((e) => (
                            <Ticket key={e.id} e={e} />
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
                                        all
                                    </button>
                                }
                            >
                                Recent results
                            </SectionTitle>
                            <div className={rail}>
                                {HISTORY.map((h) => (
                                    <div
                                        key={h.id}
                                        className="flex w-[210px] shrink-0 snap-start items-center gap-3 rounded-full border border-border-strong bg-surface-base/60 py-1.5 pl-1.5 pr-4"
                                    >
                                        <Art
                                            feature={h.feature}
                                            className="size-10 shrink-0 rounded-full"
                                        />
                                        <div className="min-w-0">
                                            <div className="truncate text-xs font-semibold text-parchment">
                                                {h.source}
                                            </div>
                                            <div className="text-[11px] text-text-muted">
                                                <b
                                                    className={
                                                        h.won
                                                            ? "text-amber-300"
                                                            : "text-parchment"
                                                    }
                                                >
                                                    {h.record}
                                                </b>{" "}
                                                · {h.place}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </>
            )}
        </div>
    );
}
