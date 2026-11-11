// The sweep board's pure view model (PRD #8772, issue #8905; prototype
// variant B): ONE catalogue row — an Archetype in a scope, or a Capability on
// one side — across the scope's cards in three lanes. No React, so the lane
// algebra and the writes each tile makes are unit-tested on the real wire
// shape (`listScopeCardProfilesForEditor`).
import type {
    EditableCardProfile,
    ScopeCardProfile,
} from "~/hooks/useCardProfiles";
import {
    effectiveProfile,
    layerReviewed,
    profileStatus,
    type ProfileTab,
} from "./card-profiles-model";

/** Which profile field a catalogue row lives in: the scoped Archetype layer,
 *  or one direction of the scope-free Capability layer. */
export type SweepKind = "archetype" | "provides" | "requires";

export interface SweepRow {
    kind: SweepKind;
    id: string;
}

export const SWEEP_KIND_LABEL: Record<SweepKind, string> = {
    archetype: "Archetype",
    provides: "Provides",
    requires: "Requires",
};

type ProfileField = "archetypes" | "provides" | "requires";

const SWEEP_FIELD: Record<SweepKind, ProfileField> = {
    archetype: "archetypes",
    provides: "provides",
    requires: "requires",
};

/** The profile layer a sweep row lives in: an Archetype row tags the
 *  Archetype layer, a Capability row the Capability layer — so a sweep's
 *  confirm reviews that layer only (ADR 0167). */
export function sweepTab(kind: SweepKind): ProfileTab {
    return kind === "archetype" ? "archetypes" : "capabilities";
}

export type SweepLane = "reviewed" | "proposed" | "untagged";

export const SWEEP_LANE_LABEL: Record<SweepLane, string> = {
    reviewed: "Tagged · reviewed",
    proposed: "Proposed by the census",
    untagged: "Not tagged",
};

export const SWEEP_LANES: readonly SweepLane[] = [
    "reviewed",
    "proposed",
    "untagged",
];

export type SweepLanes = Record<SweepLane, ScopeCardProfile[]>;

/** Whether the card's EFFECTIVE profile (DB override, else census seed)
 *  carries the row. */
export function carriesRow(card: ScopeCardProfile, row: SweepRow): boolean {
    const effective = effectiveProfile(card);
    return effective?.[SWEEP_FIELD[row.kind]].includes(row.id) ?? false;
}

/** The three lanes, in the input order: tagged and reviewed, tagged and not
 *  yet reviewed (what the census proposed), and every card not carrying the
 *  row. Every card lands in exactly one lane. */
export function sweepLanes(
    cards: readonly ScopeCardProfile[],
    row: SweepRow
): SweepLanes {
    const lanes: SweepLanes = { reviewed: [], proposed: [], untagged: [] };
    for (const card of cards) {
        if (!carriesRow(card, row)) lanes.untagged.push(card);
        else if (profileStatus(card, sweepTab(row.kind)) === "reviewed")
            lanes.reviewed.push(card);
        else lanes.proposed.push(card);
    }
    return lanes;
}

/** The effective profile as an editable write, or a blank unreviewed one for
 *  a card neither layer covers yet. */
function baseProfile(
    card: ScopeCardProfile,
    kind: SweepKind
): EditableCardProfile {
    const effective = effectiveProfile(card);
    if (effective === null) {
        return { archetypes: [], provides: [], requires: [], reviewed: false };
    }
    return {
        archetypes: [...effective.archetypes],
        provides: [...effective.provides],
        requires: [...effective.requires],
        ...(effective.comboEdges === undefined
            ? {}
            : {
                  comboEdges: effective.comboEdges.map((edge) => ({ ...edge })),
              }),
        reviewed: layerReviewed(card, sweepTab(kind)) ?? false,
    };
}

/** A tile's tag toggle: the card's profile with the row added to (or removed
 *  from) the row's OWN field — every other field and the review flag
 *  untouched, so tagging is never a review claim. */
export function toggleRowTag(
    card: ScopeCardProfile,
    row: SweepRow
): EditableCardProfile {
    const profile = baseProfile(card, row.kind);
    const field = SWEEP_FIELD[row.kind];
    profile[field] = profile[field].includes(row.id)
        ? profile[field].filter((entry) => entry !== row.id)
        : [...profile[field], row.id];
    return profile;
}

/** "Confirm": the card's profile unchanged, marked reviewed. */
export function confirmProfile(
    card: ScopeCardProfile,
    kind: SweepKind
): EditableCardProfile {
    return { ...baseProfile(card, kind), reviewed: true };
}

export interface CapabilityCount {
    id: string;
    provides: number;
    requires: number;
}

/** The Capability rail's counts: per registry row, how many cards of the
 *  listing provide it and how many require it. */
export function capabilityCounts(
    cards: readonly ScopeCardProfile[],
    ids: readonly string[]
): CapabilityCount[] {
    return ids.map((id) => ({
        id,
        provides: cards.filter((card) =>
            carriesRow(card, { kind: "provides", id })
        ).length,
        requires: cards.filter((card) =>
            carriesRow(card, { kind: "requires", id })
        ).length,
    }));
}
