// PROTOTYPE — throwaway. Draft Room phone surface of /prototype/touch: the
// two-stop snap Pack 85% ↔ Pool 85% (D10), the 15% strip as a live tab and a
// drop target (drag onto it = pick to main; its SB half = pick to sideboard),
// tap = select + peek, explicit Pick. Portrait snaps vertically, landscape
// horizontally. Gesture model from the switcher.
import { useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { getImageUrl } from "~/lib/images";
import { draftPack, type ProtoCard } from "./mock-pool";
import { useTouchMoveEngine, type GestureModel } from "./use-touch-move-engine";
import { useLandscape } from "./use-landscape";
import { useGestureLog } from "./use-gesture-log";
import TouchCardTile from "./touch-card-tile";
import TouchPreviewOverlay from "./touch-preview-overlay";
import TouchDragGhost from "./touch-drag-ghost";
import TouchEventLog from "./touch-event-log";

export default function TouchDraftSurface({ model }: { model: GestureModel }) {
    const [pack, setPack] = useState<ProtoCard[]>(draftPack);
    const [picks, setPicks] = useState<{
        main: ProtoCard[];
        side: ProtoCard[];
    }>({ main: [], side: [] });
    const [preview, setPreview] = useState<string | null>(null);
    const [pickNo, setPickNo] = useState(1);
    const landscape = useLandscape();
    const { lines, log } = useGestureLog();
    const scroller = useRef<HTMLDivElement>(null);
    const [stop, setStop] = useState<"pack" | "pool">("pack");

    const pick = (key: string, to: "main" | "side") => {
        const c = pack.find((x) => x.key === key);
        if (!c) return;
        setPack((p) => p.filter((x) => x.key !== key));
        setPicks((p) => ({ ...p, [to]: [...p[to], c] }));
        setPickNo((n) => n + 1);
        log(`pick ${c.name} → ${to}`);
        engine.select(null);
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
    const previewCard = preview
        ? [...pack, ...picks.main, ...picks.side].find((c) => c.key === preview)
        : null;
    const overId = engine.drag?.over ?? null;
    const armed = model === "B" && !!engine.selected;

    const onScroll = () => {
        const el = scroller.current;
        if (!el) return;
        const pos = landscape
            ? el.scrollLeft / el.clientWidth
            : el.scrollTop / el.clientHeight;
        const s = pos > 0.5 ? "pool" : "pack";
        if (s !== stop) {
            setStop(s);
            log(`snap → ${s}`);
        }
    };
    const snapTo = (s: "pack" | "pool") => {
        const el = scroller.current;
        if (!el) return;
        const amt = s === "pool" ? 0.85 : 0;
        el.scrollTo(
            landscape
                ? { left: amt * el.clientWidth, behavior: "smooth" }
                : { top: amt * el.clientHeight, behavior: "smooth" }
        );
    };

    // Two-stop snap: content = pack pane (85%) + pool pane (85%) in a 100%
    // scroller, so the only two stops are 0 (pack 85 + pool's first 15) and
    // max (pack's last 15 + pool 85). The pack pane's LAST 15% is its status /
    // peek bar (timer, pick n, CTAs when a card is selected, "tap to return"
    // when parked at the pool stop); the pool pane's FIRST 15% is the pool
    // strip (counts, drop = pick, SB half = pick to sideboard).
    const sizeMain = landscape
        ? { width: "85%", height: "100%" }
        : { height: "85%", width: "100%" };
    const along = (pct: number) =>
        landscape
            ? { width: `${pct}%`, height: "100%" }
            : { height: `${pct}%`, width: "100%" };
    const peekBtn = (label: string, primary: boolean, onClick: () => void) => (
        <button
            key={label}
            type="button"
            onClick={onClick}
            className={cn(
                "min-h-11 rounded-full border px-3 font-beleren text-[13px]",
                primary
                    ? "border-accent bg-accent text-surface-base"
                    : "border-accent/50 bg-surface-elevated text-accent-strong"
            )}
        >
            {label}
        </button>
    );

    return (
        <div className="fixed inset-0 flex bg-surface-base text-text select-none">
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
                {/* pack pane: 85% — grid + status/peek bar (its last 15% of the viewport) */}
                <div
                    className={cn(
                        "flex shrink-0 snap-start",
                        landscape ? "flex-row" : "flex-col"
                    )}
                    style={sizeMain}
                >
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-accent/40 bg-surface px-2 text-[11px] uppercase tracking-widest text-text-muted">
                            <span>Pack 1 · pick {pickNo}/15</span>
                            <span className="flex-1" />
                            <span className="font-mono text-signal-pending-strong">
                                0:{String(41 - pickNo).padStart(2, "0")}
                            </span>
                            <span className="text-[10px] normal-case tracking-normal">
                                model {model}
                            </span>
                        </div>
                        <div
                            className="grid min-h-0 flex-1 content-start gap-1.5 overflow-y-auto p-2"
                            style={{
                                gridTemplateColumns: landscape
                                    ? "repeat(8,minmax(0,1fr))"
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
                    </div>
                    {/* pack status / peek bar = the strip seen from the pool stop */}
                    <div
                        className={cn(
                            "flex shrink-0 items-center gap-2 border-accent/60 bg-surface px-2",
                            landscape
                                ? "flex-col justify-center border-l py-2"
                                : "flex-row border-t"
                        )}
                        style={along(15 / 0.85)}
                        onClick={() => stop === "pool" && snapTo("pack")}
                    >
                        {sel ? (
                            <>
                                {!landscape ? (
                                    <img
                                        src={getImageUrl(sel.cardId)}
                                        alt=""
                                        draggable={false}
                                        className="w-9 rounded-[6%]"
                                    />
                                ) : null}
                                <div
                                    className={cn(
                                        "min-w-0",
                                        landscape ? "text-center" : "flex-1"
                                    )}
                                >
                                    <div className="truncate font-beleren text-[13px] text-parchment">
                                        {sel.name}
                                    </div>
                                    {!landscape ? (
                                        <div className="text-[10px] text-text-muted">
                                            {sel.isLand
                                                ? "Land"
                                                : `MV ${sel.mv}`}
                                        </div>
                                    ) : null}
                                </div>
                                <div
                                    className={cn(
                                        "flex gap-1.5",
                                        landscape && "flex-col"
                                    )}
                                >
                                    {peekBtn("Pick", true, () =>
                                        pick(sel.key, "main")
                                    )}
                                    {peekBtn("→ SB", false, () =>
                                        pick(sel.key, "side")
                                    )}
                                    {peekBtn("Inspect", false, () =>
                                        setPreview(sel.key)
                                    )}
                                </div>
                            </>
                        ) : (
                            <>
                                <span className="h-2 w-2 shrink-0 rounded-full bg-signal-pending shadow-[0_0_8px_#fbbf24]" />
                                <span
                                    className={cn(
                                        "text-[11px] uppercase tracking-widest text-text-muted",
                                        landscape &&
                                            "text-center [writing-mode:vertical-rl]"
                                    )}
                                >
                                    pick {pickNo}/15 · 0:
                                    {String(41 - pickNo).padStart(2, "0")}
                                </span>
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
                {/* pool pane: 85% — strip (its first 15% of the viewport) + pool */}
                <div
                    className={cn(
                        "flex shrink-0 snap-end",
                        landscape ? "flex-row" : "flex-col"
                    )}
                    style={sizeMain}
                >
                    <div
                        className={cn(
                            "flex shrink-0 border-accent/60 bg-surface",
                            landscape
                                ? "flex-col border-l"
                                : "flex-row border-t"
                        )}
                        style={along(15 / 0.85)}
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
                            <span className="text-[10px] uppercase tracking-widest text-text-muted">
                                Pool · {picks.main.length}
                            </span>
                            <span className="font-beleren text-[12px] text-accent-strong">
                                {engine.drag ? "drop = pick" : "tap: open pool"}
                            </span>
                        </div>
                        <div
                            {...engine.zoneProps("strip:side")}
                            className={cn(
                                "flex items-center justify-center border-border-subtle px-2",
                                landscape
                                    ? "h-[30%] border-t"
                                    : "w-[30%] border-l",
                                overId === "strip:side" &&
                                    "bg-secondary-accent-soft",
                                armed && "animate-pulse"
                            )}
                        >
                            <span className="text-[10px] uppercase tracking-widest text-text-muted">
                                SB · {picks.side.length}
                            </span>
                        </div>
                    </div>
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-base">
                        <div className="flex h-9 shrink-0 items-center border-b border-accent/40 bg-surface px-2 text-[11px] uppercase tracking-widest text-text-muted">
                            Pool · {picks.main.length} main ·{" "}
                            {picks.side.length} SB
                        </div>
                        <div
                            className="flex flex-1 flex-wrap content-start gap-1.5 overflow-y-auto p-2"
                            style={{ overscrollBehavior: "contain" }}
                        >
                            {[...picks.main, ...picks.side].map((c) => (
                                <TouchCardTile
                                    key={c.key}
                                    card={c}
                                    width={64}
                                    selected={false}
                                    cardProps={{
                                        onClick: () => setPreview(c.key),
                                    }}
                                />
                            ))}
                            {picks.main.length + picks.side.length === 0 ? (
                                <div className="w-full py-10 text-center text-sm text-text-disabled">
                                    no picks yet — drag a card onto the strip,
                                    or Pick
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>
            </div>
            {engine.drag && dragCard ? (
                <TouchDragGhost drag={engine.drag} cardId={dragCard.cardId} />
            ) : null}
            {previewCard ? (
                <TouchPreviewOverlay
                    card={previewCard}
                    landscape={landscape}
                    onClose={() => setPreview(null)}
                    actions={
                        pack.some((c) => c.key === previewCard.key)
                            ? [
                                  {
                                      label: "Pick",
                                      primary: true,
                                      onClick: () => {
                                          pick(previewCard.key, "main");
                                          setPreview(null);
                                      },
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
