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

/** The review flag of `tab`'s layer (ADR 0167: each layer is reviewed on
 *  its own), `null` when the card has no row in that layer. */
export function layerReviewed(
    card: ScopeCardProfile,
    tab: ProfileTab
): boolean | null {
    const effective = effectiveProfile(card);
    if (effective === null) return null;
    return tab === "capabilities"
        ? effective.capabilitiesReviewed
        : effective.archetypesReviewed;
}

/** The census's one-line reason for `tab`'s layer, if it gave one. */
export function layerRationale(
    card: ScopeCardProfile,
    tab: ProfileTab
): string | undefined {
    const effective = effectiveProfile(card);
    return tab === "capabilities"
        ? effective?.capabilitiesRationale
        : effective?.archetypesRationale;
}

/** A card's status IN `tab`'s layer — the tab's table, filter and progress
 *  all read the layer on screen, never the other one. */
export function profileStatus(
    card: ScopeCardProfile,
    tab: ProfileTab
): ProfileStatus {
    const reviewed = layerReviewed(card, tab);
    if (reviewed === null) return "unprofiled";
    return reviewed ? "reviewed" : "unreviewed";
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
    filters: ProfileFilters,
    tab: ProfileTab
): ScopeCardProfile[] {
    const query = filters.search.trim().toLowerCase();
    return cards.filter((card) => {
        if (query && !card.name.toLowerCase().includes(query)) return false;
        const effective = effectiveProfile(card);
        return (
            matchesAny(filters.status, [profileStatus(card, tab)]) &&
            matchesAny(filters.archetype, effective?.archetypes ?? []) &&
            matchesAny(filters.provides, effective?.provides ?? []) &&
            matchesAny(filters.requires, effective?.requires ?? [])
        );
    });
}

function sortValue(
    card: ScopeCardProfile,
    key: ProfileSortKey,
    tab: ProfileTab
) {
    const effective = effectiveProfile(card);
    switch (key) {
        case "card":
            return card.name;
        case "status":
            return STATUS_RANK[profileStatus(card, tab)];
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
    sort: SortState<ProfileSortKey>,
    tab: ProfileTab
): ScopeCardProfile[] {
    return sortRows(cards, sort, (card, key) => sortValue(card, key, tab));
}

/** Reviewed / profiled over the WHOLE scope — never the filtered view, or
 *  the denominator would shrink with the filter that hides what is done. */
export function reviewProgress(
    cards: readonly ScopeCardProfile[] | undefined,
    tab: ProfileTab
) {
    let profiled = 0;
    let reviewed = 0;
    for (const card of cards ?? []) {
        const status = profileStatus(card, tab);
        if (status === "unprofiled") continue;
        profiled++;
        if (status === "reviewed") reviewed++;
    }
    return { profiled, reviewed };
}

export interface CatalogueCount {
    row: ArchetypeCatalogueRow;
    /** Cards a human REVIEWED as carrying the row. */
    tagged: number;
    /** Cards the census proposed the row for (unreviewed seed or DB rows). */
    proposed: number;
    signature: ColourSignature;
}

/** The rail's catalogue rows for one scope — those a card tags — with their
 *  tagged / proposed counts and the colour signature computed from ALL the
 *  cards tagged (`colourSignature`, never authored). */
export function catalogueCounts(
    cards: readonly ScopeCardProfile[],
    catalogue: readonly ArchetypeCatalogueRow[]
): CatalogueCount[] {
    const scoped = cards.map((card) => {
        const effective = effectiveProfile(card);
        return {
            archetypes: effective?.archetypes ?? [],
            colours: card.colours as Color[],
            reviewed: layerReviewed(card, "archetypes") === true,
        };
    });
    return activeRows(scoped, catalogue).map((row) => {
        const carrying = scoped.filter((card) =>
            card.archetypes.includes(row.id)
        );
        const tagged = carrying.filter((card) => card.reviewed).length;
        return {
            row,
            tagged,
            proposed: carrying.length - tagged,
            signature: colourSignature(scoped, row.id),
        };
    });
}

/** A registry description's two halves, split on its two markers
 *  (`TAG WHEN:` / `NOT:` for an Archetype row, `PROVIDES:` / `REQUIRES:`
 *  for a Capability row) — the focus dialog's `?` tooltip shows them apart.
 *  A missing second marker leaves the whole text in the first half. */
export function descriptionHalves(
    description: string,
    first: string,
    second: string
): [string, string] {
    const firstAt = description.indexOf(first);
    const body =
        firstAt === -1
            ? description
            : description.slice(firstAt + first.length);
    const secondAt = body.indexOf(second);
    if (secondAt === -1) return [body.trim(), ""];
    return [
        body.slice(0, secondAt).trim(),
        body.slice(secondAt + second.length).trim(),
    ];
}

export type ProfileField = "archetypes" | "provides" | "requires";

/** What the focus dialog hands the page on a save: the toggles of both
 *  families and the review flag. The page writes ONLY the tab's layer from
 *  it (`setCardCapabilities` / `setCardArchetypes`, ADR 0167). */
export interface LayerSave {
    archetypes: string[];
    provides: string[];
    requires: string[];
    reviewed: boolean;
}

/** The cards of the scope that carry `id` in `field` — the dialog line's
 *  related cards — the open card excluded, reviewed ones first (in the
 *  field's layer), then by name; at most `limit`. */
export function relatedCards(
    cards: readonly ScopeCardProfile[],
    field: ProfileField,
    id: string,
    excludeCardId: string,
    limit: number
): ScopeCardProfile[] {
    const tab: ProfileTab =
        field === "archetypes" ? "archetypes" : "capabilities";
    return cards
        .filter(
            (card) =>
                card.cardId !== excludeCardId &&
                (effectiveProfile(card)?.[field] ?? []).includes(id)
        )
        .sort(
            (a, b) =>
                Number(layerReviewed(b, tab) === true) -
                    Number(layerReviewed(a, tab) === true) ||
                a.name.localeCompare(b.name)
        )
        .slice(0, limit);
}

const BLANK_DESCRIPTION = "TAG WHEN: \nNOT: ";

/** Blank row a create form starts from: the description pre-seeded with the
 *  two clauses every row must carry. */
export const BLANK_CATALOGUE_ROW: ArchetypeCatalogueRow = {
    id: "",
    description: BLANK_DESCRIPTION,
    gloss: { when: "", not: "" },
    example: "",
};
