import { createContext, useContext } from "react";

/** What is currently hovered: a specific arrow (`key`) or a board node such as
 *  a battlefield permanent (`nodeId`). `null` = nothing hovered. Either kind is
 *  resolved by the arrow layer into the highlighted relationship. */
export type ArrowHoverSeed = { key: string } | { nodeId: string } | null;

/**
 * Shared hover-highlight channel for the spatial board's arrow layer
 * (PRD #249, combat-read). Two writers feed the SAME seed:
 *
 * - the **arrow overlay** — each path has a wide invisible hit-stroke; hovering
 *   it seeds `{ key }`;
 * - **battlefield cards** — hovering a permanent seeds `{ nodeId }` (so a
 *   creature lights its own combat cluster / target relationship, on top of its
 *   existing tilt + card-preview, which are untouched).
 *
 * The arrow overlay reads the seed, resolves it into the highlighted set
 * (direct 1-hop for target arrows, the whole transitive cluster for combat),
 * renders its own dim/emphasis, and writes the resolved node ids back to
 * `nodes`. Cards subscribe to `nodes` and illuminate when their id is in it,
 * dim when a highlight is active and they are not. `nodes === null` → nothing
 * hovered (or the hovered node has no relationship) → full strength everywhere.
 */
export type ArrowHighlightValue = {
    seed: ArrowHoverSeed;
    setSeed: (seed: ArrowHoverSeed) => void;
    nodes: ReadonlySet<string> | null;
    setNodes: (nodes: ReadonlySet<string> | null) => void;
};

export const ArrowHighlightContext = createContext<ArrowHighlightValue | null>(
    null
);

/** Subscribe to the arrow hover-highlight. Returns `null` outside a provider
 *  (e.g. the classic board), so callers no-op gracefully. */
export function useArrowHighlight(): ArrowHighlightValue | null {
    return useContext(ArrowHighlightContext);
}
