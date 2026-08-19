// PROTOTYPE — throwaway. Deckbuilder surface of /prototype/touch: 3 full-page
// swipe tabs Pool | Main | Side (tabs = drop targets), MV rows in portrait
// (duplicates collapsed ×N) / MTGO pile columns in landscape, peek sheet with
// the 44px CTA row, inspect overlay. Gesture model from the switcher.
import { useEffect, useRef, useState } from "react";
import {
    initialPool,
    type PoolState,
    type ProtoCard,
    type Zone,
} from "./mock-pool";
import { useTouchMoveEngine, type GestureModel } from "./use-touch-move-engine";
import { useLandscape } from "./use-landscape";
import { useGestureLog } from "./use-gesture-log";
import TouchZonePane from "./touch-zone-pane";
import TouchTabButton from "./touch-tab-button";
import TouchPeekSheet, { type PeekAction } from "./touch-peek-sheet";
import TouchPreviewOverlay from "./touch-preview-overlay";
import TouchDragGhost from "./touch-drag-ghost";
import TouchEventLog from "./touch-event-log";

const ZONES: { id: Zone; label: string }[] = [
    { id: "pool", label: "Pool" },
    { id: "main", label: "Main" },
    { id: "side", label: "Side" },
];

function findCard(
    s: PoolState,
    key: string
): { card: ProtoCard; zone: Zone } | null {
    for (const z of ZONES) {
        const c = s[z.id].find((x) => x.key === key);
        if (c) return { card: c, zone: z.id };
    }
    return null;
}

