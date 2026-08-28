import { describe, it, expect } from "vitest";
import {
    wantsPermanentTarget,
    wantsPlayerTarget,
    matchesPermanentFilter,
    matchesTargetRequirement,
    matchesPermanentTargetFilters,
    matchesSpellPendingTarget,
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
    mayPayDiscardPickSatisfied,
    mayPayRequiredSacrifices,
    mayPayCostLabel,
    mayPaySacrificeCount,
    mayPaySacrificePower,
    toMatchablePermanent,
    MIRROR_CENSUS,
    type MirrorStatus,
    TRIGGER_STATE_VIEW_CENSUS,
    type TriggerStateViewFieldStatus,
    normalizeMayPayCost,
    manaCostToString,
    phyrexianSplitChoices,
    hasImprovise,
    pendingCastSourceCard,
    pendingCastHasImprovise,
    pendingCastRemainingGeneric,
    activeManaSpendChoice,
    displayCardId,
    type DisplayAbilities,
} from "../card-utils";
import { getCardImageDefId } from "../card-image-signature";
import { faceDownRealCardId } from "../face-down";
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
    MayPayCost,
    TargetRequirement,
} from "@convex/cards/types";
import {
    getCardByName,
    getDefinition,
    withTemporaryDefinition,
    FACE_DOWN_CARD_ID,
} from "@convex/cards";
import { turnFaceDown, turnFaceUp } from "@convex/gre/faceDown";
import {
    matchesPermanentFilter as matchesEnginePermanentFilter,
    type FilterMatchContext,
    type PermanentFilter,
} from "@convex/cards/filters";
import type { ControlContinuityView } from "@convex/gre/controlContinuity";
import {
    crosissCatacombs,
    meteorCrater,
    starCompass,
} from "@convex/cards/sets/pls/colorless";
import { quirionExplorer } from "@convex/cards/sets/pls/green";
import { guardDogs, pollenRemedy } from "@convex/cards/sets/pls/white";
import { radiantKavu, rithsCharm } from "@convex/cards/sets/pls/multicolor";
import {
    forest as forestCard,
    island as islandCard,
    mountain as mountainCard,
    swamp as swampCard,
} from "@convex/cards/sets/lea/colorless";
import { crawWurm } from "@convex/cards/sets/lea/green";
import { skyshipWeatherlight } from "@convex/cards/sets/pls/colorless";
import {
    CHANDRA_TORCH_OF_DEFIANCE_EMBLEM_ID,
    SORIN_LORD_OF_INNISTRAD_EMBLEM_ID,
} from "@convex/cards/emblems";
import { CLUE_TOKEN_SPEC } from "@convex/cards/abilities/tokens/clueToken";
import { dismember } from "@convex/cards/sets/nph/black";
import { gitaxianProbe } from "@convex/cards/sets/nph/blue";
import { dominate } from "@convex/cards/sets/nem";
import { fellwarStone, deepWater, gaeasTouch } from "@convex/cards/sets/drk";
import { disruptingScepter, forest } from "@convex/cards/sets/lea";
import { powerArmor } from "@convex/cards/sets/inv";
import { thopterFoundry } from "@convex/cards/sets/arb/multicolor";
import { legionExtruder } from "@convex/cards/sets/big/red";
import { ornithopter } from "@convex/cards/sets/atq/colorless";
import { caribouRange } from "@convex/cards/sets/ice/white";
import { norritt } from "@convex/cards/sets/ice/black";
import { whiteout } from "@convex/cards/sets/ice/green";
import { sorrowsPath } from "@convex/cards/sets/drk/colorless";
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
import { miracleWorker } from "@convex/cards/sets/drk";
import { holyStrength } from "@convex/cards/sets/lea/white";
import {
    pendingTargetFiltersFromRequirement,
    raiseTriggerTargetSelection,
} from "@convex/gre/rules";
import { collectTriggers } from "@convex/gre/triggers";
import { fearOfMissingOut } from "@convex/cards/sets/dsk/red";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer as makeServerPlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import type { PendingTarget } from "~/types/game";
import type { CardInstanceState } from "@convex/gre/state";

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

/** Minimal `PendingTarget` carrying only the SPELL filter dimensions under
 *  test (issue #1734) — `matchesSpellPendingTarget`'s single-filter twin of
 *  the deleted per-dimension mirrors. `spellStackKind` always defaults to
 *  `"any"` so the stack-object kind gate never interferes with a test whose
 *  subject is a DIFFERENT dimension; callers exercising the kind gate itself
 *  override it explicitly. */
