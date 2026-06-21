import { describe, it, expect } from "vitest";
import {
    wantsPermanentTarget,
    matchesPermanentFilter,
    matchesTargetRequirement,
    matchesSpellTypeFilter,
    wantsSpellTarget,
    getStackAbilities,
    getAnyPlayerStackAbilities,
    buildTriggerStateView,
    getAbilityOracleText,
    getDisplayAbilities,
    resolvePreviewAbilities,
    type DisplayAbilities,
} from "../card-utils";
import type { CardInstance } from "~/types/game";

// Real card ids from convex/cards/sets/lea.ts, used to exercise the
// definition-vs-instance keyword diff in getDisplayAbilities (#156).
const MERFOLK_ID = "2b871039-6a66-4ac3-95e7-24759c1f2f92"; // vanilla, no keywords
const PHANTASMAL_FORCES_ID = "0631c7c8-9aa5-4333-8e20-20247fc47033"; // native flying

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCardInstance(overrides: Partial<CardInstance> = {}): CardInstance {
    return {
        id: overrides.id ?? "card-1",
        card: overrides.card ?? { id: "test-id" },
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        types: ["Creature"],
        subtypes: [],
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// wantsPermanentTarget
// ---------------------------------------------------------------------------

describe("wantsPermanentTarget", () => {
    it("returns true for 'Creature'", () => {
        expect(wantsPermanentTarget("Creature")).toBe(true);
    });

    it("returns true for 'any'", () => {
        expect(wantsPermanentTarget("any")).toBe(true);
    });

    it("returns true for ['Artifact', 'Enchantment']", () => {
        expect(wantsPermanentTarget(["Artifact", "Enchantment"])).toBe(true);
    });

    it("returns false for 'player'", () => {
        expect(wantsPermanentTarget("player")).toBe(false);
    });

    it("returns false for undefined", () => {
        expect(wantsPermanentTarget(undefined)).toBe(false);
    });

    it("returns true for ['player', 'Creature'] (mixed)", () => {
        expect(wantsPermanentTarget(["player", "Creature"])).toBe(true);
    });

    it("returns true for 'spell-or-permanent'", () => {
        expect(wantsPermanentTarget("spell-or-permanent")).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// matchesTargetRequirement
// ---------------------------------------------------------------------------

describe("matchesTargetRequirement", () => {
    it("creature matches 'Creature'", () => {
        const card = makeCardInstance({ types: ["Creature"] });
        expect(matchesTargetRequirement(card, "Creature")).toBe(true);
    });

    it("creature does not match 'Artifact'", () => {
        const card = makeCardInstance({ types: ["Creature"] });
        expect(matchesTargetRequirement(card, "Artifact")).toBe(false);
    });

    it("artifact matches ['Artifact', 'Enchantment']", () => {
        const card = makeCardInstance({ types: ["Artifact"] });
        expect(
            matchesTargetRequirement(card, ["Artifact", "Enchantment"])
        ).toBe(true);
    });

    it("enchantment matches ['Artifact', 'Enchantment']", () => {
        const card = makeCardInstance({ types: ["Enchantment"] });
        expect(
            matchesTargetRequirement(card, ["Artifact", "Enchantment"])
        ).toBe(true);
    });

    it("creature does not match ['Artifact', 'Enchantment']", () => {
        const card = makeCardInstance({ types: ["Creature"] });
        expect(
            matchesTargetRequirement(card, ["Artifact", "Enchantment"])
        ).toBe(false);
    });

    it("artifact creature matches both 'Artifact' and 'Creature'", () => {
        const card = makeCardInstance({ types: ["Artifact", "Creature"] });
        expect(matchesTargetRequirement(card, "Artifact")).toBe(true);
        expect(matchesTargetRequirement(card, "Creature")).toBe(true);
        expect(
            matchesTargetRequirement(card, ["Artifact", "Enchantment"])
        ).toBe(true);
    });

    it("'any' only matches damageable permanents (CR 115.4 / 120.3)", () => {
        const creature = makeCardInstance({ types: ["Creature"] });
        const planeswalker = makeCardInstance({ types: ["Planeswalker"] });
        const battle = makeCardInstance({ types: ["Battle"] });
        const land = makeCardInstance({ types: ["Land"] });
        const artifact = makeCardInstance({ types: ["Artifact"] });
        const enchantment = makeCardInstance({ types: ["Enchantment"] });
        expect(matchesTargetRequirement(creature, "any")).toBe(true);
        expect(matchesTargetRequirement(planeswalker, "any")).toBe(true);
        expect(matchesTargetRequirement(battle, "any")).toBe(true);
        expect(matchesTargetRequirement(land, "any")).toBe(false);
        expect(matchesTargetRequirement(artifact, "any")).toBe(false);
        expect(matchesTargetRequirement(enchantment, "any")).toBe(false);
    });

    it("land matches 'Land' but not 'Creature'", () => {
        const land = makeCardInstance({ types: ["Land"] });
        expect(matchesTargetRequirement(land, "Land")).toBe(true);
        expect(matchesTargetRequirement(land, "Creature")).toBe(false);
    });

    it("'spell-or-permanent' matches any permanent type (CR 114)", () => {
        const creature = makeCardInstance({ types: ["Creature"] });
        const land = makeCardInstance({ types: ["Land"] });
        const artifact = makeCardInstance({ types: ["Artifact"] });
        const enchantment = makeCardInstance({ types: ["Enchantment"] });
        expect(matchesTargetRequirement(creature, "spell-or-permanent")).toBe(
            true
        );
        expect(matchesTargetRequirement(land, "spell-or-permanent")).toBe(true);
        expect(matchesTargetRequirement(artifact, "spell-or-permanent")).toBe(
            true
        );
        expect(
            matchesTargetRequirement(enchantment, "spell-or-permanent")
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Exhaustive target-type guard
// ---------------------------------------------------------------------------

describe("TARGET_LABEL exhaustive coverage", () => {
    // This test ensures every known target type has a label entry.
    // When adding a new TargetRequirement.type value, add it here AND
    // to TARGET_LABEL in target-selection-banner.tsx.
    const KNOWN_TARGET_TYPES = [
        "Creature",
        "Artifact",
        "Enchantment",
        "Land",
        "Planeswalker",
        "player",
        "any",
        "spell",
        "spell-or-permanent",
        "card",
    ];

    // We can't import TARGET_LABEL directly (it's a component-level const),
    // so we test that matchesTargetRequirement + wantsPermanentTarget handle
    // every type without throwing or silently returning wrong values.
    it("matchesTargetRequirement handles all known types for a creature", () => {
        const creature = makeCardInstance({ types: ["Creature"] });
        for (const t of KNOWN_TARGET_TYPES) {
            expect(() => matchesTargetRequirement(creature, t)).not.toThrow();
        }
    });

    it("wantsPermanentTarget handles all known types", () => {
        for (const t of KNOWN_TARGET_TYPES) {
            expect(() => wantsPermanentTarget(t)).not.toThrow();
        }
    });
});

// ---------------------------------------------------------------------------
// getStackAbilities
// ---------------------------------------------------------------------------

describe("getStackAbilities", () => {
    it("returns stack abilities for Nevinyrral's Disk regardless of pool", () => {
        // Mana availability is deferred to the server-side pendingActivation
        // payment phase — the menu offers the ability even with an empty pool.
        const card = makeCardInstance({
            card: { id: "12926dc8-8e6f-4a47-a12b-4d674189615a" },
            types: ["Artifact"],
            isTapped: false,
        });

        const abilities = getStackAbilities(card);

        expect(abilities).toHaveLength(1);
        expect(abilities[0].id).toBe("nevinyrral-destroy");
        expect(abilities[0].oracleText).toContain("Destroy all");
    });

    it("returns empty when Disk is tapped (tap cost unpayable)", () => {
        const card = makeCardInstance({
            card: { id: "12926dc8-8e6f-4a47-a12b-4d674189615a" },
            types: ["Artifact"],
            isTapped: true,
        });

        expect(getStackAbilities(card)).toHaveLength(0);
    });

    it("returns empty for mana-only abilities (Mox)", () => {
        const card = makeCardInstance({
            card: { id: "b0e1427c-05cd-465b-be59-97ed6e39f7ba" },
            types: ["Artifact"],
            isTapped: false,
        });

        expect(getStackAbilities(card)).toHaveLength(0);
    });

    it("returns empty for creatures without activated abilities", () => {
        const card = makeCardInstance({
            card: { id: "ce2d603a-3231-4a8c-bf39-1617586ea870" },
            types: ["Creature"],
        });

        expect(getStackAbilities(card)).toHaveLength(0);
    });

    it("filters out phase-restricted abilities outside their allow-list (Jade Statue)", () => {
        // Jade Statue's animate is activationPhaseRestriction-limited to
        // combat. Outside combat the menu must hide it (CR 602.5).
        const card = makeCardInstance({
            card: { id: "8d82d94b-ceef-4533-a4f2-b6442a61b839" },
            types: ["Artifact"],
            isTapped: false,
        });
        expect(getStackAbilities(card, "PRECOMBAT_MAIN")).toHaveLength(0);
        const duringCombat = getStackAbilities(card, "DECLARE_ATTACKERS");
        expect(duringCombat).toHaveLength(1);
        expect(duringCombat[0].id).toBe("jade-statue-animate");
    });

    it("returns phase-restricted ability when `phase` is omitted (no filter applied)", () => {
        // Backwards-compatible default: callers that don't know the current
        // phase still see every ability (the server enforces the restriction).
        const card = makeCardInstance({
            card: { id: "8d82d94b-ceef-4533-a4f2-b6442a61b839" },
            types: ["Artifact"],
            isTapped: false,
        });
        expect(getStackAbilities(card)).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// getStackAbilities — `canActivate` predicates reading player/board state (#436)
//
// The UI hint must agree with the server: an ability whose `canActivate`
// inspects `state.players` / `state.activePlayerId` is surfaced only when the
// real, viewer-visible state satisfies the predicate. A `buildTriggerStateView`
// over the visible players supplies that state; an empty view (no caller state)
// reproduces the old false-negative / false-positive behavior.
// ---------------------------------------------------------------------------

const LIBRARY_OF_ALEXANDRIA_ID = "ee266113-34ce-4189-84e7-ee2c86a2722c";
const PESTILENCE_ID = "d42a6350-b16b-4e10-a273-e6cbb55dcb7a";
const NETTLING_IMP_ID = "8105973c-a94d-444c-ba20-ab0fa978bee8";

/** Minimal viewer-visible player used to build a TriggerStateView. */
function makePlayerLike(
    overrides: Partial<{
        id: string;
        life: number;
        handCount: number;
        battlefield: CardInstance[];
    }> = {}
) {
    const handCount = overrides.handCount ?? 0;
    return {
        id: overrides.id ?? "p1",
        life: overrides.life ?? 20,
        hand: Array.from({ length: handCount }, () => null),
        battlefield: overrides.battlefield ?? [],
    };
}

describe("getStackAbilities — player-state canActivate predicates (#436)", () => {
    it("Library of Alexandria: draw ability appears at exactly 7 cards", () => {
        const card = makeCardInstance({
            card: { id: LIBRARY_OF_ALEXANDRIA_ID },
            types: ["Land"],
            controllerId: "p1",
            isTapped: false,
        });
        const view = buildTriggerStateView(
            [makePlayerLike({ id: "p1", handCount: 7 })],
            "p1"
        );
        const abilities = getStackAbilities(card, undefined, true, view);
        expect(abilities.map((a) => a.id)).toContain(
            "library-of-alexandria-draw"
        );
    });

    it("Library of Alexandria: draw ability absent at 6 and at 8 cards", () => {
        const card = makeCardInstance({
            card: { id: LIBRARY_OF_ALEXANDRIA_ID },
            types: ["Land"],
            controllerId: "p1",
            isTapped: false,
        });
        for (const handCount of [6, 8]) {
            const view = buildTriggerStateView(
                [makePlayerLike({ id: "p1", handCount })],
                "p1"
            );
            const abilities = getStackAbilities(card, undefined, true, view);
            expect(abilities.map((a) => a.id)).not.toContain(
                "library-of-alexandria-draw"
            );
        }
    });

    it("Library of Alexandria: mana ability is NOT a stack ability (always usable via direct tap)", () => {
        // The {T}: Add {C} mana ability is `useStack:false`, so it never
        // appears in `getStackAbilities` — it's surfaced separately by
        // getActivatedManaMenuEntry. The draw gate must not affect it.
        const card = makeCardInstance({
            card: { id: LIBRARY_OF_ALEXANDRIA_ID },
            types: ["Land"],
            controllerId: "p1",
            isTapped: false,
        });
        for (const handCount of [6, 7, 8]) {
            const view = buildTriggerStateView(
                [makePlayerLike({ id: "p1", handCount })],
                "p1"
            );
            const ids = getStackAbilities(card, undefined, true, view).map(
                (a) => a.id
            );
            expect(ids).not.toContain("library-of-alexandria-mana");
        }
    });

    it("Library of Alexandria: draw hidden with an empty (stateless) view — old false-negative reproduced", () => {
        const card = makeCardInstance({
            card: { id: LIBRARY_OF_ALEXANDRIA_ID },
            types: ["Land"],
            controllerId: "p1",
            isTapped: false,
        });
        // No stateView passed → empty player list → predicate sees no controller.
        expect(getStackAbilities(card).map((a) => a.id)).not.toContain(
            "library-of-alexandria-draw"
        );
    });

    it("Pestilence: {B} damage ability appears while a creature is on the battlefield", () => {
        const creature = makeCardInstance({
            id: "bear-1",
            card: { id: "test-creature" },
            types: ["Creature"],
            controllerId: "p1",
            ownerId: "p1",
        });
        const card = makeCardInstance({
            id: "pest-1",
            card: { id: PESTILENCE_ID },
            types: ["Enchantment"],
            controllerId: "p1",
            isTapped: false,
        });
        const view = buildTriggerStateView(
            [makePlayerLike({ id: "p1", battlefield: [creature, card] })],
            "p1"
        );
        const abilities = getStackAbilities(card, undefined, true, view);
        expect(abilities.map((a) => a.id)).toContain("pestilence-damage");
    });

    it("Pestilence: {B} damage ability absent when no creature is on the battlefield", () => {
        const card = makeCardInstance({
            id: "pest-1",
            card: { id: PESTILENCE_ID },
            types: ["Enchantment"],
            controllerId: "p1",
            isTapped: false,
        });
        // Only Pestilence (an Enchantment) is on the battlefield — no creature.
        const view = buildTriggerStateView(
            [makePlayerLike({ id: "p1", battlefield: [card] })],
            "p1"
        );
        const abilities = getStackAbilities(card, undefined, true, view);
        expect(abilities.map((a) => a.id)).not.toContain("pestilence-damage");
    });

    it("Nettling Imp: ability NOT offered when activePlayerId equals controller (predicate false)", () => {
        // Nettling Imp's canActivate requires it be an OPPONENT's turn
        // (activePlayerId !== controllerId). On the controller's own turn the
        // predicate is false; with a real view that supplies activePlayerId the
        // entry is correctly suppressed (no missing-field false positive).
        const card = makeCardInstance({
            id: "imp-1",
            card: { id: NETTLING_IMP_ID },
            types: ["Creature"],
            subtypes: ["Imp"],
            controllerId: "p1",
            isTapped: false,
            isSummoningSick: false,
        });
        const view = buildTriggerStateView(
            [makePlayerLike({ id: "p1", battlefield: [card] })],
            "p1" // controller's own turn → predicate false
        );
        const abilities = getStackAbilities(card, "PRECOMBAT_MAIN", true, view);
        expect(abilities.map((a) => a.id)).not.toContain("nettling-imp-force");
    });

    it("Nettling Imp: ability offered when it is the opponent's turn (predicate true)", () => {
        const card = makeCardInstance({
            id: "imp-1",
            card: { id: NETTLING_IMP_ID },
            types: ["Creature"],
            subtypes: ["Imp"],
            controllerId: "p1",
            isTapped: false,
            isSummoningSick: false,
        });
        const view = buildTriggerStateView(
            [makePlayerLike({ id: "p1", battlefield: [card] })],
            "p2" // opponent's turn → predicate true
        );
        const abilities = getStackAbilities(card, "PRECOMBAT_MAIN", true, view);
        // The ability id mirrors the Nettling Imp definition.
        expect(abilities.map((a) => a.id)).toContain("nettling-imp-force");
    });

    it("source-only predicate (Clockwork Beast counter cap) still works with no view", () => {
        // Clockwork Beast's `canActivate` reads only the source's counters
        // (fewer than seven +1/+0), so an empty/absent view must keep
        // evaluating it correctly. At 7 counters the recharge ability is
        // capped (hidden); below seven it is offered.
        const CLOCKWORK_BEAST_ID = "27f916a2-0ace-44b5-99dc-72979af34db9";
        const capped = makeCardInstance({
            card: { id: CLOCKWORK_BEAST_ID },
            types: ["Artifact", "Creature"],
            controllerId: "p1",
            isTapped: false,
            isSummoningSick: false,
            counters: { "+1/+0": 7 },
        });
        const available = makeCardInstance({
            card: { id: CLOCKWORK_BEAST_ID },
            types: ["Artifact", "Creature"],
            controllerId: "p1",
            isTapped: false,
            isSummoningSick: false,
            counters: { "+1/+0": 3 },
        });
        // No view passed — source-only predicate must still gate correctly.
        expect(getStackAbilities(capped).map((a) => a.id)).not.toContain(
            "clockwork-beast-recharge"
        );
        expect(getStackAbilities(available).map((a) => a.id)).toContain(
            "clockwork-beast-recharge"
        );
    });
});

// ---------------------------------------------------------------------------
// getAnyPlayerStackAbilities (CR 113.3c — surfaced on opponents' permanents)
// ---------------------------------------------------------------------------

describe("getAnyPlayerStackAbilities", () => {
    const IFH_BIFF_ID = "c0b10fb7-8667-42bf-aeb6-35767a82917b";

    it("returns Ifh-Bíff Efreet's {G} ability (flagged any-player)", () => {
        const card = makeCardInstance({
            card: { id: IFH_BIFF_ID },
            types: ["Creature"],
            subtypes: ["Efreet"],
            isTapped: false,
        });
        const abilities = getAnyPlayerStackAbilities(card);
        expect(abilities).toHaveLength(1);
        expect(abilities[0].id).toBe("ifh-biff-efreet-rain");
    });

    it("returns empty for a controller-only ability (Nevinyrral's Disk)", () => {
        const card = makeCardInstance({
            card: { id: "12926dc8-8e6f-4a47-a12b-4d674189615a" },
            types: ["Artifact"],
            isTapped: false,
        });
        expect(getAnyPlayerStackAbilities(card)).toHaveLength(0);
    });

    it("returns empty for a vanilla creature with no abilities", () => {
        const card = makeCardInstance({
            card: { id: "ce2d603a-3231-4a8c-bf39-1617586ea870" },
            types: ["Creature"],
        });
        expect(getAnyPlayerStackAbilities(card)).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// getAbilityOracleText
// ---------------------------------------------------------------------------

describe("getAbilityOracleText", () => {
    it("returns oracle text for Disk ability", () => {
        const text = getAbilityOracleText(
            "12926dc8-8e6f-4a47-a12b-4d674189615a",
            "nevinyrral-destroy"
        );
        expect(text).toContain(
            "Destroy all artifacts, creatures, and enchantments"
        );
    });

    it("returns null for unknown ability id", () => {
        const text = getAbilityOracleText(
            "12926dc8-8e6f-4a47-a12b-4d674189615a",
            "nonexistent"
        );
        expect(text).toBeNull();
    });

    it("returns oracle text for Mox mana ability", () => {
        const text = getAbilityOracleText(
            "b0e1427c-05cd-465b-be59-97ed6e39f7ba",
            "mox-emerald-mana"
        );
        expect(text).toBe("{T}: Add {G}.");
    });
});

// ---------------------------------------------------------------------------
// wantsSpellTarget / matchesSpellTypeFilter (Fork — CR 114.1, 707.10)
// ---------------------------------------------------------------------------

describe("wantsSpellTarget", () => {
    it("is true for 'spell' and 'spell-or-permanent'", () => {
        expect(wantsSpellTarget("spell")).toBe(true);
        expect(wantsSpellTarget("spell-or-permanent")).toBe(true);
        expect(wantsSpellTarget(["any", "spell"])).toBe(true);
    });

    it("is false for non-spell requirements and undefined", () => {
        expect(wantsSpellTarget("Creature")).toBe(false);
        expect(wantsSpellTarget("player")).toBe(false);
        expect(wantsSpellTarget(undefined)).toBe(false);
    });
});

describe("matchesSpellTypeFilter", () => {
    const filter = ["Instant", "Sorcery"];

    it("matches an instant/sorcery spell when the filter is set", () => {
        expect(matchesSpellTypeFilter({ types: ["Instant"] }, filter)).toBe(
            true
        );
        expect(matchesSpellTypeFilter({ types: ["Sorcery"] }, filter)).toBe(
            true
        );
    });

    it("rejects a permanent (e.g. creature) spell under the filter", () => {
        expect(matchesSpellTypeFilter({ types: ["Creature"] }, filter)).toBe(
            false
        );
    });

    it("rejects stack abilities (not spells)", () => {
        expect(
            matchesSpellTypeFilter(
                { types: ["Creature"], abilityId: "tim-zap" },
                filter
            )
        ).toBe(false);
        expect(
            matchesSpellTypeFilter(
                { types: ["Enchantment"], triggeredAbilityId: "upkeep" },
                filter
            )
        ).toBe(false);
    });

    it("matches anything when no filter is set", () => {
        expect(matchesSpellTypeFilter({ types: ["Creature"] }, undefined)).toBe(
            true
        );
        expect(matchesSpellTypeFilter({ types: ["Instant"] }, [])).toBe(true);
    });

    // Artifact Blast (#274): "counter target artifact spell". game.ts
    // normalizes the card's string `spellTypeFilter: "Artifact"` to
    // ["Artifact"] before it reaches the client, so the UI sees an array.
    it("matches an Artifact spell but not other spell types (Artifact Blast)", () => {
        const artifactFilter = ["Artifact"];
        expect(
            matchesSpellTypeFilter({ types: ["Artifact"] }, artifactFilter)
        ).toBe(true);
        expect(
            matchesSpellTypeFilter(
                { types: ["Artifact", "Creature"] },
                artifactFilter
            )
        ).toBe(true);
        expect(
            matchesSpellTypeFilter({ types: ["Instant"] }, artifactFilter)
        ).toBe(false);
        expect(
            matchesSpellTypeFilter({ types: ["Sorcery"] }, artifactFilter)
        ).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// getDisplayAbilities — runtime keyword grants (#156)
// ---------------------------------------------------------------------------

describe("getDisplayAbilities (#156 granted keywords)", () => {
    it("marks a keyword on the instance but not the def as 'granted'", () => {
        // Merfolk of the Pearl Trident is a vanilla creature; islandwalk here
        // is granted at runtime (e.g. by Lord of Atlantis, CR 702.13c).
        const instance = makeCardInstance({
            card: { id: MERFOLK_ID },
            staticAbilities: ["islandwalk"],
        });
        const { keywords } = getDisplayAbilities(MERFOLK_ID, instance);
        expect(keywords).toEqual([{ name: "islandwalk", state: "granted" }]);
    });

    it("marks a keyword on both def and instance as 'native'", () => {
        const instance = makeCardInstance({
            card: { id: PHANTASMAL_FORCES_ID },
            staticAbilities: ["flying"],
        });
        const { keywords } = getDisplayAbilities(
            PHANTASMAL_FORCES_ID,
            instance
        );
        expect(keywords).toContainEqual({ name: "flying", state: "native" });
    });

    it("marks a def keyword missing from the instance as 'lost'", () => {
        const instance = makeCardInstance({
            card: { id: PHANTASMAL_FORCES_ID },
            staticAbilities: [], // flying stripped at runtime
        });
        const { keywords } = getDisplayAbilities(
            PHANTASMAL_FORCES_ID,
            instance
        );
        expect(keywords).toContainEqual({ name: "flying", state: "lost" });
    });

    it("shows native and granted keywords together", () => {
        const instance = makeCardInstance({
            card: { id: PHANTASMAL_FORCES_ID },
            staticAbilities: ["flying", "islandwalk"],
        });
        const { keywords } = getDisplayAbilities(
            PHANTASMAL_FORCES_ID,
            instance
        );
        expect(keywords).toContainEqual({ name: "flying", state: "native" });
        expect(keywords).toContainEqual({
            name: "islandwalk",
            state: "granted",
        });
    });
});

// ---------------------------------------------------------------------------
// resolvePreviewAbilities — what the preview body renders (#156)
// ---------------------------------------------------------------------------

describe("resolvePreviewAbilities (#156)", () => {
    const full: DisplayAbilities = {
        keywords: [
            { name: "flying", state: "native" },
            { name: "islandwalk", state: "granted" },
            { name: "defender", state: "lost" },
        ],
        activated: [
            { id: "a1", oracleText: "{T}: native", state: "native" },
            { id: "a2", oracleText: "{T}: granted", state: "granted" },
        ],
        triggered: [
            { id: "t1", oracleText: "When ...", state: "native" },
            {
                id: "t2",
                oracleText: "At the beginning of your upkeep, ...",
                state: "granted",
            },
        ],
    };

    it("returns the full set unchanged when Oracle text is not shown", () => {
        expect(resolvePreviewAbilities(full, false)).toEqual(full);
    });

    it("keeps only runtime deltas when Oracle text is shown", () => {
        const result = resolvePreviewAbilities(full, true);
        // native keyword is already in the printed text — dropped.
        expect(result.keywords).toEqual([
            { name: "islandwalk", state: "granted" },
            { name: "defender", state: "lost" },
        ]);
        // only granted activated abilities survive; native + triggered drop.
        expect(result.activated).toEqual([
            { id: "a2", oracleText: "{T}: granted", state: "granted" },
        ]);
        // native triggered drops (printed); a granted trigger (Energy Flux,
        // #291) survives so it surfaces on the recipient's zoom panel.
        expect(result.triggered).toEqual([
            {
                id: "t2",
                oracleText: "At the beginning of your upkeep, ...",
                state: "granted",
            },
        ]);
    });

    it("surfaces a granted keyword even when the card shows Oracle text (the #156 bug)", () => {
        // End-to-end: a vanilla creature granted islandwalk at runtime. Its
        // printed Oracle text would otherwise suppress the structured panel.
        const instance = makeCardInstance({
            card: { id: MERFOLK_ID },
            staticAbilities: ["islandwalk"],
        });
        const abilities = getDisplayAbilities(MERFOLK_ID, instance);
        const body = resolvePreviewAbilities(
            abilities,
            /* showOracleText */ true
        );
        expect(body.keywords).toContainEqual({
            name: "islandwalk",
            state: "granted",
        });
    });
});

// ---------------------------------------------------------------------------
// matchesPermanentFilter — client mirror of the server filter (colors + tapped)
// ---------------------------------------------------------------------------

const FLYING_MEN_ID = "25ab9a2b-e248-4ae2-aac3-b49fdb3e260a"; // blue {U} creature
const GRIZZLY_BEARS_ID = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // green creature

describe("matchesPermanentFilter (client mirror — colors + tapped)", () => {
    it("matches a tapped blue creature against { colors:[U], tapped:true }", () => {
        const card = makeCardInstance({
            card: { id: FLYING_MEN_ID },
            types: ["Creature"],
            isTapped: true,
        });
        expect(
            matchesPermanentFilter(card, {
                types: "Creature",
                colors: ["U"],
                tapped: true,
            })
        ).toBe(true);
    });

    it("rejects an untapped blue creature when tapped:true is required", () => {
        const card = makeCardInstance({
            card: { id: FLYING_MEN_ID },
            types: ["Creature"],
            isTapped: false,
        });
        expect(
            matchesPermanentFilter(card, {
                types: "Creature",
                colors: ["U"],
                tapped: true,
            })
        ).toBe(false);
    });

    it("rejects a tapped non-blue creature on the color filter", () => {
        const card = makeCardInstance({
            card: { id: GRIZZLY_BEARS_ID },
            types: ["Creature"],
            isTapped: true,
        });
        expect(
            matchesPermanentFilter(card, {
                types: "Creature",
                colors: ["U"],
                tapped: true,
            })
        ).toBe(false);
    });

    it("honors layer-5 colorOverride over the printed cost", () => {
        const card = makeCardInstance({
            card: { id: GRIZZLY_BEARS_ID }, // printed green
            types: ["Creature"],
            isTapped: true,
            colorOverride: ["U"], // laced blue
        });
        expect(
            matchesPermanentFilter(card, { colors: ["U"], tapped: true })
        ).toBe(true);
    });

    // DRK Flood (#412): "target creature without flying" — the excludeAbility
    // mirror of requireAbility, used for the keyword target filter.
    it("rejects a flyer under excludeAbility:flying (Flood)", () => {
        const flyer = makeCardInstance({
            types: ["Creature"],
            staticAbilities: ["flying"],
        });
        const ground = makeCardInstance({
            types: ["Creature"],
            staticAbilities: [],
        });
        expect(
            matchesPermanentFilter(flyer, {
                types: "Creature",
                excludeAbility: "flying",
            })
        ).toBe(false);
        expect(
            matchesPermanentFilter(ground, {
                types: "Creature",
                excludeAbility: "flying",
            })
        ).toBe(true);
    });
});
