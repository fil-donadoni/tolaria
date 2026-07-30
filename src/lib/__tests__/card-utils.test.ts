import { describe, it, expect } from "vitest";
import {
    wantsPermanentTarget,
    wantsPlayerTarget,
    matchesPermanentFilter,
    matchesTargetRequirement,
    matchesPermanentTargetFilters,
    matchesSpellTypeFilter,
    matchesSpellExcludeTypeFilter,
    matchesSpellCreaturePtFilter,
    matchesSpellSingleTargetingController,
    matchesSpellController,
    matchesSpellWouldDestroyLand,
    matchesStackObjectFilter,
    wantsSpellTarget,
    getStackAbilities,
    getGraveyardStackAbilities,
    getHandStackAbilities,
    getAnyPlayerStackAbilities,
    buildTriggerStateView,
    getAbilityOracleText,
    getTriggeredAbilityOracleText,
    getDelayedTriggerOracleText,
    getDisplayAbilities,
    shouldShowOracleText,
    resolvePreviewAbilities,
    getManaChoices,
    getNonTapManaChoices,
    hasManaAbility,
    isLandwalkUnblockable,
    mayPayCanAfford,
    mayPayRequiredSacrifices,
    mayPayCostLabel,
    mayPaySacrificeCount,
    normalizeMayPayCost,
    manaCostToString,
    phyrexianSplitChoices,
    hasImprovise,
    pendingCastSourceCard,
    pendingCastHasImprovise,
    pendingCastRemainingGeneric,
    activeManaSpendChoice,
    type DisplayAbilities,
} from "../card-utils";
import type {
    CardInstance,
    PendingActivation,
    PendingCast,
    Player,
} from "~/types/game";
import type {
    ActivatedAbility,
    CardDefinition,
    EmblemInstance,
    TargetRequirement,
} from "@convex/cards/types";
import { getDefinition } from "@convex/cards";
import {
    CHANDRA_TORCH_OF_DEFIANCE_EMBLEM_ID,
    SORIN_LORD_OF_INNISTRAD_EMBLEM_ID,
} from "@convex/cards/emblems";
import { CLUE_TOKEN_SPEC } from "@convex/cards/abilities/tokens/clueToken";
import { dismember } from "@convex/cards/sets/nph/black";
import { gitaxianProbe } from "@convex/cards/sets/nph/blue";
import { dominate } from "@convex/cards/sets/nem";
import { fellwarStone, deepWater, gaeasTouch } from "@convex/cards/sets/drk";
import { disruptingScepter } from "@convex/cards/sets/lea";
import { powerArmor } from "@convex/cards/sets/inv";
import { dauthiVoidwalker } from "@convex/cards/sets/mh2/black";
import { viviOrnitier } from "@convex/cards/sets/fin";
import { metallicRebuke } from "@convex/cards/sets/aer/blue";
import { millstone } from "@convex/cards/sets/atq/colorless";
import { gateToPhyrexia } from "@convex/cards/sets/atq/black";
import { moxOpal } from "@convex/cards/sets/som/colorless";
import { everflowingChalice } from "@convex/cards/sets/wwk/colorless";
import { icatianStore } from "@convex/cards/sets/fem/colorless";
import {
    redManaBattery,
    greatWall,
    undertow,
    pendelhaven,
    livonyaSilone,
    clergyOfTheHolyNimbus,
    karakas,
} from "@convex/cards/sets/leg";
import { pendingTargetFiltersFromRequirement } from "@convex/gre/rules";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer as makeServerPlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import type { PendingTarget } from "~/types/game";

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
// matchesPermanentTargetFilters (issue #1697 — Karakas "target legendary
// creature" rings every creature, then errors on selection)
// ---------------------------------------------------------------------------

