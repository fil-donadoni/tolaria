import { createContext, useContext } from "react";
import type { AnchorMap, AnchorPoint } from "~/lib/target-arrow-geometry";

/** The four anchor kinds, mirroring the `data-arrow-anchor-*` key space and the
 *  {@link AnchorMap} buckets. */
export type AnchorKind = "stack" | "permanent" | "player" | "graveyard";

export type ArrowAnchorContextValue = {
    /** Publish (or move) an anchor point in board-root coordinates. Idempotent;
     *  call again with the same `kind`/`id` to update the point as a card
     *  animates between placements. */
    publish: (kind: AnchorKind, id: string, point: AnchorPoint) => void;
    /** Remove an anchor (card left the zone / stack item resolved). */
    unpublish: (kind: AnchorKind, id: string) => void;
    /** The current assembled map of every published anchor. */
    anchors: AnchorMap;
};

export const ArrowAnchorContext = createContext<ArrowAnchorContextValue | null>(
    null
);

/** Subscribe to the assembled anchor map. Returns `null` outside a provider
 *  (e.g. the classic board), so consumers can no-op gracefully. */
export function useArrowAnchors(): ArrowAnchorContextValue | null {
    return useContext(ArrowAnchorContext);
}
