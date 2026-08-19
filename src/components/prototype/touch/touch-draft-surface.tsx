// PROTOTYPE — throwaway. Draft Room phone surface of /prototype/touch.
//
// Two-stop snap (D10). Portrait: pack 85% ↔ pool 85%, the 15% strip is the
// live tab + drop target (SB half = pick to sideboard); picks split Main / SB.
// Landscape (round-2 notes): pack grid 80% | right column 20% = sneak peek of
// the picks as one Arena-style vertical pile + the actions bar UNDER it; on
// swipe the pack collapses to a vertical pile (20%) and the pool expands to
// MV columns (80%). Inspect overlay closes on a tap ANYWHERE except Pick.
import { useMemo, useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { getImageUrl } from "~/lib/images";
import { BUCKETS, bucketOf, draftPack, type ProtoCard } from "./mock-pool";
import { useTouchMoveEngine, type GestureModel } from "./use-touch-move-engine";
import { useLandscape } from "./use-landscape";
import { useGestureLog } from "./use-gesture-log";
import TouchCardTile from "./touch-card-tile";
import TouchPreviewOverlay from "./touch-preview-overlay";
import TouchDragGhost from "./touch-drag-ghost";
import TouchEventLog from "./touch-event-log";

type Stop = "pack" | "pool";

export default function TouchDraftSurface({ model }: { model: GestureModel }) {
    const [pack, setPack] = useState<ProtoCard[]>(draftPack);
    const [picks, setPicks] = useState<{
        main: ProtoCard[];
        side: ProtoCard[];
    }>({ main: [], side: [] });
    const [preview, setPreview] = useState<string | null>(null);
    const [pickNo, setPickNo] = useState(1);
    const [stop, setStop] = useState<Stop>("pack");
    const landscape = useLandscape();
    const { lines, log } = useGestureLog();
    const scroller = useRef<HTMLDivElement>(null);

    const pick = (key: string, to: "main" | "side") => {
        const c = pack.find((x) => x.key === key);
        if (!c) return;
        setPack((p) => p.filter((x) => x.key !== key));
        setPicks((p) => ({ ...p, [to]: [...p[to], c] }));
        setPickNo((n) => n + 1);
        log(`pick ${c.name} → ${to}`);
        engine.select(null);
        setPreview(null);
    };

    const engine = useTouchMoveEngine({
        model,
        onMove: (key, dropId) => {
            if (dropId === "strip:main") pick(key, "main");
            else if (dropId === "strip:side") pick(key, "side");
        },
        onSelect: () => {},
        onPreview: setPreview,
        log,
    });

    const sel = engine.selected
        ? pack.find((c) => c.key === engine.selected)
        : null;
    const dragCard = engine.drag
        ? pack.find((c) => c.key === engine.drag!.key)
        : null;
    const allPicks = useMemo(() => [...picks.main, ...picks.side], [picks]);
    const previewCard = preview
        ? [...pack, ...allPicks].find((c) => c.key === preview)
        : null;
    const overId = engine.drag?.over ?? null;
    const armed = model === "B" && !!engine.selected;
    const timer = `0:${String(41 - pickNo).padStart(2, "0")}`;

    // portrait: pane = 85% of the viewport; landscape: pane = 80%
    const PANE = landscape ? 0.8 : 0.85;
    const STRIP = (1 - PANE) / PANE; // the strip as a fraction of its pane
    const onScroll = () => {
        const el = scroller.current;
        if (!el) return;
        const pos = landscape
            ? el.scrollLeft / el.clientWidth
            : el.scrollTop / el.clientHeight;
        const s: Stop = pos > (1 - PANE) / 2 ? "pool" : "pack";
        if (s !== stop) {
            setStop(s);
            log(`snap → ${s}`);
        }
    };
    const snapTo = (s: Stop) => {
        const el = scroller.current;
        if (!el) return;
        const amt = s === "pool" ? PANE : 0;
        el.scrollTo(
            landscape
                ? { left: amt * el.clientWidth, behavior: "smooth" }
                : { top: amt * el.clientHeight, behavior: "smooth" }
        );
    };
    const paneStyle = landscape
        ? { width: `${PANE * 100}%`, height: "100%" }
        : { height: `${PANE * 100}%`, width: "100%" };
    const along = (frac: number) =>
        landscape
            ? { width: `${frac * 100}%`, height: "100%" }
            : { height: `${frac * 100}%`, width: "100%" };

    const btn = (
        label: string,
        primary: boolean,
        onClick: () => void,
        cls = ""
    ) => (
        <button
            key={label}
            type="button"
            onClick={onClick}
            className={cn(
                "min-h-11 rounded-full border px-3 font-beleren text-[13px]",
                primary
                    ? "border-accent bg-accent text-surface-base"
                    : "border-accent/50 bg-surface-elevated text-accent-strong",
                cls
            )}
        >
            {label}
        </button>
    );
    const actions = sel ? (
        <div className={cn("flex gap-1.5", landscape && "flex-col")}>
            {btn("Pick", true, () => pick(sel.key, "main"))}
            {btn("→ SB", false, () => pick(sel.key, "side"))}
            {btn("Inspect", false, () => setPreview(sel.key))}
        </div>
    ) : null;
    const status = (
        <>
            <span className="h-2 w-2 shrink-0 rounded-full bg-signal-pending shadow-[0_0_8px_#fbbf24]" />
            <span className="text-[11px] uppercase tracking-widest text-text-muted">
                pick {pickNo}/15 · {timer}
            </span>
        </>
    );

    const packGrid = (
        <div
            className="grid min-h-0 flex-1 content-start gap-1.5 overflow-y-auto p-2"
            style={{
                gridTemplateColumns: landscape
                    ? "repeat(6,minmax(0,1fr))"
                    : "repeat(3,minmax(0,1fr))",
                overscrollBehavior: "contain",
            }}
        >
            {pack.map((c) => (
                <TouchCardTile
                    key={c.key}
                    card={c}
                    width={9999}
                    selected={engine.selected === c.key}
                    showHandle={model === "C"}
                    cardProps={engine.cardProps(c.key)}
                    handleProps={engine.handleProps(c.key)}
                    className="!w-full"
                />
            ))}
        </div>
    );
    const packHeader = (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-accent/40 bg-surface px-2 text-[11px] uppercase tracking-widest text-text-muted">
            <span>Pack 1 · pick {pickNo}/15</span>
            <span className="flex-1" />
            <span className="font-mono text-signal-pending-strong">
                {timer}
            </span>
            <span className="text-[10px] normal-case tracking-normal">
                model {model}
            </span>
        </div>
    );

    // ---- portrait panes ------------------------------------------------
    const portraitPack = (
        <div className="flex shrink-0 snap-start flex-col" style={paneStyle}>
            {packHeader}
            {packGrid}
            {/* pack status / peek bar = the strip seen from the pool stop */}
            <div
                className="flex shrink-0 items-center gap-2 border-t border-accent/60 bg-surface px-2"
                style={along(STRIP)}
                onClick={() => stop === "pool" && snapTo("pack")}
            >
                {sel ? (
                    <>
                        <img
                            src={getImageUrl(sel.cardId)}
                            alt=""
                            draggable={false}
                            className="w-9 rounded-[6%]"
                        />
                        <div className="min-w-0 flex-1">
                            <div className="truncate font-beleren text-[13px] text-parchment">
                                {sel.name}
                            </div>
                            <div className="text-[10px] text-text-muted">
                                {sel.isLand ? "Land" : `MV ${sel.mv}`}
                            </div>
                        </div>
                        {actions}
                    </>
                ) : (
                    <>
                        {status}
                        <span className="flex-1" />
                        <span className="font-beleren text-[12px] text-accent-strong">
                            {stop === "pool"
                                ? "tap: back to pack"
                                : "tap a card"}
                        </span>
                    </>
                )}
            </div>
        </div>
    );
    const portraitPool = (
        <div className="flex shrink-0 snap-end flex-col" style={paneStyle}>
            <div
                className="flex shrink-0 border-t border-accent/60 bg-surface"
                style={along(STRIP)}
                onClick={() => stop === "pack" && snapTo("pool")}
            >
                <div
                    {...engine.zoneProps("strip:main")}
                    className={cn(
                        "flex flex-1 flex-col items-center justify-center gap-0.5 px-2",
                        overId === "strip:main" && "bg-accent/30",
                        armed && "animate-pulse"
                    )}
                >
                    <span className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-text-muted">
                        {stop === "pack" ? (
                            <svg
                                viewBox="0 0 24 24"
                                className="h-3.5 w-3.5 stroke-accent-strong"
                                style={{
                                    fill: "none",
                                    strokeWidth: 2,
                                    animation:
                                        "protoNudgeY 1.8s ease-in-out infinite",
                                }}
                            >
                                <path d="m6 15 6-6 6 6" />
                            </svg>
                        ) : null}
                        Pool · {picks.main.length}
                    </span>
                    <span className="font-beleren text-[12px] text-accent-strong">
                        {engine.drag ? "drop = pick" : "tap: open pool"}
                    </span>
                </div>
                <div
                    {...engine.zoneProps("strip:side")}
                    className={cn(
                        "flex w-[30%] items-center justify-center border-l border-border-subtle px-2",
                        overId === "strip:side" && "bg-secondary-accent-soft",
                        armed && "animate-pulse"
                    )}
                >
                    <span className="text-[10px] uppercase tracking-widest text-text-muted">
                        SB · {picks.side.length}
                    </span>
                </div>
            </div>
            <div
                className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-base"
                style={{ overscrollBehavior: "contain" }}
            >
                <PicksSection
                    title={`Main · ${picks.main.length}`}
                    cards={picks.main}
                    onTap={setPreview}
                />
                <PicksSection
                    title={`Sideboard · ${picks.side.length}`}
                    cards={picks.side}
                    onTap={setPreview}
                />
            </div>
        </div>
    );

    // ---- landscape panes -----------------------------------------------
    // pack pane (80%): at the pack stop = header + grid; at the pool stop only
    // its LAST 20% is visible = the collapsed vertical pack pile + status.
    const landscapePack = (
        <div className="flex shrink-0 snap-start flex-row" style={paneStyle}>
            <div
                className={cn(
                    "flex min-h-0 min-w-0 flex-col",
                    stop === "pack" ? "flex-1" : "w-[75%]"
                )}
                style={stop === "pool" ? { visibility: "hidden" } : undefined}
            >
                {packHeader}
                {packGrid}
            </div>
            {stop === "pool" ? (
                <div
                    className="flex w-[25%] shrink-0 flex-col items-center gap-1 border-l border-accent/60 bg-surface p-2"
                    onClick={() => snapTo("pack")}
                >
                    <div className="flex items-center gap-1.5">{status}</div>
                    <div className="relative mt-1 w-[64px] flex-1">
                        {pack.slice(0, 12).map((c, i) => (
                            <img
                                key={c.key}
                                src={getImageUrl(c.cardId)}
                                alt=""
                                draggable={false}
                                className="absolute left-0 w-[64px] rounded-[6%] shadow"
                                style={{ top: i * 14 }}
                            />
                        ))}
                    </div>
                    <span className="font-beleren text-[12px] text-accent-strong">
                        tap: back to pack
                    </span>
                </div>
            ) : null}
        </div>
    );
    // pool pane (80%): at the pack stop only its FIRST 20% is visible = the
    // sneak-peek column (picks as one Arena pile + actions under it); at the
    // pool stop the whole pane renders MV columns.
    const landscapePool = (
        <div
            className="flex shrink-0 snap-end flex-row bg-surface-base"
            style={paneStyle}
        >
            {stop === "pack" ? (
                <div
                    className="flex w-[25%] shrink-0 flex-col border-l border-accent/60 bg-surface"
                    onClick={() => !sel && snapTo("pool")}
                >
                    <div
                        {...engine.zoneProps("strip:main")}
                        className={cn(
                            "flex min-h-0 flex-1 flex-col items-center gap-1 p-2",
                            overId === "strip:main" && "bg-accent/30",
                            armed && "animate-pulse"
                        )}
                    >
                        <span className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-text-muted">
                            <svg
                                viewBox="0 0 24 24"
                                className="h-3.5 w-3.5 stroke-accent-strong"
                                style={{
                                    fill: "none",
                                    strokeWidth: 2,
                                    animation:
                                        "protoNudgeX 1.8s ease-in-out infinite",
                                }}
                            >
                                <path d="m15 6-6 6 6 6" />
                            </svg>
                            Pool · {picks.main.length} · SB {picks.side.length}
                        </span>
                        <div className="relative w-[64px] flex-1 overflow-hidden">
                            {allPicks.map((c, i) => (
                                <img
                                    key={c.key}
                                    src={getImageUrl(c.cardId)}
                                    alt=""
                                    draggable={false}
                                    className={cn(
                                        "absolute left-0 w-[64px] rounded-[6%] shadow",
                                        picks.side.includes(c) &&
                                            "ring-1 ring-secondary-accent"
                                    )}
                                    style={{ top: i * 18 }}
                                />
                            ))}
                            {allPicks.length === 0 ? (
                                <div className="mt-2 text-center text-[10px] text-text-disabled">
                                    {engine.drag
                                        ? "drop = pick"
                                        : "no picks yet"}
                                </div>
                            ) : null}
                        </div>
                    </div>
                    <div
                        {...engine.zoneProps("strip:side")}
                        className={cn(
                            "flex h-8 shrink-0 items-center justify-center border-t border-border-subtle text-[10px] uppercase tracking-widest text-text-muted",
                            overId === "strip:side" &&
                                "bg-secondary-accent-soft",
                            armed && "animate-pulse"
                        )}
                    >
                        SB · {picks.side.length} · drop here
                    </div>
                    {/* actions bar UNDER the sneak peek */}
                    <div
                        className="flex shrink-0 flex-col gap-1.5 border-t border-accent/60 p-2"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {sel ? (
                            <>
                                <div className="truncate text-center font-beleren text-[12px] text-parchment">
                                    {sel.name}
                                </div>
                                {actions}
                            </>
                        ) : (
                            <div className="flex items-center justify-center gap-1.5">
                                {status}
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex h-9 shrink-0 items-center border-b border-accent/40 bg-surface px-2 text-[11px] uppercase tracking-widest text-text-muted">
                        Pool · {picks.main.length} main · {picks.side.length} SB
                    </div>
                    <MvColumns
                        cards={picks.main}
                        side={picks.side}
                        onTap={setPreview}
                    />
                </div>
            )}
        </div>
    );

    return (
        <div className="fixed inset-0 flex bg-surface-base text-text select-none">
            <style>{`@keyframes protoNudgeY{0%,100%{transform:translateY(0);opacity:.45}50%{transform:translateY(-3px);opacity:.9}}@keyframes protoNudgeX{0%,100%{transform:translateX(0);opacity:.45}50%{transform:translateX(-3px);opacity:.9}}`}</style>
            <div
                ref={scroller}
                onScroll={onScroll}
                className={cn(
                    "min-h-0 flex-1 [scrollbar-width:none]",
                    landscape
                        ? "flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden"
                        : "flex flex-col snap-y snap-mandatory overflow-y-auto overflow-x-hidden"
                )}
                style={{ overscrollBehavior: "contain" }}
            >
                {landscape ? landscapePack : portraitPack}
                {landscape ? landscapePool : portraitPool}
            </div>
            {engine.drag && dragCard ? (
                <TouchDragGhost drag={engine.drag} cardId={dragCard.cardId} />
            ) : null}
            {previewCard ? (
                <TouchPreviewOverlay
                    card={previewCard}
                    landscape={landscape}
                    tapAnywhereCloses
                    onClose={() => setPreview(null)}
                    actions={
                        pack.some((c) => c.key === previewCard.key)
                            ? [
                                  {
                                      label: "Pick",
                                      primary: true,
                                      onClick: () =>
                                          pick(previewCard.key, "main"),
                                  },
                              ]
                            : []
                    }
                />
            ) : null}
            <TouchEventLog lines={lines} />
        </div>
    );
}

function PicksSection({
    title,
    cards,
    onTap,
}: {
    title: string;
    cards: ProtoCard[];
    onTap: (key: string) => void;
}) {
    return (
        <div className="flex flex-col gap-1 p-2">
            <div className="text-[10px] uppercase tracking-widest text-text-muted">
                {title}
            </div>
            <div className="flex flex-wrap gap-1.5">
                {cards.map((c) => (
                    <TouchCardTile
                        key={c.key}
                        card={c}
                        width={64}
                        selected={false}
                        cardProps={{ onClick: () => onTap(c.key) }}
                    />
                ))}
                {cards.length === 0 ? (
                    <div className="py-3 text-[11px] text-text-disabled">
                        — empty —
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function MvColumns({
    cards,
    side,
    onTap,
}: {
    cards: ProtoCard[];
    side: ProtoCard[];
    onTap: (key: string) => void;
}) {
    const cols = BUCKETS.map(
        (b) => [b, cards.filter((c) => bucketOf(c) === b)] as const
    ).filter(([, l]) => l.length > 0);
    return (
        <div
            className="flex min-h-0 flex-1 gap-2 overflow-auto p-2"
            style={{ overscrollBehavior: "contain" }}
        >
            {cols.map(([b, list]) => (
                <div key={b} className="w-[64px] shrink-0">
                    <div className="mb-1 text-[10px] text-text-muted">
                        {b} · {list.length}
                    </div>
                    <div
                        className="relative"
                        style={{ height: 64 * 1.4 + (list.length - 1) * 20 }}
                    >
                        {list.map((c, i) => (
                            <img
                                key={c.key}
                                src={getImageUrl(c.cardId)}
                                alt={c.name}
                                draggable={false}
                                onClick={() => onTap(c.key)}
                                className="absolute left-0 w-[64px] rounded-[6%] shadow"
                                style={{ top: i * 20 }}
                            />
                        ))}
                    </div>
                </div>
            ))}
            {side.length ? (
                <div className="ml-2 w-[64px] shrink-0 border-l border-border-subtle pl-2">
                    <div className="mb-1 text-[10px] text-text-muted">
                        SB · {side.length}
                    </div>
                    <div
                        className="relative"
                        style={{ height: 64 * 1.4 + (side.length - 1) * 20 }}
                    >
                        {side.map((c, i) => (
                            <img
                                key={c.key}
                                src={getImageUrl(c.cardId)}
                                alt={c.name}
                                draggable={false}
                                onClick={() => onTap(c.key)}
                                className="absolute left-0 w-[64px] rounded-[6%] shadow"
                                style={{ top: i * 20 }}
                            />
                        ))}
                    </div>
                </div>
            ) : null}
            {cards.length + side.length === 0 ? (
                <div className="w-full py-10 text-center text-sm text-text-disabled">
                    no picks yet
                </div>
            ) : null}
        </div>
    );
}
