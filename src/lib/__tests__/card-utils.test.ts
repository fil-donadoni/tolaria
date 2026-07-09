import { describe, it, expect } from "vitest";
import {
    wantsPermanentTarget,
    wantsPlayerTarget,
    matchesPermanentFilter,
    matchesTargetRequirement,
    matchesTargetController,
    matchesSpellTypeFilter,
    matchesSpellExcludeTypeFilter,
    matchesSpellCreaturePtFilter,
    matchesSpellSingleTargetingController,
    matchesSpellWouldDestroyLand,
    matchesStackObjectFilter,
    wantsSpellTarget,
    getStackAbilities,
    getAnyPlayerStackAbilities,
    buildTriggerStateView,
    getAbilityOracleText,
    getDelayedTriggerOracleText,
    getDisplayAbilities,
    shouldShowOracleText,
    resolvePreviewAbilities,
    getManaChoices,
    hasManaAbility,
    isLandwalkUnblockable,
    mayPayCanAfford,
    mayPayRequiredSacrifices,
    mayPayCostLabel,
    mayPaySacrificeCount,
    normalizeMayPayCost,
    type DisplayAbilities,
} from "../card-utils";
import type { CardInstance } from "~/types/game";
import type { CardDefinition } from "@convex/cards/types";
import { getDefinition } from "@convex/cards";
import { dominate } from "@convex/cards/sets/nem";
import { fellwarStone, deepWater, gaeasTouch } from "@convex/cards/sets/drk";
import {
    redManaBattery,
    greatWall,
    undertow,
    pendelhaven,
    livonyaSilone,
} from "@convex/cards/sets/leg";

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
// wantsPlayerTarget
// ---------------------------------------------------------------------------

