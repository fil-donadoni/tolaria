// PROTOTYPE (zone-target highlight) — the hover FOCUS every variant shares
// (owner feedback 2026-11-12): pointing at a targeting relationship — the
// source stack row, the source permanent, a drawn target card, or the zone
// pile — focuses that relationship; everything else dims.
//
// Returns the focused group keys, or null when nothing is hovered.
import { useEffect, useState } from "react";
import type { ZoneTargetGroup } from "./use-zone-target-model";

export function useProtoFocus(groups: ZoneTargetGroup[]): Set<string> | null {
    const [focus, setFocus] = useState<Set<string> | null>(null);
    useEffect(() => {
        let last = "";
        const onMove = (e: PointerEvent) => {
            if (e.pointerType === "touch") return;
            const t = e.target as Element | null;
            const keys = new Set<string>();
            const proto = t?.closest("[data-proto-group]");
            if (proto)
                for (const k of proto
                    .getAttribute("data-proto-group")!
                    .split(" "))
                    keys.add(k);
            const row = t
                ?.closest("[data-arrow-anchor-stack]")
                ?.getAttribute("data-arrow-anchor-stack");
            const perm = t
                ?.closest("[data-arrow-anchor-permanent]")
                ?.getAttribute("data-arrow-anchor-permanent");
            const gy = t
                ?.closest("[data-arrow-anchor-graveyard]")
                ?.getAttribute("data-arrow-anchor-graveyard");
            const ex = t
                ?.closest("[data-arrow-anchor-exile]")
                ?.getAttribute("data-arrow-anchor-exile");
            for (const g of groups) {
                if (row && g.sourceStackId === row) keys.add(g.key);
                if (perm && g.sourcePermanentId === perm) keys.add(g.key);
                if (gy && g.zone === "graveyard" && g.ownerId === gy)
                    keys.add(g.key);
                if (ex && g.zone === "exile" && g.ownerId === ex)
                    keys.add(g.key);
            }
            const sig = Array.from(keys).sort().join(",");
            if (sig === last) return;
            last = sig;
            setFocus(keys.size ? keys : null);
        };
        const onLeave = () => {
            last = "";
            setFocus(null);
        };
        window.addEventListener("pointermove", onMove);
        document.addEventListener("pointerleave", onLeave);
        return () => {
            window.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerleave", onLeave);
        };
    }, [groups]);
    return focus;
}
