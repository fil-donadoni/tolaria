// The Card Profiles tool's pure view model (PRD #8772, issue #8903): one row
// per card of a scope, its status, the filter algebra, the sort keys and the
// rail's catalogue counts. No React, so it is unit-testable on the real wire
// shape (`listScopeCardProfilesForEditor`).
import {
    activeRows,
    colourSignature,
    type ArchetypeCatalogueRow,
    type ColourSignature,
} from "@convex/limited/archetypeCatalogueCore";
import type { Color } from "@convex/cards/types";
import type { ScopeCardProfile } from "~/hooks/useCardProfiles";
import { matchesAny, sortRows, type SortState } from "~/lib/adminTableSort";

export type ProfileStatus = "unprofiled" | "unreviewed" | "reviewed";

export const STATUS_LABEL: Record<ProfileStatus, string> = {
    unprofiled: "Unprofiled",
    unreviewed: "Unreviewed",
    reviewed: "Reviewed",
};

/** Worst-first, so an ascending Status sort is the review queue. */
const STATUS_RANK: Record<ProfileStatus, number> = {
    unprofiled: 0,
    unreviewed: 1,
    reviewed: 2,
};

export type ProfileTab = "capabilities" | "archetypes";

export type ProfileSortKey =
    | "card"
    | "status"
    | "archetypes"
    | "provides"
    | "requires";

/** The columns each tab shows, in order. */
export const TAB_COLUMNS: Record<ProfileTab, readonly ProfileSortKey[]> = {
    capabilities: ["card", "status", "provides", "requires"],
    archetypes: ["card", "status", "archetypes"],
};

export const COLUMN_LABEL: Record<ProfileSortKey, string> = {
    card: "Card",
    status: "Status",
    archetypes: "Archetypes",
    provides: "Provides",
    requires: "Requires",
};

export function effectiveProfile(card: ScopeCardProfile) {
    return card.dbProfile ?? card.seedProfile;
}

export function profileStatus(card: ScopeCardProfile): ProfileStatus {
    const effective = effectiveProfile(card);
    if (effective === null) return "unprofiled";
    return effective.reviewed ? "reviewed" : "unreviewed";
}

export interface ProfileFilters {
    search: string;
    status: string[];
    archetype: string[];
    provides: string[];
    requires: string[];
}

export const EMPTY_FILTERS: ProfileFilters = {
    search: "",
    status: [],
    archetype: [],
    provides: [],
    requires: [],
};

/** OR within a filter, AND across filters (and the name search). */
export function filterCards(
    cards: readonly ScopeCardProfile[],
    filters: ProfileFilters
): ScopeCardProfile[] {
    const query = filters.search.trim().toLowerCase();
    return cards.filter((card) => {
        if (query && !card.name.toLowerCase().includes(query)) return false;
        const effective = effectiveProfile(card);
        return (
            matchesAny(filters.status, [profileStatus(card)]) &&
            matchesAny(filters.archetype, effective?.archetypes ?? []) &&
            matchesAny(filters.provides, effective?.provides ?? []) &&
            matchesAny(filters.requires, effective?.requires ?? [])
        );
    });
}

function sortValue(card: ScopeCardProfile, key: ProfileSortKey) {
    const effective = effectiveProfile(card);
    switch (key) {
        case "card":
            return card.name;
        case "status":
            return STATUS_RANK[profileStatus(card)];
        case "archetypes":
            return (effective?.archetypes ?? []).join(", ");
        case "provides":
            return (effective?.provides ?? []).join(", ");
        case "requires":
            return (effective?.requires ?? []).join(", ");
    }
}

export function sortCards(
    cards: readonly ScopeCardProfile[],
    sort: SortState<ProfileSortKey>
): ScopeCardProfile[] {
    return sortRows(cards, sort, sortValue);
}

/** Reviewed / profiled over the WHOLE scope — never the filtered view, or
 *  the denominator would shrink with the filter that hides what is done. */
export function reviewProgress(cards: readonly ScopeCardProfile[] | undefined) {
    let profiled = 0;
    let reviewed = 0;
    for (const card of cards ?? []) {
        const status = profileStatus(card);
        if (status === "unprofiled") continue;
        profiled++;
        if (status === "reviewed") reviewed++;
    }
    return { profiled, reviewed };
}

export interface CatalogueCount {
    row: ArchetypeCatalogueRow;
    tagged: number;
    signature: ColourSignature;
}

/** The rail's catalogue rows for one scope — those a card tags — with their
 *  tagged count and the colour signature computed from the tagged cards
 *  (`colourSignature`, never authored). */
export function catalogueCounts(
    cards: readonly ScopeCardProfile[],
    catalogue: readonly ArchetypeCatalogueRow[]
): CatalogueCount[] {
    const scoped = cards.map((card) => ({
        archetypes: effectiveProfile(card)?.archetypes ?? [],
        colours: card.colours as Color[],
    }));
    return activeRows(scoped, catalogue).map((row) => ({
        row,
        tagged: scoped.filter((card) => card.archetypes.includes(row.id))
            .length,
        signature: colourSignature(scoped, row.id),
    }));
}
