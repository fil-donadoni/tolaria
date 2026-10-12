// PROTOTYPE (issue #4433) — floating switcher bar: ← variant →, scenario
// picker, replay, reduced-motion toggle, live state readout. Dev-only.
import { useEffect } from "react";
import { SCENARIOS } from "./prototype-scenarios";
import type { ProtoSequence } from "./use-proto-sequence";

export type ProtoParams = { variant: string; scenario: string; rm: boolean };

export function readProtoParams(): ProtoParams | null {
    const q = new URLSearchParams(window.location.search);
    if (!q.has("coinProto")) return null;
    return {
        variant: q.get("variant") ?? "A2",
        scenario: q.get("coinProto") || SCENARIOS[0].key,
        rm: q.get("rm") === "1",
    };
}

export function writeProtoParams(p: ProtoParams) {
    const q = new URLSearchParams(window.location.search);
    q.set("coinProto", p.scenario);
    q.set("variant", p.variant);
    if (p.rm) q.set("rm", "1");
    else q.delete("rm");
    window.history.replaceState(null, "", `${window.location.pathname}?${q}`);
}

export default function PrototypeSwitcher({
    variants,
    params,
    onChange,
    onReplay,
    seq,
}: {
    variants: Array<{ key: string; name: string }>;
    params: ProtoParams;
    onChange: (p: ProtoParams) => void;
    onReplay: () => void;
    seq: ProtoSequence;
}) {
    const idx = Math.max(
        0,
        variants.findIndex((v) => v.key === params.variant)
    );
    const cycle = (d: number) =>
        onChange({
            ...params,
            variant:
                variants[(idx + d + variants.length) % variants.length].key,
        });

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            const t = e.target as HTMLElement | null;
            if (
                t &&
                (t.tagName === "INPUT" ||
                    t.tagName === "TEXTAREA" ||
                    t.tagName === "SELECT" ||
                    t.isContentEditable)
            )
                return;
            if (e.key === "ArrowLeft") cycle(-1);
            if (e.key === "ArrowRight") cycle(1);
            if (e.key === "r") onReplay();
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    return (
        <div className="fixed bottom-3 left-1/2 z-[1000] flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-full bg-black/90 px-3 py-1.5 font-mono text-[11px] text-white shadow-xl ring-1 ring-white/30">
            <span className="text-amber-300">PROTOTYPE #4433</span>
            <button onClick={() => cycle(-1)} className="px-1">
                ←
            </button>
            <span>
                {variants[idx].key} ({variants[idx].name})
            </span>
            <button onClick={() => cycle(1)} className="px-1">
                →
            </button>
            <select
                className="rounded bg-white/10 px-1"
                value={params.scenario}
                onChange={(e) =>
                    onChange({ ...params, scenario: e.target.value })
                }
            >
                {SCENARIOS.map((s) => (
                    <option key={s.key} value={s.key} className="text-black">
                        {s.label}
                    </option>
                ))}
            </select>
            <button onClick={onReplay} className="rounded bg-white/15 px-2">
                replay (r)
            </button>
            <label className="flex items-center gap-1">
                <input
                    type="checkbox"
                    checked={params.rm}
                    onChange={(e) =>
                        onChange({ ...params, rm: e.target.checked })
                    }
                />
                reduced motion
            </label>
            <span className="text-white/60">
                {seq.phase} · {seq.landed} landed
                {seq.skipped ? " · skipped" : ""} ·{" "}
                {(seq.elapsedMs / 1000).toFixed(1)}s
            </span>
        </div>
    );
}
