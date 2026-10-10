// PROTOTYPE — throwaway. Variant A: bento grid, big hero tile for the first event.
import { getArtCropImageUrl } from "~/lib/images";
import { cn } from "~/lib/utils";
import {
    Art,
    artId,
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

type HeroSize = "big" | "wide" | "small";

function Hero({ e, size }: { e: HubEvent; size: HeroSize }) {
    const big = size !== "small";
    return (
        <div
            className={cn(
                "relative isolate flex flex-col justify-end overflow-hidden rounded-[var(--panel-radius)] border border-accent/50 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]",
                size === "big" && "min-h-[340px] lg:col-span-2 lg:row-span-2",
                size === "wide" && "min-h-[256px] sm:col-span-2",
                size === "small" && "min-h-[240px] sm:col-span-2"
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

/** Last event the user created (localStorage in the real thing); first
 *  visit falls back to the default setup. */
const LAST_SETUP = {
    feature: "Black Lotus",
    name: "Vintage Cube Draft",
    meta: "8 seats · Bo3 · pick timer on",
};

/** The New-event bento: a solid parchment tile, the one light surface on a
 *  page of artwork — it wins the eye by contrast, not by size.
 *  `tile`: last cell of Your events, same height as an event tile.
 *  `side`: no event in progress — a third of the row, beside Join a table. */
function NewEventBento({ layout }: { layout: "tile" | "side" }) {
    const side = layout === "side";
    return (
        <div
            className={cn(
                "flex h-full flex-col gap-4 rounded-[var(--panel-radius)] bg-parchment p-5 text-surface-base shadow-[0_8px_40px_-12px_rgba(0,0,0,0.6)]",
                side ? "min-h-[300px]" : "min-h-[240px] sm:col-span-2"
            )}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-60">
                        {side ? "Nothing in progress" : "New event"}
                    </span>
                    <span
                        className={cn(
                            "font-display leading-none",
                            side ? "text-4xl" : "text-3xl"
                        )}
                    >
                        {side ? "Start an event" : "Start another"}
                    </span>
                </div>
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-base text-2xl leading-none text-parchment">
                    +
                </span>
            </div>
            {side && (
                <span className="text-sm opacity-70">
                    Bots fill every empty seat — you can draft right now.
                </span>
            )}
            <div
                className={cn("mt-auto flex flex-col gap-2", side && "flex-1")}
            >
                {side ? (
                    <button
                        type="button"
                        onClick={() => console.log("[proto] Quick start last")}
                        className="group relative isolate flex min-h-[170px] flex-1 flex-col justify-end overflow-hidden rounded-xl text-left text-parchment transition hover:scale-[1.01]"
                    >
                        <img
                            src={getArtCropImageUrl(artId(LAST_SETUP.feature))}
                            alt=""
                            className="absolute inset-0 -z-10 h-full w-full object-cover"
                        />
                        <span className="absolute inset-0 -z-10 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
                        <span className="flex items-end justify-between gap-3 p-3">
                            <span className="flex min-w-0 flex-col">
                                <span className="text-[10px] uppercase tracking-widest text-parchment/75">
                                    Again: your last event
                                </span>
                                <span className="truncate font-display text-xl leading-tight">
                                    {LAST_SETUP.name}
                                </span>
                                <span className="truncate text-[11px] text-parchment/75">
                                    {LAST_SETUP.meta}
                                </span>
                            </span>
                            <span className="shrink-0 rounded-full bg-parchment px-4 py-1.5 text-sm font-bold text-surface-base">
                                Start
                            </span>
                        </span>
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={() => console.log("[proto] Quick start last")}
                        className="group flex items-center gap-3 rounded-xl bg-surface-base p-2 pr-3 text-left text-parchment transition hover:scale-[1.02]"
                    >
                        <img
                            src={getArtCropImageUrl(artId(LAST_SETUP.feature))}
                            alt=""
                            className="size-12 shrink-0 rounded-lg object-cover"
                        />
                        <span className="flex min-w-0 flex-1 flex-col">
                            <span className="text-[10px] uppercase tracking-widest text-text-muted">
                                Again: your last event
                            </span>
                            <span className="truncate font-display text-base leading-tight">
                                {LAST_SETUP.name}
                            </span>
                            <span className="truncate text-[11px] text-text-muted">
                                {LAST_SETUP.meta}
                            </span>
                        </span>
                        <span className="rounded-full bg-parchment px-3 py-1 text-sm font-bold text-surface-base">
                            Start
                        </span>
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => console.log("[proto] Customise")}
                    className="rounded-xl border-2 border-surface-base/80 px-4 py-2 text-sm font-bold transition hover:bg-surface-base/10"
                >
                    Choose format, seats, timers…
                </button>
            </div>
        </div>
    );
}

/** One event: a wide half-row beside the bento. Two or more: the first is
 *  the 2×2 lead, the rest stack beside it, the bento closes the grid. */
function heroSize(i: number, n: number): HeroSize {
    if (n === 1) return "wide";
    return i === 0 ? "big" : "small";
}

export default function HubBento() {
    const { count, setCount, view, setView, mine, counts } = useHub();
    const show = (e: HubEvent) => view === "all" || view === e.phase;
    const myShown = mine.filter(show);
    const openShown = OPEN.filter(show);
    const hist = view === "history";

    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
            <PageHeader />
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
                        <>
                            <SectionTitle
                                aside={`${myShown.length} in progress`}
                            >
                                Your events
                            </SectionTitle>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:auto-rows-[256px]">
                                {myShown.map((e, i) => (
                                    <Hero
                                        key={e.id}
                                        e={e}
                                        size={heroSize(i, myShown.length)}
                                    />
                                ))}
                                {view === "all" && (
                                    <NewEventBento layout="tile" />
                                )}
                            </div>
                        </>
                    )}
                    <SectionTitle
                        aside={`${openShown.length} waiting for players`}
                    >
                        {myShown.length === 0 && view === "all"
                            ? "Start or join a table"
                            : "Join a table"}
                    </SectionTitle>
                    {myShown.length === 0 && view === "all" ? (
                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                            <NewEventBento layout="side" />
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-2">
                                {openShown.map((e) => (
                                    <OpenTile key={e.id} e={e} />
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {openShown.map((e) => (
                                <OpenTile key={e.id} e={e} />
                            ))}
                        </div>
                    )}
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
