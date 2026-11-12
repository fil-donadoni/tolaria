// PROTOTYPE (zone-target highlight) — floating switcher: ← variant →, a
// REAL scenario loader (loads into the current game), live state readout.
// Dev-only (mounted behind DEV).
import { useEffect } from "react";
import { PROTO_SCENARIOS } from "./prototype-scenarios";
import { notifyZoneProto } from "./zone-proto-store";

export type ZoneProtoParams = { variant: string };

export function readZoneProto(): ZoneProtoParams | null {
    const q = new URLSearchParams(window.location.search);
    if (!q.has("zoneProto")) return null;
    return { variant: q.get("variant") ?? "C2" };
}

export function writeZoneProto(p: ZoneProtoParams) {
    const q = new URLSearchParams(window.location.search);
    q.set("zoneProto", "1");
    q.set("variant", p.variant);
    window.history.replaceState(null, "", `${window.location.pathname}?${q}`);
    notifyZoneProto();
}

export default function ZoneProtoSwitcher({
    variants,
    params,
    onChange,
    onLoad,
    loading,
    status,
}: {
    variants: Array<{ key: string; name: string }>;
    params: ZoneProtoParams;
    onChange: (p: ZoneProtoParams) => void;
    onLoad: (scenarioKey: string) => void;
    loading: string | null;
    status: string;
}) {
    const idx = Math.max(
        0,
        variants.findIndex((v) => v.key === params.variant)
    );
    const cycle = (d: number) =>
        onChange({
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
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });
    return (
        <div className="fixed bottom-3 left-1/2 z-[1000] flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-full bg-black/90 px-3 py-1.5 font-mono text-[11px] text-white shadow-xl ring-1 ring-white/30">
            <span className="text-amber-300">PROTOTYPE zone targets</span>
            <button onClick={() => cycle(-1)} className="px-1">
                ←
            </button>
            <span>
                {variants[idx].key} ({variants[idx].name})
            </span>
            <button onClick={() => cycle(1)} className="px-1">
                →
            </button>
            <span className="text-white/50">load:</span>
            {PROTO_SCENARIOS.map((s) => (
                <button
                    key={s.key}
                    title={s.label}
                    disabled={loading !== null}
                    onClick={(e) => {
                        (e.currentTarget as HTMLButtonElement).blur();
                        onLoad(s.key);
                    }}
                    className="rounded bg-white/15 px-2 disabled:opacity-40"
                >
                    {loading === s.key ? "loading…" : s.key}
                </button>
            ))}
            <span className="text-white/60">{status}</span>
        </div>
    );
}
