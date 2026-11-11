/* eslint-disable -- PROTOTYPE, throwaway branch */
// PROTOTYPE — throwaway (player-feedback 2026-11, `?pv-target-arrow=A|B|C`).
import { useEffect, useRef, useState, type RefObject } from "react";
import type { AnchorPoint } from "~/lib/target-arrow-geometry";
import {
    measurePrototypeTargets,
    type PrototypeTargetBox,
} from "./prototype-target-geometry";
import type { PrototypeTargetSession } from "./use-prototype-target-session";

export type PrototypeTargetTracking = {
    pointer: AnchorPoint | null;
    sources: PrototypeTargetBox[];
    targets: PrototypeTargetBox[];
};

const EMPTY: PrototypeTargetTracking = {
    pointer: null,
    sources: [],
    targets: [],
};

/** While a session is open: follow the cursor, keep the source / target boxes
 *  measured, and cancel on Escape or right-click. */
export function usePrototypeTargetTracking(
    session: PrototypeTargetSession | null,
    svgRef: RefObject<HTMLElement | null>
): PrototypeTargetTracking {
    const [state, setState] = useState<PrototypeTargetTracking>(EMPTY);
    const sessionRef = useRef(session);
    sessionRef.current = session;
    const active = session !== null;

    useEffect(() => {
        if (!active) {
            setState(EMPTY);
            return;
        }
        let pointer: AnchorPoint | null = null;
        let raf = 0;
        const measure = () => {
            raf = 0;
            const s = sessionRef.current;
            const origin = svgRef.current?.getBoundingClientRect();
            if (!s || !origin) return;
            setState({
                pointer,
                ...measurePrototypeTargets(s, origin, s.nameOf),
            });
        };
        const schedule = () => {
            if (!raf) raf = requestAnimationFrame(measure);
        };
        const onMove = (e: PointerEvent) => {
            const origin = svgRef.current?.getBoundingClientRect();
            if (!origin) return;
            pointer = {
                x: e.clientX - origin.left,
                y: e.clientY - origin.top,
            };
            schedule();
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            sessionRef.current?.cancel();
        };
        const onContext = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            sessionRef.current?.cancel();
        };
        // Cards spring to new placements; keep the boxes glued without a
        // pointer move.
        const tick = window.setInterval(schedule, 200);
        schedule();
        window.addEventListener("pointermove", onMove);
        window.addEventListener("keydown", onKey, true);
        window.addEventListener("contextmenu", onContext, true);
        return () => {
            if (raf) cancelAnimationFrame(raf);
            window.clearInterval(tick);
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("keydown", onKey, true);
            window.removeEventListener("contextmenu", onContext, true);
        };
    }, [active, svgRef]);

    return active ? state : EMPTY;
}
