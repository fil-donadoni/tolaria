import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";

// Card Profile Admin editor (PRD #1607, ADR 0072, issue #1614). Thin wrapper
// hooks over `convex/limited/cardProfiles.ts`'s editor query/mutations —
// mirrors `useCardRatings.ts` exactly so components never import
// `convex/react`/`api` directly (CLAUDE.md: types come from `convex/`, the
// frontend only reaches the domain through public queries/mutations).

/** One card of a chosen scope annotated with BOTH profile layers — the exact
 *  wire shape `listScopeCardProfilesForEditor` returns (`{ cardId, name,
 *  dbProfile, seedProfile }`). */
export type ScopeCardProfile = FunctionReturnType<
    typeof api.limited.cardProfiles.listScopeCardProfilesForEditor
>[number];

/** The `CardProfile` half of a row — what the editor writes back. */
export type EditableCardProfile = NonNullable<ScopeCardProfile["dbProfile"]>;

/** Every profiled/profilable card of `scope`, `undefined` while loading.
 *  `scope` undefined skips the query (no scope chosen yet). Admin-gated
 *  server-side (`assertIsAdmin`) — the panel itself is already gated on
 *  `canEditPresets` before it ever mounts this hook. */
export function useScopeCardProfiles(
    scope: string | undefined
): ScopeCardProfile[] | undefined {
    return useQuery(
        api.limited.cardProfiles.listScopeCardProfilesForEditor,
        scope ? { scope } : "skip"
    );
}

/** The two write mutations the editor's inline controls fire —
 *  `setCardProfile` (save, including the review toggle) and
 *  `clearCardProfile` (revert to the checked-in census seed / to no profile).
 *  Both are admin-gated server-side; callers must disable their controls
 *  while a call from either is in flight (project-wide rule). */
export function useCardProfileMutations() {
    const setProfile = useMutation(api.limited.cardProfiles.setCardProfile);
    const clearProfile = useMutation(api.limited.cardProfiles.clearCardProfile);
    return { setProfile, clearProfile };
}
