/**
 * PROTOTYPE — board rendering comparison: DOM high-perf vs WebGL (Pixi).
 * Throwaway — delete after the rendering-tech decision is captured.
 *
 * Route: /prototype/board
 * Switch variant + stress count from the floating bottom bar. "Cast" moves a
 * card hand→battlefield so you can feel the zone transition in both engines.
 */

import { useEffect, useState } from "react";
import DomBoard, { type ZonedCard } from "./prototype-board/dom-board";
import WebglBoard from "./prototype-board/webgl-board";
import WebglFxBoard from "./prototype-board/webgl-fx-board";
import HybridBoard from "./prototype-board/hybrid-board";
import { makeCards } from "./prototype-board/cards";

type Variant = "dom" | "webgl" | "webgl-fx" | "hybrid";

function buildCards(bfCount: number, handCount: number): ZonedCard[] {
    const bf = makeCards(bfCount, 0).map(
        (c) => ({ ...c, zone: "battlefield" }) as ZonedCard
    );
    const hand = makeCards(handCount, 5).map(
        (c) => ({ ...c, zone: "hand" }) as ZonedCard
    );
    return [...bf, ...hand];
}

export default function PrototypeBoardRoute() {
    const [variant, setVariant] = useState<Variant>("dom");
    const [bfCount, setBfCount] = useState(5);
    const [handCount, setHandCount] = useState(5);
    const [cards, setCards] = useState<ZonedCard[]>(() => buildCards(5, 5));
    const [fps, setFps] = useState(0);

    // Rebuild when counts change.
    useEffect(() => {
        setCards(buildCards(bfCount, handCount));
    }, [bfCount, handCount]);

    // FPS meter.
    useEffect(() => {
        let raf = 0;
        let last = performance.now();
        let frames = 0;
        const loop = (t: number) => {
            frames++;
            if (t - last >= 500) {
                setFps(Math.round((frames * 1000) / (t - last)));
                frames = 0;
                last = t;
            }
            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, []);

    function castOne() {
        setCards((prev) => {
            const idx = prev.findIndex((c) => c.zone === "hand");
            if (idx < 0) return prev;
            const next = [...prev];
            next[idx] = { ...next[idx], zone: "battlefield" };
            return next;
        });
    }

    function reset() {
        setBfCount(5);
        setHandCount(5);
        setCards(buildCards(5, 5));
    }

    return (
        <div
            className="fixed inset-0 overflow-hidden"
            style={{
                backgroundImage:
                    "radial-gradient(ellipse at 50% 30%, #15212e 0%, #0a0a0c 60%)",
            }}
        >
            {/* zone guides */}
            <div className="absolute inset-x-0 top-[34%] -translate-y-1/2 h-px bg-white/5" />
            <div className="absolute left-4 top-[34%] -translate-y-1/2 text-[10px] uppercase tracking-widest text-white/25">
                Battlefield
            </div>
            <div className="absolute left-4 top-[72%] -translate-y-1/2 text-[10px] uppercase tracking-widest text-white/25">
                Hand
            </div>

            {variant === "dom" && <DomBoard cards={cards} />}
            {variant === "webgl" && <WebglBoard cards={cards} />}
            {variant === "webgl-fx" && <WebglFxBoard cards={cards} />}
            {variant === "hybrid" && <HybridBoard cards={cards} />}

            {/* Floating control bar */}
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-4 px-4 py-3 rounded-lg bg-zinc-900/85 backdrop-blur border border-white/10 text-zinc-200 text-xs shadow-2xl">
                <div className="flex rounded overflow-hidden border border-white/15">
                    {(
                        [
                            ["dom", "DOM (Motion)"],
                            ["webgl", "WebGL (parity)"],
                            ["webgl-fx", "WebGL (FX)"],
                            ["hybrid", "Hybrid (DOM+FX)"],
                        ] as [Variant, string][]
                    ).map(([v, label]) => (
                        <button
                            key={v}
                            type="button"
                            onClick={() => setVariant(v)}
                            className={`px-3 py-1.5 cursor-pointer transition-colors ${
                                variant === v
                                    ? "bg-emerald-600/80 text-white"
                                    : "bg-transparent hover:bg-white/10"
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                <label className="flex items-center gap-2">
                    <span className="text-white/50">Battlefield</span>
                    <input
                        type="range"
                        min={0}
                        max={60}
                        value={bfCount}
                        onChange={(e) => setBfCount(+e.target.value)}
                        className="w-28 accent-emerald-500"
                    />
                    <span className="w-6 tabular-nums">{bfCount}</span>
                </label>

                <label className="flex items-center gap-2">
                    <span className="text-white/50">Hand</span>
                    <input
                        type="range"
                        min={0}
                        max={20}
                        value={handCount}
                        onChange={(e) => setHandCount(+e.target.value)}
                        className="w-20 accent-emerald-500"
                    />
                    <span className="w-6 tabular-nums">{handCount}</span>
                </label>

                <button
                    type="button"
                    onClick={castOne}
                    className="px-3 py-1.5 rounded bg-sky-600/80 hover:bg-sky-500 text-white cursor-pointer"
                >
                    Cast → BF
                </button>
                <button
                    type="button"
                    onClick={reset}
                    className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 cursor-pointer"
                >
                    Reset
                </button>

                <div className="pl-3 border-l border-white/10">
                    <span className="text-white/50">FPS </span>
                    <span
                        className={`tabular-nums font-bold ${
                            fps >= 55
                                ? "text-emerald-400"
                                : fps >= 30
                                  ? "text-amber-400"
                                  : "text-red-400"
                        }`}
                    >
                        {fps}
                    </span>
                </div>
            </div>

            <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] text-[11px] text-white/40">
                PROTOTYPE · drag any card · raise Battlefield to ~40+ to stress
                the engines
            </div>
        </div>
    );
}
