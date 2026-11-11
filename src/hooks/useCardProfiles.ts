import { useConvex, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import {
    ARCHETYPE_CATALOGUE_SEED,
    type ArchetypeCatalogueRow,
} from "@convex/limited/archetypeCatalogueCore";

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

/** The effective profile half of a row — both layers' data, each layer's
 *  own review flag and census rationale. */
export type EditorCardProfile = NonNullable<ScopeCardProfile["dbProfile"]>;

/** One layer's editable write — what the sweep board and the focus dialog
 *  hand the page; the page routes it to the layer's own mutation. */
export interface EditableCardProfile {
    archetypes: string[];
    provides: string[];
    requires: string[];
    comboEdges?: { cardId: string; weight: number }[];
    reviewed: boolean;
}

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

/** The effective Archetype Catalogue (seed ∪ DB) the editor's Archetype
 *  picker offers — the checked-in seed while the query loads, so the picker
 *  is never empty; a row an Admin adds arrives with the query. Admin-gated
 *  server-side, like every editor read. */
export function useArchetypeCatalogue(): readonly ArchetypeCatalogueRow[] {
    return (
        useQuery(api.limited.archetypeCatalogue.listArchetypeCatalogue, {}) ??
        ARCHETYPE_CATALOGUE_SEED
    );
}

/** The editor's write mutations, ONE LAYER each (ADR 0167, issue #8904):
 *  the Capabilities tab saves/clears the scope-free Capability row, the
 *  Archetypes tab the scope's Archetype row — so "Mark reviewed" flips only
 *  the flag of the layer on screen. Admin-gated server-side; callers disable
 *  their controls while a call is in flight (project-wide rule). */
export function useCardProfileMutations() {
    const setCapabilities = useMutation(
        api.limited.cardProfiles.setCardCapabilities
    );
    const setArchetypes = useMutation(
        api.limited.cardProfiles.setCardArchetypes
    );
    const clearCapabilities = useMutation(
        api.limited.cardProfiles.clearCardCapabilities
    );
    const clearArchetypes = useMutation(
        api.limited.cardProfiles.clearCardArchetypes
    );
    return {
        setCapabilities,
        setArchetypes,
        clearCapabilities,
        clearArchetypes,
    };
}

/** One Card Profile layer, as `exportCardProfileSeedFile` names it. */
export type CardProfileExportLayer = "capabilities" | "archetypes";

/** Fetches one layer's effective rows (DB over seed) as its seed-file text
 *  ON DEMAND — an export is a one-shot read on click, never a live
 *  subscription (issue #8907). Admin-gated server-side. */
export function useCardProfileExport() {
    const convex = useConvex();
    return (layer: CardProfileExportLayer, scope: string | undefined) =>
        convex.query(api.limited.cardProfiles.exportCardProfileSeedFile, {
            layer,
            ...(scope === undefined ? {} : { scope }),
        });
}

/** The Archetype Catalogue's two admin writes — add a row, edit a row. Both
 *  re-validate server-side (`archetypeCatalogueWriteErrors`) and reject with
 *  the reason; callers disable their controls while one is in flight. */
export function useArchetypeCatalogueMutations() {
    const createRow = useMutation(
        api.limited.archetypeCatalogue.createArchetypeRow
    );
    const updateRow = useMutation(
        api.limited.archetypeCatalogue.updateArchetypeRow
    );
    return { createRow, updateRow };
}
