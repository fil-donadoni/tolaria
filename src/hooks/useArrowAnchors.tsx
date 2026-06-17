import { useCallback, useMemo, useState, type ReactNode } from "react";
import { emptyAnchorMap, type AnchorPoint } from "~/lib/target-arrow-geometry";
import {
    ArrowAnchorContext,
    type AnchorKind,
    type ArrowAnchorContextValue,
} from "~/hooks/arrowAnchorContext";

/**
 * Registry for SVG target-arrow anchor points on the spatial board (PRD #249,
 * slice #257).
 *
 * Each zone / edge anchor publishes its items' centers in **board-root
 * coordinates** — derived from the shared layout placements that position the
 * cards (`board-layout.ts`), not from sampling the moving DOM. The arrow layer
 * (`board-next-arrows.tsx`) subscribes to the assembled {@link AnchorMap} and
 * recomputes arrow geometry whenever any anchor moves, so arrows stay glued to
 * continuously-animating cards with no reflow.
 *
 * The map lives in React state and is updated immutably per change: a publish
 * that actually moves a point replaces only the affected bucket (other buckets
 * keep their identity), so the geometry `useMemo` in the arrow layer recomputes
 * only when a relevant anchor moved. Writes happen in `publish`/`unpublish`
 * (callbacks, never during render), keeping the React-19 refs lint clean.
 */
export function ArrowAnchorProvider({ children }: { children: ReactNode }) {
    const [anchors, setAnchors] = useState(emptyAnchorMap);

    const publish = useCallback(
        (kind: AnchorKind, id: string, point: AnchorPoint) => {
            setAnchors((prev) => {
                const cur = prev[kind][id];
                if (cur && cur.x === point.x && cur.y === point.y) return prev;
                return {
                    ...prev,
                    [kind]: { ...prev[kind], [id]: point },
                };
            });
        },
        []
    );

    const unpublish = useCallback((kind: AnchorKind, id: string) => {
        setAnchors((prev) => {
            if (prev[kind][id] === undefined) return prev;
            const next = { ...prev[kind] };
            delete next[id];
            return { ...prev, [kind]: next };
        });
    }, []);

    const value = useMemo<ArrowAnchorContextValue>(
        () => ({ publish, unpublish, anchors }),
        [publish, unpublish, anchors]
    );

    return (
        <ArrowAnchorContext.Provider value={value}>
            {children}
        </ArrowAnchorContext.Provider>
    );
}