export default function TouchBuilderSurface({
    model,
}: {
    model: GestureModel;
}) {
    const [state, setState] = useState<PoolState>(initialPool);
    const [tab, setTab] = useState<Zone>("main");
    const [preview, setPreview] = useState<string | null>(null);
    const landscape = useLandscape();
    const { lines, log } = useGestureLog();
    const panes = useRef<HTMLDivElement>(null);
    // open on Main (pane index 1), instantly
    useEffect(() => {
        const el = panes.current;
        if (el) el.scrollLeft = el.clientWidth;
    }, []);

    const moveTo = (key: string, zone: Zone) => {
        setState((s) => {
            const hit = findCard(s, key);
            if (!hit || hit.zone === zone) return s;
            return {
                ...s,
                [hit.zone]: s[hit.zone].filter((c) => c.key !== key),
                [zone]: [...s[zone], hit.card],
            };
        });
    };

    const engine = useTouchMoveEngine({
        model,
        onMove: (key, dropId) => {
            const [kind, zone, bucket] = dropId.split(":");
            if (kind === "tab" || kind === "row" || kind === "col") {
                moveTo(key, zone as Zone);
                log(
                    `moved → ${zone}${bucket ? ` (${kind} ${bucket}; bucket pin not modelled)` : ""}`
                );
                engine.select(null);
            }
        },
        onSelect: () => {},
        onPreview: setPreview,
        log,
    });

    const selected = engine.selected ? findCard(state, engine.selected) : null;
    const dragCard = engine.drag
        ? findCard(state, engine.drag.key)?.card
        : null;
    const previewCard = preview ? findCard(state, preview)?.card : null;

    const goTab = (z: Zone) => {
        setTab(z);
        const el = panes.current;
        if (el)
            el.scrollTo({
                left: ZONES.findIndex((x) => x.id === z) * el.clientWidth,
                behavior: "smooth",
            });
    };
    const onPanesScroll = () => {
        const el = panes.current;
        if (!el) return;
        const i = Math.round(el.scrollLeft / el.clientWidth);
        const z = ZONES[i]?.id;
        if (z && z !== tab) setTab(z);
    };

    const peekActions = (hit: {
        card: ProtoCard;
        zone: Zone;
    }): PeekAction[] => {
        // primary = the most likely destination: main→side, side→main, pool→main
        const others = ZONES.filter((z) => z.id !== hit.zone).sort((a, b) =>
            a.id === (hit.zone === "main" ? "side" : "main")
                ? -1
                : b.id === (hit.zone === "main" ? "side" : "main")
                  ? 1
                  : 0
        );
        return [
            ...others.map((z, i) => ({
                label: `→ ${z.label}`,
                primary: i === 0,
                onClick: () => {
                    moveTo(hit.card.key, z.id);
                    log(`CTA → ${z.id}`);
                    engine.select(null);
                },
            })),
            { label: "Inspect", onClick: () => setPreview(hit.card.key) },
        ];
    };

    const overId = engine.drag?.over ?? null;
    const armed = model === "B" && !!engine.selected;

    return (
        <div className="fixed inset-0 flex flex-col bg-surface-base text-text select-none">
            {/* top bar */}
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-accent/40 bg-surface px-2">
                <span className="font-beleren text-sm text-parchment">
                    Sealed Pool Deck
                </span>
                <span className="rounded-full border border-signal-pending px-2 text-[10px] uppercase tracking-wider text-signal-pending">
                    {state.main.length}/40
                </span>
                {landscape ? (
                    <div className="ml-2 flex h-11">
                        {ZONES.map((z) => (
                            <TouchTabButton
                                key={z.id}
                                zone={z}
                                active={tab === z.id}
                                count={state[z.id].length}
                                over={overId === `tab:${z.id}`}
                                armed={armed}
                                onClick={() => goTab(z.id)}
                                zoneProps={engine.zoneProps(`tab:${z.id}`)}
                            />
                        ))}
                    </div>
                ) : null}
                <span className="flex-1" />
                <span className="text-[10px] text-text-muted">
                    model {model}
                </span>
            </div>
            {!landscape ? (
                <div className="grid h-11 shrink-0 grid-cols-3 border-b border-border-subtle">
                    {ZONES.map((z) => (
                        <TouchTabButton
                            key={z.id}
                            zone={z}
                            active={tab === z.id}
                            count={state[z.id].length}
                            over={overId === `tab:${z.id}`}
                            armed={armed}
                            onClick={() => goTab(z.id)}
                            zoneProps={engine.zoneProps(`tab:${z.id}`)}
                        />
                    ))}
                </div>
            ) : null}

            <div className="flex min-h-0 flex-1">
                {/* swipe panes */}
                <div
                    ref={panes}
                    onScroll={onPanesScroll}
                    className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
                    style={{ overscrollBehaviorX: "contain" }}
                >
                    {ZONES.map((z) => (
                        <div
                            key={z.id}
                            className="h-full w-full shrink-0 snap-start"
                        >
                            <TouchZonePane
                                zone={z.id}
                                cards={state[z.id]}
                                landscape={landscape}
                                model={model}
                                selectedKey={engine.selected}
                                overId={overId}
                                armed={armed}
                                cardProps={engine.cardProps}
                                handleProps={engine.handleProps}
                                zoneProps={engine.zoneProps}
                            />
                        </div>
                    ))}
                </div>
                {landscape && selected ? (
                    <TouchPeekSheet
                        card={selected.card}
                        subtitle={`${selected.zone} · ${selected.card.isLand ? "Land" : `MV ${selected.card.mv}`}`}
                        actions={peekActions(selected)}
                        landscape
                        onClose={engine.clearSelection}
                    />
                ) : null}
            </div>

            {!landscape && selected ? (
                <TouchPeekSheet
                    card={selected.card}
                    subtitle={`${selected.zone} · ${selected.card.isLand ? "Land" : `MV ${selected.card.mv}`}`}
                    actions={peekActions(selected)}
                    landscape={false}
                    onClose={engine.clearSelection}
                />
            ) : null}

            {!landscape ? (
                <div className="flex h-14 shrink-0 items-center gap-2 border-t border-border-subtle bg-surface px-3 pb-1 text-[11px] uppercase tracking-widest text-text-muted">
                    Main {state.main.length} · Side {state.side.length} · Pool{" "}
                    {state.pool.length}
                    <span className="flex-1" />
                    <span className="rounded-full border border-accent/50 px-3 py-2 font-beleren text-accent-strong normal-case tracking-wide">
                        Stats
                    </span>
                    <span className="rounded-full bg-accent px-4 py-2 font-beleren text-surface-base normal-case tracking-wide">
                        Done
                    </span>
                </div>
            ) : null}

            {engine.drag && dragCard ? (
                <TouchDragGhost drag={engine.drag} cardId={dragCard.cardId} />
            ) : null}
            {previewCard ? (
                <TouchPreviewOverlay
                    card={previewCard}
                    landscape={landscape}
                    actions={ZONES.filter(
                        (z) => z.id !== findCard(state, previewCard.key)?.zone
                    ).map((z, i) => ({
                        label: `→ ${z.label}`,
                        primary: i === 0,
                        onClick: () => {
                            moveTo(previewCard.key, z.id);
                            setPreview(null);
                            engine.select(null);
                        },
                    }))}
                    onClose={() => setPreview(null)}
                />
            ) : null}
            <TouchEventLog lines={lines} />
        </div>
    );
}