describe("wantsPlayerTarget", () => {
    it("returns true for 'player'", () => {
        expect(wantsPlayerTarget("player")).toBe(true);
    });

    it("returns true for 'any'", () => {
        expect(wantsPlayerTarget("any")).toBe(true);
    });

    // Lava Spike (chk/red): "3 damage to target player or planeswalker" →
    // type ["player", "Planeswalker"]. The array form MUST mark the player
    // face as targetable — the regression this covers (player not highlighted).
    it("returns true for ['player', 'Planeswalker'] (Lava Spike)", () => {
        expect(wantsPlayerTarget(["player", "Planeswalker"])).toBe(true);
    });

    it("returns false for 'Creature'", () => {
        expect(wantsPlayerTarget("Creature")).toBe(false);
    });

    it("returns false for ['Artifact', 'Enchantment']", () => {
        expect(wantsPlayerTarget(["Artifact", "Enchantment"])).toBe(false);
    });

    it("returns false for undefined", () => {
        expect(wantsPlayerTarget(undefined)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// matchesTargetRequirement
// ---------------------------------------------------------------------------

describe("matchesTargetController (CR 109.3 / 102.1, #904)", () => {
    // chooser = "p1", active player = "p1", opponent = "p2".
    it("'you' accepts the chooser's permanent, rejects the opponent's", () => {
        expect(matchesTargetController("p1", "p1", "p1", "you")).toBe(true);
        expect(matchesTargetController("p2", "p1", "p1", "you")).toBe(false);
    });
    it("'opponent' accepts the opponent's permanent, rejects the chooser's", () => {
        expect(matchesTargetController("p2", "p1", "p1", "opponent")).toBe(
            true
        );
        expect(matchesTargetController("p1", "p1", "p1", "opponent")).toBe(
            false
        );
    });
    it("'active' accepts the active player's permanent regardless of chooser", () => {
        // Chooser is the non-active player p2; active player is p1.
        expect(matchesTargetController("p1", "p2", "p1", "active")).toBe(true);
        expect(matchesTargetController("p2", "p2", "p1", "active")).toBe(false);
    });
    it("'any' / undefined accepts any controller", () => {
        expect(matchesTargetController("p2", "p1", "p1", "any")).toBe(true);
        expect(matchesTargetController("p2", "p1", "p1", undefined)).toBe(true);
    });
});

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

    // Dominate ({X}{1}{U}{U}, NEM): "target creature with mana value X or
    // less". The `mvFilter` ceiling is enforced server-side (getLegalTargets),
    // so the client marks ANY creature clickable under the "Creature"
    // requirement and lets the server reject an over-MV pick (CR 202.3, #994).
    it("marks a creature clickable for Dominate's 'Creature' requirement (mvFilter is server-side)", () => {
        expect(dominate.targetRequirement?.type).toBe("Creature");
        const creature = makeCardInstance({ types: ["Creature"] });
        const land = makeCardInstance({ types: ["Land"] });
        expect(
            matchesTargetRequirement(creature, dominate.targetRequirement!.type)
        ).toBe(true);
        expect(
            matchesTargetRequirement(land, dominate.targetRequirement!.type)
        ).toBe(false);
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

    // FEM Night Soil — exile-from-graveyard cost affordability (CR 602.1 /
    // 118.5). The activation is surfaced only when one viewer-visible graveyard
    // holds enough matching cards; otherwise the menu hides it (UI hint).
    it("hides Night Soil's exile ability when no graveyard has two creature cards", () => {
        const nightSoilId = "4cda6d18-d4b1-4b8a-a72e-f90115adf4c3";
        const card = makeCardInstance({
            card: { id: nightSoilId },
            types: ["Enchantment"],
        });
        // Empty graveyards → unpayable → hidden.
        const emptyView = {
            players: [
                { id: "p1", life: 20, hand: { length: 0 }, battlefield: [] },
            ],
        };
        expect(
            getStackAbilities(card, undefined, true, emptyView)
        ).toHaveLength(0);
    });

    it("surfaces Night Soil's exile ability when a single graveyard has two creature cards", () => {
        const nightSoilId = "4cda6d18-d4b1-4b8a-a72e-f90115adf4c3";
        const card = makeCardInstance({
            card: { id: nightSoilId },
            types: ["Enchantment"],
        });
        const gv = (id: string) => ({
            id,
            ownerId: "p2",
            types: ["Creature"] as const,
        });
        const view = {
            players: [
                { id: "p1", life: 20, hand: { length: 0 }, battlefield: [] },
                {
                    id: "p2",
                    life: 20,
                    hand: { length: 0 },
                    battlefield: [],
                    graveyard: [gv("g1"), gv("g2")],
                },
            ],
        };
        const abilities = getStackAbilities(card, undefined, true, view);
        expect(abilities).toHaveLength(1);
        expect(abilities[0].id).toBe("night-soil-make-saproling");
    });

    // Grim Lavamancer (Torment) — `exileFromGraveyard { owner: "you" }`
    // (CR 118.5). Regression for the bug where `buildTriggerStateView` dropped
    // each player's graveyard, so the affordability check always saw an empty
    // graveyard and hid the ability even with 2+ cards in the viewer's own
    // graveyard. The view MUST be built via `buildTriggerStateView` (as the UI
    // does) — a hand-built view masks the bug.
    describe("Grim Lavamancer exile-from-your-graveyard affordability", () => {
        const GRIM_LAVAMANCER_ID = "5dd72697-24be-42c7-a6d9-a837bdbd4662";
        const makeLavamancer = () =>
            makeCardInstance({
                card: { id: GRIM_LAVAMANCER_ID },
                types: ["Creature"],
                controllerId: "p1",
                ownerId: "p1",
                isTapped: false,
            });
        const gvCard = (id: string, ownerId: string): CardInstance =>
            makeCardInstance({
                id,
                ownerId,
                controllerId: ownerId,
                types: ["Creature"],
                zone: "graveyard",
            });

        it("surfaces the ability when the viewer's own graveyard has 2 cards (via buildTriggerStateView)", () => {
            const view = buildTriggerStateView(
                [
                    {
                        id: "p1",
                        life: 20,
                        hand: [],
                        battlefield: [],
                        graveyard: [gvCard("g1", "p1"), gvCard("g2", "p1")],
                    },
                ],
                "p1"
            );
            const abilities = getStackAbilities(
                makeLavamancer(),
                undefined,
                true,
                view
            );
            expect(abilities.map((a) => a.id)).toContain(
                "grim-lavamancer-bolt"
            );
        });

        it("hides the ability when only the opponent's graveyard has 2 cards (owner: 'you')", () => {
            const view = buildTriggerStateView(
                [
                    { id: "p1", life: 20, hand: [], battlefield: [] },
                    {
                        id: "p2",
                        life: 20,
                        hand: [],
                        battlefield: [],
                        graveyard: [gvCard("g1", "p2"), gvCard("g2", "p2")],
                    },
                ],
                "p1"
            );
            const abilities = getStackAbilities(
                makeLavamancer(),
                undefined,
                true,
                view
            );
            expect(abilities.map((a) => a.id)).not.toContain(
                "grim-lavamancer-bolt"
            );
        });
    });

    // CR 118.4 — a "pay N life" activation cost is unpayable when the payer has
    // fewer than N life. The menu must hide the ability rather than offer it and
    // let the server throw "Not enough life" at commit time. Griselbrand's
    // "Pay 7 life: Draw seven cards."
    describe("life-payment cost affordability (CR 118.4)", () => {
        const griselbrandId = "b51666ae-2aef-4cb1-9cd4-44aec81530f8";
        const makeGriselbrand = () =>
            makeCardInstance({
                card: { id: griselbrandId },
                types: ["Creature"],
            });

        it("hides the ability when the payer has fewer life than the cost", () => {
            expect(
                getStackAbilities(
                    makeGriselbrand(),
                    undefined,
                    true,
                    undefined,
                    6
                )
            ).toHaveLength(0);
        });

        it("surfaces the ability when the payer has exactly the cost in life", () => {
            const abilities = getStackAbilities(
                makeGriselbrand(),
                undefined,
                true,
                undefined,
                7
            );
            expect(abilities).toHaveLength(1);
            expect(abilities[0].id).toBe("griselbrand-pay-life-draw");
        });

        it("surfaces the ability when payer life is unknown (gate skipped)", () => {
            const abilities = getStackAbilities(makeGriselbrand());
            expect(abilities).toHaveLength(1);
            expect(abilities[0].id).toBe("griselbrand-pay-life-draw");
        });
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

    it("Pestilence: {B} damage ability is still available with no creature on the battlefield (modern Oracle, #960)", () => {
        const card = makeCardInstance({
            id: "pest-1",
            card: { id: PESTILENCE_ID },
            types: ["Enchantment"],
            controllerId: "p1",
            isTapped: false,
        });
        // Only Pestilence (an Enchantment) is on the battlefield — no creature.
        // Modern Oracle removed the Alpha printing's "activate only if a
        // creature is in play" gate on the {B} ability (issue #960); the sole
        // creature-count check now lives on the end-step sacrifice trigger, not
        // the activated ability. So the ability remains offerable here.
        const view = buildTriggerStateView(
            [makePlayerLike({ id: "p1", battlefield: [card] })],
            "p1"
        );
        const abilities = getStackAbilities(card, undefined, true, view);
        expect(abilities.map((a) => a.id)).toContain("pestilence-damage");
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

    // Clergy of the Holy Nimbus — "only your opponents may activate" (CR 602.1,
    // issue #491). Surfaced on the opponent's view; hidden on the controller's.
    const CLERGY_ID = "db1f578f-fa3b-4447-953b-1490852b6c80";

    it("surfaces Clergy's opponents-only {1} ability on the opponent's view (CR 602.1)", () => {
        const card = makeCardInstance({
            card: { id: CLERGY_ID },
            types: ["Creature"],
            subtypes: ["Human", "Cleric"],
            isTapped: false,
        });
        const abilities = getAnyPlayerStackAbilities(card);
        expect(abilities).toHaveLength(1);
        expect(abilities[0].id).toBe("clergy-cant-regen");
    });

    it("does NOT surface Clergy's opponents-only ability on the controller's own view (CR 602.1)", () => {
        const card = makeCardInstance({
            card: { id: CLERGY_ID },
            types: ["Creature"],
            subtypes: ["Human", "Cleric"],
            isTapped: false,
        });
        const ids = getStackAbilities(card).map((a) => a.id);
        expect(ids).not.toContain("clergy-cant-regen");
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
// getDelayedTriggerOracleText (delayed triggered ability, CR 603.7a, #935)
// ---------------------------------------------------------------------------

describe("getDelayedTriggerOracleText", () => {
    it("returns oracle text for Mishra's Bauble's next-upkeep draw", () => {
        const text = getDelayedTriggerOracleText(
            "8a720448-017f-4f4a-9501-678245eaed17",
            "next-upkeep-cantrip"
        );
        expect(text).toBe(
            "Draw a card at the beginning of the next turn's upkeep."
        );
    });

    it("returns null for an unknown delayed trigger id", () => {
        const text = getDelayedTriggerOracleText(
            "8a720448-017f-4f4a-9501-678245eaed17",
            "nonexistent"
        );
        expect(text).toBeNull();
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

describe("matchesStackObjectFilter (Brown Ouphe / Mistfolk — CR 113/114.1)", () => {
    const artifactAbility = { types: ["Artifact"], abilityId: "icy-tap" };
    const creatureAbility = { types: ["Creature"], abilityId: "tim-zap" };
    const artifactSpell = { types: ["Artifact"] };

    it("keeps an activated ability from an artifact source (Brown Ouphe)", () => {
        expect(
            matchesStackObjectFilter(
                artifactAbility,
                "activated-ability",
                ["Artifact"],
                undefined
            )
        ).toBe(true);
    });

    it("rejects a non-artifact ability and an artifact SPELL under the Brown Ouphe filter", () => {
        expect(
            matchesStackObjectFilter(
                creatureAbility,
                "activated-ability",
                ["Artifact"],
                undefined
            )
        ).toBe(false);
        // An artifact spell is not an activated ability.
        expect(
            matchesStackObjectFilter(
                artifactSpell,
                "activated-ability",
                ["Artifact"],
                undefined
            )
        ).toBe(false);
    });

    it("keeps only spells targeting the given permanent (Mistfolk)", () => {
        const atMist = {
            types: ["Instant"],
            targets: [{ type: "permanent", id: "mist" }],
        };
        const atOther = {
            types: ["Instant"],
            targets: [{ type: "permanent", id: "other" }],
        };
        expect(
            matchesStackObjectFilter(atMist, undefined, undefined, ["mist"])
        ).toBe(true);
        expect(
            matchesStackObjectFilter(atOther, undefined, undefined, ["mist"])
        ).toBe(false);
        // An ability never satisfies a "spell that targets ~" filter.
        expect(
            matchesStackObjectFilter(
                { ...atMist, abilityId: "x" },
                undefined,
                undefined,
                ["mist"]
            )
        ).toBe(false);
    });

    it("matches a SPELL when no stack-kind filter is set", () => {
        expect(
            matchesStackObjectFilter(
                artifactSpell,
                undefined,
                undefined,
                undefined
            )
        ).toBe(true);
    });

    it("rejects an ability under the default (omitted) and explicit 'spell' — target spell targets a spell (CR 701.5a)", () => {
        // Regression: Counterspell ("target spell", omitted spellStackKind)
        // must NOT be clickable on a triggered/activated ability.
        const triggeredAbility = {
            types: ["Creature"],
            triggeredAbilityId: "etb-trigger",
        };
        expect(
            matchesStackObjectFilter(
                creatureAbility,
                undefined,
                undefined,
                undefined
            )
        ).toBe(false);
        expect(
            matchesStackObjectFilter(
                triggeredAbility,
                undefined,
                undefined,
                undefined
            )
        ).toBe(false);
        expect(
            matchesStackObjectFilter(
                creatureAbility,
                "spell",
                undefined,
                undefined
            )
        ).toBe(false);
    });

    it("keeps any ability — activated OR triggered — under 'ability' (Stifle), rejects a spell", () => {
        const triggeredAbility = {
            types: ["Creature"],
            triggeredAbilityId: "etb-trigger",
        };
        expect(
            matchesStackObjectFilter(
                creatureAbility,
                "ability",
                undefined,
                undefined
            )
        ).toBe(true);
        expect(
            matchesStackObjectFilter(
                triggeredAbility,
                "ability",
                undefined,
                undefined
            )
        ).toBe(true);
        // An ability-kind target never accepts a spell.
        expect(
            matchesStackObjectFilter(
                artifactSpell,
                "ability",
                undefined,
                undefined
            )
        ).toBe(false);
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

// Spell Pierce (issue #683): "target noncreature spell" — frontend
// clickability gate (CR 114.1, the negative of spellTypeFilter).
describe("matchesSpellExcludeTypeFilter", () => {
    it("rejects a creature spell, accepts a noncreature spell", () => {
        const filter = ["Creature"];
        expect(
            matchesSpellExcludeTypeFilter({ types: ["Creature"] }, filter)
        ).toBe(false);
        expect(
            matchesSpellExcludeTypeFilter({ types: ["Instant"] }, filter)
        ).toBe(true);
    });

    it("rejects stack abilities (not spells)", () => {
        expect(
            matchesSpellExcludeTypeFilter(
                { types: ["Instant"], abilityId: "tim-zap" },
                ["Creature"]
            )
        ).toBe(false);
    });

    it("matches anything when no filter is set", () => {
        expect(
            matchesSpellExcludeTypeFilter({ types: ["Creature"] }, undefined)
        ).toBe(true);
        expect(matchesSpellExcludeTypeFilter({ types: ["Creature"] }, [])).toBe(
            true
        );
    });
});

// Stern Scolding (issue #683): "target creature spell with power or
// toughness 2 or less" — frontend clickability gate (CR 114.1 + 208.2).
describe("matchesSpellCreaturePtFilter", () => {
    const filter = { maxPowerOrToughness: 2 };

    it("matches a creature spell at or under the threshold on either stat", () => {
        expect(
            matchesSpellCreaturePtFilter(
                { types: ["Creature"], power: 2, toughness: 5 },
                filter
            )
        ).toBe(true);
        expect(
            matchesSpellCreaturePtFilter(
                { types: ["Creature"], power: 5, toughness: 1 },
                filter
            )
        ).toBe(true);
    });

    it("rejects a creature spell over the threshold on both stats", () => {
        expect(
            matchesSpellCreaturePtFilter(
                { types: ["Creature"], power: 4, toughness: 4 },
                filter
            )
        ).toBe(false);
    });

    it("rejects a noncreature spell regardless of power/toughness", () => {
        expect(
            matchesSpellCreaturePtFilter(
                { types: ["Instant"], power: 1, toughness: 1 },
                filter
            )
        ).toBe(false);
    });

    it("rejects stack abilities (not spells)", () => {
        expect(
            matchesSpellCreaturePtFilter(
                {
                    types: ["Creature"],
                    power: 1,
                    toughness: 1,
                    abilityId: "some-ability",
                },
                filter
            )
        ).toBe(false);
    });

    it("matches anything when no filter is set", () => {
        expect(
            matchesSpellCreaturePtFilter(
                { types: ["Instant"], power: 9, toughness: 9 },
                undefined
            )
        ).toBe(true);
    });
});

// Reflecting Mirror (#425): "target spell with a single target if that target
// is you" — frontend clickability gate (CR 114.6 / 115.10).
describe("matchesSpellSingleTargetingController", () => {
    it("matches a single-target spell whose only target is the activator", () => {
        expect(
            matchesSpellSingleTargetingController(
                { targets: [{ type: "player", id: "p1" }] },
                true,
                "p1"
            )
        ).toBe(true);
    });

    it("rejects a spell targeting a different player", () => {
        expect(
            matchesSpellSingleTargetingController(
                { targets: [{ type: "player", id: "p2" }] },
                true,
                "p1"
            )
        ).toBe(false);
    });

    it("rejects a multi-target spell", () => {
        expect(
            matchesSpellSingleTargetingController(
                {
                    targets: [
                        { type: "player", id: "p1" },
                        { type: "player", id: "p2" },
                    ],
                },
                true,
                "p1"
            )
        ).toBe(false);
    });

    it("rejects a spell whose single target is a permanent", () => {
        expect(
            matchesSpellSingleTargetingController(
                { targets: [{ type: "permanent", id: "c1" }] },
                true,
                "p1"
            )
        ).toBe(false);
    });

    it("rejects stack abilities (not spells)", () => {
        expect(
            matchesSpellSingleTargetingController(
                {
                    abilityId: "tim-zap",
                    targets: [{ type: "player", id: "p1" }],
                },
                true,
                "p1"
            )
        ).toBe(false);
    });

    it("matches anything when the flag is off", () => {
        expect(
            matchesSpellSingleTargetingController(
                { targets: [{ type: "player", id: "p2" }] },
                undefined,
                "p1"
            )
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// matchesSpellWouldDestroyLand (Equinox — CR 114.1 + 701.7). The UI marks a
// stack spell clickable only if it would destroy a land the activator controls.
// ---------------------------------------------------------------------------

describe("matchesSpellWouldDestroyLand (Equinox clickability)", () => {
    const STONE_RAIN_ID = "57ff74cb-a2ed-4123-ac42-f72f9820049e";
    const ARMAGEDDON_ID = "5b6ddce7-b9c5-431d-a0b0-46d4aa93cbcb";
    const COUNTERSPELL_ID = "0df55e3f-14de-46ef-b6b1-616618724d9e";
    const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed";
    const FOREST_ID = "6f1c8cb0-38eb-408b-94e8-16db83999b3b";

    const myLand = makeCardInstance({
        id: "myLand",
        card: { id: PLAINS_ID },
        controllerId: "p1",
        types: ["Land"],
    });
    const oppLand = makeCardInstance({
        id: "oppLand",
        card: { id: FOREST_ID },
        controllerId: "p2",
        types: ["Land"],
    });
    const players = [
        { id: "p1", battlefield: [myLand] },
        { id: "p2", battlefield: [oppLand] },
    ];

    it("matches Stone Rain aimed at a land you control", () => {
        const item = {
            card: { id: STONE_RAIN_ID },
            targets: [{ type: "permanent", id: "myLand" }],
        };
        expect(matchesSpellWouldDestroyLand(item, true, players, "p1")).toBe(
            true
        );
    });

    it("rejects Stone Rain aimed at the opponent's land", () => {
        const item = {
            card: { id: STONE_RAIN_ID },
            targets: [{ type: "permanent", id: "oppLand" }],
        };
        expect(matchesSpellWouldDestroyLand(item, true, players, "p1")).toBe(
            false
        );
    });

    it("matches Armageddon while you control a land", () => {
        const item = { card: { id: ARMAGEDDON_ID }, targets: [] };
        expect(matchesSpellWouldDestroyLand(item, true, players, "p1")).toBe(
            true
        );
    });

    it("rejects a Counterspell (no land destruction)", () => {
        const item = { card: { id: COUNTERSPELL_ID }, targets: [] };
        expect(matchesSpellWouldDestroyLand(item, true, players, "p1")).toBe(
            false
        );
    });

    it("rejects an ability on the stack (not a spell)", () => {
        const item = {
            card: { id: STONE_RAIN_ID },
            targets: [{ type: "permanent", id: "myLand" }],
            abilityId: "some-ability",
        };
        expect(matchesSpellWouldDestroyLand(item, true, players, "p1")).toBe(
            false
        );
    });

    it("matches anything when the flag is off", () => {
        const item = { card: { id: COUNTERSPELL_ID }, targets: [] };
        expect(
            matchesSpellWouldDestroyLand(item, undefined, players, "p1")
        ).toBe(true);
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

// ---------------------------------------------------------------------------
// getManaChoices — board-conditional choosers (Fellwar Stone, #420). The client
// runs the SAME getManaChoices resolver the server validates against, so the
// picker the player sees matches the index the server reads (CR 106.1).
// ---------------------------------------------------------------------------

const FOREST_ID = "6f1c8cb0-38eb-408b-94e8-16db83999b3b";
const ISLAND_ID = "90a57c0e-fa61-45ef-955d-d296403967d5";

describe("getManaChoices — Fellwar Stone (board-conditional)", () => {
    function land(id: string, controllerId: string): CardInstance {
        return makeCardInstance({
            id: `${id}-${controllerId}`,
            card: { id },
            controllerId,
            ownerId: controllerId,
            types: ["Land"],
            subtypes: id === FOREST_ID ? ["Forest"] : ["Island"],
        });
    }

    it("derives the picker colours from the opponent's lands", () => {
        const rock = makeCardInstance({
            id: "fs1",
            card: { id: fellwarStone.id },
            controllerId: "p1",
            types: ["Artifact"],
            subtypes: [],
        });
        const players = [
            { id: "p1", battlefield: [rock] },
            {
                id: "p2",
                battlefield: [land(FOREST_ID, "p2"), land(ISLAND_ID, "p2")],
            },
        ];
        expect(getManaChoices(rock, players)).toEqual([{ U: 1 }, { G: 1 }]);
    });

    it("returns the static fallback (any colour) when no players passed", () => {
        const rock = makeCardInstance({
            id: "fs2",
            card: { id: fellwarStone.id },
            controllerId: "p1",
            types: ["Artifact"],
            subtypes: [],
        });
        // Without a board snapshot the client falls back to the static list.
        expect(getManaChoices(rock)).toEqual([
            { W: 1 },
            { U: 1 },
            { B: 1 },
            { R: 1 },
            { G: 1 },
        ]);
    });

    it("hasManaAbility recognises the dynamic chooser and the sacrifice mana ability", () => {
        const rock = makeCardInstance({
            id: "fs3",
            card: { id: fellwarStone.id },
            controllerId: "p1",
            types: ["Artifact"],
            subtypes: [],
        });
        expect(hasManaAbility(rock)).toBe(true);
        const gt = makeCardInstance({
            id: "gt1",
            card: { id: gaeasTouch.id },
            controllerId: "p1",
            types: ["Enchantment"],
            subtypes: [],
        });
        // Gaea's Touch has a sacrifice-for-{G}{G} mana ability.
        expect(hasManaAbility(gt)).toBe(true);
    });

    it("Deep Water exposes no tap mana ability (its ability uses the stack)", () => {
        const dw = makeCardInstance({
            id: "dw1",
            card: { id: deepWater.id },
            controllerId: "p1",
            types: ["Enchantment"],
            subtypes: [],
        });
        expect(getManaChoices(dw)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Mana Battery — client picker offers 1..1+available scaled choices (#482)
// ---------------------------------------------------------------------------

describe("Mana Battery mana picker (charge-counter scaling, #482)", () => {
    function battery(counters?: Record<string, number>): CardInstance {
        return makeCardInstance({
            id: "battery",
            card: { id: redManaBattery.id },
            controllerId: "p1",
            types: ["Artifact"],
            subtypes: [],
            ...(counters ? { counters } : {}),
        });
    }

    it("exposes a tap mana ability", () => {
        expect(hasManaAbility(battery())).toBe(true);
    });

    it("offers 1..1+available {R} options scaled by charge counters", () => {
        const players = [{ id: "p1", battlefield: [battery({ charge: 2 })] }];
        // 2 counters → remove 0..2 → produce 1..3 {R}. The same resolver the
        // server validates against, so the index the picker submits matches.
        expect(getManaChoices(battery({ charge: 2 }), players)).toEqual([
            { R: 1 },
            { R: 2 },
            { R: 3 },
        ]);
    });

    it("offers only the base 1 {R} when the battery has no counters", () => {
        const players = [{ id: "p1", battlefield: [battery()] }];
        expect(getManaChoices(battery(), players)).toEqual([{ R: 1 }]);
    });
});

// CR 509.1b / 702.13 — client-side block-eligibility view must agree with the
// server: a landwalk-negation static (Great Wall / Undertow) suppresses the
// matching landwalk so the creature is no longer treated as unblockable.
describe("isLandwalkUnblockable (landwalk-negation parity, CR 509.1b / 702.13)", () => {
    const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed";
    const ISLAND_ID = "90a57c0e-fa61-45ef-955d-d296403967d5";

    const plainswalker = (): CardInstance =>
        makeCardInstance({ id: "atk", staticAbilities: ["plainswalk"] });
    const islandwalker = (): CardInstance =>
        makeCardInstance({ id: "atk", staticAbilities: ["islandwalk"] });
    const land = (id: string, subtype: string): CardInstance =>
        makeCardInstance({
            id,
            card: { id },
            types: ["Land"],
            subtypes: [subtype],
        });
    const enchant = (id: string): CardInstance =>
        makeCardInstance({
            id,
            card: { id },
            types: ["Enchantment"],
            subtypes: [],
        });

    it("plainswalk creature is unblockable behind a Plains with no Great Wall", () => {
        expect(
            isLandwalkUnblockable(plainswalker(), [land(PLAINS_ID, "Plains")])
        ).toBe(true);
    });

    it("Great Wall makes the plainswalk creature blockable despite the Plains", () => {
        expect(
            isLandwalkUnblockable(plainswalker(), [
                land(PLAINS_ID, "Plains"),
                enchant(greatWall.id),
            ])
        ).toBe(false);
    });

    it("Undertow makes the islandwalk creature blockable despite the Island", () => {
        expect(
            isLandwalkUnblockable(islandwalker(), [
                land(ISLAND_ID, "Island"),
                enchant(undertow.id),
            ])
        ).toBe(false);
    });

    it("Great Wall does not negate islandwalk (only its own subtype)", () => {
        expect(
            isLandwalkUnblockable(islandwalker(), [
                land(ISLAND_ID, "Island"),
                enchant(greatWall.id),
            ])
        ).toBe(true);
    });

    // CR 702.13 — supertype-keyed landwalk ("legendary landwalk", Livonya
    // Silone). The client matcher must agree with the server's
    // `LANDWALK_SUPERTYPE_RULES` so the board lights up the same blockers.
    const FOREST_ID = "6f1c8cb0-38eb-408b-94e8-16db83999b3b";
    const legendaryLandwalker = (): CardInstance =>
        makeCardInstance({
            id: "atk",
            card: { id: livonyaSilone.id },
            staticAbilities: ["legendary landwalk"],
        });
    const registryLand = (id: string): CardInstance =>
        makeCardInstance({ id, card: { id }, types: ["Land"] });

    it("legendary landwalk is unblockable behind a legendary land (Pendelhaven)", () => {
        expect(
            isLandwalkUnblockable(legendaryLandwalker(), [
                registryLand(pendelhaven.id),
            ])
        ).toBe(true);
    });

    it("legendary landwalk is blockable behind only a nonlegendary land (Forest)", () => {
        expect(
            isLandwalkUnblockable(legendaryLandwalker(), [
                registryLand(FOREST_ID),
            ])
        ).toBe(false);
    });

    it("legendary landwalk requires a LAND — a legendary nonland grants no evasion", () => {
        // Livonya is herself Legendary but a creature, not a land.
        expect(
            isLandwalkUnblockable(legendaryLandwalker(), [
                makeCardInstance({
                    id: "legendary-creature",
                    card: { id: livonyaSilone.id },
                    types: ["Creature"],
                }),
            ])
        ).toBe(false);
    });
});

describe("may-pay cost union helpers (CR 117.3a / 118.4 / 702.24, #638)", () => {
    it("normalizeMayPayCost widens a bare ManaCost to { mana }", () => {
        expect(normalizeMayPayCost({ U: 1 })).toEqual({ mana: { U: 1 } });
        expect(normalizeMayPayCost({ mana: { B: 1 }, life: 1 })).toEqual({
            mana: { B: 1 },
            life: 1,
        });
    });

    it("mayPayCostLabel renders mana symbols, life, and sacrifice words", () => {
        expect(mayPayCostLabel({ X: 1, U: 1 })).toBe("{1}{U}");
        expect(mayPayCostLabel({ life: 2 })).toBe("2 life");
        expect(mayPayCostLabel({ mana: { B: 1 }, life: 1 })).toBe(
            "{B} and 1 life"
        );
        expect(
            mayPayCostLabel({
                sacrifice: { filter: { types: "Land" as const }, count: 1 },
            })
        ).toBe("sacrifice");
        expect(
            mayPayCostLabel({
                sacrifice: { filter: { types: "Land" as const }, count: 2 },
            })
        ).toBe("sacrifice 2");
    });

    it("mayPayCanAfford gates each leg (mana / life / sacrifice)", () => {
        const pool = { U: 1 };
        // mana leg
        expect(mayPayCanAfford({ U: 1 }, pool, 20, 0)).toBe(true);
        expect(mayPayCanAfford({ U: 2 }, pool, 20, 0)).toBe(false);
        // life leg
        expect(mayPayCanAfford({ life: 2 }, {}, 20, 0)).toBe(true);
        expect(mayPayCanAfford({ life: 2 }, {}, 1, 0)).toBe(false);
        // sacrifice leg (candidate count supplied by the caller)
        const sac = {
            sacrifice: { filter: { types: "Land" as const }, count: 2 },
        };
        expect(mayPayCanAfford(sac, {}, 20, 2)).toBe(true);
        expect(mayPayCanAfford(sac, {}, 20, 1)).toBe(false);
        // mixed: all-or-nothing
        const mix = { mana: { B: 1 }, life: 1 };
        expect(mayPayCanAfford(mix, { B: 1 }, 20, 0)).toBe(true);
        expect(mayPayCanAfford(mix, { B: 1 }, 0, 0)).toBe(false);
        // cost-less is always affordable
        expect(mayPayCanAfford(undefined, {}, 0, 0)).toBe(true);
    });

    it("mayPaySacrificeCount counts matching battlefield permanents", () => {
        const bf = [
            makeCardInstance({ id: "l1", types: ["Land"] }),
            makeCardInstance({ id: "l2", types: ["Land"] }),
            makeCardInstance({ id: "c1", types: ["Creature"] }),
        ];
        expect(
            mayPaySacrificeCount(
                { sacrifice: { filter: { types: "Land" as const }, count: 1 } },
                bf
            )
        ).toBe(2);
        // No sacrifice leg → 0.
        expect(mayPaySacrificeCount({ U: 1 }, bf)).toBe(0);
        expect(mayPaySacrificeCount(undefined, bf)).toBe(0);
    });

    it("mayPayRequiredSacrifices reads the sacrifice leg's count (CR 701.16b)", () => {
        expect(
            mayPayRequiredSacrifices({
                sacrifice: { filter: {}, count: 1 },
            })
        ).toBe(1);
        expect(
            mayPayRequiredSacrifices({
                sacrifice: { filter: { types: "Land" as const }, count: 2 },
            })
        ).toBe(2);
        // No sacrifice leg / cost-less → 0.
        expect(mayPayRequiredSacrifices({ U: 1 })).toBe(0);
        expect(mayPayRequiredSacrifices(undefined)).toBe(0);
    });
});

// The card preview renders the structured ability rows (keywords / activated /
// triggered) OR the printed Oracle text, never both. `shouldShowOracleText`
// gates that choice. The bug it fixes: a permanent whose behavior is
// oracle-text-only (replacement effect, enter-tapped choice) but that ALSO has
// a structured ability would suppress its Oracle text and show nothing for the
// oracle-only clause. See shouldShowOracleText in card-utils.
describe("shouldShowOracleText — preview Oracle-text gate", () => {
    const show = (def: CardDefinition) =>
        shouldShowOracleText(def, def.types, def.subtypes ?? []);

    it("shows Oracle text for a replacement-effect permanent that also has a triggered ability (Sulfuric Vortex)", () => {
        // Enchantment: upkeep-ping trigger + lifegain-lock replacement. The
        // replacement's rules text lives only in oracleText — the structured
        // trigger row would otherwise be the sole thing shown.
        const def = getDefinition("79955e27-eef7-43bd-9895-e9209ed1537f");
        expect(def.replacementEffects?.length ?? 0).toBeGreaterThan(0);
        expect((def.triggeredAbilities?.length ?? 0) > 0).toBe(true);
        expect(show(def)).toBe(true);
    });

    it("shows Oracle text for a shockland (enter-tapped choice) that also has a mana ability (Steam Vents)", () => {
        // Land: activated mana ability + entersTappedUnlessPay (CR 614.12).
        // The pay-2-life-or-tapped clause is oracle-only.
        const def = getDefinition("054f2276-2dd5-43da-bb26-c57c560861fe");
        expect(def.entersTappedUnlessPay).toBeDefined();
        expect((def.activatedAbilities?.length ?? 0) > 0).toBe(true);
        expect(show(def)).toBe(true);
    });

    it("does NOT show Oracle text for a card whose only behavior is structured keyword/activated/triggered abilities", () => {
        // A keyword flyer with no oracle-only mechanic: the structured rows
        // fully describe it, so the Oracle text is suppressed to avoid
        // double-printing.
        const def: CardDefinition = {
            id: "x",
            name: "Test Flyer",
            rarity: "common",
            oracleText: "Flying",
            manaCost: { W: 1 },
            types: ["Creature"],
            subtypes: ["Bird"],
            power: 2,
            toughness: 2,
            staticAbilities: ["flying"],
        };
        expect(show(def)).toBe(false);
    });

    it("shows Oracle text for spells, auras, and ability-less cards", () => {
        const spell: CardDefinition = {
            id: "s",
            name: "Test Bolt",
            rarity: "common",
            oracleText: "Deal 3 damage to any target.",
            manaCost: { R: 1 },
            types: ["Instant"],
        };
        const ability: CardDefinition = {
            id: "a",
            name: "Test Aura",
            rarity: "common",
            oracleText: "Enchanted creature gets +2/+2.",
            manaCost: { W: 1 },
            types: ["Enchantment"],
            subtypes: ["Aura"],
        };
        const vanilla: CardDefinition = {
            id: "v",
            name: "Test Bear",
            rarity: "common",
            oracleText: "",
            manaCost: { G: 1 },
            types: ["Creature"],
            subtypes: ["Bear"],
            power: 2,
            toughness: 2,
        };
        expect(show(spell)).toBe(true);
        expect(show(ability)).toBe(true);
        // Empty oracleText → nothing to show even though ability-less.
        expect(show(vanilla)).toBe(false);
    });
});
