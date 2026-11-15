// PROTOTYPE — throwaway. Floating switcher: ←/→ cycles the variant, ↑/↓ the
// fake controller state; URL ?variant= & ?state= are the truth. It also prints
// the pod's measured height (and the min/max seen since the last switch), so
// "shift-free" is measured, not eyeballed.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Item = { key: string; name: string };

function useCycle(
    items: readonly Item[],
    current: string,
    set: (k: string) => void
) {
    const i = Math.max(
        0,
        items.findIndex((v) => v.key === current)
    );
    return {
        item: items[i],
        go: (d: number) =>
            set(items[(i + d + items.length) % items.length].key),
    };
}

function usePodHeight(resetKey: string) {
    const [h, setH] = useState({ key: "", now: 0, min: Infinity, max: 0 });
    useEffect(() => {
        const pod = document.querySelector("[data-controller-pod]");
        if (!pod) return;
        const ro = new ResizeObserver(() => {
            const now = Math.round(pod.getBoundingClientRect().height);
            // A new variant restarts the min/max window.
            setH((p) =>
                p.key !== resetKey
                    ? { key: resetKey, now, min: now, max: now }
                    : {
                          key: resetKey,
                          now,
                          min: Math.min(p.min, now),
                          max: Math.max(p.max, now),
                      }
            );
        });
        ro.observe(pod);
        return () => ro.disconnect();
    }, [resetKey]);
    return h;
}

export default function PrototypeSwitcher({
    variants,
    variant,
    onVariant,
    scenarios,
    scenario,
    onScenario,
}: {
    variants: readonly Item[];
    variant: string;
    onVariant: (key: string) => void;
    scenarios: readonly Item[];
    scenario: string;
    onScenario: (key: string) => void;
}) {
    const v = useCycle(variants, variant, onVariant);
    const s = useCycle(scenarios, scenario, onScenario);
    const h = usePodHeight(variant);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target;
            if (
                t instanceof Element &&
                t.closest("input, textarea, select, [contenteditable]")
            )
                return;
            if (e.key === "ArrowLeft") v.go(-1);
            if (e.key === "ArrowRight") v.go(1);
            if (e.key === "ArrowUp") s.go(-1);
            if (e.key === "ArrowDown") s.go(1);
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    });

    if (!import.meta.env.DEV) return null;
    const delta = h.max - (Number.isFinite(h.min) ? h.min : h.max);
    return createPortal(
        <div
            style={{ zIndex: 99999 }}
            className="fixed bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-fuchsia-600 px-4 py-1 text-xs font-semibold text-white shadow-lg"
        >
            <button type="button" onClick={() => v.go(-1)}>
                ←
            </button>
            <span>
                {v.item.key} ({v.item.name})
            </span>
            <button type="button" onClick={() => v.go(1)}>
                →
            </button>
            <span className="opacity-60">|</span>
            <button type="button" onClick={() => s.go(-1)}>
                ↑
            </button>
            <span>state: {s.item.name}</span>
            <button type="button" onClick={() => s.go(1)}>
                ↓
            </button>
            <span className="opacity-60">|</span>
            <span className={delta > 0 ? "text-yellow-200" : ""}>
                pod {h.now}px · Δ {delta}px
            </span>
        </div>,
        document.body
    );
}
