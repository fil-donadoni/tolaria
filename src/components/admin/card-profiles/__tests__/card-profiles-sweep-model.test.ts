// The sweep board's lane algebra and tile writes (PRD #8772, issue #8905),
// driven on the REAL editor-query projection (`listScopeCards` +
// `buildScopeCardProfiles` over the checked-in census) — a hand-built row
// could not catch a field the projection drops.
import { describe, it, expect } from "vitest";
import {
    buildCardProfileRows,
    buildDbProfileLayers,
    buildScopeCardProfiles,
    EMPTY_PROFILE_LAYERS,
    type ProfileLayers,
} from "@convex/limited/cardProfilesCore";
import { listScopeCards } from "@convex/limited/cardRatingsCore";
import { CUBE_SOURCE_KEY } from "@convex/limited/cube";
import { tryGetCardByName } from "@convex/cards";
import type { ScopeCardProfile } from "~/hooks/useCardProfiles";
import {
    capabilityCounts,
    confirmProfile,
    sweepLanes,
    toggleRowTag,
} from "../card-profiles-sweep-model";

function cardId(name: string): string {
    const def = tryGetCardByName(name);
    if (!def) throw new Error(`test fixture: no card named "${name}"`);
    return def.id;
}

const SAMPLE = ["Griselbrand", "Reanimate", "Lightning Bolt"].map(cardId);

function rows(db: ProfileLayers = EMPTY_PROFILE_LAYERS): ScopeCardProfile[] {
    const wanted = new Set(SAMPLE);
    const cards = listScopeCards(CUBE_SOURCE_KEY).filter((card) =>
        wanted.has(card.cardId)
    );
    return buildScopeCardProfiles(CUBE_SOURCE_KEY, cards, db);
}

function names(cards: readonly ScopeCardProfile[]): string[] {
    return cards.map((card) => card.name).sort();
}

/** Reanimate reviewed as reanimator in the DB; Griselbrand left to the census. */
function withReviewedReanimate(): ScopeCardProfile[] {
    const save = buildCardProfileRows(CUBE_SOURCE_KEY, cardId("Reanimate"), {
        archetypes: ["reanimator"],
        provides: [],
        requires: ["reanimatable"],
        reviewed: true,
    });
    return rows(
        buildDbProfileLayers({
            capabilities: [save.capabilities],
            archetypes: [save.archetypes],
        })
    );
}

describe("sweepLanes (issue #8905)", () => {
    it("splits the scope into reviewed, census-proposed and untagged — every card in one lane", () => {
        const cards = withReviewedReanimate();
        const lanes = sweepLanes(cards, {
            kind: "archetype",
            id: "reanimator",
        });
        expect(names(lanes.reviewed)).toEqual(["Reanimate"]);
        expect(names(lanes.proposed)).toEqual(["Griselbrand"]);
        expect(names(lanes.untagged)).toEqual(["Lightning Bolt"]);
    });

    it("reads a Capability row from its own side only", () => {
        const cards = withReviewedReanimate();
        const provides = sweepLanes(cards, {
            kind: "provides",
            id: "reanimatable",
        });
        expect(names(provides.proposed)).toEqual(["Griselbrand"]);
        expect(names(provides.untagged)).toContain("Reanimate");
        const requires = sweepLanes(cards, {
            kind: "requires",
            id: "reanimatable",
        });
        expect(names(requires.reviewed)).toEqual(["Reanimate"]);
        expect(names(requires.untagged)).toContain("Griselbrand");
    });
});

describe("tile writes (issue #8905)", () => {
    it("the tag toggle writes the row's own field and keeps the review flag", () => {
        const bolt = rows().find((card) => card.name === "Lightning Bolt")!;
        const before = bolt.dbProfile ?? bolt.seedProfile;
        const tagged = toggleRowTag(bolt, { kind: "archetype", id: "control" });
        expect(tagged.archetypes).toEqual([
            ...(before?.archetypes ?? []),
            "control",
        ]);
        expect(tagged.provides).toEqual(before?.provides ?? []);
        expect(tagged.requires).toEqual(before?.requires ?? []);
        expect(tagged.reviewed).toBe(before?.reviewed ?? false);

        const griselbrand = rows().find((card) => card.name === "Griselbrand")!;
        const untagged = toggleRowTag(griselbrand, {
            kind: "provides",
            id: "reanimatable",
        });
        expect(untagged.provides).not.toContain("reanimatable");
        expect(untagged.archetypes).toEqual(
            griselbrand.seedProfile?.archetypes
        );
    });

    it("confirm keeps the profile and marks it reviewed", () => {
        const griselbrand = rows().find((card) => card.name === "Griselbrand")!;
        expect(confirmProfile(griselbrand)).toEqual({
            ...griselbrand.seedProfile,
            reviewed: true,
        });
    });

    it("counts each Capability on both sides", () => {
        const [reanimatable] = capabilityCounts(withReviewedReanimate(), [
            "reanimatable",
        ]);
        expect(reanimatable).toEqual({
            id: "reanimatable",
            provides: 1,
            requires: 1,
        });
    });
});
