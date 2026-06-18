import { useMemo, useState, type ReactNode } from "react";
import {
    ArrowHighlightContext,
    type ArrowHighlightValue,
    type ArrowHoverSeed,
} from "~/hooks/arrowHighlightContext";

/** Holds the current arrow hover state (see {@link ArrowHighlightContext}):
 *  the hovered `seed` (written by the arrow overlay and by battlefield cards)
 *  and the resolved highlighted `nodes` (written by the arrow overlay, read by
 *  cards). Wraps the spatial board so publisher and subscribers share one
 *  channel; state only flips on hover enter/leave. */
export function ArrowHighlightProvider({ children }: { children: ReactNode }) {
    const [seed, setSeed] = useState<ArrowHoverSeed>(null);
    const [nodes, setNodes] = useState<ReadonlySet<string> | null>(null);
    const value = useMemo<ArrowHighlightValue>(
        () => ({ seed, setSeed, nodes, setNodes }),
        [seed, nodes]
    );
    return (
        <ArrowHighlightContext.Provider value={value}>
            {children}
        </ArrowHighlightContext.Provider>
    );
}