function pt(filters: Record<string, unknown>): PendingTarget {
    return {
        playerId: "p1",
        cardInstanceId: "src",
        targetType: "spell",
        count: 1,
        selected: [],
        spellStackKind: "any",
        ...filters,
    } as unknown as PendingTarget;
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

describe("matchesPermanentTargetFilters (CR 109/202/205/613 / 701.26 / 702, issue #1697)", () => {
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
        emblems?: EmblemInstance[],
        selected: PendingTarget["selected"] = [],
        /** CR 302.6 / 400.7 (issue #1824) — the turn-scoped control-change
         *  break ledger, seeded onto the SERVER state so it reaches the client
         *  through the real projection rather than being hand-built. */
        controlChangedThisTurn?: string[]
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
                selected,
                ...pendingTargetFiltersFromRequirement(req, undefined),
            } as PendingTarget,
            emblems,
            controlChangedThisTurn,
        });

        const projected = projectPublicState(state, 1, "p1");
        return {
            players: projected.players as unknown as Player[],
            pendingTarget: projected.pendingTarget as unknown as PendingTarget,
            /** The `{ turn, controlChangedThisTurn }` view read back off the
             *  PROJECTED state — the same way `board.tsx` publishes
             *  `engineTurn`/`controlChangedThisTurn` into the game context.
             *  Reading it from the pre-projection fixture would mask a wire
             *  drop of either field (issue #1824). */
            turnState: {
                turn: projected.turn,
                controlChangedThisTurn: projected.controlChangedThisTurn,
            } as ControlContinuityView,
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
                "p1",
                undefined
            )
        ).toBe(false);
        expect(
            matchesPermanentTargetFilters(
                legendaryClient,
                pendingTarget,
                players,
                "p1",
                undefined
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
                "p1",
                undefined
            )
        ).toBe(false);
        expect(
            matchesPermanentTargetFilters(
                plainClient,
                pendingTarget,
                players,
                "p1",
                undefined
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
                "p1",
                undefined
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
                undefined,
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
                "p1",
                undefined
            )
        ).toBe(false);
        expect(
            matchesPermanentTargetFilters(
                legendaryClient,
                pendingTarget,
                players,
                "p1",
                undefined
            )
        ).toBe(true);
    });

    // CR 303.4b (issue #1853 review, finding 2) — `attachedToFilter` is the
    // FIRST permanent filter that dereferences a SECOND card (the candidate's
    // OWN host) out of the client's synthetic board
    // (`matchesPermanentTargetFilters` builds it from `allPlayers`,
    // card-utils.ts) rather than reading only the candidate itself, and it
    // fails CLOSED when that host can't be resolved. No prior test exercised
    // it client-side (unlike its direct precedent, `controlledSinceTurnStart`
    // / #1824, covered just below) — a future narrowing of the synthetic
    // board would silently make Miracle Worker/Pyramids/Savaen Elves
    // unclickable with every other test green. Built the same way
    // `projectScenario` builds its Karakas fixture — a real server
    // `GameState` through the REAL wire projection — but standalone, since
    // this filter needs a SECOND card (the host) per candidate rather than
    // `projectScenario`'s one-override-per-candidate shape.
    function projectAttachedToScenario(req: TargetRequirement) {
        const myCreature = makeInstance(MERFOLK_ID, {
            id: "my-creature",
            controllerId: "p1",
            ownerId: "p1",
        });
        const myLand = makeInstance(forestCard.id, {
            id: "my-land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const auraOnCreature = makeInstance(holyStrength.id, {
            id: "aura-on-creature",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "my-creature",
        });
        const auraOnLand = makeInstance(holyStrength.id, {
            id: "aura-on-land",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "my-land",
        });
        const miracleWorkerInstance = makeInstance(miracleWorker.id, {
            id: "mw-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makeServerPlayer("p1", {
                    battlefield: [
                        miracleWorkerInstance,
                        myCreature,
                        myLand,
                        auraOnCreature,
                        auraOnLand,
                    ],
                }),
                makeServerPlayer("p2", { battlefield: [] }),
            ],
            pendingTarget: {
                playerId: "p1",
                cardInstanceId: "mw-1",
                targetType: req.type,
                count: 1,
                selected: [],
                ...pendingTargetFiltersFromRequirement(req, undefined),
            } as PendingTarget,
        });
        const projected = projectPublicState(state, 1, "p1");
        const p1Battlefield = projected.players.find(
            (p) => p.id === "p1"
        )!.battlefield;
        return {
            players: projected.players as unknown as Player[],
            pendingTarget: projected.pendingTarget as unknown as PendingTarget,
            auraOnCreatureClient: p1Battlefield.find(
                (c) => c.id === "aura-on-creature"
            ) as unknown as CardInstance,
            auraOnLandClient: p1Battlefield.find(
                (c) => c.id === "aura-on-land"
            ) as unknown as CardInstance,
        };
    }

    it("attachedToFilter (CR 303.4b, issue #1853, Miracle Worker's 'attached to a creature you control'): rejects an Aura on a land, accepts one on a creature, through the real wire projection", () => {
        const req = miracleWorker.activatedAbilities!.find(
            (a) => a.id === "miracle-worker-destroy-aura"
        )!.targetRequirement!;
        const {
            players,
            pendingTarget,
            auraOnCreatureClient,
            auraOnLandClient,
        } = projectAttachedToScenario(req);

        // Proves the host lookup runs at all: the OLD narrow check (structural
        // type only) would accept both — they're both Auras.
        expect(
            matchesTargetRequirement(auraOnLandClient, pendingTarget.targetType)
        ).toBe(true);

        expect(
            matchesPermanentTargetFilters(
                auraOnLandClient,
                pendingTarget,
                players,
                "p1",
                undefined
            )
        ).toBe(false);
        expect(
            matchesPermanentTargetFilters(
                auraOnCreatureClient,
                pendingTarget,
                players,
                "p1",
                undefined
            )
        ).toBe(true);
    });

    it("attachedToFilter (issue #1853): FAILS CLOSED when the candidate's host can't be resolved on the synthetic board (unattached candidate)", () => {
        const req = miracleWorker.activatedAbilities!.find(
            (a) => a.id === "miracle-worker-destroy-aura"
        )!.targetRequirement!;
        const { players, pendingTarget, auraOnCreatureClient } =
            projectAttachedToScenario(req);
        // A candidate with no `attachedTo` at all (never legal for "attached
        // to X") must read as non-clickable, not as an unfiltered pass.
        const unattached: CardInstance = {
            ...auraOnCreatureClient,
            id: "aura-loose",
            attachedTo: undefined,
        };
        expect(
            matchesPermanentTargetFilters(
                unattached,
                pendingTarget,
                players,
                "p1",
                undefined
            )
        ).toBe(false);
    });

    it("controlledSinceTurnStart (CR 302.6 / 400.7, issue #1824, Norritt): rejects a creature that entered this turn, accepts one held since before it, through the real wire projection", () => {
        const req: TargetRequirement = {
            type: "Creature",
            count: 1,
            controlledSinceTurnStart: true,
        };
        // `makeState` runs on turn 1, so `enteredOnTurn: 1` is "entered THIS
        // turn". The legendary creature carries no stamp — it has been on the
        // battlefield since before the turn began.
        const {
            players,
            pendingTarget,
            legendaryClient,
            plainClient,
            turnState,
        } = projectScenario(req, {}, { enteredOnTurn: 1 });

        expect(
            matchesPermanentTargetFilters(
                plainClient,
                pendingTarget,
                players,
                "p1",
                turnState
            )
        ).toBe(false);
        expect(
            matchesPermanentTargetFilters(
                legendaryClient,
                pendingTarget,
                players,
                "p1",
                turnState
            )
        ).toBe(true);
    });

    it("controlledSinceTurnStart (issue #1824): a creature whose CONTROL changed this turn is rejected even though it entered long ago, through the real wire projection", () => {
        const req: TargetRequirement = {
            type: "Creature",
            count: 1,
            controlledSinceTurnStart: true,
        };
        // Neither creature entered this turn; the break ledger is the ONLY
        // thing that distinguishes them (a start-of-turn snapshot could not).
        const {
            players,
            pendingTarget,
            legendaryClient,
            plainClient,
            turnState,
        } = projectScenario(req, {}, {}, undefined, [], ["plain-1"]);

        expect(
            matchesPermanentTargetFilters(
                plainClient,
                pendingTarget,
                players,
                "p1",
                turnState
            )
        ).toBe(false);
        expect(
            matchesPermanentTargetFilters(
                legendaryClient,
                pendingTarget,
                players,
                "p1",
                turnState
            )
        ).toBe(true);
    });

    it("controlledSinceTurnStart (issue #1824): FAILS CLOSED when the caller supplies no turn state — never offers a target the server would reject", () => {
        const req: TargetRequirement = {
            type: "Creature",
            count: 1,
            controlledSinceTurnStart: true,
        };
        // The legendary creature is genuinely legal (no entry stamp, no
        // control break) — but with the continuity facts absent the client
        // cannot VERIFY that, and `enteredOnTurn >= undefined` is `false`, so
        // a naive implementation would fail OPEN and admit even the
        // entered-this-turn creature. Both must read as non-clickable.
        const { players, pendingTarget, legendaryClient, plainClient } =
            projectScenario(req, {}, { enteredOnTurn: 1 });

        expect(
            matchesPermanentTargetFilters(
                legendaryClient,
                pendingTarget,
                players,
                "p1",
                undefined
            )
        ).toBe(false);
        expect(
            matchesPermanentTargetFilters(
                plainClient,
                pendingTarget,
                players,
                "p1",
                undefined
            )
        ).toBe(false);
    });

    it("CR 601.2c: a permanent already chosen under this SAME requirement no longer reads as clickable, through the real wire projection", () => {
        // Dust to Dust's "two target artifacts" shape: count > 1, one slot
        // already filled. A hand-built view would mask exactly this class of
        // bug (the server's own `isAlreadySelectedTarget` exclusion silently
        // dropped client-side) — this goes through the real
        // `pendingTarget.selected` the wire projection carries, not a
        // fixture built by hand.
        const req: TargetRequirement = { type: "Creature", count: 2 };
        const { players, pendingTarget, legendaryClient, plainClient } =
            projectScenario(req, {}, {}, undefined, [
                { type: "permanent", id: "legendary-1" },
            ]);

        // Already picked — must NOT read as clickable for a second slot.
        expect(
            matchesPermanentTargetFilters(
                legendaryClient,
                pendingTarget,
                players,
                "p1",
                undefined
            )
        ).toBe(false);
        // Not yet picked — still a legal second-slot candidate.
        expect(
            matchesPermanentTargetFilters(
                plainClient,
                pendingTarget,
                players,
                "p1",
                undefined
            )
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Face-down permanent target filters (CR 708.2, issue #1735) — a face-down
// permanent's `card.card.id` must stay the sentinel for EVERY viewer,
// INCLUDING its own controller: `supertypeFilter`, `colorFilter` and
// `mvFilter` all resolve off this id, and before this fix the projection
// restored the real id only for the controller, so a face-down legendary
// creature rang as a legal Karakas target for its own controller (the exact
// #1697 symptom, revived) while the server still enforced the face-down 2/2.
// Every scenario below is projected through the REAL `projectPublicState` for
// BOTH viewers — a controller-only or opponent-only assertion would miss the
// bug by construction, since the opponent's view was never wrong.
// ---------------------------------------------------------------------------

describe("face-down permanent target filters read the sentinel for the controller too (issue #1735)", () => {
    // Livonya Silone: Legendary supertype, R/G colors, mana value 6 — one
    // fixture exercises all three id-derived filter dimensions named in the
    // issue. Turned face down: colourless, no supertypes, mana value 0.
    function projectFaceDownScenario(
        req: TargetRequirement,
        viewerId: "p1" | "p2"
    ) {
        const legendary = makeInstance(livonyaSilone.id, {
            id: "fd-legendary",
            controllerId: "p1",
            ownerId: "p1",
        });
        turnFaceDown(legendary, "morph");
        const karakasInstance = makeInstance(karakas.id, {
            id: "karakas-1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makeServerPlayer("p1", { battlefield: [legendary] }),
                makeServerPlayer("p2", { battlefield: [karakasInstance] }),
            ],
            pendingTarget: {
                playerId: "p2",
                cardInstanceId: "karakas-1",
                targetType: req.type,
                count: 1,
                selected: [],
                ...pendingTargetFiltersFromRequirement(req, undefined),
            } as PendingTarget,
        });

        const projected = projectPublicState(state, 1, viewerId);
        return {
            players: projected.players as unknown as Player[],
            pendingTarget: projected.pendingTarget as unknown as PendingTarget,
            target: projected.players
                .find((p) => p.id === "p1")!
                .battlefield.find(
                    (c) => c.id === "fd-legendary"
                ) as unknown as CardInstance,
        };
    }

    it("supertypeFilter (Karakas-style): a face-down legendary creature is NOT a legal target, for either viewer", () => {
        const req: TargetRequirement = {
            type: "Creature",
            count: 1,
            supertypeFilter: ["Legendary"],
        };
        for (const viewerId of ["p1", "p2"] as const) {
            const { players, pendingTarget, target } = projectFaceDownScenario(
                req,
                viewerId
            );
            // The wire id is the sentinel for BOTH viewers — the controller
            // (p1) no longer gets the real id restored into `card.card.id`.
            expect(target.card.id).toBe(FACE_DOWN_CARD_ID);
            expect(
                matchesPermanentTargetFilters(
                    target,
                    pendingTarget,
                    players,
                    "p2",
                    undefined
                )
            ).toBe(false);
        }
    });

    it("colorFilter: a face-down permanent is colorless for a colour-filtered target, for either viewer", () => {
        const req: TargetRequirement = {
            type: "Creature",
            count: 1,
            colorFilter: "R",
        };
        for (const viewerId of ["p1", "p2"] as const) {
            const { players, pendingTarget, target } = projectFaceDownScenario(
                req,
                viewerId
            );
            expect(target.card.id).toBe(FACE_DOWN_CARD_ID);
            expect(
                matchesPermanentTargetFilters(
                    target,
                    pendingTarget,
                    players,
                    "p2",
                    undefined
                )
            ).toBe(false);
        }
    });

    it("mvFilter: a face-down permanent is mana value 0, for either viewer", () => {
        const req: TargetRequirement = {
            type: "Creature",
            count: 1,
            mvFilter: { min: 6 }, // Livonya Silone's real mana value
        };
        for (const viewerId of ["p1", "p2"] as const) {
            const { players, pendingTarget, target } = projectFaceDownScenario(
                req,
                viewerId
            );
            expect(target.card.id).toBe(FACE_DOWN_CARD_ID);
            expect(
                matchesPermanentTargetFilters(
                    target,
                    pendingTarget,
                    players,
                    "p2",
                    undefined
                )
            ).toBe(false);
        }
    });

    it("the controller's own view still carries the identification affordance (knownCardId), separate from the sentinel", () => {
        const { target } = projectFaceDownScenario(
            { type: "Creature", count: 1 },
            "p1"
        );
        expect(target.card.id).toBe(FACE_DOWN_CARD_ID);
        expect(target.knownCardId).toBe(livonyaSilone.id);
    });

    it("the opponent's view carries neither the real id nor knownCardId", () => {
        const { target } = projectFaceDownScenario(
            { type: "Creature", count: 1 },
            "p2"
        );
        expect(target.card.id).toBe(FACE_DOWN_CARD_ID);
        expect(target.knownCardId).toBeUndefined();
    });

    it("turning the permanent face up restores normal filtering", () => {
        const legendary = makeInstance(livonyaSilone.id, {
            id: "fd-legendary",
            controllerId: "p1",
            ownerId: "p1",
        });
        turnFaceDown(legendary, "morph");
        turnFaceUp(legendary);
        const req: TargetRequirement = {
            type: "Creature",
            count: 1,
            supertypeFilter: ["Legendary"],
        };
        const state = makeState({
            players: [
                makeServerPlayer("p1", { battlefield: [legendary] }),
                makeServerPlayer("p2", {
                    battlefield: [
                        makeInstance(karakas.id, {
                            id: "karakas-1",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
            pendingTarget: {
                playerId: "p2",
                cardInstanceId: "karakas-1",
                targetType: req.type,
                count: 1,
                selected: [],
                ...pendingTargetFiltersFromRequirement(req, undefined),
            } as PendingTarget,
        });
        const projected = projectPublicState(state, 1, "p1");
        const target = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find(
                (c) => c.id === "fd-legendary"
            ) as unknown as CardInstance;
        expect(target.card.id).toBe(livonyaSilone.id);
        expect(
            matchesPermanentTargetFilters(
                target,
                projected.pendingTarget as unknown as PendingTarget,
                projected.players as unknown as Player[],
                "p2",
                undefined
            )
        ).toBe(true);
    });

    it("activated-ability affordance: a face-down permanent offers NO activated abilities, for either viewer (CR 708.2)", () => {
        // Norritt — "{T}: Untap target blue creature." — has a real, unrestricted
        // activated ability. Face down, the permanent is a vanilla 2/2 with
        // `staticAbilities: []` and no activated abilities at all.
        const norrittCard = makeInstance(norritt.id, {
            id: "fd-norritt",
            controllerId: "p1",
            ownerId: "p1",
        });
        turnFaceDown(norrittCard, "morph");
        const state = makeState({
            players: [
                makeServerPlayer("p1", { battlefield: [norrittCard] }),
                makeServerPlayer("p2"),
            ],
        });

        for (const viewerId of ["p1", "p2"] as const) {
            const projected = projectPublicState(state, 1, viewerId);
            const wireCard = projected.players
                .find((p) => p.id === "p1")!
                .battlefield.find(
                    (c) => c.id === "fd-norritt"
                ) as unknown as CardInstance;
            expect(wireCard.card.id).toBe(FACE_DOWN_CARD_ID);
            expect(getStackAbilities(wireCard)).toHaveLength(0);
        }
    });

    it("sanity: Norritt's untap ability IS offered face up (proves the face-down test above isn't vacuous)", () => {
        const norrittCard = makeInstance(norritt.id, {
            id: "up-norritt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makeServerPlayer("p1", { battlefield: [norrittCard] }),
                makeServerPlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const wireCard = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find(
                (c) => c.id === "up-norritt"
            ) as unknown as CardInstance;
        const abilities = getStackAbilities(wireCard);
        expect(abilities.map((a) => a.id)).toContain("norritt-untap-blue");
    });
});

// ---------------------------------------------------------------------------
// `displayCardId` / `getCardImageDefId` — the identification affordance
// itself (issue #1735 review, finding 3). Pure functions over the wire
// object; before this test neither had a single automated assertion
// anywhere in the repo (`grep -rl 'displayCardId|getCardImageDefId' src
// convex` matched nothing). Acceptance criterion 1 ("the controller sees
// their own face-down card's real art/name") is exactly what these two
// functions compute, and this is the ONE node-level check that would have
// caught the `battlefield-stacks.ts` regression (finding 1) too: a wrong
// `identityKey` only ever manifests as two DIFFERENT `getCardImageDefId`
// results colliding into the same group.
// ---------------------------------------------------------------------------

describe("displayCardId / getCardImageDefId (issue #1735 review, finding 3)", () => {
    function projectFaceDown(viewerId: "p1" | "p2") {
        const legendary = makeInstance(livonyaSilone.id, {
            id: "fd-legendary",
            controllerId: "p1",
            ownerId: "p1",
        });
        turnFaceDown(legendary, "morph");
        const state = makeState({
            players: [
                makeServerPlayer("p1", { battlefield: [legendary] }),
                makeServerPlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, viewerId);
        return projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find(
                (c) => c.id === "fd-legendary"
            ) as unknown as CardInstance;
    }

    // Issue #2904 flipped `getCardImageDefId` for the CONTROLLER: the BOARD
    // FACE never leaks the identity, so it resolves to the sentinel for every
    // viewer. `displayCardId` is unchanged — it is the identification
    // affordance (the stacking identity key, the "Attached to:" host name),
    // and collapsing it would fan two DIFFERENT face-down permanents into one
    // pile again (the #1735 review's finding 1, guarded next door in
    // `battlefield-stacks.wire.test.ts`).
    it("the controller's own face-down permanent renders the SENTINEL face; the real id survives only as the identification affordance", () => {
        const target = projectFaceDown("p1");
        expect(target.card.id).toBe(FACE_DOWN_CARD_ID); // rules id stays honest
        expect(displayCardId(target)).toBe(livonyaSilone.id);
        expect(getCardImageDefId(target)).toBe(FACE_DOWN_CARD_ID);
        // …and it is what the preview's SECOND face is built from (CR 708.5).
        expect(faceDownRealCardId(target)).toBe(livonyaSilone.id);
    });

    it("the opponent's view of the SAME permanent stays the sentinel on both helpers", () => {
        const target = projectFaceDown("p2");
        expect(target.card.id).toBe(FACE_DOWN_CARD_ID);
        expect(displayCardId(target)).toBe(FACE_DOWN_CARD_ID);
        expect(getCardImageDefId(target)).toBe(FACE_DOWN_CARD_ID);
        // issue #2904 — no second preview face for a non-entitled viewer:
        // the real id is not merely unrendered, it is not on the wire at all.
        expect(faceDownRealCardId(target)).toBeUndefined();
    });

    it("a face-up permanent is unaffected — both helpers are a no-op without knownCardId", () => {
        const upCard = makeInstance(livonyaSilone.id, {
            id: "up-legendary",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makeServerPlayer("p1", { battlefield: [upCard] }),
                makeServerPlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const target = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find(
                (c) => c.id === "up-legendary"
            ) as unknown as CardInstance;
        expect(displayCardId(target)).toBe(livonyaSilone.id);
        expect(getCardImageDefId(target)).toBe(livonyaSilone.id);
        expect(faceDownRealCardId(target)).toBeUndefined();
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
        "Battle",
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

    // CR 611.2a / 613.1f (layer 6) — Titania's Song-style "loses all
    // abilities" effects must strip a NATIVE activated ability from the
    // client's offering, not just server-side: before this fix,
    // `getStackAbilities` read `getDefinition(...).activatedAbilities`
    // directly and never consulted `abilitiesSuppressedBy`, so the menu kept
    // offering an ability the server would reject.
    it("hides a native activated ability while abilitiesSuppressedBy is active (Titania's Song)", () => {
        const card = makeCardInstance({
            card: { id: "12926dc8-8e6f-4a47-a12b-4d674189615a" },
            types: ["Artifact"],
            isTapped: false,
            abilitiesSuppressedBy: [{ sourceId: "titanias-song", seq: 1 }],
        });

        expect(getStackAbilities(card)).toHaveLength(0);
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
        // A Creature to pay the "Sacrifice a creature" cost (`sacrificeFilter`,
        // issue #1951 review) and an Artifact for its "destroy target
        // artifact" requirement — both orthogonal to what THIS test exercises
        // (the `oncePerTurn` gate), supplied fully-affordable to isolate it.
        // (A non-empty `stateView.players` also stops
        // `hasBattlefieldTargetCandidate`'s empty-view fail-open from masking
        // a missing target candidate — the artifact is genuinely needed once
        // the sacrifice fixture makes the view non-empty.)
        const sacrificeFodder = makeCardInstance({
            id: "fodder",
            card: { id: crawWurm.id },
            types: ["Creature"],
            controllerId: "p1",
            ownerId: "p1",
        });
        const targetArtifact = makeCardInstance({
            id: "target-artifact",
            card: { id: powerArmor.id },
            types: ["Artifact"],
            controllerId: "p1",
            ownerId: "p1",
        });
        const view = buildTriggerStateView(
            [
                {
                    id: "p1",
                    life: 20,
                    hand: [],
                    battlefield: [sacrificeFodder, targetArtifact],
                },
            ],
            "p1"
        );
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
        // Same sacrifice-fodder + target-artifact setup as the test above —
        // orthogonal to the `activationsThisTurn` gate under test here.
        const sacrificeFodder = makeCardInstance({
            id: "fodder2",
            card: { id: crawWurm.id },
            types: ["Creature"],
            controllerId: "p1",
            ownerId: "p1",
        });
        const targetArtifact = makeCardInstance({
            id: "target-artifact2",
            card: { id: powerArmor.id },
            types: ["Artifact"],
            controllerId: "p1",
            ownerId: "p1",
        });
        const view = buildTriggerStateView(
            [
                {
                    id: "p1",
                    life: 20,
                    hand: [],
                    battlefield: [sacrificeFodder, targetArtifact],
                },
            ],
            "p1"
        );
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

    // CR 119.4 — a "pay N life" activation cost is unpayable when the payer has
    // fewer than N life. The menu must hide the ability rather than offer it and
    // let the server throw "Not enough life" at commit time. Griselbrand's
    // "Pay 7 life: Draw seven cards."
    describe("life-payment cost affordability (CR 119.4)", () => {
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

    // CR 702.129a (issue #2339) — Eternalize is the SECOND graveyard-source
    // ability in the catalogue and the first with a sorcery-speed
    // restriction. It rides the same reducer with no keyword-specific code,
    // which is exactly what this pair proves: the affordance appears in a main
    // phase and is hidden by `sorcerySpeedOnly` everywhere else. Driven through
    // the real `buildTriggerStateView`, so a dropped field fails here.
    describe("Eternalize (CR 702.129a — Fanatic of Rhonas, #2339)", () => {
        const FANATIC_OF_RHONAS_ID = "1f9fb33a-3b39-4aff-93b8-aedafe0ea694";

        const makeFanatic = () =>
            makeCardInstance({
                id: "fanatic-1",
                card: { id: FANATIC_OF_RHONAS_ID },
                types: ["Creature"],
                subtypes: ["Snake", "Druid"],
                ownerId: "p1",
                controllerId: "p1",
                zone: "graveyard",
            });

        const fanaticView = () =>
            buildTriggerStateView(
                [
                    {
                        id: "p1",
                        life: 20,
                        hand: [],
                        battlefield: [],
                        graveyard: [makeFanatic()],
                    },
                ],
                "p1"
            );

        it("surfaces ONLY the eternalize ability in a main phase", () => {
            const abilities = getGraveyardStackAbilities(
                makeFanatic(),
                "PRECOMBAT_MAIN",
                fanaticView()
            );
            // The card's two MANA abilities are battlefield-only and must not
            // leak into the graveyard menu.
            expect(abilities.map((a) => a.id)).toEqual(["eternalize"]);
            expect(abilities[0].oracleText).toContain("Eternalize {2}{G}{G}");
        });

        it("hides it outside a sorcery window (sorcerySpeedOnly, CR 307.5)", () => {
            expect(
                getGraveyardStackAbilities(
                    makeFanatic(),
                    "DECLARE_ATTACKERS",
                    fanaticView()
                )
            ).toHaveLength(0);
        });
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
// getGraveyardStackAbilities' `sacrificeFilter` gate vs LIVE supertype status
// (Whiteout, issue #2235 review — the fail-closed-vs-live-snow-status class).
//
// `buildTriggerStateView` used to populate a battlefield entry's `supertypes`
// from the PRINTED definition only (`tryGetDefinition(...).supertypes`), while
// the server resolves a `sacrificeFilter`'s `supertypes` clause against LIVE
// status (`activateAbilityOnState`, game.ts, via `liveSupertypesOf`) — printed
// supertypes overlaid by any `grantedSupertypes`/`removedSupertypes` mutation
// (Melting / Arcum's Weathervane's "Target land becomes snow"). A land made
// snow ONLY via that grant (never printed as Snow) would activate Whiteout
// server-side while this gate returned `[]` client-side: the Activate button
// would never render even though the mutation succeeds on click-through from
// any OTHER entry point. The view is built via the real `buildTriggerStateView`
// reducer (as the UI does) — a hand-built view would mask exactly this class
// of dropped-field bug.
// ---------------------------------------------------------------------------

describe("getGraveyardStackAbilities vs LIVE snow status (Whiteout, issue #2235 review)", () => {
    const makeWhiteout = (): CardInstance =>
        makeCardInstance({
            id: "wo-1",
            card: { id: whiteout.id },
            types: ["Instant"],
            ownerId: "p1",
            controllerId: "p1",
            zone: "graveyard",
        });

    /** A plain LEA Forest (NOT printed Snow) made snow ONLY via a
     *  `grantedSupertypes` marker — exactly the shape Arcum's Weathervane's
     *  `arcums-weathervane-snow` ability produces
     *  (`convex/cards/sets/ice/colorless.ts`), and what `applyIndefiniteSupertypeMutation`
     *  (`convex/gre/snow.ts`) writes onto the target instance. */
    const weathervanedForest: CardInstance = {
        id: "forest-1",
        card: { id: forest.id },
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        types: ["Land"],
        subtypes: ["Forest"],
        isTapped: false,
        grantedSupertypes: [{ supertype: "Snow", sourceId: "indefinite" }],
    };

    /** The SAME Forest with no snow status at all — the negative control. */
    const plainForest: CardInstance = {
        ...weathervanedForest,
        id: "forest-2",
        grantedSupertypes: undefined,
    };

    it("surfaces whiteout-return when the owner's only land is snow ONLY via grantedSupertypes (LIVE status, not printed)", () => {
        const view = buildTriggerStateView([
            {
                id: "p1",
                life: 20,
                hand: [],
                battlefield: [weathervanedForest],
                graveyard: [makeWhiteout()],
            },
        ]);
        const abilities = getGraveyardStackAbilities(
            makeWhiteout(),
            "PRECOMBAT_MAIN",
            view
        );
        expect(abilities.map((a) => a.id)).toContain("whiteout-return");
    });

    it("hides whiteout-return when the owner's only land has no snow status at all (negative control)", () => {
        const view = buildTriggerStateView([
            {
                id: "p1",
                life: 20,
                hand: [],
                battlefield: [plainForest],
                graveyard: [makeWhiteout()],
            },
        ]);
        const abilities = getGraveyardStackAbilities(
            makeWhiteout(),
            "PRECOMBAT_MAIN",
            view
        );
        expect(abilities.map((a) => a.id)).not.toContain("whiteout-return");
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
    // timing restriction (Clergy of the Holy Nimbus declares neither), so a
    // VARIANT Clergy definition carrying the fixture ability is served
    // through `withTemporaryDefinition` — the catalogue object itself is
    // deep-frozen in node test setup (vitest.setup.node.ts) and may not be
    // mutated, restore-in-finally included.
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
        const variant = {
            ...clergyOfTheHolyNimbus,
            activatedAbilities: [
                ...(clergyOfTheHolyNimbus.activatedAbilities ?? []),
                syntheticAbility,
            ],
        };
        withTemporaryDefinition(variant, () => {
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
        });
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

describe("matchesSpellPendingTarget (spellStackKind dimension — Brown Ouphe / Mistfolk, CR 113/114.1)", () => {
    const stackCtx = { playerId: "p1", activePlayerId: "p1", players: [] };
    const artifactAbility = {
        id: "artifact-ability",
        card: { id: "x" },
        types: ["Artifact"],
        abilityId: "icy-tap",
    };
    const creatureAbility = {
        id: "creature-ability",
        card: { id: "x" },
        types: ["Creature"],
        abilityId: "tim-zap",
    };
    const artifactSpell = {
        id: "artifact-spell",
        card: { id: "x" },
        types: ["Artifact"],
    };

    it("keeps an activated ability from an artifact source (Brown Ouphe)", () => {
        expect(
            matchesSpellPendingTarget(
                artifactAbility,
                pt({
                    spellStackKind: "activated-ability",
                    stackSourceTypeFilter: ["Artifact"],
                }),
                stackCtx
            )
        ).toBe(true);
    });

    it("rejects a non-artifact ability and an artifact SPELL under the Brown Ouphe filter", () => {
        expect(
            matchesSpellPendingTarget(
                creatureAbility,
                pt({
                    spellStackKind: "activated-ability",
                    stackSourceTypeFilter: ["Artifact"],
                }),
                stackCtx
            )
        ).toBe(false);
        // An artifact spell is not an activated ability.
        expect(
            matchesSpellPendingTarget(
                artifactSpell,
                pt({
                    spellStackKind: "activated-ability",
                    stackSourceTypeFilter: ["Artifact"],
                }),
                stackCtx
            )
        ).toBe(false);
    });

    it("keeps only spells targeting the given permanent (Mistfolk)", () => {
        const atMist = {
            id: "at-mist",
            card: { id: "x" },
            types: ["Instant"],
            targets: [{ type: "permanent", id: "mist" }],
        };
        const atOther = {
            id: "at-other",
            card: { id: "x" },
            types: ["Instant"],
            targets: [{ type: "permanent", id: "other" }],
        };
        expect(
            matchesSpellPendingTarget(
                atMist,
                pt({
                    spellStackKind: "spell",
                    spellTargetsInstanceIds: ["mist"],
                }),
                stackCtx
            )
        ).toBe(true);
        expect(
            matchesSpellPendingTarget(
                atOther,
                pt({
                    spellStackKind: "spell",
                    spellTargetsInstanceIds: ["mist"],
                }),
                stackCtx
            )
        ).toBe(false);
        // An ability never satisfies a "spell that targets ~" filter.
        expect(
            matchesSpellPendingTarget(
                { ...atMist, id: "at-mist-ability", abilityId: "x" },
                pt({
                    spellStackKind: "spell",
                    spellTargetsInstanceIds: ["mist"],
                }),
                stackCtx
            )
        ).toBe(false);
    });

    it("matches a SPELL when no stack-kind filter is set", () => {
        expect(
            matchesSpellPendingTarget(
                artifactSpell,
                pt({ spellStackKind: "spell" }),
                stackCtx
            )
        ).toBe(true);
    });

    it("rejects an ability under the default (omitted) and explicit 'spell' — target spell targets a spell (CR 701.6a)", () => {
        // Regression: Counterspell ("target spell", omitted spellStackKind)
        // must NOT be clickable on a triggered/activated ability.
        const triggeredAbility = {
            id: "triggered-ability",
            card: { id: "x" },
            types: ["Creature"],
            triggeredAbilityId: "etb-trigger",
        };
        expect(
            matchesSpellPendingTarget(
                creatureAbility,
                pt({ spellStackKind: "spell" }),
                stackCtx
            )
        ).toBe(false);
        expect(
            matchesSpellPendingTarget(
                triggeredAbility,
                pt({ spellStackKind: "spell" }),
                stackCtx
            )
        ).toBe(false);
        expect(
            matchesSpellPendingTarget(
                creatureAbility,
                pt({ spellStackKind: "spell" }),
                stackCtx
            )
        ).toBe(false);
    });

    it("keeps any ability — activated OR triggered — under 'ability' (Stifle), rejects a spell", () => {
        const triggeredAbility = {
            id: "triggered-ability",
            card: { id: "x" },
            types: ["Creature"],
            triggeredAbilityId: "etb-trigger",
        };
        expect(
            matchesSpellPendingTarget(
                creatureAbility,
                pt({ spellStackKind: "ability" }),
                stackCtx
            )
        ).toBe(true);
        expect(
            matchesSpellPendingTarget(
                triggeredAbility,
                pt({ spellStackKind: "ability" }),
                stackCtx
            )
        ).toBe(true);
        // An ability-kind target never accepts a spell.
        expect(
            matchesSpellPendingTarget(
                artifactSpell,
                pt({ spellStackKind: "ability" }),
                stackCtx
            )
        ).toBe(false);
    });

    it("keeps BOTH a spell and an ability under 'any' (Ward, CR 702.21a)", () => {
        const triggeredAbility = {
            id: "triggered-ability",
            card: { id: "x" },
            types: ["Creature"],
            triggeredAbilityId: "etb-trigger",
        };
        expect(
            matchesSpellPendingTarget(
                artifactSpell,
                pt({ spellStackKind: "any" }),
                stackCtx
            )
        ).toBe(true);
        expect(
            matchesSpellPendingTarget(
                creatureAbility,
                pt({ spellStackKind: "any" }),
                stackCtx
            )
        ).toBe(true);
        expect(
            matchesSpellPendingTarget(
                triggeredAbility,
                pt({ spellStackKind: "any" }),
                stackCtx
            )
        ).toBe(true);
    });

    it("'any' + spellTargetsInstanceIds also admits a matching ABILITY (Ward's reflexive self-target), unlike the spell-only Mistfolk default", () => {
        const abilityAtWarded = {
            id: "ability-at-warded",
            card: { id: "x" },
            types: ["Creature"],
            triggeredAbilityId: "ward-trigger",
            targets: [{ type: "permanent", id: "warded" }],
        };
        const abilityAtOther = {
            ...abilityAtWarded,
            id: "ability-at-other",
            targets: [{ type: "permanent", id: "other" }],
        };
        expect(
            matchesSpellPendingTarget(
                abilityAtWarded,
                pt({
                    spellStackKind: "any",
                    spellTargetsInstanceIds: ["warded"],
                }),
                stackCtx
            )
        ).toBe(true);
        expect(
            matchesSpellPendingTarget(
                abilityAtOther,
                pt({
                    spellStackKind: "any",
                    spellTargetsInstanceIds: ["warded"],
                }),
                stackCtx
            )
        ).toBe(false);
        // Spell-only default (no spellStackKind) keeps excluding abilities,
        // even one that targets the pinned id — Mistfolk's existing contract
        // is unchanged.
        expect(
            matchesSpellPendingTarget(
                abilityAtWarded,
                pt({
                    spellStackKind: "spell",
                    spellTargetsInstanceIds: ["warded"],
                }),
                stackCtx
            )
        ).toBe(false);
    });
});

describe("matchesSpellPendingTarget (spellTypeFilter dimension)", () => {
    const filter = ["Instant", "Sorcery"];
    const ctx = { playerId: "p1", activePlayerId: "p1", players: [] };

    it("matches an instant/sorcery spell when the filter is set", () => {
        expect(
            matchesSpellPendingTarget(
                { id: "s1", card: { id: "x" }, types: ["Instant"] },
                pt({ spellTypeFilter: filter }),
                ctx
            )
        ).toBe(true);
        expect(
            matchesSpellPendingTarget(
                { id: "s2", card: { id: "x" }, types: ["Sorcery"] },
                pt({ spellTypeFilter: filter }),
                ctx
            )
        ).toBe(true);
    });

    it("rejects a permanent (e.g. creature) spell under the filter", () => {
        expect(
            matchesSpellPendingTarget(
                { id: "s3", card: { id: "x" }, types: ["Creature"] },
                pt({ spellTypeFilter: filter }),
                ctx
            )
        ).toBe(false);
    });

    it("rejects stack abilities (not spells)", () => {
        expect(
            matchesSpellPendingTarget(
                {
                    id: "a1",
                    card: { id: "x" },
                    types: ["Creature"],
                    abilityId: "tim-zap",
                },
                pt({ spellTypeFilter: filter }),
                ctx
            )
        ).toBe(false);
        expect(
            matchesSpellPendingTarget(
                {
                    id: "a2",
                    card: { id: "x" },
                    types: ["Enchantment"],
                    triggeredAbilityId: "upkeep",
                },
                pt({ spellTypeFilter: filter }),
                ctx
            )
        ).toBe(false);
    });

    it("matches anything when no filter is set", () => {
        expect(
            matchesSpellPendingTarget(
                { id: "s4", card: { id: "x" }, types: ["Creature"] },
                pt({}),
                ctx
            )
        ).toBe(true);
        // The absent case again, for a second stack item shape. NOT an empty
        // ARRAY: `spellTypeFilterDescriptor.lower` is a bare `arr(...)` with no
        // length guard (unlike its sibling `stackSourceTypeFilterDescriptor`,
        // which does `v.length > 0 ? v : undefined`), so a
        // `spellTypeFilter: []` WOULD be carried and would reject everything —
        // `value.some(...)` over an empty array is `false`. That is unreachable
        // (no requirement authors `[]`) and both sides of the wire read it
        // identically, so it is not a client/server divergence — but "the
        // registry normalizes it away" is not why.
        expect(
            matchesSpellPendingTarget(
                { id: "s5", card: { id: "x" }, types: ["Instant"] },
                pt({}),
                ctx
            )
        ).toBe(true);
    });

    // Artifact Blast (#274): "counter target artifact spell". game.ts
    // normalizes the card's string `spellTypeFilter: "Artifact"` to
    // ["Artifact"] before it reaches the client, so the UI sees an array.
    it("matches an Artifact spell but not other spell types (Artifact Blast)", () => {
        const artifactFilter = ["Artifact"];
        expect(
            matchesSpellPendingTarget(
                { id: "s6", card: { id: "x" }, types: ["Artifact"] },
                pt({ spellTypeFilter: artifactFilter }),
                ctx
            )
        ).toBe(true);
        expect(
            matchesSpellPendingTarget(
                {
                    id: "s7",
                    card: { id: "x" },
                    types: ["Artifact", "Creature"],
                },
                pt({ spellTypeFilter: artifactFilter }),
                ctx
            )
        ).toBe(true);
        expect(
            matchesSpellPendingTarget(
                { id: "s8", card: { id: "x" }, types: ["Instant"] },
                pt({ spellTypeFilter: artifactFilter }),
                ctx
            )
        ).toBe(false);
        expect(
            matchesSpellPendingTarget(
                { id: "s9", card: { id: "x" }, types: ["Sorcery"] },
                pt({ spellTypeFilter: artifactFilter }),
                ctx
            )
        ).toBe(false);
    });
});

// Spell Pierce (issue #683): "target noncreature spell" — frontend
// clickability gate (CR 114.1, the negative of spellTypeFilter).
describe("matchesSpellPendingTarget (spellExcludeTypeFilter dimension)", () => {
    const ctx = { playerId: "p1", activePlayerId: "p1", players: [] };

    it("rejects a creature spell, accepts a noncreature spell", () => {
        const filter = ["Creature"];
        expect(
            matchesSpellPendingTarget(
                { id: "s1", card: { id: "x" }, types: ["Creature"] },
                pt({ spellExcludeTypeFilter: filter }),
                ctx
            )
        ).toBe(false);
        expect(
            matchesSpellPendingTarget(
                { id: "s2", card: { id: "x" }, types: ["Instant"] },
                pt({ spellExcludeTypeFilter: filter }),
                ctx
            )
        ).toBe(true);
    });

    it("rejects stack abilities (not spells)", () => {
        expect(
            matchesSpellPendingTarget(
                {
                    id: "a1",
                    card: { id: "x" },
                    types: ["Instant"],
                    abilityId: "tim-zap",
                },
                pt({ spellExcludeTypeFilter: ["Creature"] }),
                ctx
            )
        ).toBe(false);
    });

    it("matches anything when no filter is set", () => {
        expect(
            matchesSpellPendingTarget(
                { id: "s3", card: { id: "x" }, types: ["Creature"] },
                pt({}),
                ctx
            )
        ).toBe(true);
        expect(
            matchesSpellPendingTarget(
                { id: "s4", card: { id: "x" }, types: ["Creature"] },
                pt({ spellExcludeTypeFilter: [] }),
                ctx
            )
        ).toBe(true);
    });
});

// Stern Scolding (issue #683): "target creature spell with power or
// toughness 2 or less" — frontend clickability gate (CR 114.1 + 208.2).
describe("matchesSpellPendingTarget (spellCreaturePtFilter dimension)", () => {
    const filter = { maxPowerOrToughness: 2 };
    const ctx = { playerId: "p1", activePlayerId: "p1", players: [] };

    it("matches a creature spell at or under the threshold on either stat", () => {
        expect(
            matchesSpellPendingTarget(
                {
                    id: "s1",
                    card: { id: "x" },
                    types: ["Creature"],
                    power: 2,
                    toughness: 5,
                },
                pt({ spellCreaturePtFilter: filter }),
                ctx
            )
        ).toBe(true);
        expect(
            matchesSpellPendingTarget(
                {
                    id: "s2",
                    card: { id: "x" },
                    types: ["Creature"],
                    power: 5,
                    toughness: 1,
                },
                pt({ spellCreaturePtFilter: filter }),
                ctx
            )
        ).toBe(true);
    });

    it("rejects a creature spell over the threshold on both stats", () => {
        expect(
            matchesSpellPendingTarget(
                {
                    id: "s3",
                    card: { id: "x" },
                    types: ["Creature"],
                    power: 4,
                    toughness: 4,
                },
                pt({ spellCreaturePtFilter: filter }),
                ctx
            )
        ).toBe(false);
    });

    it("rejects a noncreature spell regardless of power/toughness", () => {
        expect(
            matchesSpellPendingTarget(
                {
                    id: "s4",
                    card: { id: "x" },
                    types: ["Instant"],
                    power: 1,
                    toughness: 1,
                },
                pt({ spellCreaturePtFilter: filter }),
                ctx
            )
        ).toBe(false);
    });

    it("rejects stack abilities (not spells)", () => {
        expect(
            matchesSpellPendingTarget(
                {
                    id: "a1",
                    card: { id: "x" },
                    types: ["Creature"],
                    power: 1,
                    toughness: 1,
                    abilityId: "some-ability",
                },
                pt({ spellCreaturePtFilter: filter }),
                ctx
            )
        ).toBe(false);
    });

    it("matches anything when no filter is set", () => {
        expect(
            matchesSpellPendingTarget(
                {
                    id: "s5",
                    card: { id: "x" },
                    types: ["Instant"],
                    power: 9,
                    toughness: 9,
                },
                pt({}),
                ctx
            )
        ).toBe(true);
    });
});

// Reflecting Mirror (#425): "target spell with a single target if that target
// is you" — frontend clickability gate (CR 115.7 / 115.10).
describe("matchesSpellPendingTarget (spellSingleTargetingController dimension)", () => {
    const ctx = { playerId: "p1", activePlayerId: "p1", players: [] };

    it("matches a single-target spell whose only target is the activator", () => {
        expect(
            matchesSpellPendingTarget(
                {
                    id: "s1",
                    card: { id: "x" },
                    targets: [{ type: "player", id: "p1" }],
                },
                pt({ spellSingleTargetingController: true }),
                ctx
            )
        ).toBe(true);
    });

    it("rejects a spell targeting a different player", () => {
        expect(
            matchesSpellPendingTarget(
                {
                    id: "s2",
                    card: { id: "x" },
                    targets: [{ type: "player", id: "p2" }],
                },
                pt({ spellSingleTargetingController: true }),
                ctx
            )
        ).toBe(false);
    });

    it("rejects a multi-target spell", () => {
        expect(
            matchesSpellPendingTarget(
                {
                    id: "s3",
                    card: { id: "x" },
                    targets: [
                        { type: "player", id: "p1" },
                        { type: "player", id: "p2" },
                    ],
                },
                pt({ spellSingleTargetingController: true }),
                ctx
            )
        ).toBe(false);
    });

    it("rejects a spell whose single target is a permanent", () => {
        expect(
            matchesSpellPendingTarget(
                {
                    id: "s4",
                    card: { id: "x" },
                    targets: [{ type: "permanent", id: "c1" }],
                },
                pt({ spellSingleTargetingController: true }),
                ctx
            )
        ).toBe(false);
    });

    it("rejects stack abilities (not spells)", () => {
        expect(
            matchesSpellPendingTarget(
                {
                    id: "a1",
                    card: { id: "x" },
                    abilityId: "tim-zap",
                    targets: [{ type: "player", id: "p1" }],
                },
                pt({ spellSingleTargetingController: true }),
                ctx
            )
        ).toBe(false);
    });

    it("matches anything when the flag is off", () => {
        expect(
            matchesSpellPendingTarget(
                {
                    id: "s5",
                    card: { id: "x" },
                    targets: [{ type: "player", id: "p2" }],
                },
                pt({}),
                ctx
            )
        ).toBe(true);
    });
});

// Lutri, the Spellchaser (#1391): "copy target instant or sorcery spell YOU
// CONTROL" — frontend clickability gate extending `controller` (CR 109.3 /
// 114.1) onto spell/ability stack targets, mirroring the server's
// `matchesBattlefieldController` predicate.
describe("matchesSpellPendingTarget (controller dimension — Lutri, the Spellchaser)", () => {
    it("matches a spell the activating player cast, under 'you'", () => {
        expect(
            matchesSpellPendingTarget(
                { id: "s1", card: { id: "x" }, castById: "p1" },
                pt({ controller: "you" }),
                { playerId: "p1", activePlayerId: "p1", players: [] }
            )
        ).toBe(true);
    });

    it("rejects an opponent's spell under 'you'", () => {
        expect(
            matchesSpellPendingTarget(
                { id: "s2", card: { id: "x" }, castById: "p2" },
                pt({ controller: "you" }),
                { playerId: "p1", activePlayerId: "p1", players: [] }
            )
        ).toBe(false);
    });

    it("matches an opponent's spell under 'opponent'", () => {
        expect(
            matchesSpellPendingTarget(
                { id: "s3", card: { id: "x" }, castById: "p2" },
                pt({ controller: "opponent" }),
                { playerId: "p1", activePlayerId: "p1", players: [] }
            )
        ).toBe(true);
    });

    it("rejects the activator's own spell under 'opponent'", () => {
        expect(
            matchesSpellPendingTarget(
                { id: "s4", card: { id: "x" }, castById: "p1" },
                pt({ controller: "opponent" }),
                { playerId: "p1", activePlayerId: "p1", players: [] }
            )
        ).toBe(false);
    });

    it("matches only the active player's spell under 'active'", () => {
        expect(
            matchesSpellPendingTarget(
                { id: "s5", card: { id: "x" }, castById: "p2" },
                pt({ controller: "active" }),
                { playerId: "p1", activePlayerId: "p2", players: [] }
            )
        ).toBe(true);
        expect(
            matchesSpellPendingTarget(
                { id: "s6", card: { id: "x" }, castById: "p1" },
                pt({ controller: "active" }),
                { playerId: "p1", activePlayerId: "p2", players: [] }
            )
        ).toBe(false);
    });

    it("matches anything under 'any' or no filter", () => {
        expect(
            matchesSpellPendingTarget(
                { id: "s7", card: { id: "x" }, castById: "p2" },
                pt({ controller: "any" }),
                { playerId: "p1", activePlayerId: "p1", players: [] }
            )
        ).toBe(true);
        expect(
            matchesSpellPendingTarget(
                { id: "s8", card: { id: "x" }, castById: "p2" },
                pt({}),
                { playerId: "p1", activePlayerId: "p1", players: [] }
            )
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// matchesSpellPendingTarget (spellWouldDestroyLandYouControl dimension —
// Equinox, CR 114.1 + 701.8). The UI marks a stack spell clickable only if
// it would destroy a land the activator controls.
// ---------------------------------------------------------------------------

describe("matchesSpellPendingTarget (spellWouldDestroyLandYouControl dimension — Equinox clickability)", () => {
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
    const ctx = { playerId: "p1", activePlayerId: "p1", players };

    it("matches Stone Rain aimed at a land you control", () => {
        const item = {
            id: "stone-rain",
            card: { id: STONE_RAIN_ID },
            targets: [{ type: "permanent", id: "myLand" }],
        };
        expect(
            matchesSpellPendingTarget(
                item,
                pt({ spellWouldDestroyLandYouControl: true }),
                ctx
            )
        ).toBe(true);
    });

    it("rejects Stone Rain aimed at the opponent's land", () => {
        const item = {
            id: "stone-rain",
            card: { id: STONE_RAIN_ID },
            targets: [{ type: "permanent", id: "oppLand" }],
        };
        expect(
            matchesSpellPendingTarget(
                item,
                pt({ spellWouldDestroyLandYouControl: true }),
                ctx
            )
        ).toBe(false);
    });

    it("matches Armageddon while you control a land", () => {
        const item = {
            id: "armageddon",
            card: { id: ARMAGEDDON_ID },
            targets: [],
        };
        expect(
            matchesSpellPendingTarget(
                item,
                pt({ spellWouldDestroyLandYouControl: true }),
                ctx
            )
        ).toBe(true);
    });

    it("rejects a Counterspell (no land destruction)", () => {
        const item = {
            id: "counterspell",
            card: { id: COUNTERSPELL_ID },
            targets: [],
        };
        expect(
            matchesSpellPendingTarget(
                item,
                pt({ spellWouldDestroyLandYouControl: true }),
                ctx
            )
        ).toBe(false);
    });

    it("rejects an ability on the stack (not a spell)", () => {
        const item = {
            id: "stone-rain-ability",
            card: { id: STONE_RAIN_ID },
            targets: [{ type: "permanent", id: "myLand" }],
            abilityId: "some-ability",
        };
        expect(
            matchesSpellPendingTarget(
                item,
                pt({ spellWouldDestroyLandYouControl: true }),
                ctx
            )
        ).toBe(false);
    });

    it("matches anything when the flag is off", () => {
        const item = {
            id: "counterspell",
            card: { id: COUNTERSPELL_ID },
            targets: [],
        };
        expect(matchesSpellPendingTarget(item, pt({}), ctx)).toBe(true);
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

    // Skyship Weatherlight (PLS, issue #1947) prints its ETB search trigger
    // BEFORE its {4},{T} activated ability — `order` must reflect that
    // printed-line position so the preview (CardPreviewAbilities) doesn't
    // fall back to its fixed activated-then-triggered block order and swap
    // them.
    it("assigns Skyship Weatherlight's triggered row an earlier order than its activated row", () => {
        const { activated, triggered } = getDisplayAbilities(
            skyshipWeatherlight.id
        );
        expect(triggered).toHaveLength(1);
        expect(activated).toHaveLength(1);
        expect(triggered[0].order).toBeDefined();
        expect(activated[0].order).toBeDefined();
        expect(triggered[0].order!).toBeLessThan(activated[0].order!);
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

    // CR 613.1d — the layer-5 colour GRANT (Dralnu's Crusade "All Goblins are
    // black", Sinister Strength), the additive twin of `colorOverride`. The
    // server writes `grantedColors` on the instance and `slimCard` forwards it
    // across the wire, but this client mirror used to derive colours from
    // `colorOverride ?? printed cost` alone — so a Goblin the engine treats as
    // black never matched a "black creature" filter here, and the board
    // highlighted the wrong (or no) targets.
    it("folds in a layer-5 grantedColors colour (Dralnu's Crusade)", () => {
        const card = makeCardInstance({
            card: { id: GRIZZLY_BEARS_ID }, // printed green
            types: ["Creature"],
            isTapped: true,
            grantedColors: [{ color: "B", sourceId: "crusade-1" }],
        });
        expect(
            matchesPermanentFilter(card, { colors: ["B"], tapped: true })
        ).toBe(true);
        // Additive, not a replacement: the printed colour survives (CR 613.1d
        // — only `colorOverride` REPLACES).
        expect(
            matchesPermanentFilter(card, { colors: ["G"], tapped: true })
        ).toBe(true);
    });

    it("a colorOverride still REPLACES a granted colour (set beats grant)", () => {
        const card = makeCardInstance({
            card: { id: GRIZZLY_BEARS_ID }, // printed green
            types: ["Creature"],
            isTapped: true,
            colorOverride: ["U"],
            grantedColors: [{ color: "B", sourceId: "crusade-1" }],
        });
        expect(
            matchesPermanentFilter(card, { colors: ["U"], tapped: true })
        ).toBe(true);
        expect(
            matchesPermanentFilter(card, { colors: ["B"], tapped: true })
        ).toBe(false);
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
// matchesPermanentFilter / toMatchablePermanent — MIRROR_CENSUS parity guard
// (issue #1938 fixup 2)
//
// Fixup 1 closed the `excludeSubtypes` gap (the Planeshift Lair cycle's
// "non-Lair land" return-leg cost, `{ types: "Land", excludeSubtypes: "Lair"
// }`) but its own "parity guard" was a hand-maintained `cases` array: nothing
// FAILS when a field exists on the engine `PermanentFilter`
// (convex/cards/filters.ts) but isn't exercised here. Proof it had already
// rotted: `controllerRelation`, `isToken`, `name`, `enteredThisTurn`,
// `powerAtLeast`, `instanceIds`, `excludeInstanceIds`, `createdBy` were all
// unmirrored while that guard stayed green — the SAME shape of gap the guard
// exists to catch.
//
// This block replaces the array with `MIRROR_CENSUS`
// (`Record<keyof PermanentFilter, MirrorStatus>`, defined in card-utils.ts):
// adding a NEW field to `PermanentFilter` breaks `tsc` here until the census
// is updated, and the two `it` blocks below fail if a census entry has no
// backing test case. See `MIRROR_CENSUS`'s own doc comment for what each
// status means.
// ---------------------------------------------------------------------------

describe("matchesPermanentFilter / toMatchablePermanent — MIRROR_CENSUS parity guard (issue #1938 fixup 2)", () => {
    /** Both the client mirror (`ClientPermanentFilter`) AND the real engine
     *  matcher (via the REAL production `toMatchablePermanent`, not a
     *  hand-built duplicate — a duplicate is exactly how the `excludeSubtypes`
     *  gap went unnoticed) must agree. Used for every `"mirrored"` census key. */
    function expectParity(
        card: CardInstance,
        filter: PermanentFilter,
        expected: boolean,
        ctx?: FilterMatchContext,
        turnState?: ControlContinuityView
    ) {
        expect(matchesPermanentFilter(card, filter, turnState)).toBe(expected);
        expect(
            matchesEnginePermanentFilter(
                toMatchablePermanent(card, turnState),
                filter,
                ctx
            )
        ).toBe(expected);
    }

    /** Only the real engine matcher is exercised — the `ClientPermanentFilter`
     *  mirror has no field for this filter key (no shipped board-highlight
     *  filter needs it). Used for every `"adapter-only"` census key; proves
     *  `toMatchablePermanent` actually populates the field it claims to. */
    function expectAdapterOnly(
        card: CardInstance,
        filter: PermanentFilter,
        expected: boolean,
        ctx?: FilterMatchContext,
        turnState?: ControlContinuityView
    ) {
        expect(
            matchesEnginePermanentFilter(
                toMatchablePermanent(card, turnState),
                filter,
                ctx
            )
        ).toBe(expected);
    }

    type Case = {
        card: CardInstance;
        filter: PermanentFilter;
        expected: boolean;
        /** Projected `{ turn, controlChangedThisTurn }` — only the two
         *  turn-scoped derived flags need it (issue #1944). */
        turnState?: ControlContinuityView;
    };
    type AdapterCase = Case & { ctx?: FilterMatchContext };

    const MIRRORED_CASES: Partial<Record<keyof PermanentFilter, Case[]>> = {
        // CR 109.2 "another" (issue #2373). `excludeSource` on an
        // `EffectCardFilter` becomes `PermanentFilter.excludeInstanceIds` in
        // `toPermanentFilter` and rides the wire on `PendingChoice.filter`,
        // which the human battlefield picker evaluates through the CLIENT
        // mirror. It was `"adapter-only"` — i.e. the mirror had no branch and
        // failed OPEN — until a shipped card (Gut, True Soul Zealot) put it on
        // a client-reachable filter. `instanceIds` is the positive twin.
        excludeInstanceIds: [
            {
                card: makeCardInstance({ id: "source-1" }),
                filter: { excludeInstanceIds: ["source-1"] },
                expected: false,
            },
            {
                card: makeCardInstance({ id: "another-1" }),
                filter: { excludeInstanceIds: ["source-1"] },
                expected: true,
            },
        ],
        // CR 109.2 (issue #2367) — the id-LESS form of `excludeInstanceIds`,
        // for a static card-definition filter ("Sacrifice another artifact").
        // `expectParity` supplies no `FilterMatchContext`, which is exactly the
        // shape under test: BOTH paths must then match NOTHING (the engine
        // matcher has no `ctx.selfInstanceId`; the client mirror has no context
        // at all), never fall through to "no constraint" and ring the source as
        // a legal sacrifice. The working client path is the LOWERED filter —
        // `resolveExcludeSource` turns this flag into a concrete
        // `excludeInstanceIds` entry before the requirement leaves the server —
        // which the two cases above already cover.
        excludeSource: [
            {
                card: makeCardInstance({ id: "source-1" }),
                filter: { excludeSource: true },
                expected: false,
            },
            {
                card: makeCardInstance({ id: "another-1" }),
                filter: { excludeSource: true },
                expected: false,
            },
        ],
        instanceIds: [
            {
                card: makeCardInstance({ id: "keep-me" }),
                filter: { instanceIds: ["keep-me"] },
                expected: true,
            },
            {
                card: makeCardInstance({ id: "not-me" }),
                filter: { instanceIds: ["keep-me"] },
                expected: false,
            },
        ],
        // Keldon Twilight's "…that they controlled since the beginning of the
        // turn" (issue #1944). Both paths delegate to the ONE engine helper
        // `hasControlledSinceTurnStart`, so the board highlight and the
        // server's pending-choice submit validation cannot disagree.
        controlledSinceTurnStart: [
            {
                card: makeCardInstance({ id: "long-held", enteredOnTurn: 1 }),
                filter: { controlledSinceTurnStart: true },
                turnState: { turn: 5 },
                expected: true,
            },
            {
                card: makeCardInstance({ id: "just-cast", enteredOnTurn: 5 }),
                filter: { controlledSinceTurnStart: true },
                turnState: { turn: 5 },
                expected: false,
            },
            {
                card: makeCardInstance({ id: "stolen", enteredOnTurn: 1 }),
                filter: { controlledSinceTurnStart: true },
                turnState: { turn: 5, controlChangedThisTurn: ["stolen"] },
                expected: false,
            },
            {
                // No turnState — must fail CLOSED on both paths (the filter is
                // a restriction; highlighting a pick the server would reject is
                // the worse failure).
                card: makeCardInstance({ id: "long-held", enteredOnTurn: 1 }),
                filter: { controlledSinceTurnStart: true },
                expected: false,
            },
        ],
        types: [
            {
                card: makeCardInstance({ types: ["Creature"] }),
                filter: { types: "Creature" },
                expected: true,
            },
        ],
        excludeTypes: [
            {
                card: makeCardInstance({
                    card: { id: forest.id },
                    types: ["Land"],
                    subtypes: ["Forest"],
                }),
                filter: { excludeTypes: "Land" },
                expected: false,
            },
            {
                card: makeCardInstance({ types: ["Creature"] }),
                filter: { excludeTypes: "Land" },
                expected: true,
            },
        ],
        subtypes: [
            {
                card: makeCardInstance({
                    types: ["Land"],
                    subtypes: ["Forest"],
                }),
                filter: { subtypes: "Forest" },
                expected: true,
            },
        ],
        // The Planeshift Lair cycle's own return-leg filter (issue #1938):
        // "sacrifice a nonbasic land" — before fixup 1 this silently matched
        // every land, Lairs included.
        excludeSubtypes: [
            {
                card: makeCardInstance({
                    card: { id: crosissCatacombs.id },
                    types: ["Land"],
                    subtypes: ["Lair"],
                }),
                filter: { types: "Land", excludeSubtypes: "Lair" },
                expected: false,
            },
            {
                card: makeCardInstance({
                    card: { id: forest.id },
                    types: ["Land"],
                    subtypes: ["Forest"],
                }),
                filter: { types: "Land", excludeSubtypes: "Lair" },
                expected: true,
            },
        ],
        excludeSupertypes: [
            {
                card: makeCardInstance({
                    card: { id: forest.id },
                    types: ["Land"],
                    subtypes: ["Forest"],
                }),
                filter: { types: "Land", excludeSupertypes: "Basic" },
                expected: false,
            },
        ],
        requireAbility: [
            {
                card: makeCardInstance({
                    types: ["Creature"],
                    staticAbilities: ["flying"],
                }),
                filter: { requireAbility: "flying" },
                expected: true,
            },
        ],
        excludeAbility: [
            {
                card: makeCardInstance({
                    types: ["Creature"],
                    staticAbilities: ["flying"],
                }),
                filter: { excludeAbility: "flying" },
                expected: false,
            },
        ],
        colors: [
            {
                card: makeCardInstance({
                    card: { id: FLYING_MEN_ID },
                    isTapped: true,
                }),
                filter: { colors: ["U"], tapped: true },
                expected: true,
            },
        ],
        tapped: [
            {
                card: makeCardInstance({
                    card: { id: FLYING_MEN_ID },
                    isTapped: true,
                }),
                filter: { colors: ["U"], tapped: true },
                expected: true,
            },
        ],
        any: [
            {
                card: makeCardInstance({
                    types: ["Creature"],
                    subtypes: ["Bear"],
                }),
                filter: { any: [{ subtypes: "Bear" }, { types: "Land" }] },
                expected: true,
            },
        ],
    };

    // `power`/`toughness`/`isAttacking`/`isBlocking` are always populated on
    // `MatchablePermanent`, so these filters already work correctly via the
    // engine-matcher path with no `toMatchablePermanent` change.
    const ADAPTER_ONLY_CASES: Partial<
        Record<keyof PermanentFilter, AdapterCase[]>
    > = {
        supertypes: [
            {
                card: makeCardInstance({
                    card: { id: forest.id },
                    types: ["Land"],
                    subtypes: ["Forest"],
                }),
                filter: { types: "Land", supertypes: "Basic" },
                expected: true,
            },
        ],
        // CR 400.7 (issue #1944) — derived by the adapter from the projected
        // turn number, exactly as the server derives it. The client mirror has
        // no field for it (no shipped board-highlight filter needs it).
        enteredThisTurn: [
            {
                card: makeCardInstance({ id: "fresh", enteredOnTurn: 5 }),
                filter: { enteredThisTurn: true },
                turnState: { turn: 5 },
                expected: true,
            },
            {
                card: makeCardInstance({ id: "old", enteredOnTurn: 2 }),
                filter: { enteredThisTurn: true },
                turnState: { turn: 5 },
                expected: false,
            },
            {
                // No turnState — the adapter leaves the flag undefined, which
                // reads as "did not enter this turn".
                card: makeCardInstance({ id: "fresh", enteredOnTurn: 5 }),
                filter: { enteredThisTurn: true },
                expected: false,
            },
        ],
        powerAtLeast: [
            {
                card: makeCardInstance({ types: ["Creature"], power: 4 }),
                filter: { powerAtLeast: 3 },
                expected: true,
            },
            {
                card: makeCardInstance({ types: ["Creature"], power: 2 }),
                filter: { powerAtLeast: 3 },
                expected: false,
            },
        ],
        toughnessAtLeast: [
            {
                card: makeCardInstance({
                    types: ["Creature"],
                    toughness: 5,
                }),
                filter: { toughnessAtLeast: 3 },
                expected: true,
            },
        ],
        isAttacking: [
            {
                card: makeCardInstance({
                    types: ["Creature"],
                    isAttacking: true,
                }),
                filter: { isAttacking: true },
                expected: true,
            },
        ],
        isBlocking: [
            {
                card: makeCardInstance({
                    types: ["Creature"],
                    isBlocking: false,
                }),
                filter: { isBlocking: true },
                expected: false,
            },
        ],
        // CR 111.5 / 701.21 — "sacrifice a nontoken permanent". Before this
        // fixup `toMatchablePermanent` dropped `isToken` entirely, so an
        // ACTUAL token read as `undefined` → treated as non-token by
        // `matchesPermanentFilter`'s boolean-equality check → an
        // `isToken: false` filter matched it anyway (fail OPEN).
        isToken: [
            {
                card: makeCardInstance({
                    types: ["Creature"],
                    isToken: true,
                }),
                filter: { isToken: false },
                expected: false,
            },
            {
                card: makeCardInstance({
                    types: ["Creature"],
                    isToken: true,
                }),
                filter: { isToken: true },
                expected: true,
            },
        ],
        createdBy: [
            {
                card: makeCardInstance({
                    types: ["Creature"],
                    isToken: true,
                    createdBy: "tetravus-1",
                }),
                filter: { createdBy: "tetravus-1" },
                expected: true,
            },
            {
                card: makeCardInstance({
                    types: ["Creature"],
                    isToken: true,
                    createdBy: "tetravus-1",
                }),
                filter: { createdBy: "other-source" },
                expected: false,
            },
        ],
        // CR 701.21 (issue #1938 fixup 2 REGRESSION) — `controllerRelation`
        // requires a `FilterMatchContext`; `mayPaySacrificeCount` /
        // `mayPaySacrificePower` called the engine matcher with NO third
        // argument, so `matchesControllerRelation` always failed CLOSED.
        controllerRelation: [
            {
                card: makeCardInstance({ controllerId: "p1" }),
                filter: { controllerRelation: "you" },
                ctx: { selfControllerId: "p1" },
                expected: true,
            },
            {
                card: makeCardInstance({ controllerId: "p2" }),
                filter: { controllerRelation: "you" },
                ctx: { selfControllerId: "p1" },
                expected: false,
            },
            {
                card: makeCardInstance({ controllerId: "p1" }),
                filter: { controllerRelation: "you" },
                // No ctx at all — this is the exact regression shape: it
                // must fail closed (false), not silently match.
                expected: false,
            },
        ],
    };

    it("every 'mirrored' MIRROR_CENSUS key has at least one parity case, run through both paths", () => {
        for (const [key, status] of Object.entries(MIRROR_CENSUS) as Array<
            [keyof PermanentFilter, MirrorStatus]
        >) {
            if (status !== "mirrored") continue;
            const cases = MIRRORED_CASES[key];
            expect(cases, `MIRRORED_CASES["${key}"] is missing`).toBeDefined();
            expect(cases!.length).toBeGreaterThan(0);
            for (const { card, filter, expected, turnState } of cases!) {
                expectParity(card, filter, expected, undefined, turnState);
            }
        }
    });

    it("every 'adapter-only' MIRROR_CENSUS key has at least one case, populated by toMatchablePermanent", () => {
        for (const [key, status] of Object.entries(MIRROR_CENSUS) as Array<
            [keyof PermanentFilter, MirrorStatus]
        >) {
            if (status !== "adapter-only") continue;
            const cases = ADAPTER_ONLY_CASES[key];
            expect(
                cases,
                `ADAPTER_ONLY_CASES["${key}"] is missing`
            ).toBeDefined();
            expect(cases!.length).toBeGreaterThan(0);
            for (const { card, filter, expected, ctx, turnState } of cases!) {
                expectAdapterOnly(card, filter, expected, ctx, turnState);
            }
        }
    });

    it("'intentionally-absent' keys stay undeclared in either case map (documents the gap, doesn't paper over it)", () => {
        for (const [key, status] of Object.entries(MIRROR_CENSUS) as Array<
            [keyof PermanentFilter, MirrorStatus]
        >) {
            if (status !== "intentionally-absent") continue;
            expect(MIRRORED_CASES[key]).toBeUndefined();
            expect(ADAPTER_ONLY_CASES[key]).toBeUndefined();
        }
    });
});

// ---------------------------------------------------------------------------
// buildTriggerStateView — TRIGGER_STATE_VIEW_CENSUS (issue #1951 review round
// 3, MAJOR 5). A THIRD reducer distinct from MIRROR_CENSUS's two paths — the
// shape getStackAbilities' sacrificeFilter/tapOtherFilter affordability gates
// read through. The isToken BLOCKER (round 2) was exactly a field this
// reducer silently failed to populate; this guards the whole field set at
// once, run through the REAL reducer (not a hand-built view — that would mask
// precisely the class of bug this exists to catch).
// ---------------------------------------------------------------------------

describe("buildTriggerStateView — TRIGGER_STATE_VIEW_CENSUS (issue #1951 review round 3, MAJOR 5)", () => {
    /** One representative permanent exercising every "populated" filter
     *  dimension at once, run through the real `buildTriggerStateView`. */
    function representativeEntry(turnState?: ControlContinuityView) {
        const card = {
            id: "rep",
            card: { id: crawWurm.id },
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield" as const,
            types: ["Creature"] as const,
            subtypes: ["Bear"],
            staticAbilities: ["trample"],
            power: 3,
            toughness: 3,
            isTapped: true,
            isToken: true,
            isAttacking: true,
            isBlocking: false,
            createdBy: "source-1",
            enteredOnTurn: 5,
        } as unknown as CardInstance;
        const view = buildTriggerStateView(
            [{ id: "p1", life: 20, hand: [], battlefield: [card] }],
            "p1",
            undefined,
            undefined,
            turnState
        );
        return view.players[0].battlefield[0];
    }

    it("populates every field the census marks 'populated', through the real reducer", () => {
        const entry = representativeEntry();
        expect(entry.id).toBe("rep");
        expect(entry.controllerId).toBe("p1");
        expect(entry.types).toEqual(["Creature"]);
        expect(entry.subtypes).toEqual(["Bear"]);
        expect(entry.staticAbilities).toEqual(["trample"]);
        expect(entry.power).toBe(3);
        expect(entry.toughness).toBe(3);
        expect(entry.isTapped).toBe(true);
        // The exact BLOCKER field from round 2 — still verified here too.
        expect(entry.isToken).toBe(true);
        // MAJOR 5 — the four fields this round adds.
        expect(entry.isAttacking).toBe(true);
        expect(entry.isBlocking).toBe(false);
        expect(entry.createdBy).toBe("source-1");
    });

    it("carries the CR 307.1 / 117.1a cast-time snapshot a CR 603.4 condition reads (issue #2392)", () => {
        // `castOffSorceryTiming` is not a `PermanentFilter` dimension, so the
        // census above cannot police it — but it IS a field a card condition
        // reads off `self` (Necromancy's "if you cast it any time a sorcery
        // couldn't have been cast"), and this reducer enumerates its
        // battlefield fields explicitly. Dropped, every client-side read of
        // the flag answers `undefined`, i.e. "cast at sorcery speed", for
        // every permanent — no failing test anywhere, no visible symptom.
        const entry = (offSorceryTiming: boolean | undefined) => {
            const card = {
                id: "necro",
                card: { id: crawWurm.id },
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield" as const,
                types: ["Enchantment"] as const,
                subtypes: [],
                staticAbilities: [],
                isTapped: false,
                ...(offSorceryTiming === undefined
                    ? {}
                    : { castOffSorceryTiming: offSorceryTiming }),
            } as unknown as CardInstance;
            return buildTriggerStateView([
                { id: "p1", life: 20, hand: [], battlefield: [card] },
            ]).players[0].battlefield[0];
        };

        expect(entry(true).castOffSorceryTiming).toBe(true);
        expect(entry(false).castOffSorceryTiming).toBe(false);
        // An absent flag is a normal sorcery-speed cast, not "unknown".
        expect(entry(undefined).castOffSorceryTiming).toBe(false);
    });

    it("populates the turnState-conditional fields ONLY when turnState is supplied (fails CLOSED otherwise, matching every other unsupplied filter dimension)", () => {
        const withoutTurnState = representativeEntry();
        expect(withoutTurnState.enteredThisTurn).toBeUndefined();
        expect(withoutTurnState.controlledSinceTurnStart).toBeUndefined();

        const turnState: ControlContinuityView = {
            turn: 5,
            controlChangedThisTurn: [],
        };
        const withTurnState = representativeEntry(turnState);
        // The fixture entered ON turn 5 (the checked turn) — CR 400.7:
        // "entered this turn" is true, and (correctly the INVERSE here,
        // proving the derivation is real and not a stub) it therefore
        // canNOT have been controlled since the turn's beginning.
        expect(withTurnState.enteredThisTurn).toBe(true);
        expect(withTurnState.controlledSinceTurnStart).toBe(false);
    });

    it("every 'populated'/'conditional-on-turnState' census key is exercised by the tests above", () => {
        // Not a behavioural assertion — the census's own completeness check:
        // `entry` above (from `representativeEntry()`) carries every field a
        // "populated" or "conditional-on-turnState" key needs to be judged;
        // if a future key is added to `TRIGGER_STATE_VIEW_CENSUS` with either
        // status but the test above is never extended to cover it, THIS
        // still passes today (that's a per-key authoring omission, not
        // something a generic loop can catch) — but the loop below at least
        // asserts the census hasn't silently dropped every key down to
        // `"intentionally-absent"`/`"structural"`, which would make the
        // guard vacuous the same way an empty catalogue sweep would be.
        const populatedOrConditional = (
            Object.entries(TRIGGER_STATE_VIEW_CENSUS) as Array<
                [keyof PermanentFilter, TriggerStateViewFieldStatus]
            >
        ).filter(
            ([, status]) =>
                status === "populated" || status === "conditional-on-turnState"
        );
        expect(populatedOrConditional.length).toBeGreaterThan(0);
    });

    it("MINOR 6 — Caribou Range's sibling: a token-only board correctly HIDES a nontoken-only sacrificeFilter ability (Thopter Foundry fail-OPEN direction)", () => {
        // Thopter Foundry (`arb/multicolor.ts`): `sacrificeFilter: { types:
        // "Artifact", isToken: false }`. The sweep's catalogue test reports
        // this card as a self-referential skip (its OWN source already
        // matches its own filter, so a "zero candidates" break can't be
        // constructed there) — this test instead builds a board where the
        // ONLY artifacts are TOKENS, through the real buildTriggerStateView
        // reducer, and asserts the ability does NOT read as offered. Before
        // the `isToken` BLOCKER fix (round 2), every view entry read
        // `isToken: undefined` (≈ false), so a token-only board would have
        // WRONGLY offered this ability — the fail-OPEN direction.
        const tokenArtifact: CardInstance = {
            id: "token-art",
            card: { id: thopterFoundry.id },
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            types: ["Artifact", "Creature"],
            subtypes: ["Thopter"],
            staticAbilities: [],
            isTapped: false,
            isToken: true,
        };
        const foundry: CardInstance = {
            id: "foundry",
            card: { id: thopterFoundry.id },
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            types: ["Artifact"],
            subtypes: [],
            staticAbilities: [],
            isTapped: false,
            isToken: true, // the Foundry itself is ALSO a token here
        };
        const view = buildTriggerStateView([
            {
                id: "p1",
                life: 20,
                hand: [],
                battlefield: [foundry, tokenArtifact],
            },
        ]);
        const ids = getStackAbilities(foundry, undefined, true, view).map(
            (a) => a.id
        );
        expect(ids).not.toContain("thopter-foundry-make-thopter");
    });

    it("MINOR 7 — isToken survives projectPublicState into the shape getStackAbilities reads (Caribou Range)", () => {
        // Real server-side GameState (not a hand-built view — a hand-built
        // fixture would mask exactly the class of bug the isToken BLOCKER
        // (round 2) was: `CardInstanceState.isToken` dropped somewhere
        // between the server and `buildTriggerStateView`). Projects through
        // the REAL wire boundary (`projectPublicState`), then re-runs the
        // affordability check against the PROJECTED battlefield.
        const range = makeInstance(caribouRange.id, {
            id: "range",
            controllerId: "p1",
            ownerId: "p1",
        });
        const caribouToken = makeInstance(crawWurm.id, {
            id: "caribou-token",
            controllerId: "p1",
            ownerId: "p1",
            subtypes: ["Caribou"],
            isToken: true,
        });
        const state = makeState({
            players: [
                makeServerPlayer("p1", { battlefield: [range, caribouToken] }),
                makeServerPlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const projectedP1 = projected.players.find((p) => p.id === "p1")!;
        const projectedRange = projectedP1.battlefield.find(
            (c) => c.id === "range"
        )! as unknown as CardInstance;
        const view = buildTriggerStateView([
            {
                id: "p1",
                life: 20,
                hand: [],
                battlefield:
                    projectedP1.battlefield as unknown as CardInstance[],
            },
        ]);
        const ids = getStackAbilities(
            projectedRange,
            undefined,
            true,
            view
        ).map((a) => a.id);
        expect(ids).toContain("caribou-range-gain-life");
    });

    it('#2367 — "Sacrifice ANOTHER artifact" is HIDDEN when the source is the only artifact, and OFFERED once a second one exists (Legion Extruder, through projectPublicState + buildTriggerStateView)', () => {
        // The fail-OPEN direction this issue closes: before
        // `PermanentFilter.excludeSource`, `getStackAbilities`'
        // `sacrificeFilter` gate counted the ability's OWN source as a legal
        // sacrifice candidate, so Legion Extruder alone on the battlefield read
        // as affordable — the client offered an activation the server rejects,
        // and (worse) the shipped Orc General could feed itself to its own cost.
        //
        // Deliberately routed through BOTH real reducers — the server-side
        // `projectPublicState` wire boundary and `buildTriggerStateView` — so a
        // dropped field fails here rather than being masked by a hand-built
        // view (the structural rule in gre-development.md § Proof-of-failure).
        function offeredAbilityIds(battlefield: CardInstanceState[]): string[] {
            const state = makeState({
                players: [
                    makeServerPlayer("p1", { battlefield }),
                    makeServerPlayer("p2"),
                ],
            });
            const projected = projectPublicState(state, 1, "p1");
            const projectedP1 = projected.players.find((p) => p.id === "p1")!;
            const projectedExtruder = projectedP1.battlefield.find(
                (c) => c.id === "extruder"
            )! as unknown as CardInstance;
            const view = buildTriggerStateView([
                {
                    id: "p1",
                    life: 20,
                    hand: [],
                    battlefield:
                        projectedP1.battlefield as unknown as CardInstance[],
                },
            ]);
            return getStackAbilities(
                projectedExtruder,
                undefined,
                true,
                view
            ).map((a) => a.id);
        }

        const extruder = makeInstance(legionExtruder.id, {
            id: "extruder",
            controllerId: "p1",
            ownerId: "p1",
        });
        const otherArtifact = makeInstance(ornithopter.id, {
            id: "other-artifact",
            controllerId: "p1",
            ownerId: "p1",
        });

        expect(offeredAbilityIds([extruder])).not.toContain(
            "legion-extruder-make-golem"
        );
        expect(offeredAbilityIds([extruder, otherArtifact])).toContain(
            "legion-extruder-make-golem"
        );
    });
});

// ---------------------------------------------------------------------------
// mayPaySacrificeCount / mayPaySacrificePower — controllerRelation regression
// (issue #1938 fixup 2)
//
// Infernal Denizen (convex/cards/sets/ice/black.ts): "At the beginning of your
// upkeep, sacrifice two Swamps." — a `may-pay` sacrifice leg with
// `{ subtypes: "Swamp", controllerRelation: "you" }` (Minion of Leshrac's
// creature-sacrifice leg is the same shape). Fixup 1's `toMatchablePermanent`
// adapter called the engine matcher with NO `FilterMatchContext`, so
// `controllerRelation` always failed closed — a 2-Swamp battlefield counted 0
// candidates and the Pay button was permanently disabled on a legal
// sacrifice, even though fixup 1 shipped to fix exactly this class of bug.
// ---------------------------------------------------------------------------

describe("mayPaySacrificeCount / mayPaySacrificePower — Infernal Denizen's controllerRelation leg (issue #1938 fixup 2)", () => {
    const infernalDenizenCost: MayPayCost = {
        permanent: {
            action: "sacrifice",
            filter: { subtypes: "Swamp", controllerRelation: "you" },
            count: 2,
        },
    };

    it("counts the controller's own Swamps once a FilterMatchContext is threaded", () => {
        const bf = [
            makeCardInstance({
                id: "s1",
                controllerId: "p1",
                types: ["Land"],
                subtypes: ["Swamp"],
            }),
            makeCardInstance({
                id: "s2",
                controllerId: "p1",
                types: ["Land"],
                subtypes: ["Swamp"],
            }),
            // An opponent's Swamp must NOT count toward "Swamps YOU control".
            makeCardInstance({
                id: "s3-opp",
                controllerId: "p2",
                types: ["Land"],
                subtypes: ["Swamp"],
            }),
        ];
        expect(
            mayPaySacrificeCount(infernalDenizenCost, bf, {
                selfControllerId: "p1",
            })
        ).toBe(2);
    });

    it("REGRESSION: undercounts to 0 with no ctx — the exact shape that disabled the Pay button", () => {
        const bf = [
            makeCardInstance({
                id: "s1",
                controllerId: "p1",
                types: ["Land"],
                subtypes: ["Swamp"],
            }),
            makeCardInstance({
                id: "s2",
                controllerId: "p1",
                types: ["Land"],
                subtypes: ["Swamp"],
            }),
        ];
        // No ctx argument at all — `matchesControllerRelation` fails closed.
        expect(mayPaySacrificeCount(infernalDenizenCost, bf)).toBe(0);
    });

    it("mayPaySacrificePower threads the same ctx (Phyrexian Dreadnought-style threshold legs)", () => {
        const bf = [
            makeCardInstance({
                id: "s1",
                controllerId: "p1",
                card: { id: forest.id },
                types: ["Land"],
                subtypes: ["Swamp"],
                power: 0,
            }),
        ];
        // forest.id has no power on its definition — 0 is fine, this just
        // proves the ctx-threaded call doesn't throw and still filters by
        // controller. Count-based affordability is covered above; this
        // asserts the SAME regression shape for the power-summing sibling.
        expect(
            mayPaySacrificePower(infernalDenizenCost, bf, {
                selfControllerId: "p1",
            })
        ).toBe(0);
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

// CR 509.1b / 702.14 — client-side block-eligibility view must agree with the
// server: a landwalk-negation static (Great Wall / Undertow) suppresses the
// matching landwalk so the creature is no longer treated as unblockable.
describe("isLandwalkUnblockable (landwalk-negation parity, CR 509.1b / 702.14)", () => {
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

    // CR 702.14 — supertype-keyed landwalk ("legendary landwalk", Livonya
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

    // PR #1963 review round 2 — the UI's Pay gate was a THIRD unfixed consumer
    // of the may-pay hand leg (after the client Brain and the bot view):
    // `mayPayCanAfford` compared the chooser's HAND SIZE against the summed
    // requirement count, and `mayPayDiscardPickSatisfied` checked only the size
    // of the click buffer. Both ignore the per-requirement filters ADR 0079 /
    // #1933 made representable, so Pay enabled on picks the server rejects.
    // Both now run the engine's ONE hand-leg assignment authority.
    describe("may-pay FILTERED hand leg — UI Pay gate (CR 701.9 / 118.9, PR #1963)", () => {
        // Grizzly Bears (LEA) — a vanilla Creature; Ancestral Recall (LEA) — an
        // Instant. Real registry ids: the filter matcher resolves the card
        // DEFINITION, so a synthetic id would fail closed and prove nothing.
        const BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870";
        const RECALL = "70e7ddf2-5604-41e7-bb9d-ddd03d3e9d0b";
        const handCard = (id: string, defId: string) =>
            makeCardInstance({ id, card: { id: defId }, zone: "hand" });

        const DISCARD_A_CREATURE = {
            hand: {
                action: "discard" as const,
                requirements: [
                    { filter: { type: "Creature" as const }, count: 1 },
                ],
            },
        };
        /** Restrictive FIRST, per the `CostLegs.hand` authoring constraint. */
        const DISCARD_A_CREATURE_AND_ANOTHER = {
            hand: {
                action: "discard" as const,
                requirements: [
                    { filter: { type: "Creature" as const }, count: 1 },
                    { filter: {}, count: 1 },
                ],
            },
        };

        it("mayPayCanAfford gates the hand leg per REQUIREMENT, not on hand size", () => {
            const withCreature = [
                handCard("r1", RECALL),
                handCard("b1", BEARS),
            ];
            const noCreature = [
                handCard("r1", RECALL),
                handCard("r2", RECALL),
                handCard("r3", RECALL),
            ];
            expect(
                mayPayCanAfford(
                    DISCARD_A_CREATURE,
                    {},
                    20,
                    0,
                    undefined,
                    undefined,
                    withCreature
                )
            ).toBe(true);
            // Three cards for a one-card leg — the summed-count gate this
            // replaced said affordable and the server then threw.
            expect(
                mayPayCanAfford(
                    DISCARD_A_CREATURE,
                    {},
                    20,
                    0,
                    undefined,
                    undefined,
                    noCreature
                )
            ).toBe(false);
            // Two-requirement leg: enough cards, but no creature.
            expect(
                mayPayCanAfford(
                    DISCARD_A_CREATURE_AND_ANOTHER,
                    {},
                    20,
                    0,
                    undefined,
                    undefined,
                    noCreature
                )
            ).toBe(false);
            expect(
                mayPayCanAfford(
                    DISCARD_A_CREATURE_AND_ANOTHER,
                    {},
                    20,
                    0,
                    undefined,
                    undefined,
                    withCreature
                )
            ).toBe(true);
        });

        it("mayPayDiscardPickSatisfied enforces the per-requirement cover, not just the count", () => {
            const hand = [handCard("r1", RECALL), handCard("b1", BEARS)];
            // Trivially satisfied with no hand leg.
            expect(mayPayDiscardPickSatisfied(undefined, [], hand)).toBe(true);
            // Count-correct but the creature requirement is uncovered — the
            // exact shape the count-only check used to enable Pay on.
            expect(
                mayPayDiscardPickSatisfied(DISCARD_A_CREATURE, ["r1"], hand)
            ).toBe(false);
            expect(
                mayPayDiscardPickSatisfied(DISCARD_A_CREATURE, ["b1"], hand)
            ).toBe(true);
            // Wrong count is still rejected.
            expect(
                mayPayDiscardPickSatisfied(
                    DISCARD_A_CREATURE,
                    ["b1", "r1"],
                    hand
                )
            ).toBe(false);
            // Duplicates never satisfy a leg needing DISTINCT cards.
            expect(
                mayPayDiscardPickSatisfied(
                    DISCARD_A_CREATURE_AND_ANOTHER,
                    ["b1", "b1"],
                    hand
                )
            ).toBe(false);
            // Both click orders satisfy the restrictive-first leg.
            for (const ids of [
                ["b1", "r1"],
                ["r1", "b1"],
            ]) {
                expect(
                    mayPayDiscardPickSatisfied(
                        DISCARD_A_CREATURE_AND_ANOTHER,
                        ids,
                        hand
                    )
                ).toBe(true);
            }
        });
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

    it("mayPayRequiredSacrifices reads the sacrifice leg's count (CR 701.21a)", () => {
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

    // CR 702.29e/f (issue #1839) — a TYPECYCLING ability is a cycling ability,
    // so the same hand affordance must surface it. Both a permanent card
    // (Troll of Khazad-dûm) and a NONPERMANENT one (Lórien Revealed, a
    // sorcery) go through the real reducer: the hand-activation path must not
    // be gated on the card being castable-as-a-permanent.
    it.each([
        {
            what: "Troll of Khazad-dûm (Swampcycling {1})",
            cardId: "a6539e26-b63b-4725-9407-caaf451de084",
            types: ["Creature"],
        },
        {
            what: "Lórien Revealed (Islandcycling {1}, a sorcery)",
            cardId: "0ce44270-a684-4489-9077-521456e6dfaa",
            types: ["Sorcery"],
        },
    ])("surfaces the typecycling ability for $what", ({ cardId, types }) => {
        const card = makeCardInstance({
            id: "typecycler-1",
            card: { id: cardId },
            types,
            ownerId: "p1",
            controllerId: "p1",
            zone: "hand",
        });
        const abilities = getHandStackAbilities(
            card,
            "PRECOMBAT_MAIN",
            viewFor(card)
        );
        // CR 702.29f — it is offered under the SAME ability id as plain
        // Cycling, and its printed reminder text reaches the menu.
        expect(abilities.map((a) => a.id)).toEqual(["cycling"]);
        expect(abilities[0].oracleText).toMatch(/cycling \{1\}/i);
        expect(abilities[0].oracleText).toMatch(/Search your library/);
        // CR 702.29b — instant speed, so a later phase offers it too.
        expect(
            getHandStackAbilities(card, "POSTCOMBAT_MAIN", viewFor(card)).map(
                (a) => a.id
            )
        ).toEqual(["cycling"]);
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

// ---------------------------------------------------------------------------
// Sorrow's Path — a `count: 2` targeting ability's affordability gate (issue
// #1951 review round 3, MINOR 8). `hasBattlefieldTargetCandidate` used to
// return true on the FIRST matching candidate, so a `count >= 2` ability
// (Sorrow's Path's "choose two target blocking creatures", General Jarkeld's
// swap, Garruk Wildspeaker's "+1: Untap two target lands") stayed offered
// with only ONE legal candidate — a dead menu entry, since
// `activateAbilityOnState` (`convex/game.ts`) now rejects that up front (the
// CR 601.2c distinct-targets fix from an earlier review round made the
// mismatch reachable). Driven through the REAL reducer
// (`buildTriggerStateView`), never a hand-built view.
// ---------------------------------------------------------------------------

describe("Sorrow's Path — count:2 targeting ability's affordability gate (CR 602.2b, issue #1951 review round 3)", () => {
    function sorrowsPathOnBoard(): CardInstance {
        return makeCardInstance({
            id: "path",
            card: { id: sorrowsPath.id },
            types: ["Land"],
            isTapped: false,
        });
    }
    function blocker(id: string): CardInstance {
        return makeCardInstance({
            id,
            card: { id: sorrowsPath.id },
            controllerId: "p2",
            types: ["Creature"],
            isBlocking: true,
        });
    }

    it("is HIDDEN with only ONE legal blocking creature (would dead-end mid-selection)", () => {
        const path = sorrowsPathOnBoard();
        const view = buildTriggerStateView([
            { id: "p1", life: 20, hand: [], battlefield: [path] },
            { id: "p2", life: 20, hand: [], battlefield: [blocker("blk1")] },
        ]);
        const ids = getStackAbilities(path, undefined, true, view).map(
            (a) => a.id
        );
        expect(ids).not.toContain("sorrows-path-swap-blockers");
    });

    it("is OFFERED with two legal blocking creatures", () => {
        const path = sorrowsPathOnBoard();
        const view = buildTriggerStateView([
            { id: "p1", life: 20, hand: [], battlefield: [path] },
            {
                id: "p2",
                life: 20,
                hand: [],
                battlefield: [blocker("blk1"), blocker("blk2")],
            },
        ]);
        const ids = getStackAbilities(path, undefined, true, view).map(
            (a) => a.id
        );
        expect(ids).toContain("sorrows-path-swap-blockers");
    });
});

// ---------------------------------------------------------------------------
// Board-derived restricted-colour mana abilities (CR 605.1a, issue #1941) —
// FRONTEND WIRING. A mana ability whose colour set the client view cannot
// derive is dead in the UI: no picker, or a picker whose indices disagree with
// the server's list. Every assertion here drives the REAL reducer
// (`projectPublicState`) and the REAL client helper (`getManaChoices` /
// `hasManaAbility`), never a hand-built view — a hand-built one would mask a
// dropped field, which is the exact bug class this file exists to catch.
// ---------------------------------------------------------------------------

describe("getManaChoices — board-derived colour sources through the wire reducer (issue #1941)", () => {
    /** Projects a real GameState and returns the wire-shaped picker inputs for
     *  the mana source: the slim source instance plus the slim per-player
     *  battlefields the board component passes to `getManaChoices`. */
    function projectManaScenario(
        sourceCardId: string,
        p1Battlefield: CardInstanceState[],
        p2Battlefield: CardInstanceState[] = []
    ) {
        const source = makeInstance(sourceCardId, {
            id: "mana-source-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makeServerPlayer("p1", {
                    battlefield: [source, ...p1Battlefield],
                }),
                makeServerPlayer("p2", { battlefield: p2Battlefield }),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const players = projected.players.map((p) => ({
            id: p.id,
            battlefield: p.battlefield as unknown as CardInstance[],
        }));
        const slimSource = players[0].battlefield.find(
            (c) => c.id === source.id
        )!;
        return {
            slimSource,
            players,
            view: buildTriggerStateView(
                projected.players as unknown as Player[]
            ),
        };
    }

    function basic(cardId: string, controllerId: string, id: string) {
        return makeInstance(cardId, {
            id,
            controllerId,
            ownerId: controllerId,
        });
    }

    it("Quirion Explorer: the picker offers exactly the opponent's land colours", () => {
        const { slimSource, players, view } = projectManaScenario(
            quirionExplorer.id,
            [basic(mountainCard.id, "p1", "own-mountain")],
            [
                basic(forestCard.id, "p2", "opp-forest"),
                basic(islandCard.id, "p2", "opp-island"),
            ]
        );
        // p1's own Mountain must not leak in — only p2's Forest + Island.
        expect(getManaChoices(slimSource, players)).toEqual([
            { U: 1 },
            { G: 1 },
        ]);
        expect(hasManaAbility(slimSource, view)).toBe(true);
    });

    it("Star Compass: the picker offers only the controller's BASIC land colours", () => {
        const { slimSource, players } = projectManaScenario(
            starCompass.id,
            [
                basic(swampCard.id, "p1", "own-swamp"),
                // Nonbasic: taps for three colours, contributes none.
                basic(crosissCatacombs.id, "p1", "own-lair"),
            ],
            [basic(mountainCard.id, "p2", "opp-mountain")]
        );
        expect(getManaChoices(slimSource, players)).toEqual([{ B: 1 }]);
    });

    it("Meteor Crater: the picker offers the COLOURS of the controller's permanents", () => {
        const { slimSource, players } = projectManaScenario(meteorCrater.id, [
            // A Forest taps for {G} but is colourless — it contributes nothing.
            basic(forestCard.id, "p1", "own-forest"),
            basic(crawWurm.id, "p1", "own-wurm"),
        ]);
        expect(getManaChoices(slimSource, players)).toEqual([{ G: 1 }]);
    });

    it("an EMPTY scope offers no picker at all — no false affordance", () => {
        const { slimSource, players } = projectManaScenario(
            quirionExplorer.id,
            [],
            []
        );
        // Null, not the static five-colour fallback: the board IS known here
        // and it genuinely contributes nothing.
        expect(getManaChoices(slimSource, players)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// PLS C4 — frontend wiring for the source-scoped prevention slice (#1955)
// ---------------------------------------------------------------------------
//
// A card correct in the GRE is routinely dead in the UI because a client view
// reducer drops a field the affordance reads. These drive the REAL reducers
// (`getStackAbilities`, `buildTriggerStateView`, `matchesTargetRequirement`,
// `wantsSpellTarget`) for every affordance the slice introduces.
describe("PLS C4 prevention slice — client affordances (#1955)", () => {
    it("Guard Dogs' {2}{W},{T} ability is offered in the tap menu (untapped, main phase)", () => {
        const card = makeCardInstance({
            card: { id: guardDogs.id },
            types: ["Creature"],
            subtypes: ["Dog"],
            isTapped: false,
        });
        const view = buildTriggerStateView([], undefined, undefined);
        expect(
            getStackAbilities(card, "PRECOMBAT_MAIN", true, view)
        ).toHaveLength(1);
        // A tap cost is unpayable while already tapped (CR 602.2a).
        const tapped = makeCardInstance({
            card: { id: guardDogs.id },
            types: ["Creature"],
            subtypes: ["Dog"],
            isTapped: true,
        });
        expect(
            getStackAbilities(tapped, "PRECOMBAT_MAIN", true, view)
        ).toHaveLength(0);
    });

    it("Radiant Kavu's mana-only ability is offered even while tapped", () => {
        const card = makeCardInstance({
            card: { id: radiantKavu.id },
            types: ["Creature"],
            subtypes: ["Kavu"],
            isTapped: true,
        });
        expect(
            getStackAbilities(
                card,
                "PRECOMBAT_MAIN",
                true,
                buildTriggerStateView([], undefined, undefined)
            )
        ).toHaveLength(1);
    });

    it("Rith's Charm mode 3 makes permanents clickable AND enables stack-spell selection", () => {
        const req = rithsCharm.modes?.[2].targetRequirement;
        const types = req?.type as string[];
        // Every permanent type in the requirement marks a battlefield card
        // clickable (CR 609.7 — the source may be any object).
        for (const t of ["Creature", "Artifact", "Enchantment", "Land"]) {
            const perm = makeCardInstance({ types: [t as never] });
            expect(matchesTargetRequirement(perm, types)).toBe(true);
        }
        // …and the "spell" member opens stack selection, so a burn spell on
        // the stack can be named as the source.
        expect(wantsSpellTarget(types)).toBe(true);
        expect(wantsPermanentTarget(types)).toBe(true);
    });

    it("Pollen Remedy declares a divided requirement, which drives the per-target stepper", () => {
        // `divideAsChosen` is what sets `PendingTarget.divideTotal`, the single
        // field the whole client divide UI (`useDivideTargets`,
        // `useDivideBuffer`, `DivideTargetList`) keys off. Kicked and unkicked
        // must both carry one, or the stepper never opens for that mode.
        expect(pollenRemedy.targetRequirement?.divideAsChosen?.total).toBe(3);
        expect(
            pollenRemedy.kickedTargetRequirement?.divideAsChosen?.total
        ).toBe(6);
        // "Any target" is what makes both players and permanents clickable.
        expect(wantsPermanentTarget(pollenRemedy.targetRequirement!.type)).toBe(
            true
        );
    });
});

// ---------------------------------------------------------------------------
// Norritt — the CR 602.2b "no legal target" tap-menu gate must judge
// `controlledSinceTurnStart` (issue #1824 review, finding 3).
//
// `hasBattlefieldTargetCandidate` judged only `type` + `controller` +
// `subtypeFilter` and failed OPEN on everything else. That was harmless until
// a filter shipped that can exclude EVERY candidate on an otherwise-populated
// board: Norritt's "the active player has controlled continuously since the
// beginning of the turn". On a board whose only active-player creature entered
// this turn, the gate offered the ability with zero legal targets and
// `activateAbilityOnState` (`convex/game.ts`) then threw "Not enough legal
// targets" — the dead menu entry this gate exists to prevent.
//
// Every assertion drives the REAL reducer (`buildTriggerStateView`), which is
// what pre-derives each permanent's `controlledSinceTurnStart` through the
// engine's own `hasControlledSinceTurnStart`. A hand-built view would supply
// the field directly and mask exactly the drop being guarded against.
// ---------------------------------------------------------------------------

describe("Norritt — force-attack ability's no-legal-target gate honours control continuity (CR 602.2b / 400.7, issue #1824)", () => {
    const FORCE_ATTACK = "norritt-force-attack";
    const TURN = 5;

    function norrittOnBoard(): CardInstance {
        return makeCardInstance({
            id: "norr",
            card: { id: norritt.id },
            controllerId: "p2",
            ownerId: "p2",
            types: ["Creature"],
            isTapped: false,
            isSummoningSick: false,
        });
    }
    function activeCreature(id: string, enteredOnTurn: number): CardInstance {
        return makeCardInstance({
            id,
            card: { id: crawWurm.id },
            controllerId: "p1",
            ownerId: "p1",
            types: ["Creature"],
            enteredOnTurn,
        });
    }
    /** The reducer-built view — `turnState` is what populates the per-permanent
     *  `controlledSinceTurnStart` the gate reads. */
    function view(
        candidates: CardInstance[],
        controlChangedThisTurn?: string[]
    ) {
        return buildTriggerStateView(
            [
                { id: "p1", life: 20, hand: [], battlefield: candidates },
                {
                    id: "p2",
                    life: 20,
                    hand: [],
                    battlefield: [norrittOnBoard()],
                },
            ],
            "p1",
            undefined,
            undefined,
            { turn: TURN, controlChangedThisTurn }
        );
    }
    const menu = (v: ReturnType<typeof view>) =>
        getStackAbilities(norrittOnBoard(), "PRECOMBAT_MAIN", true, v).map(
            (a) => a.id
        );

    it("is HIDDEN when the active player's only creature entered THIS turn (CR 400.7)", () => {
        expect(menu(view([activeCreature("fresh", TURN)]))).not.toContain(
            FORCE_ATTACK
        );
    });

    it("is HIDDEN when the active player's only creature changed hands this turn", () => {
        expect(
            menu(view([activeCreature("stolen", 1)], ["stolen"]))
        ).not.toContain(FORCE_ATTACK);
    });

    it("is OFFERED when the active player has held a creature since before the turn", () => {
        expect(menu(view([activeCreature("held", 1)]))).toContain(FORCE_ATTACK);
    });

    it("still FAILS OPEN when the reducer was given no turn state (never hides a legal ability)", () => {
        // No `turnState` → the reducer leaves `controlledSinceTurnStart`
        // undefined, and this conservative UI hint declines to judge rather
        // than hiding an ability the server would allow.
        const blindView = buildTriggerStateView(
            [
                {
                    id: "p1",
                    life: 20,
                    hand: [],
                    battlefield: [activeCreature("fresh", TURN)],
                },
                {
                    id: "p2",
                    life: 20,
                    hand: [],
                    battlefield: [norrittOnBoard()],
                },
            ],
            "p1"
        );
        expect(menu(blindView)).toContain(FORCE_ATTACK);
    });
});

// ---------------------------------------------------------------------------
// Fear of Missing Out — the attack trigger's announced target, client leg
// (issue #2885, CR 603.3d / 508.1m)
// ---------------------------------------------------------------------------

// The UI leg of the full-path walk GRE → game.ts → client. The GRE and wire
// legs live in `convex/cards/sets/dsk/__tests__/red.test.ts`; what only this
// project can prove is that the `PendingTarget` the trigger announcement
// raises survives `projectPublicState` carrying a `targetType` the board's
// clickability predicate (`matchesTargetRequirement`, read by
// `useBattlefieldInteraction` / `useBattlefieldVisualState`) understands. A
// dropped or reshaped `targetType` here is the classic silent failure: the
// server waits for a target the player can never click.
describe("Fear of Missing Out — attack-trigger target announcement reaches the client (issue #2885)", () => {
    const BEARS = getCardByName("Balduvian Bears").id;
    const MOUNTAIN = getCardByName("Mountain").id;
    const BOLT = getCardByName("Lightning Bolt").id;
    const WRATH = getCardByName("Wrath of God").id;

    it("projects a PendingTarget whose targetType marks creatures — and only creatures — clickable", () => {
        const fomo = makeInstance(fearOfMissingOut.id, {
            id: "fomo",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
            isTapped: true,
        });
        const victim = makeInstance(BEARS, {
            id: "victim",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const land = makeInstance(MOUNTAIN, {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Four distinct card types in the graveyard — delirium on.
        const graveyard = [MOUNTAIN, BEARS, BOLT, WRATH].map((cardId, i) =>
            makeInstance(cardId, {
                id: `gy${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            })
        );
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            players: [
                makeServerPlayer("p1", {
                    battlefield: [fomo, victim, land],
                    graveyard,
                }),
                makeServerPlayer("p2"),
            ],
            combat: {
                attackerIds: ["fomo"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });

        const triggers = collectTriggers(state, [
            {
                type: "ATTACKERS_DECLARED",
                attackingPlayerId: "p1",
                attackerIds: ["fomo"],
            },
        ]);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        expect(raiseTriggerTargetSelection(state)).toBe(true);

        const projected = projectPublicState(state, 1, "p1");
        const pending = projected.pendingTarget as unknown as PendingTarget;
        expect(pending).toBeDefined();
        expect(pending.targetType).toBe("Creature");

        const board = projected.players[0].battlefield as unknown as Parameters<
            typeof matchesTargetRequirement
        >[0][];
        const clickable = board
            .filter((c) => matchesTargetRequirement(c, pending.targetType))
            .map((c) => c.id)
            .sort();
        expect(clickable).toEqual(["fomo", "victim"]);
    });
});
