import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type LeaderLine from "leader-line-new";

type LeaderLineCtor = new (
    start: Element,
    end: Element,
    options?: LeaderLine.Options
) => LeaderLine;

export type ArrowSpec = {
    /** Stable identity for diffing across renders. */
    key: string;
    sourceSelector: string;
    targetSelector: string;
    /** Per-arrow option overrides merged onto `defaults`. */
    options?: Partial<LeaderLine.Options>;
};

type UseLeaderLinesOptions = {
    /** Default leader-line options applied to every arrow. */
    defaults?: Partial<LeaderLine.Options>;
    /** When this element resizes, all lines reposition. Optional. */
    containerRef?: RefObject<HTMLElement | null>;
};

/**
 * Window event that forces every active leader-line to recompute its
 * endpoints. Dispatch it whenever an arrow anchor moves without a resize or
 * scroll (e.g. a draggable panel translated via CSS transform).
 */
export const LEADER_LINES_REPOSITION_EVENT = "leaderlines:reposition";

/** Convenience dispatcher for {@link LEADER_LINES_REPOSITION_EVENT}. */
export function repositionLeaderLines(): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(LEADER_LINES_REPOSITION_EVENT));
}

let LeaderLineCtorPromise: Promise<LeaderLineCtor> | null = null;

function loadLeaderLine(): Promise<LeaderLineCtor> {
    if (typeof window === "undefined") {
        return Promise.reject(new Error("leader-line requires a window"));
    }
    if (!LeaderLineCtorPromise) {
        LeaderLineCtorPromise = import("leader-line-new").then((mod) => {
            const Ctor = (mod.default ?? mod) as unknown as LeaderLineCtor;
            return Ctor;
        });
    }
    return LeaderLineCtorPromise;
}

export function useLeaderLines(
    arrows: ArrowSpec[],
    options: UseLeaderLinesOptions = {}
): void {
    const linesRef = useRef<Map<string, LeaderLine>>(new Map());
    const defaults = options.defaults;

    useEffect(() => {
        let cancelled = false;
        void loadLeaderLine().then((Ctor) => {
            if (cancelled) return;
            const wanted = new Map(arrows.map((a) => [a.key, a]));
            const lines = linesRef.current;

            for (const [key, line] of lines) {
                const arrow = wanted.get(key);
                const source = arrow
                    ? document.querySelector(arrow.sourceSelector)
                    : null;
                const target = arrow
                    ? document.querySelector(arrow.targetSelector)
                    : null;
                if (!arrow || !source || !target) {
                    safeRemove(line);
                    lines.delete(key);
                }
            }

            for (const arrow of arrows) {
                const source = document.querySelector(arrow.sourceSelector);
                const target = document.querySelector(arrow.targetSelector);
                if (!source || !target) continue;
                const merged = {
                    ...defaults,
                    ...arrow.options,
                };
                const existing = lines.get(arrow.key);
                if (existing) {
                    try {
                        existing.setOptions(merged);
                        existing.position();
                    } catch (err) {
                        console.warn(
                            "[useLeaderLines] update failed",
                            arrow.key,
                            err
                        );
                    }
                } else {
                    try {
                        const line = new Ctor(source, target, merged);
                        lines.set(arrow.key, line);
                    } catch (err) {
                        console.warn(
                            "[useLeaderLines] create failed",
                            arrow.key,
                            err
                        );
                    }
                }
            }
        });
        return () => {
            cancelled = true;
        };
    }, [arrows, defaults]);

    useEffect(() => {
        const reposition = () => {
            for (const line of linesRef.current.values()) {
                try {
                    line.position();
                } catch {
                    // anchor went away — next reconcile will clean it up
                }
            }
        };
        window.addEventListener("resize", reposition);
        document.addEventListener("scroll", reposition, true);
        // A draggable anchor that moves via CSS transform changes neither
        // window size nor element size, so resize/scroll/ResizeObserver never
        // fire. Movable panels dispatch this event to drive live repositioning.
        window.addEventListener(LEADER_LINES_REPOSITION_EVENT, reposition);
        let ro: ResizeObserver | undefined;
        const el = options.containerRef?.current;
        if (el && typeof ResizeObserver !== "undefined") {
            ro = new ResizeObserver(reposition);
            ro.observe(el);
        }
        return () => {
            window.removeEventListener("resize", reposition);
            document.removeEventListener("scroll", reposition, true);
            window.removeEventListener(
                LEADER_LINES_REPOSITION_EVENT,
                reposition
            );
            ro?.disconnect();
        };
    }, [options.containerRef]);

    useEffect(() => {
        const lines = linesRef.current;
        return () => {
            for (const line of lines.values()) safeRemove(line);
            lines.clear();
        };
    }, []);
}

function safeRemove(line: LeaderLine): void {
    try {
        line.remove();
    } catch {
        // already detached
    }
}