describe("matchesPermanentTargetFilters (CR 109/202/205/613/701.20/702, issue #1697)", () => {
    // Builds a server-side GameState with Karakas's bounce ability's
    // TargetRequirement lowered onto a real PendingTarget
    // (pendingTargetFiltersFromRequirement, the exact function selectTarget
    // uses server-side), projects it through the REAL wire projection
    // (projectPublicState) — not a hand-built client fixture — and returns the
    // wire-shaped players + pendingTarget the board actually reads. Per the
    // frontend-wiring mandate: a hand-built view would mask exactly the class
    // of bug this closes (a reducer silently dropping a field).
    function projectScenario(
        req: TargetRequirement,
        legendaryCreatureOverrides: Partial<
            Parameters<typeof makeInstance>[1]
        > = {},
        plainCreatureOverrides: Partial<
            Parameters<typeof makeInstance>[1]
        > = {},
        emblems?: EmblemInstance[]
    ) {
        const legendary = makeInstance(livonyaSilone.id, {
            id: "legendary-1",
            controllerId: "p2",
            ownerId: "p2",
            ...legendaryCreatureOverrides,
        });
        const plain = makeInstance(MERFOLK_ID, {
            id: "plain-1",
            controllerId: "p2",
            ownerId: "p2",
            ...plainCreatureOverrides,
        });
        const karakasInstance = makeInstance(karakas.id, {
            id: "karakas-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makeServerPlayer("p1", { battlefield: [karakasInstance] }),
                makeServerPlayer("p2", { battlefield: [legendary, plain] }),
            ],
            pendingTarget: {
                playerId: "p1",
                cardInstanceId: "karakas-1",
                targetType: req.type,
                count: 1,
                selected: [],
                ...pendingTargetFiltersFromRequirement(req, undefined),
            } as PendingTarget,
            emblems,
        });

        const projected = projectPublicState(state, 1, "p1");
        return {
            players: projected.players as unknown as Player[],
            pendingTarget: projected.pendingTarget as unknown as PendingTarget,
            // CR 114 (issue #1221) — the wire projection forwards the
            // top-level `emblems` field unchanged (`...state` spread in
            // `projectPublicState`); read it back the same way
            // `useGameContext()` does, not from the pre-projection fixture.
            emblems: projected.emblems as unknown as
                | EmblemInstance[]
                | undefined,
            legendaryClient: projected.players
                .find((p) => p.id === "p2")!
                .battlefield.find(
                    (c) => c.id === "legendary-1"
                ) as unknown as CardInstance,
            plainClient: projected.players
                .find((p) => p.id === "p2")!
                .battlefield.find(
                    (c) => c.id === "plain-1"
                ) as unknown as CardInstance,
        };
    }

    it("supertypeFilter (Karakas): highlights the legendary creature, rejects the non-legendary one, through the real wire projection", () => {
        const { players, pendingTarget, legendaryClient, plainClient } =
            projectScenario(karakas.activatedAbilities![1].targetRequirement!);

        // The OLD narrow check alone would wrongly say both match — proving
        // the bug (a "Creature" requirement's structural type check has no
        // opinion on supertype).
        expect(
            matchesTargetRequirement(plainClient, pendingTarget.targetType)
        ).toBe(true);

        // The shared registry-backed predicate is the one that must diverge:
        // reject the non-legendary creature, accept the legendary one.
        expect(
            matchesPermanentTargetFilters(
                plainClient,
                pendingTarget,
                players,
                "p1"
            )
        ).toBe(false);
        expect(
            matchesPermanentTargetFilters(
                legendaryClient,
                pendingTarget,
                players,
                "p1"
            )
        ).toBe(true);
    });

    it("powerFilter (a dimension beyond supertype): rejects a creature below the power floor, accepts one at/above it, through the real wire projection", () => {
        const req: TargetRequirement = {
            type: "Creature",
            count: 1,
            powerFilter: { min: 5 },
        };
        // Livonya Silone (power 4) fails a "power 5 or greater" filter even
        // though she IS legendary — proving this isn't Karakas-specific.
        const { players, pendingTarget, legendaryClient, plainClient } =
            projectScenario(
                req,
                { power: 4 },
                { power: 6 } // "plain" creature repurposed as the power-6 pass case
            );

        expect(
            matchesPermanentTargetFilters(
                legendaryClient,
                pendingTarget,
                players,
                "p1"
            )
        ).toBe(false);
        expect(
            matchesPermanentTargetFilters(
                plainClient,
                pendingTarget,
                players,
                "p1"
            )
        ).toBe(true);
    });

    it("powerFilter under a command-zone emblem anthem: matches the server's effective power only when emblems are folded in (CR 114, over-filter regression)", () => {
        const req: TargetRequirement = {
            type: "Creature",
            count: 1,
            powerFilter: { min: 2 },
        };
        // Both creatures are base power 1 — only Sorin, Lord of Innistrad's
        // "Creatures you control get +1/+0" emblem (owned by p2, same as the
        // creatures' controller, CR 114.3) pushes them to power 2. The server
        // computes effective power through the SAME layer system
        // (`getEffectivePower`, `convex/gre/layers.ts`) reading
        // `state.emblems`, so it accepts this target; a client predicate that
        // built its synthetic state WITHOUT `emblems` would under-compute
        // power back to 1 and wrongly reject a target the server allows —
        // the over-filter inverse of #1697's under-filter symptom (a legal
        // target silently reads as unclickable, worse than #1697 because it
        // fails silently instead of erroring on selection).
        const sorinEmblem: EmblemInstance = {
            id: "emblem-1",
            ownerId: "p2",
            emblemId: SORIN_LORD_OF_INNISTRAD_EMBLEM_ID,
            name: "Sorin, Lord of Innistrad emblem",
            text: "Creatures you control get +1/+0.",
        };
        const { players, pendingTarget, legendaryClient, emblems } =
            projectScenario(req, { power: 1 }, { power: 1 }, [sorinEmblem]);

        // Proves the bug: omitting `emblems` from the call under-computes
        // power (still 1) and wrongly rejects a target the server accepts.
        expect(
            matchesPermanentTargetFilters(
                legendaryClient,
                pendingTarget,
                players,
                "p1"
            )
        ).toBe(false);

        // The fix: `emblems` folded into the synthetic state matches the
        // server's effective power (2) and accepts the target.
        expect(
            matchesPermanentTargetFilters(
                legendaryClient,
                pendingTarget,
                players,
                "p1",
                emblems
            )
        ).toBe(true);
    });

    it("isToken (CR 111.5, issue #1195, Satya / Dance of Many): rejects a token creature for 'target nontoken creature', accepts a nontoken one, through the real wire projection", () => {
        const req: TargetRequirement = {
            type: "Creature",
            count: 1,
            isToken: false,
        };
        // Repurpose the "plain" creature as a TOKEN — the exact "target
        // nontoken creature" bug class (Dance of Many's ETB has documented
        // this gap since #1459): a hand-built client view could easily drop
        // `isToken` the same way it once dropped `supertypeFilter` (#1697),
        // so this goes through the REAL wire projection like every other
        // test in this describe.
        const { players, pendingTarget, legendaryClient, plainClient } =
            projectScenario(req, {}, { isToken: true });

        expect(
            matchesPermanentTargetFilters(
                plainClient,
                pendingTarget,
                players,
                "p1"
            )
        ).toBe(false);
        expect(
            matchesPermanentTargetFilters(
                legendaryClient,
                pendingTarget,
                players,
                "p1"
            )
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

    it("offers Dread Wight's granted {4} counter-removal on a paralyzed creature (CR 113.1, #728)", () => {
        // The grant lives on the VICTIM as `grantedActivatedAbilities`, with
        // the template on Dread Wight's `grantTemplates` — if the reducer
        // dropped either, the affordance would be dead on the board.
        const victim = makeCardInstance({
            // Grizzly Bears — a creature with no native activated ability.
            card: { id: "ce2d603a-3231-4a8c-bf39-1617586ea870" },
            types: ["Creature"],
            isTapped: true,
            counters: { paralyzation: 1 },
            grantedActivatedAbilities: [
                {
                    sourceCardId: "65d332e2-4b2d-4131-84f7-862cb138c477",
                    abilityId: "dread-wight-remove-paralyzation",
                },
            ],
        });

        const abilities = getStackAbilities(victim);
        expect(abilities.map((a) => a.id)).toContain(
            "dread-wight-remove-paralyzation"
        );
        expect(
            abilities.find((a) => a.id === "dread-wight-remove-paralyzation")!
                .oracleText
        ).toContain("Remove a paralyzation counter");
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

    // CR 707.2 / 701.16 (issue #1191) — a Clue token's sac-draw ability must
    // survive the FULL client reducer path: `getStackAbilities` reads
    // `getDefinition(card.card.id).activatedAbilities`, and for a token the
    // definition is never registered client-side directly — it is decoded on
    // demand from the content-derived `token:` id (`maybeSynthesizeToken`,
    // pinned by `convex/cards/__tests__/tokenRegistry.test.ts`). This is the
    // mandatory SURFACE test through the reducer (§ Frontend wiring analysis):
    // a hand-built `CardDefinition` would mask exactly the bug this proves
    // fixed — Investigate/Magda's Treasures/Voldaren Epicure's Blood token
    // were all previously blocked because a token could carry NO activated
    // ability, encoded or otherwise.
    it("surfaces a Clue token's sac-draw ability, decoded from its content-derived id", () => {
        // Mirrors `tokenDefinitionId`'s encoding (`convex/gre/state.ts`) using
        // the REAL shared `CLUE_TOKEN_SPEC` (not a hand-duplicated literal),
        // so this test tracks the spec instead of drifting from it.
        const clueId = [
            "token:Clue",
            "Artifact",
            "Clue",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            encodeURIComponent(
                JSON.stringify(CLUE_TOKEN_SPEC.activatedAbilities)
            ),
        ].join("|");
        const card = makeCardInstance({
            card: { id: clueId },
            types: ["Artifact"],
            subtypes: ["Clue"],
            isTapped: false,
        });

        const abilities = getStackAbilities(card);

        expect(abilities).toHaveLength(1);
        expect(abilities[0].id).toBe("sacrifice-draw");
        expect(abilities[0].oracleText).toBe(
            "{2}, Sacrifice this token: Draw a card."
        );
    });

    it("excludes a hand-only ability (Cycling) from a battlefield permanent's menu — Marauding Mako", () => {
        // CR 113.6 / 702.29a — Marauding Mako carries a Cycling ability
        // (`activateFromHand`), usable only while the card is in hand. Once it
        // has resolved onto the battlefield it can never pay the discard-this
        // cost, so its battlefield menu must be empty (the ability belongs to
        // `getHandStackAbilities`, not here). Regression for the reported bug:
        // the cycling menu wrongly appearing on Mako in play.
        const card = makeCardInstance({
            card: { id: "9efbfd67-e0f5-43e0-9fff-1eb4a2bed0d8" },
            types: ["Creature"],
            isTapped: false,
        });
        expect(getStackAbilities(card)).toHaveLength(0);
    });

    // CR 602.1 / 605.1a (issue #1124) — Abeyance's "can't activate abilities
    // that aren't mana abilities" lock. Reducer-driven: builds the view via
    // `buildTriggerStateView` (not a hand-built state) so a dropped field
    // would surface here.
    it("hides a non-mana ability when the controller is under Abeyance's lock", () => {
        const card = makeCardInstance({
            card: { id: "12926dc8-8e6f-4a47-a12b-4d674189615a" },
            types: ["Artifact"],
            isTapped: false,
        });
        const lockedView = buildTriggerStateView([], undefined, ["p1"]);
        expect(
            getStackAbilities(card, undefined, true, lockedView)
        ).toHaveLength(0);
        const unlockedView = buildTriggerStateView([], undefined, ["p2"]);
        expect(
            getStackAbilities(card, undefined, true, unlockedView)
        ).toHaveLength(1);
    });

    // CR 119.3 (issue #1457) — the per-turn life-gain tally must reach the
    // client-side view, or a "if you gained life this turn" affordance would be
    // permanently dead in the UI. Driven through the REAL reducer (a hand-built
    // view would mask a dropped field).
    it("buildTriggerStateView carries lifeGainedThisTurn (CR 603.4 condition input)", () => {
        const view = buildTriggerStateView([], undefined, undefined, {
            p1: 4,
        });
        expect(view.lifeGainedThisTurn).toEqual({ p1: 4 });
        expect(view.lifeGainedThisTurn?.p2 ?? 0).toBe(0);
        // Omitted (no gains yet this turn) stays undefined — 0 by default.
        expect(buildTriggerStateView([]).lifeGainedThisTurn).toBeUndefined();
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

    // Dauthi Voidwalker's "{T}, Sacrifice this creature: ... Activate only
    // as a sorcery" (CR 602.3b, issue #1156) — `sorcerySpeedOnly` hides the
    // ability outside a main phase (a cheap client hint; the mutation's
    // `assertActivationTimingLegal` is authoritative).
    it("hides a sorcerySpeedOnly ability outside a main phase, shows it during one", () => {
        const card = makeCardInstance({
            card: { id: dauthiVoidwalker.id },
            types: ["Creature"],
            isTapped: false,
        });
        expect(getStackAbilities(card, "DECLARE_ATTACKERS")).toHaveLength(0);
        expect(getStackAbilities(card, "END_STEP")).toHaveLength(0);
        const inMain = getStackAbilities(card, "PRECOMBAT_MAIN");
        expect(inMain).toHaveLength(1);
        expect(inMain[0].id).toBe("dauthi-voidwalker-cast");
        expect(getStackAbilities(card, "POSTCOMBAT_MAIN")).toHaveLength(1);
    });

    it("returns a sorcerySpeedOnly ability when `phase` is omitted (no filter applied)", () => {
        const card = makeCardInstance({
            card: { id: dauthiVoidwalker.id },
            types: ["Creature"],
            isTapped: false,
        });
        expect(getStackAbilities(card)).toHaveLength(1);
    });

    // Disrupting Scepter's "{3}, {T}: Target player discards a card. Activate
    // only during your turn." (CR 602.5b, issue #1694) — the battlefield
    // helper must honor `controllerTurnOnly` exactly like its graveyard/hand
    // siblings (`getGraveyardStackAbilities`, `getHandStackAbilities` below)
    // already do; before this fix it offered the ability during the
    // opponent's turn and the server rejected the click. Driven through the
    // real reducer (`buildTriggerStateView`), not a hand-built view.
    it("hides a controllerTurnOnly ability during the opponent's turn, shows it on the controller's turn (Disrupting Scepter)", () => {
        const card = makeCardInstance({
            card: { id: disruptingScepter.id },
            types: ["Artifact"],
            isTapped: false,
            controllerId: "p1",
            ownerId: "p1",
        });
        const opponentTurnView = buildTriggerStateView([], "p2");
        expect(
            getStackAbilities(card, undefined, true, opponentTurnView)
        ).toHaveLength(0);
        const controllerTurnView = buildTriggerStateView([], "p1");
        const abilities = getStackAbilities(
            card,
            undefined,
            true,
            controllerTurnView
        );
        expect(abilities).toHaveLength(1);
        expect(abilities[0].id).toBe("disrupting-scepter-discard");
    });

    it("returns a controllerTurnOnly ability when `activePlayerId` is unknown (fail-open, matches the phase/sorcery-speed discipline)", () => {
        const card = makeCardInstance({
            card: { id: disruptingScepter.id },
            types: ["Artifact"],
            isTapped: false,
        });
        expect(getStackAbilities(card)).toHaveLength(1);
    });

    // Gate to Phyrexia's "Sacrifice a creature: Destroy target artifact.
    // Activate only during your upkeep and only once each turn." (CR 602.5,
    // issue #1694 finding 1) — `oncePerTurn` was NOT mirrored by
    // `isActivationTimingAllowed` even though `activationPhaseRestriction`
    // and `controllerTurnOnly` were, so the battlefield menu kept offering a
    // second activation in the same upkeep and the server threw "Activate
    // only once each turn". Driven through the real reducer
    // (`buildTriggerStateView`), not a hand-built view.
    it("offers Gate to Phyrexia's ability on the first activation in the controller's upkeep, hides it once activationsThisTurn records a use", () => {
        const view = buildTriggerStateView([], "p1");
        const card = makeCardInstance({
            card: { id: gateToPhyrexia.id },
            types: ["Enchantment"],
            controllerId: "p1",
            ownerId: "p1",
        });
        const beforeUse = getStackAbilities(card, "UPKEEP", true, view);
        expect(beforeUse).toHaveLength(1);
        expect(beforeUse[0].id).toBe("gate-to-phyrexia-destroy");

        const usedCard = makeCardInstance({
            card: { id: gateToPhyrexia.id },
            types: ["Enchantment"],
            controllerId: "p1",
            ownerId: "p1",
            activationsThisTurn: { "gate-to-phyrexia-destroy": 1 },
        });
        expect(getStackAbilities(usedCard, "UPKEEP", true, view)).toHaveLength(
            0
        );
    });

    it("fails OPEN on a oncePerTurn ability when `activationsThisTurn` is absent (an unknown counter must never hide a legal activation)", () => {
        const view = buildTriggerStateView([], "p1");
        const card = makeCardInstance({
            card: { id: gateToPhyrexia.id },
            types: ["Enchantment"],
            controllerId: "p1",
            ownerId: "p1",
            // No `activationsThisTurn` at all — the counter is unknown, not
            // "zero uses"; the gate must still offer the ability.
        });
        expect(card.activationsThisTurn).toBeUndefined();
        expect(getStackAbilities(card, "UPKEEP", true, view)).toHaveLength(1);
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
            // The Lavamancer itself is on the battlefield, so its "any target"
            // ability has a legal target candidate (CR 602.2b — a targeting
            // ability with none is hidden).
            const lavamancer = makeLavamancer();
            const view = buildTriggerStateView(
                [
                    {
                        id: "p1",
                        life: 20,
                        hand: [],
                        battlefield: [lavamancer],
                        graveyard: [gvCard("g1", "p1"), gvCard("g2", "p1")],
                    },
                ],
                "p1"
            );
            const abilities = getStackAbilities(
                lavamancer,
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
// Power Armor (INV, issue #1066) — Domain-scaled activated ability
// ({3},{T}: target creature +Domain/+Domain). Its cost shape (`tap` + `mana`)
// is the baseline the catalogue reuses everywhere, so no NEW affordability
// gate is introduced — but per the Frontend wiring analysis
// (.claude/rules/gre-development.md), every new card's activated ability
// still gets walked through the reducer (`getStackAbilities`) at least once
// so a regression that silently hides it is caught. The Domain-scaled
// pump AMOUNT itself is computed server-side at resolution (`ctx.getDomain`)
// and never read by this client-side affordability gate.
// ---------------------------------------------------------------------------
describe("getStackAbilities — Power Armor (Domain-scaled pump, issue #1066)", () => {
    it("surfaces the {3},{T} ability when untapped", () => {
        const card = makeCardInstance({
            card: { id: powerArmor.id },
            types: ["Artifact"],
            isTapped: false,
        });
        const abilities = getStackAbilities(card);
        expect(abilities).toHaveLength(1);
        expect(abilities[0].id).toBe("power-armor-pump");
    });

    it("hides the ability when the source is already tapped (unpayable {T})", () => {
        const card = makeCardInstance({
            card: { id: powerArmor.id },
            types: ["Artifact"],
            isTapped: true,
        });
        expect(getStackAbilities(card)).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// getGraveyardStackAbilities — activate-from-graveyard affordance (CR 113.6 /
// 602.5b / 603.6e, Ashen Ghoul, #737). The board never sees the GRE, so the
// Activate button in the Graveyard reveal dialog is driven entirely by this
// client helper. It must agree with the server `activateAbility` mutation:
// surface the reanimate ability only during the owner's upkeep AND when three
// or more creature cards sit above the Ghoul in its owner's graveyard. The view
// is built via `buildTriggerStateView` (as the UI does) — a hand-built view
// would mask a dropped graveyard-order field.
// ---------------------------------------------------------------------------

describe("getGraveyardStackAbilities (CR 113.6 — Ashen Ghoul, #737)", () => {
    const ASHEN_GHOUL_ID = "6bb83301-5662-4628-b536-6a3ee0296f2e";

    /** Ashen Ghoul instance in p1's graveyard. */
    const makeGhoul = () =>
        makeCardInstance({
            id: "ghoul-1",
            card: { id: ASHEN_GHOUL_ID },
            types: ["Creature"],
            subtypes: ["Zombie"],
            ownerId: "p1",
            controllerId: "p1",
            zone: "graveyard",
        });

    const creatureAbove = (id: string): CardInstance =>
        makeCardInstance({
            id,
            ownerId: "p1",
            controllerId: "p1",
            types: ["Creature"],
            zone: "graveyard",
        });

    /** View with the Ghoul at the BOTTOM (index 0) and `above` creatures stacked
     *  on top of it, at `phase` on `activePlayerId`'s turn. */
    const viewWith = (above: number, activePlayerId = "p1") =>
        buildTriggerStateView(
            [
                {
                    id: "p1",
                    life: 20,
                    hand: [],
                    battlefield: [],
                    graveyard: [
                        makeGhoul(),
                        ...Array.from({ length: above }, (_, i) =>
                            creatureAbove(`bear-${i}`)
                        ),
                    ],
                },
            ],
            activePlayerId
        );

    it("surfaces the reanimate ability during the owner's upkeep with 3 creatures above", () => {
        const abilities = getGraveyardStackAbilities(
            makeGhoul(),
            "UPKEEP",
            viewWith(3)
        );
        expect(abilities.map((a) => a.id)).toEqual(["ashen-ghoul-reanimate"]);
    });

    it("hides it when only 2 creature cards are above (CR 603.6e gate)", () => {
        const abilities = getGraveyardStackAbilities(
            makeGhoul(),
            "UPKEEP",
            viewWith(2)
        );
        expect(abilities).toHaveLength(0);
    });

    it("hides it outside the upkeep (activationPhaseRestriction)", () => {
        const abilities = getGraveyardStackAbilities(
            makeGhoul(),
            "PRECOMBAT_MAIN",
            viewWith(3)
        );
        expect(abilities).toHaveLength(0);
    });

    it("hides it on the opponent's turn (controllerTurnOnly)", () => {
        const abilities = getGraveyardStackAbilities(
            makeGhoul(),
            "UPKEEP",
            viewWith(3, "p2")
        );
        expect(abilities).toHaveLength(0);
    });

    // CR 602.1 / 605.1a (issue #1124) — Abeyance's lock also hides a
    // graveyard-activated ability regardless of source zone.
    it("hides it when the owner is under Abeyance's activation lock", () => {
        const lockedView = buildTriggerStateView(
            [
                {
                    id: "p1",
                    life: 20,
                    hand: [],
                    battlefield: [],
                    graveyard: [
                        makeGhoul(),
                        creatureAbove("bear-0"),
                        creatureAbove("bear-1"),
                        creatureAbove("bear-2"),
                    ],
                },
            ],
            "p1",
            ["p1"]
        );
        expect(
            getGraveyardStackAbilities(makeGhoul(), "UPKEEP", lockedView)
        ).toHaveLength(0);
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
        // Nettling Imp forces a creature an OPPONENT controls to attack, so the
        // opponent needs one on the board or the ability has no legal target
        // (CR 602.2b) and is hidden.
        const victim = makeCardInstance({
            id: "victim-1",
            types: ["Creature"],
            controllerId: "p2",
            ownerId: "p2",
        });
        const view = buildTriggerStateView(
            [
                makePlayerLike({ id: "p1", battlefield: [card] }),
                makePlayerLike({ id: "p2", battlefield: [victim] }),
            ],
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

    // Issue #1694 finding 2 — the `opponentOnly` merge branch read
    // `cardDef.activatedAbilities` directly and never ran the shared
    // `isActivationTimingAllowed` predicate every other zone-listing path
    // consults, so a printed timing restriction on an opponent-only ability
    // would be silently ignored (offered outside its legal window). No
    // shipped card currently combines `activatableByOpponentsOnly` with a
    // timing restriction (Clergy of the Holy Nimbus declares neither), so the
    // ability is constructed here as a test fixture and pushed onto Clergy's
    // real `activatedAbilities` array (the SAME object `getDefinition`
    // returns, since Clergy carries no fading/vanishing/exalted/prowess
    // keyword for `expandDefinition` to clone over) rather than editing a
    // card definition file. Restored in `finally` so no other test observes
    // the synthetic ability.
    it("honors a controllerTurnOnly timing restriction on the opponentOnly branch (constructed test-fixture ability)", () => {
        const syntheticAbilityId = "test-clergy-opponent-only-controller-turn";
        const syntheticAbility: ActivatedAbility = {
            id: syntheticAbilityId,
            cost: {},
            useStack: true,
            oracleText:
                "Test fixture: opponent-only ability, activate only during the controller's turn.",
            activatableByOpponentsOnly: true,
            controllerTurnOnly: true,
        };
        clergyOfTheHolyNimbus.activatedAbilities!.push(syntheticAbility);
        try {
            const card = makeCardInstance({
                card: { id: CLERGY_ID },
                types: ["Creature"],
                subtypes: ["Human", "Cleric"],
                isTapped: false,
                controllerId: "p1",
                ownerId: "p1",
            });
            // Active player is p2 (NOT the controller) — `controllerTurnOnly`
            // ("your turn" tracks the controller, CR 602.5b) hides the
            // ability even though the viewer is an opponent entitled to
            // activate it.
            const opponentActiveTurnIds = getAnyPlayerStackAbilities(
                card,
                undefined,
                buildTriggerStateView([], "p2")
            ).map((a) => a.id);
            expect(opponentActiveTurnIds).not.toContain(syntheticAbilityId);

            // Active player IS the controller (p1) — the timing restriction
            // is satisfied, so the opponent-only ability is offered.
            const controllerActiveTurnIds = getAnyPlayerStackAbilities(
                card,
                undefined,
                buildTriggerStateView([], "p1")
            ).map((a) => a.id);
            expect(controllerActiveTurnIds).toContain(syntheticAbilityId);
        } finally {
            clergyOfTheHolyNimbus.activatedAbilities =
                clergyOfTheHolyNimbus.activatedAbilities!.filter(
                    (a) => a.id !== syntheticAbilityId
                );
        }
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
// getTriggeredAbilityOracleText — emblem source (CR 114)
// ---------------------------------------------------------------------------

describe("getTriggeredAbilityOracleText — emblem source (CR 114)", () => {
    // Regression: an emblem-sourced trigger's `card.id` is an emblem KEY, not a
    // card registry id, so a hard `getDefinition` threw "Card not found" and
    // crashed <StackRow>. The oracle text must resolve from the emblem registry.
    it("resolves Chandra, Torch of Defiance emblem trigger text without throwing", () => {
        expect(() =>
            getTriggeredAbilityOracleText(
                CHANDRA_TORCH_OF_DEFIANCE_EMBLEM_ID,
                "chandra-torch-of-defiance-emblem-cast"
            )
        ).not.toThrow();
        expect(
            getTriggeredAbilityOracleText(
                CHANDRA_TORCH_OF_DEFIANCE_EMBLEM_ID,
                "chandra-torch-of-defiance-emblem-cast"
            )
        ).toBe(
            "Whenever you cast a spell, this emblem deals 5 damage to any target."
        );
    });

    it("returns null (no throw) for an unknown emblem id", () => {
        expect(getTriggeredAbilityOracleText("no-such-emblem", "x")).toBeNull();
    });
});

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

    // ADR 0048 — an INLINE delayed trigger (DSL `delayedTrigger` Op) carries
    // the constant INLINE_DELAYED_TRIGGER_ID as its id and has NO
    // `cardDef.delayedTriggers[]` row, so the card-def lookup returns null; its
    // text rides on the stack item (`delayedOracleText`). Without this the
    // stack tile fell back to a full-card image (Sneak Attack, Forth Eorlingas).
    it("prefers the inline oracle text carried on the stack item", () => {
        const text = getDelayedTriggerOracleText(
            "d07dc95d-82a8-4a58-8ea2-d4513bd7316d", // Sneak Attack
            "$inline-effects",
            "Sacrifice the creature at the beginning of the next end step."
        );
        expect(text).toBe(
            "Sacrifice the creature at the beginning of the next end step."
        );
    });

    it("returns null for an inline trigger id with no carried text (defensive)", () => {
        const text = getDelayedTriggerOracleText(
            "d07dc95d-82a8-4a58-8ea2-d4513bd7316d",
            "$inline-effects"
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

    it("keeps BOTH a spell and an ability under 'any' (Ward, CR 702.21a)", () => {
        const triggeredAbility = {
            types: ["Creature"],
            triggeredAbilityId: "etb-trigger",
        };
        expect(
            matchesStackObjectFilter(artifactSpell, "any", undefined, undefined)
        ).toBe(true);
        expect(
            matchesStackObjectFilter(
                creatureAbility,
                "any",
                undefined,
                undefined
            )
        ).toBe(true);
        expect(
            matchesStackObjectFilter(
                triggeredAbility,
                "any",
                undefined,
                undefined
            )
        ).toBe(true);
    });

    it("'any' + spellTargetsInstanceIds also admits a matching ABILITY (Ward's reflexive self-target), unlike the spell-only Mistfolk default", () => {
        const abilityAtWarded = {
            types: ["Creature"],
            triggeredAbilityId: "ward-trigger",
            targets: [{ type: "permanent", id: "warded" }],
        };
        const abilityAtOther = {
            ...abilityAtWarded,
            targets: [{ type: "permanent", id: "other" }],
        };
        expect(
            matchesStackObjectFilter(abilityAtWarded, "any", undefined, [
                "warded",
            ])
        ).toBe(true);
        expect(
            matchesStackObjectFilter(abilityAtOther, "any", undefined, [
                "warded",
            ])
        ).toBe(false);
        // Spell-only default (no spellStackKind) keeps excluding abilities,
        // even one that targets the pinned id — Mistfolk's existing contract
        // is unchanged.
        expect(
            matchesStackObjectFilter(abilityAtWarded, undefined, undefined, [
                "warded",
            ])
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

// Lutri, the Spellchaser (#1391): "copy target instant or sorcery spell YOU
// CONTROL" — frontend clickability gate extending `controller` (CR 109.3 /
// 114.1) onto spell/ability stack targets, mirroring the server's
// `matchesBattlefieldController` predicate.
describe("matchesSpellController", () => {
    it("matches a spell the activating player cast, under 'you'", () => {
        expect(
            matchesSpellController({ castById: "p1" }, "you", "p1", "p1")
        ).toBe(true);
    });

    it("rejects an opponent's spell under 'you'", () => {
        expect(
            matchesSpellController({ castById: "p2" }, "you", "p1", "p1")
        ).toBe(false);
    });

    it("matches an opponent's spell under 'opponent'", () => {
        expect(
            matchesSpellController({ castById: "p2" }, "opponent", "p1", "p1")
        ).toBe(true);
    });

    it("rejects the activator's own spell under 'opponent'", () => {
        expect(
            matchesSpellController({ castById: "p1" }, "opponent", "p1", "p1")
        ).toBe(false);
    });

    it("matches only the active player's spell under 'active'", () => {
        expect(
            matchesSpellController({ castById: "p2" }, "active", "p1", "p2")
        ).toBe(true);
        expect(
            matchesSpellController({ castById: "p1" }, "active", "p1", "p2")
        ).toBe(false);
    });

    it("matches anything under 'any' or no filter", () => {
        expect(
            matchesSpellController({ castById: "p2" }, "any", "p1", "p1")
        ).toBe(true);
        expect(
            matchesSpellController({ castById: "p2" }, undefined, "p1", "p1")
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

    // Frontend wiring walk (issue #1470) — earthbend N's return clause is
    // built, so the ability's reminder text is no longer truncated. The card
    // preview's structured ability panel reads the TRIGGER's own oracleText
    // through this reducer, so the restored sentence must appear here.
    it("renders Badgermole Cub's FULL earthbend reminder text (issue #1470)", () => {
        const BADGERMOLE_CUB_ID = "340c5799-4964-44dd-8c48-8f3f3aba5211";
        const { triggered } = getDisplayAbilities(BADGERMOLE_CUB_ID);
        const earthbendLine = triggered.find((t) =>
            t.oracleText.includes("earthbend 1")
        );
        expect(earthbendLine).toBeDefined();
        expect(earthbendLine!.oracleText).toContain(
            "When it dies or is exiled, return it to the battlefield tapped."
        );
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
// matchesPermanentFilter — `any` disjunction (issue #897)
// ---------------------------------------------------------------------------

describe("matchesPermanentFilter (client mirror — `any` disjunction, #897)", () => {
    // A filter carrying ONLY `any` must NOT collapse to all-fields-undefined
    // (which would fail OPEN and highlight every permanent as a legal pick).
    // Regression for the client battlefield-choice highlighter dropping the
    // disjunction that toPermanentFilter/matchesPermanentFilter (server) and
    // the other 3 consumers already honor.
    const anyFilter = {
        any: [{ types: "Artifact" }, { subtypes: "Dragon" }],
    };

    it("matches an artifact (clause A) via `any`", () => {
        const artifact = makeCardInstance({
            types: ["Artifact"],
            subtypes: [],
        });
        expect(matchesPermanentFilter(artifact, anyFilter)).toBe(true);
    });

    it("matches a non-artifact Dragon creature (clause B) via `any`", () => {
        const dragon = makeCardInstance({
            types: ["Creature"],
            subtypes: ["Dragon"],
        });
        expect(matchesPermanentFilter(dragon, anyFilter)).toBe(true);
    });

    it("rejects a permanent matching NEITHER clause (not every permanent)", () => {
        const bear = makeCardInstance({
            types: ["Creature"],
            subtypes: ["Bear"],
        });
        expect(matchesPermanentFilter(bear, anyFilter)).toBe(false);
    });

    it("ANDs `any` with a sibling top-level field", () => {
        const tappedArtifact = makeCardInstance({
            types: ["Artifact"],
            subtypes: [],
            isTapped: true,
        });
        const untappedArtifact = makeCardInstance({
            types: ["Artifact"],
            subtypes: [],
            isTapped: false,
        });
        const filter = { ...anyFilter, tapped: true };
        expect(matchesPermanentFilter(tappedArtifact, filter)).toBe(true);
        expect(matchesPermanentFilter(untappedArtifact, filter)).toBe(false);
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

// ---------------------------------------------------------------------------
// getNonTapManaChoices — Vivi Ornitier (issue #1179). The non-tap analog of
// getManaChoices: a NON-tap, choice-based mana ability (no {T}/sacrifice) is
// deliberately EXCLUDED from the unified tap-options list, so it needs its
// own client resolver reading the SAME `getEffectiveManaChoices` the server
// (`activateManaAbility`) validates the submitted index against.
// ---------------------------------------------------------------------------

describe("getNonTapManaChoices — Vivi Ornitier (non-tap choice-based mana ability)", () => {
    function vivi(counters?: Record<string, number>): CardInstance {
        return makeCardInstance({
            id: "vivi",
            card: { id: viviOrnitier.id },
            controllerId: "p1",
            types: ["Creature"],
            subtypes: ["Wizard"],
            power: 0,
            toughness: 3,
            ...(counters ? { counters } : {}),
        });
    }

    it("is null for a card with no non-tap choice-based mana ability (regular getManaChoices, e.g. Fellwar Stone, has its own describe block)", () => {
        const rock = makeCardInstance({
            id: "fs-nontap",
            card: { id: fellwarStone.id },
            controllerId: "p1",
            types: ["Artifact"],
            subtypes: [],
        });
        expect(getNonTapManaChoices(rock)).toBeNull();
    });

    it("enumerates every {U}/{R} split summing to Vivi's CURRENT effective power", () => {
        const players = [{ id: "p1", battlefield: [vivi({ "+1/+1": 2 })] }];
        expect(getNonTapManaChoices(vivi({ "+1/+1": 2 }), players)).toEqual(
            expect.arrayContaining([{ R: 2 }, { U: 1, R: 1 }, { U: 2 }])
        );
    });

    it("is the single zero-mana option at base power (no counters yet)", () => {
        const players = [{ id: "p1", battlefield: [vivi()] }];
        expect(getNonTapManaChoices(vivi(), players)).toEqual([{}]);
    });

    it("is NOT surfaced by the TAP-based getManaChoices (she has no {T} component, CR 605.1a)", () => {
        const players = [{ id: "p1", battlefield: [vivi({ "+1/+1": 2 })] }];
        expect(getManaChoices(vivi({ "+1/+1": 2 }), players)).toBeNull();
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

    it("normalizeMayPayCost preserves the energy leg (CR 122.1, #1194)", () => {
        expect(normalizeMayPayCost({ energy: 3 })).toEqual({ energy: 3 });
        expect(normalizeMayPayCost({ mana: { B: 1 }, energy: 2 })).toEqual({
            mana: { B: 1 },
            energy: 2,
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
                permanent: {
                    action: "sacrifice" as const,
                    filter: { types: "Land" as const },
                    count: 1,
                },
            })
        ).toBe("sacrifice");
        expect(
            mayPayCostLabel({
                permanent: {
                    action: "sacrifice" as const,
                    filter: { types: "Land" as const },
                    count: 2,
                },
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
            permanent: {
                action: "sacrifice" as const,
                filter: { types: "Land" as const },
                count: 2,
            },
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

    // CR 122.1 (issue #1194) — the energy leg wasn't wired into the frontend
    // affordability gate: Guide of Souls' `{ energy: 3 }` may-pay left the Pay
    // button enabled below 3 energy, and clicking it hit the server's
    // "Cannot pay the cost" rejection (`canPayMayPayCost`). Regression test for
    // that fixup.
    it("mayPayCanAfford gates the energy leg (CR 122.1, #1194)", () => {
        const energyCost = { energy: 3 };
        // Insufficient energy (undefined / below the leg) → not affordable.
        expect(mayPayCanAfford(energyCost, {}, 20, 0)).toBe(false);
        expect(
            mayPayCanAfford(
                energyCost,
                {},
                20,
                0,
                undefined,
                undefined,
                undefined,
                2
            )
        ).toBe(false);
        // Energy meeting / exceeding the leg → affordable.
        expect(
            mayPayCanAfford(
                energyCost,
                {},
                20,
                0,
                undefined,
                undefined,
                undefined,
                3
            )
        ).toBe(true);
        expect(
            mayPayCanAfford(
                energyCost,
                {},
                20,
                0,
                undefined,
                undefined,
                undefined,
                4
            )
        ).toBe(true);
        // Mixed with another leg: all-or-nothing, energy insufficient still
        // fails even when mana is covered.
        const mix = { mana: { U: 1 }, energy: 2 };
        expect(
            mayPayCanAfford(
                mix,
                { U: 1 },
                20,
                0,
                undefined,
                undefined,
                undefined,
                1
            )
        ).toBe(false);
        expect(
            mayPayCanAfford(
                mix,
                { U: 1 },
                20,
                0,
                undefined,
                undefined,
                undefined,
                2
            )
        ).toBe(true);
    });

    it("mayPayCostLabel renders the energy leg as repeated {E} tokens (CR 122.1, #1194)", () => {
        expect(mayPayCostLabel({ energy: 3 })).toBe("{E}{E}{E}");
        expect(mayPayCostLabel({ energy: 1 })).toBe("{E}");
        expect(mayPayCostLabel({ mana: { B: 1 }, energy: 2 })).toBe(
            "{B} and {E}{E}"
        );
    });

    it("mayPaySacrificeCount counts matching battlefield permanents", () => {
        const bf = [
            makeCardInstance({ id: "l1", types: ["Land"] }),
            makeCardInstance({ id: "l2", types: ["Land"] }),
            makeCardInstance({ id: "c1", types: ["Creature"] }),
        ];
        expect(
            mayPaySacrificeCount(
                {
                    permanent: {
                        action: "sacrifice" as const,
                        filter: { types: "Land" as const },
                        count: 1,
                    },
                },
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
                permanent: {
                    action: "sacrifice" as const,
                    filter: {},
                    count: 1,
                },
            })
        ).toBe(1);
        expect(
            mayPayRequiredSacrifices({
                permanent: {
                    action: "sacrifice" as const,
                    filter: { types: "Land" as const },
                    count: 2,
                },
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

    it("shows FULL Oracle text for a card with an oracle-only clause NOT in the field allowlist (Enduring Renewal — drawReplacement + revealsHand)", () => {
        // 3-clause card: "Play with your hand revealed." (revealsHand) +
        // draw-replacement (drawReplacement) + one triggered ability. Only the
        // trigger has a structured row; the other two clauses live in fields the
        // old `hasOracleOnlyText` allowlist did not check, so its printed text
        // was suppressed entirely. Coverage check (3 paragraphs > 1 row) fixes it.
        const def = getDefinition("be77edac-9a8b-4b7f-a859-27df76b10aa6");
        expect(def.drawReplacement).toBeDefined();
        expect(def.revealsHand).toBeDefined();
        expect((def.triggeredAbilities?.length ?? 0) > 0).toBe(true);
        expect(show(def)).toBe(true);
    });

    it("shows FULL Oracle text for a card with land-play clauses NOT in the field allowlist (Icetill Explorer — extraLandDrops + playsLandsFromGraveyard)", () => {
        // "You may play an additional land." (extraLandDrops) + "You may play
        // lands from your graveyard." (playsLandsFromGraveyard) + a landfall
        // trigger. Only the trigger had a structured row; the two land clauses
        // were dropped by the old allowlist. 3 paragraphs > 1 row → show.
        const def = getDefinition("d9482aab-6ddf-48e1-84fa-b13d5ff81e69");
        expect(def.extraLandDrops).toBeDefined();
        expect(def.playsLandsFromGraveyard).toBe(true);
        expect((def.triggeredAbilities?.length ?? 0) > 0).toBe(true);
        expect(show(def)).toBe(true);
    });

    it("shows FULL Oracle text whenever printed lines exceed renderable structured rows (coverage check, bug class)", () => {
        // Synthetic root-cause case: two oracle paragraphs, one of which has no
        // structured representation (a single triggered ability). Regardless of
        // WHICH field the second clause lives in, the paragraph/row mismatch
        // surfaces the full text.
        const def: CardDefinition = {
            id: "cov",
            name: "Coverage Test",
            rarity: "common",
            oracleText:
                "Some effect with no structured field.\nWhenever this enters, draw a card.",
            manaCost: { U: 1 },
            types: ["Enchantment"],
            triggeredAbilities: [
                {
                    id: "cov-trig",
                    oracleText: "Whenever this enters, draw a card.",
                    // minimal shape — only oracleText is read by the gate
                } as unknown as NonNullable<
                    CardDefinition["triggeredAbilities"]
                >[number],
            ],
        };
        expect(show(def)).toBe(true);
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

// CR 107.4 / 202.1 — mana-cost symbol rendering for the card preview. The
// `generic` key (fixed generic mana that coexists with a variable {X}) was
// dropped, so any card using it lost its generic pip. This is a bug CLASS:
// every card encoding fixed generic via `generic` — not just Dominate.
describe("manaCostToString renders fixed generic mana (bug class)", () => {
    it("renders Dominate's {X}{1}{U}{U} — the generic:1 is not dropped", () => {
        expect(manaCostToString(dominate.manaCost)).toBe("{X}{1}{U}{U}");
    });

    it("renders a variable-X + fixed-generic + colored cost in {X}{N}{C} order", () => {
        // Soul Burn shape: { X: "X", generic: 2, B: 1 } → {X}{2}{B}.
        expect(manaCostToString({ X: "X", generic: 2, B: 1 })).toBe(
            "{X}{2}{B}"
        );
    });

    it("renders a generic-only key with a color ({generic:2, R:1} → {2}{R})", () => {
        expect(manaCostToString({ generic: 2, R: 1 })).toBe("{2}{R}");
    });

    it("still renders the numeric-X fixed-generic convention ({X:1, G:1} → {1}{G})", () => {
        expect(manaCostToString({ X: 1, G: 1 })).toBe("{1}{G}");
    });

    it("collapses numeric-X and generic-key into a single {N} if both present", () => {
        expect(manaCostToString({ X: 1, generic: 2, U: 1 })).toBe("{3}{U}");
    });

    it("renders Phyrexian pips after the colored pips (CR 107.4f)", () => {
        // Dismember {1}{B/P}{B/P}, Gitaxian Probe {U/P}, Metamorph {3}{U/P}.
        expect(manaCostToString({ X: 1, phyrexian: { B: 2 } })).toBe(
            "{1}{B/P}{B/P}"
        );
        expect(manaCostToString({ phyrexian: { U: 1 } })).toBe("{U/P}");
        expect(manaCostToString({ X: 3, phyrexian: { U: 1 } })).toBe(
            "{3}{U/P}"
        );
    });
});

// phyrexianSplitChoices — the cast-time picker's option labels (CR 107.4f). The
// affordable `lifePips` values arrive from the projection (`phyrexianOptions`);
// this maps each to a "pay mana / pay life" label the picker renders.
describe("phyrexianSplitChoices (CR 107.4f)", () => {
    it("labels each affordable split of a 2-pip cost (Dismember)", () => {
        const card = makeCardInstance({
            card: { id: dismember.id },
            types: ["Instant"],
            phyrexianOptions: [0, 1, 2],
        });
        expect(phyrexianSplitChoices(card)).toEqual([
            { lifePips: 0, label: "{B}{B}" },
            { lifePips: 1, label: "{B} + 2 life" },
            { lifePips: 2, label: "4 life" },
        ]);
    });

    it("labels the two-way split of a single-pip cost (Gitaxian Probe)", () => {
        const card = makeCardInstance({
            card: { id: gitaxianProbe.id },
            types: ["Sorcery"],
            phyrexianOptions: [0, 1],
        });
        expect(phyrexianSplitChoices(card)).toEqual([
            { lifePips: 0, label: "{U}" },
            { lifePips: 1, label: "2 life" },
        ]);
    });

    it("returns [] when there is no real branch (< 2 options)", () => {
        const card = makeCardInstance({
            card: { id: gitaxianProbe.id },
            types: ["Sorcery"],
            phyrexianOptions: [1],
        });
        expect(phyrexianSplitChoices(card)).toEqual([]);
        // And when the field is absent entirely (non-Phyrexian / degenerate).
        expect(
            phyrexianSplitChoices(
                makeCardInstance({ card: { id: gitaxianProbe.id } })
            )
        ).toEqual([]);
    });
});

// getHandStackAbilities — activate-from-hand affordance (CR 113.6 / 702.29a,
// Cycling, #689). The board never sees the GRE, so the "Cycle" button on a hand
// card is driven entirely by this client helper. It must agree with the server
// `activateAbility` mutation: surface a Cycling ability only for a card in the
// viewer's own hand that opts in via `activateFromHand`. The view is built via
// `buildTriggerStateView` (as the UI does) — a hand-built view would mask a
// dropped field. Raugrin Triome (Cycling {3}) is the exemplar.
// ---------------------------------------------------------------------------

describe("getHandStackAbilities (CR 113.6 / 702.29a — Cycling, #689)", () => {
    const RAUGRIN_TRIOME_ID = "02138fbb-3962-4348-8d31-faaefba0b8b2";
    const GRIZZLY_BEARS_ID = "ce2d603a-3231-4a8c-bf39-1617586ea870";

    const makeTriomeInHand = () =>
        makeCardInstance({
            id: "triome-1",
            card: { id: RAUGRIN_TRIOME_ID },
            types: ["Land"],
            ownerId: "p1",
            controllerId: "p1",
            zone: "hand",
        });

    const viewFor = (card: CardInstance, activePlayerId = "p1") =>
        buildTriggerStateView(
            [
                {
                    id: "p1",
                    life: 20,
                    hand: [card],
                    battlefield: [],
                    graveyard: [],
                },
            ],
            activePlayerId
        );

    it("surfaces the Cycling ability for a Triome in the viewer's own hand (through the reducer)", () => {
        const triome = makeTriomeInHand();
        const abilities = getHandStackAbilities(
            triome,
            "PRECOMBAT_MAIN",
            viewFor(triome)
        );
        expect(abilities.map((a) => a.id)).toEqual(["cycling"]);
        // Instant speed — it is also offered in a later phase.
        const postcombat = getHandStackAbilities(
            triome,
            "POSTCOMBAT_MAIN",
            viewFor(triome)
        );
        expect(postcombat.map((a) => a.id)).toEqual(["cycling"]);
    });

    it("offers nothing for a card in hand with no activateFromHand ability", () => {
        const bears = makeCardInstance({
            id: "bears-1",
            card: { id: GRIZZLY_BEARS_ID },
            types: ["Creature"],
            ownerId: "p1",
            controllerId: "p1",
            zone: "hand",
        });
        expect(
            getHandStackAbilities(bears, "PRECOMBAT_MAIN", viewFor(bears))
        ).toHaveLength(0);
    });

    // CR 602.1 / 605.1a (issue #1124) — Abeyance's lock also hides a
    // hand-activated ability (Cycling) regardless of source zone.
    it("hides Cycling when the owner is under Abeyance's activation lock", () => {
        const triome = makeTriomeInHand();
        const lockedView = buildTriggerStateView(
            [{ id: "p1", life: 20, hand: [triome], battlefield: [] }],
            "p1",
            ["p1"]
        );
        expect(
            getHandStackAbilities(triome, "PRECOMBAT_MAIN", lockedView)
        ).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// CR 702.126 — Improvise (issue #1313)
// ---------------------------------------------------------------------------

function makeImprovisePlayer(overrides: Partial<Player> = {}): Player {
    return {
        id: "p1",
        name: "P1",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: {},
        ...overrides,
    };
}

describe("hasImprovise", () => {
    it("is true for Metallic Rebuke (declares the keyword)", () => {
        const card = makeCardInstance({
            card: { id: metallicRebuke.id },
            types: ["Instant"],
        });
        expect(hasImprovise(card)).toBe(true);
    });

    it("is false for a card without the keyword", () => {
        const card = makeCardInstance({
            card: { id: MERFOLK_ID },
            types: ["Creature"],
        });
        expect(hasImprovise(card)).toBe(false);
    });
});

describe("pendingCastSourceCard / pendingCastHasImprovise / pendingCastRemainingGeneric", () => {
    const pendingCast: PendingCast = {
        playerId: "p1",
        cardInstanceId: "spell-1",
        manaCost: { U: 1, X: 2 },
        tappedLandIds: [],
    };

    it("finds the cast source in the caster's own hand", () => {
        const spell = makeCardInstance({
            id: "spell-1",
            card: { id: metallicRebuke.id },
            types: ["Instant"],
            zone: "hand",
        });
        const me = makeImprovisePlayer({ hand: [spell] });
        expect(pendingCastSourceCard(pendingCast, me)).toBe(spell);
        expect(pendingCastHasImprovise(pendingCast, me)).toBe(true);
    });

    it("falls back to exile, then graveyard, when not in hand (Ice Cauldron / Flashback casts)", () => {
        const spell = makeCardInstance({
            id: "spell-1",
            card: { id: metallicRebuke.id },
            types: ["Instant"],
            zone: "exile",
        });
        const meExile = makeImprovisePlayer({ exile: [spell] });
        expect(pendingCastSourceCard(pendingCast, meExile)).toBe(spell);

        const meGraveyard = makeImprovisePlayer({
            graveyard: [{ ...spell, zone: "graveyard" }],
        });
        expect(pendingCastSourceCard(pendingCast, meGraveyard)).toBeDefined();
    });

    it("returns false/undefined when the caster has no such card in any zone", () => {
        const me = makeImprovisePlayer();
        expect(pendingCastSourceCard(pendingCast, me)).toBeUndefined();
        expect(pendingCastHasImprovise(pendingCast, me)).toBe(false);
        expect(pendingCastHasImprovise(pendingCast, undefined)).toBe(false);
    });

    it("is false for a spell that does not declare improvise", () => {
        const spell = makeCardInstance({
            id: "spell-1",
            card: { id: MERFOLK_ID },
            types: ["Creature"],
            zone: "hand",
        });
        const me = makeImprovisePlayer({ hand: [spell] });
        expect(pendingCastHasImprovise(pendingCast, me)).toBe(false);
    });

    it("reads the remaining generic cost straight off manaCost.X", () => {
        expect(pendingCastRemainingGeneric(pendingCast)).toBe(2);
        expect(
            pendingCastRemainingGeneric({ ...pendingCast, manaCost: { U: 1 } })
        ).toBe(0);
    });
});

// CR 601.2g (issue #1445) — the prompt-visibility predicate for the
// generic-mana spend choice (`ManaSpendChoiceDialog` in board.tsx). Mirrors
// the server's `findActiveManaSpendChoice` (convex/game.ts) so the board
// renders the prompt exactly when the server has one parked for the viewer.
describe("activeManaSpendChoice (CR 601.2g)", () => {
    const pendingCast: PendingCast = {
        playerId: "p1",
        cardInstanceId: "spell-1",
        manaCost: { generic: 1 },
        tappedLandIds: [],
        manaSpendChoice: { generic: 1, candidateColors: ["U", "G"] },
    };
    const pendingActivation: PendingActivation = {
        playerId: "p1",
        cardInstanceId: "art-1",
        abilityId: "tap-for-white",
        manaCost: { generic: 1 },
        tappedLandIds: [],
        tapSource: false,
        sacrificeSource: false,
        manaSpendChoice: { generic: 1, candidateColors: ["W", "B"] },
    };

    it("surfaces a parked pendingCast.manaSpendChoice for its own player", () => {
        expect(activeManaSpendChoice(pendingCast, undefined, "p1")).toEqual({
            container: "cast",
            choice: { generic: 1, candidateColors: ["U", "G"] },
        });
    });

    it("surfaces a parked pendingActivation.manaSpendChoice for its own player", () => {
        expect(
            activeManaSpendChoice(undefined, pendingActivation, "p1")
        ).toEqual({
            container: "activation",
            choice: { generic: 1, candidateColors: ["W", "B"] },
        });
    });

    it("returns null for the opponent (not the parked choice's own player)", () => {
        expect(activeManaSpendChoice(pendingCast, undefined, "p2")).toBeNull();
    });

    it("returns null when pendingCast has no manaSpendChoice parked", () => {
        expect(
            activeManaSpendChoice(
                { ...pendingCast, manaSpendChoice: undefined },
                undefined,
                "p1"
            )
        ).toBeNull();
    });

    it("returns null with no pendingCast/pendingActivation at all", () => {
        expect(activeManaSpendChoice(undefined, undefined, "p1")).toBeNull();
    });
});

describe("Millstone fixture sanity (Improvise payment tests use it as a plain artifact)", () => {
    it("is an Artifact with no mana ability", () => {
        const card = makeCardInstance({
            card: { id: millstone.id },
            types: ["Artifact"],
        });
        expect(hasManaAbility(card)).toBe(false);
        expect(card.types?.includes("Artifact")).toBe(true);
    });
});

// Mox Opal's Metalcraft gate (issue #1530) — a NEW `canActivate` predicate
// shape (a battlefield-wide artifact count, unlike Chrome Mox's per-instance
// imprint counters or Fellwar Stone's dynamic colour chooser). Frontend
// wiring analysis (CLAUDE.md): the gate reads `state.players[].battlefield[]
// .types`/`controllerId`, both fields `buildTriggerStateView` already
// preserves (issue #947's `hasManaAbility` client mirror), so this drives the
// SURFACE assertion through the REAL reducer rather than a hand-built view.
describe("Mox Opal Metalcraft gate through buildTriggerStateView (issue #1530, #947)", () => {
    function board(artifactCount: number) {
        const mox = makeCardInstance({
            id: "mox",
            card: { id: moxOpal.id },
            controllerId: "p1",
            ownerId: "p1",
            types: ["Artifact"],
        });
        const others = Array.from({ length: artifactCount - 1 }, (_, i) =>
            makeCardInstance({
                id: `art${i}`,
                card: { id: moxOpal.id },
                controllerId: "p1",
                ownerId: "p1",
                types: ["Artifact"],
            })
        );
        return buildTriggerStateView([
            {
                id: "p1",
                life: 20,
                hand: [],
                battlefield: [mox, ...others],
            },
            { id: "p2", life: 20, hand: [], battlefield: [] },
        ]);
    }

    it("hasManaAbility is false with fewer than 3 artifacts controlled", () => {
        const card = makeCardInstance({
            id: "mox",
            card: { id: moxOpal.id },
            types: ["Artifact"],
        });
        expect(hasManaAbility(card, board(2))).toBe(false);
    });

    it("hasManaAbility is true with 3+ artifacts controlled, via the real buildTriggerStateView reducer", () => {
        const card = makeCardInstance({
            id: "mox",
            card: { id: moxOpal.id },
            types: ["Artifact"],
        });
        expect(hasManaAbility(card, board(3))).toBe(true);
    });
});

// Zero-output mana source (CR 605.1a / 106.1, issue #1889) — an Everflowing
// Chalice with no charge counters CAN legally be activated, but it adds no
// mana, so it must not be offered as a tappable payment source in the UI (the
// server's `getManaTapOptionsDetailed` stopped offering it at the same time).
// Frontend wiring analysis (CLAUDE.md): the gate resolves the SAME unified tap
// option list the server does (`getManaTapOptions`), fed the viewer's whole
// `allPlayers` list — so the SURFACE assertions below run through the REAL
// `buildTriggerStateView` reducer and the real player list, never a hand-built
// view.
describe("hasManaAbility drops a zero-output mana source (issue #1889)", () => {
    function chalice(charge: number) {
        return makeCardInstance({
            id: `chalice-${charge}`,
            card: { id: everflowingChalice.id },
            controllerId: "p1",
            ownerId: "p1",
            types: ["Artifact"],
            counters: charge > 0 ? { charge } : {},
        });
    }

    function players(cards: ReturnType<typeof chalice>[]) {
        return [
            { id: "p1", life: 20, hand: [], battlefield: cards },
            { id: "p2", life: 20, hand: [], battlefield: [] },
        ];
    }

    it("is false for a 0-counter Chalice, through the real reducer + board helper", () => {
        const card = chalice(0);
        const all = players([card]);
        const view = buildTriggerStateView(all);
        expect(hasManaAbility(card, view, all)).toBe(false);
    });

    it("is true for a 2-counter Chalice, through the same path", () => {
        const card = chalice(2);
        const all = players([card]);
        const view = buildTriggerStateView(all);
        expect(hasManaAbility(card, view, all)).toBe(true);
    });

    it("omitting the board leaves the client predicate exactly as before (delta zero)", () => {
        expect(hasManaAbility(chalice(0))).toBe(true);
    });

    it("getManaChoices offers no tap option for a 0-counter Chalice", () => {
        const card = chalice(0);
        expect(getManaChoices(card, players([card]))).toBeNull();
    });

    // REGRESSION GUARD (reviewer finding on PR #1902): the first cut of #1889
    // dropped zero-output entries from CHOICE lists too, which deleted a storage
    // land's index-0 "remove 0 counters" entry. A 0-counter storage land — its
    // NORMAL post-untap state — then had an empty option list: `hasManaAbility`
    // still said "mana source" (so it painted and clicked), `getManaChoices`
    // returned null (so no index was sent), and the server's still-true
    // `manaTapNeedsChoice` threw "Must choose a mana color" on a click that used
    // to work. Both halves are pinned here.
    it("a 0-counter storage land still reads as a mana source and still offers its choice list", () => {
        const land = makeCardInstance({
            id: "store",
            card: { id: icatianStore.id },
            controllerId: "p1",
            ownerId: "p1",
            types: ["Land"],
            counters: {},
        });
        const all = [
            { id: "p1", life: 20, hand: [], battlefield: [land] },
            { id: "p2", life: 20, hand: [], battlefield: [] },
        ];
        const view = buildTriggerStateView(all);
        expect(hasManaAbility(land, view, all)).toBe(true);
        // The "remove 0 counters" entry survives, so an index IS submittable —
        // client and server agree there is exactly one thing to choose.
        expect(getManaChoices(land, all)).toEqual([{ W: 0 }]);
    });

    it("a 3-counter storage land's client choice list is the full 0..N ladder", () => {
        const land = makeCardInstance({
            id: "store",
            card: { id: icatianStore.id },
            controllerId: "p1",
            ownerId: "p1",
            types: ["Land"],
            counters: { storage: 3 },
        });
        const all = [
            { id: "p1", life: 20, hand: [], battlefield: [land] },
            { id: "p2", life: 20, hand: [], battlefield: [] },
        ];
        expect(hasManaAbility(land, buildTriggerStateView(all), all)).toBe(
            true
        );
        // Index IS the counter count — a shifted list would remove N+1 for N.
        expect(getManaChoices(land, all)).toEqual([
            { W: 0 },
            { W: 1 },
            { W: 2 },
            { W: 3 },
        ]);
    });
});

// CR 606.3 — a loyalty ability is sorcery-speed on its controller's own turn.
// The client hint only checked the TURN, so every loyalty ability stayed in the
// context menu all through combat and the end step, where the server rejects
// it ("A loyalty ability can only be activated at sorcery speed on your turn").
describe("getStackAbilities — loyalty abilities are sorcery-speed (CR 606.3)", () => {
    const JACE_ID = "0e606072-a3aa-4300-ba90-ec92a721fa76"; // Jace, the Mind Sculptor

    function jaceOnBoard() {
        return makeCardInstance({
            id: "jace-1",
            card: { id: JACE_ID },
            types: ["Planeswalker"],
            controllerId: "p1",
            ownerId: "p1",
            counters: { loyalty: 20 },
        });
    }

    function abilitiesAt(phase: string) {
        const jace = jaceOnBoard();
        const opp = makeCardInstance({
            id: "victim-1",
            types: ["Creature"],
            controllerId: "p2",
            ownerId: "p2",
        });
        const view = buildTriggerStateView(
            [
                makePlayerLike({ id: "p1", battlefield: [jace] }),
                makePlayerLike({ id: "p2", battlefield: [opp] }),
            ],
            "p1" // controller's own turn
        );
        return getStackAbilities(jace, phase as never, true, view).map(
            (a) => a.id
        );
    }

    it("offers them in a main phase", () => {
        expect(abilitiesAt("PRECOMBAT_MAIN").length).toBeGreaterThan(0);
        expect(abilitiesAt("POSTCOMBAT_MAIN").length).toBeGreaterThan(0);
    });

    it("hides them outside a main phase, even on your own turn", () => {
        expect(abilitiesAt("DECLARE_ATTACKERS")).toEqual([]);
        expect(abilitiesAt("UPKEEP")).toEqual([]);
        expect(abilitiesAt("END_STEP")).toEqual([]);
    });
});

// CR 602.2b — an activated ability that targets and has no legal target can't
// be activated, so offering it in the menu offers a move the server rejects
// (an Equipment's Equip with no creature anywhere on the battlefield).
describe("getStackAbilities — targeting abilities with no legal target (CR 602.2b)", () => {
    const BOOTS_ID = "e50709de-e6ef-4dbc-af1e-290fed279f34"; // Lavaspur Boots

    function boots() {
        return makeCardInstance({
            id: "boots-1",
            card: { id: BOOTS_ID },
            types: ["Artifact"],
            subtypes: ["Equipment"],
            controllerId: "p1",
            ownerId: "p1",
        });
    }

    it("hides Equip when its controller has no creature", () => {
        const equipment = boots();
        const view = buildTriggerStateView(
            [
                makePlayerLike({ id: "p1", battlefield: [equipment] }),
                makePlayerLike({ id: "p2", battlefield: [] }),
            ],
            "p1"
        );
        expect(
            getStackAbilities(equipment, "PRECOMBAT_MAIN", true, view).map(
                (a) => a.id
            )
        ).not.toContain("lavaspur-boots-equip");
    });

    it("offers Equip once a creature it could attach to exists", () => {
        const equipment = boots();
        const bear = makeCardInstance({
            id: "bear-1",
            types: ["Creature"],
            controllerId: "p1",
            ownerId: "p1",
        });
        const view = buildTriggerStateView(
            [
                makePlayerLike({ id: "p1", battlefield: [equipment, bear] }),
                makePlayerLike({ id: "p2", battlefield: [] }),
            ],
            "p1"
        );
        expect(
            getStackAbilities(equipment, "PRECOMBAT_MAIN", true, view).map(
                (a) => a.id
            )
        ).toContain("lavaspur-boots-equip");
    });

    it("does not offer Equip for a creature only the OPPONENT controls (controller: 'you')", () => {
        const equipment = boots();
        const oppBear = makeCardInstance({
            id: "bear-2",
            types: ["Creature"],
            controllerId: "p2",
            ownerId: "p2",
        });
        const view = buildTriggerStateView(
            [
                makePlayerLike({ id: "p1", battlefield: [equipment] }),
                makePlayerLike({ id: "p2", battlefield: [oppBear] }),
            ],
            "p1"
        );
        expect(
            getStackAbilities(equipment, "PRECOMBAT_MAIN", true, view).map(
                (a) => a.id
            )
        ).not.toContain("lavaspur-boots-equip");
    });
});

// ---------------------------------------------------------------------------
// Emry, Lurker of the Loch — a {T} ability whose only target lives in the
// GRAVEYARD (issue #1650, CR 601.2c / 400.7).
//
// Frontend-wiring regression: `getStackAbilities` runs a CR 602.2b
// "no legal target" gate (`hasBattlefieldTargetCandidate`) over every
// targeting ability. That gate only judges the BATTLEFIELD, so a
// graveyard-zone requirement MUST fail open — otherwise the ability is
// permanently missing from the tap/context menu even though the server would
// allow it (the exact "correct in the GRE, dead in the UI" bug class). Driven
// through the REAL reducer (`buildTriggerStateView`), never a hand-built view.
// ---------------------------------------------------------------------------

describe("Emry, Lurker of the Loch — graveyard-targeting {T} ability surfaces in the menu (issue #1650)", () => {
    const EMRY_ID = "bf4b9a8a-b42a-46fb-b0d0-9cf800f63c8a";
    const EMRY_ABILITY = "emry-lurker-of-the-loch-graveyard-cast";

    function emryOnBoard(overrides: Partial<CardInstance> = {}): CardInstance {
        return makeCardInstance({
            id: "emry",
            card: { id: EMRY_ID },
            types: ["Creature"],
            isTapped: false,
            isSummoningSick: false,
            ...overrides,
        });
    }

    it("is offered even though the ONLY legal target sits in a graveyard (empty battlefield)", () => {
        const emry = emryOnBoard();
        // Reducer-driven view: two players, nothing on either battlefield.
        const view = buildTriggerStateView([
            {
                id: "p1",
                life: 20,
                hand: [],
                battlefield: [emry],
                graveyard: [],
            },
            { id: "p2", life: 20, hand: [], battlefield: [], graveyard: [] },
        ]);
        const ids = getStackAbilities(emry, "PRECOMBAT_MAIN", true, view).map(
            (a) => a.id
        );
        expect(ids).toContain(EMRY_ABILITY);
    });

    it("is hidden while Emry is tapped or summoning sick (CR 302.1 / 602.1)", () => {
        const view = buildTriggerStateView([
            {
                id: "p1",
                life: 20,
                hand: [],
                battlefield: [],
                graveyard: [],
            },
        ]);
        expect(
            getStackAbilities(
                emryOnBoard({ isTapped: true }),
                "PRECOMBAT_MAIN",
                true,
                view
            )
        ).toHaveLength(0);
        expect(
            getStackAbilities(
                emryOnBoard({ isSummoningSick: true }),
                "PRECOMBAT_MAIN",
                true,
                view
            )
        ).toHaveLength(0);
    });
});
