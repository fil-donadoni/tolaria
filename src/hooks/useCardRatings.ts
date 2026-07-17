import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";

// Bot Pick Rating Admin editor (PRD #1296 Slice C, issue #1300). Thin wrapper
// hooks over `convex/limited/cardRatings.ts`'s query/mutations — mirrors
// `useLimitedEvent.ts`'s shape so components never import `convex/react`/
// `api` directly (CLAUDE.md: types come from `convex/`, the frontend only
// reaches the GRE/domain through public mutations/queries).

/** One card of a chosen scope, annotated with both rating layers — the exact
 *  wire shape `listScopeCardRatings` returns (`{ cardId, name, dbRating,
 *  seedRating }`). */
export type ScopeCardRating = FunctionReturnType<
    typeof api.limited.cardRatings.listScopeCardRatings
>[number];

/** Every rated/ratable card of `scope`, `undefined` while loading. `scope`
 *  undefined skips the query (no scope chosen yet). Admin-gated server-side
 *  (`assertIsAdmin`) — a non-admin caller's query throws, which `useQuery`
 *  surfaces by leaving the value `undefined` (mirrors `useCurrentUser`'s
 *  loading-vs-denied ambiguity; the panel itself is already gated on
 *  `canEditPresets` before it ever mounts this hook). */
export function useScopeCardRatings(
    scope: string | undefined
): ScopeCardRating[] | undefined {
    return useQuery(
        api.limited.cardRatings.listScopeCardRatings,
        scope ? { scope } : "skip"
    );
}

/** The two write mutations the editor's inline rating controls fire —
 *  `setCardRating` (save) and `clearCardRating` (revert to seed/heuristic).
 *  Both are admin-gated server-side; callers must disable their controls
 *  while a call from either is in flight (project-wide rule). */
export function useCardRatingMutations() {
    const setRating = useMutation(api.limited.cardRatings.setCardRating);
    const clearRating = useMutation(api.limited.cardRatings.clearCardRating);
    return { setRating, clearRating };
}
