import { describe, it, expect, beforeAll } from "vitest";
import {
    getPlayer,
    resolveTopOfStack,
    type CardInstanceState,
    type PlayerState,
    type GameState,
    type StackItem,
} from "../state";
import {
    getLegalTargets,
    intrinsicPermanentTargetViolation,
    pendingTargetFiltersFromRequirement,
    getPendingTargetSourceSubtypes,
    getTriggerSourcePower,
    matchesBattlefieldController,
    spellMatchesCreaturePtFilter,
    spellMatchesExcludeTypeFilter,
    siblingControllerIdFor,
} from "../rules";
import { isGuardedAgainst, playerHasShroud } from "../permanentGuard";
import {
    checkPermanentTargetFilters,
    checkSpellTargetFilters,
    checkPlayerTargetFilters,
    checkCardTargetFilters,
    REGISTRY,
    type TargetFilterCtx,
} from "../targetFilters";
import type {
    CardDefinition,
    CardType,
    TargetRequirement,
} from "../../cards/types";
import {
    getDefinition,
    registerTokenDefinition,
    tryGetDefinition,
} from "../../cards";
import { projectPublicState } from "../../gameProjections";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// SLIM card builder. `card.card` always shrinks to `{ id }`, with an optional
// `manaCost` passthrough for synthetic fixtures that need color filtering.
// Runtime fields fall back to the registry def when `id` matches, else to
// the inline cardData fields, else to defaults.
function makeCard(
    overrides: Partial<CardInstanceState> & {
        card?: Record<string, unknown>;
    } = {}
): CardInstanceState {
    const cardRef = overrides.card as
        | {
              id?: string;
              manaCost?: unknown;
              types?: CardType[];
              subtypes?: string[];
              power?: number;
              toughness?: number;
              staticAbilities?: string[];
          }
        | undefined;
    const id = cardRef?.id ?? `synth-${crypto.randomUUID()}`;
    const def = tryGetDefinition(id);
    const cardField: { id: string; manaCost?: unknown } = { id };
    if (cardRef?.manaCost !== undefined) {
        cardField.manaCost = cardRef.manaCost;
    }
    return {
        id: overrides.id ?? crypto.randomUUID(),
        card: cardField,
        types: overrides.types ?? def?.types ?? cardRef?.types ?? [],
        subtypes:
            overrides.subtypes ?? def?.subtypes ?? cardRef?.subtypes ?? [],
        power: overrides.power ?? def?.power ?? cardRef?.power,
        toughness: overrides.toughness ?? def?.toughness ?? cardRef?.toughness,
        staticAbilities:
            overrides.staticAbilities ??
            def?.staticAbilities ??
            cardRef?.staticAbilities ??
            [],
        controllerId: overrides.controllerId ?? "p1",
        ownerId: overrides.ownerId ?? "p1",
        zone: overrides.zone ?? "battlefield",
        isTapped: overrides.isTapped ?? false,
        ...(overrides.counters ? { counters: overrides.counters } : {}),
        ...(overrides.isToken !== undefined
            ? { isToken: overrides.isToken }
            : {}),
    };
}

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
    return {
        id: "p1",
        name: "Player 1",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...overrides,
    };
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
    return {
        players: [makePlayer({ id: "p1" }), makePlayer({ id: "p2" })],
        stack: [],
        turn: 1,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        passCount: 0,
        phase: "PRECOMBAT_MAIN",
        rngSeed: 0,
        rngCounter: 0,
        ...overrides,
    };
}

// Card fixtures
const CREATURE = { id: "test-creature", name: "Bear", types: ["Creature"] };
const ARTIFACT = { id: "test-artifact", name: "Mox", types: ["Artifact"] };
const ENCHANTMENT = {
    id: "test-enchant",
    name: "Aura",
    types: ["Enchantment"],
};
const LAND = {
    name: "Island",
    types: ["Land"],
    subtypes: ["Island"],
    supertypes: ["Basic"],
};
const ARTIFACT_CREATURE = {
    id: "test-artcreat",
    name: "Golem",
    types: ["Artifact", "Creature"],
};

// ---------------------------------------------------------------------------
// getLegalTargets
// ---------------------------------------------------------------------------

describe("getLegalTargets", () => {
    it("finds creatures for Creature requirement", () => {
        const bear = makeCard({ id: "bear", card: CREATURE });
        const mox = makeCard({
            id: "mox",
            card: ARTIFACT,
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [bear] }),
                makePlayer({ id: "p2", battlefield: [mox] }),
            ],
        });

        const req: TargetRequirement = { type: "Creature", count: 1 };
        const targets = getLegalTargets(state, req);

        expect(targets).toHaveLength(1);
        expect(targets[0]).toEqual({ type: "permanent", id: "bear" });
    });

    it("finds artifacts and enchantments for Disenchant-style requirement", () => {
        const bear = makeCard({ id: "bear", card: CREATURE });
        const mox = makeCard({ id: "mox", card: ARTIFACT });
        const aura = makeCard({
            id: "aura",
            card: ENCHANTMENT,
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [bear, mox] }),
                makePlayer({ id: "p2", battlefield: [aura] }),
            ],
        });

        const req: TargetRequirement = {
            type: ["Artifact", "Enchantment"],
            count: 1,
        };
        const targets = getLegalTargets(state, req);

        expect(targets).toHaveLength(2);
        const ids = targets.map((t) => t.id);
        expect(ids).toContain("mox");
        expect(ids).toContain("aura");
        expect(ids).not.toContain("bear");
    });

    it("finds only creatures, planeswalkers, battles and players for 'any' requirement (CR 115.4)", () => {
        const bear = makeCard({ id: "bear", card: CREATURE });
        const mox = makeCard({
            id: "mox",
            card: ARTIFACT,
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeCard({
            id: "aura",
            card: ENCHANTMENT,
            controllerId: "p2",
            ownerId: "p2",
        });
        const island = makeCard({
            id: "island",
            card: LAND,
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [bear] }),
                makePlayer({ id: "p2", battlefield: [mox, aura, island] }),
            ],
        });

        const req: TargetRequirement = { type: "any", count: 1 };
        const targets = getLegalTargets(state, req);

        // Only the creature + 2 players — artifact, enchantment and land are excluded.
        expect(targets).toHaveLength(3);
        const ids = targets.map((t) => t.id);
        expect(ids).toContain("bear");
        expect(ids).toContain("p1");
        expect(ids).toContain("p2");
        expect(ids).not.toContain("mox");
        expect(ids).not.toContain("aura");
        expect(ids).not.toContain("island");
    });

    it("includes players for 'player' requirement", () => {
        const state = makeGameState();
        const req: TargetRequirement = { type: "player", count: 1 };
        const targets = getLegalTargets(state, req);

        expect(targets).toHaveLength(2);
        expect(targets.every((t) => t.type === "player")).toBe(true);
    });

    it("controller:'opponent' restricts a player target to the opponent (CR 115.1, Word of Command)", () => {
        const state = makeGameState();
        const req: TargetRequirement = {
            type: "player",
            count: 1,
            controller: "opponent",
        };
        // From p1's perspective the only legal player target is p2.
        const targets = getLegalTargets(state, req, [], "p1");
        expect(targets).toEqual([{ type: "player", id: "p2" }]);
    });

    it("controller:'you' restricts a player target to the caster", () => {
        const state = makeGameState();
        const req: TargetRequirement = {
            type: "player",
            count: 1,
            controller: "you",
        };
        const targets = getLegalTargets(state, req, [], "p1");
        expect(targets).toEqual([{ type: "player", id: "p1" }]);
    });

    it("playerAttackedThisTurn filters players to those who attacked (CR 506.2)", () => {
        // p2 controls a creature flagged as having attacked; p1 controls none.
        const attacker = makeCard({
            id: "atk",
            card: CREATURE,
            controllerId: "p2",
            ownerId: "p2",
        });
        attacker.hasAttackedThisTurn = true;
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1" }),
                makePlayer({ id: "p2", battlefield: [attacker] }),
            ],
        });
        const req: TargetRequirement = {
            type: "player",
            count: 1,
            playerAttackedThisTurn: true,
        };
        const targets = getLegalTargets(state, req);
        expect(targets).toEqual([{ type: "player", id: "p2" }]);
    });

    it("artifact creature matches both Artifact and Creature requirements", () => {
        const golem = makeCard({ id: "golem", card: ARTIFACT_CREATURE });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [golem] }),
                makePlayer({ id: "p2" }),
            ],
        });

        const creatureReq: TargetRequirement = { type: "Creature", count: 1 };
        const artifactReq: TargetRequirement = { type: "Artifact", count: 1 };
        const disenchantReq: TargetRequirement = {
            type: ["Artifact", "Enchantment"],
            count: 1,
        };

        expect(getLegalTargets(state, creatureReq)).toHaveLength(1);
        expect(getLegalTargets(state, artifactReq)).toHaveLength(1);
        expect(getLegalTargets(state, disenchantReq)).toHaveLength(1);
    });

    it("returns empty when no matching permanents exist", () => {
        const bear = makeCard({ id: "bear", card: CREATURE });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [bear] }),
                makePlayer({ id: "p2" }),
            ],
        });

        const req: TargetRequirement = {
            type: ["Artifact", "Enchantment"],
            count: 1,
        };
        expect(getLegalTargets(state, req)).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Permanent-controller filter (CR 109.3 / 102.1, #904).
//
// `matchesBattlefieldController` is the single authority both `getLegalTargets`
// (offered set) and the `selectTarget` mutation's permanent branch (accepted
// set — the authoritative anti-spoof gate) route through. The project has no
// convex-test harness (ADR 0001), so these tests drive that shared predicate
// directly: it is the exact decision the mutation makes, so exercising it is
// equivalent to exercising the mutation's controller rejection. A negative
// (server rejects a wrong-controller permanent) + positive (accepts the right
// one) is asserted per controller value.
// ---------------------------------------------------------------------------

describe("permanent-controller filter — selectTarget authority (CR 109.3 / 102.1, #904)", () => {
    // chooser = p1, active player = p1, opponent = p2.
    const ACTIVE = "p1";

    describe("controller: 'you' (Simulacrum)", () => {
        it("accepts a permanent the chooser controls", () => {
            expect(
                matchesBattlefieldController("p1", "p1", ACTIVE, "you")
            ).toBe(true);
        });
        it("rejects an opponent's permanent (spoof)", () => {
            expect(
                matchesBattlefieldController("p2", "p1", ACTIVE, "you")
            ).toBe(false);
        });
    });

    describe("controller: 'opponent' (Nettling Imp)", () => {
        it("accepts an opponent's permanent", () => {
            expect(
                matchesBattlefieldController("p2", "p1", ACTIVE, "opponent")
            ).toBe(true);
        });
        it("rejects a permanent the chooser controls (spoof)", () => {
            expect(
                matchesBattlefieldController("p1", "p1", ACTIVE, "opponent")
            ).toBe(false);
        });
        it("rejects when the chooser is unknown (can never be an opponent)", () => {
            expect(
                matchesBattlefieldController(
                    "p2",
                    undefined,
                    ACTIVE,
                    "opponent"
                )
            ).toBe(false);
        });
    });

    describe("controller: 'active' (Arcum's Whistle)", () => {
        it("accepts a permanent the active player controls", () => {
            // Chooser is the non-active player p2; the active player is p1.
            expect(
                matchesBattlefieldController("p1", "p2", ACTIVE, "active")
            ).toBe(true);
        });
        it("rejects a permanent the non-active player controls (spoof)", () => {
            expect(
                matchesBattlefieldController("p2", "p2", ACTIVE, "active")
            ).toBe(false);
        });
    });

    describe("controller: 'any' / undefined", () => {
        it("accepts any controller", () => {
            expect(
                matchesBattlefieldController("p1", "p2", ACTIVE, "any")
            ).toBe(true);
            expect(
                matchesBattlefieldController("p2", "p1", ACTIVE, undefined)
            ).toBe(true);
        });
    });

    // getLegalTargets integration: the offered set honors the same filter, so
    // the client is never shown an illegal target either.
    describe("getLegalTargets honors the controller filter", () => {
        const OWN = makeCard({ id: "own", card: CREATURE, controllerId: "p1" });
        const THEIRS = makeCard({
            id: "theirs",
            card: CREATURE,
            controllerId: "p2",
        });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [OWN] }),
                makePlayer({ id: "p2", battlefield: [THEIRS] }),
            ],
        });

        it("'you' offers only the caster's creature", () => {
            const req: TargetRequirement = {
                type: "Creature",
                count: 1,
                controller: "you",
            };
            const ids = getLegalTargets(state, req, [], "p1").map((t) => t.id);
            expect(ids).toEqual(["own"]);
        });
        it("'opponent' offers only the opponent's creature", () => {
            const req: TargetRequirement = {
                type: "Creature",
                count: 1,
                controller: "opponent",
            };
            const ids = getLegalTargets(state, req, [], "p1").map((t) => t.id);
            expect(ids).toEqual(["theirs"]);
        });
        it("'active' offers only the active player's creature (chooser p2)", () => {
            const req: TargetRequirement = {
                type: "Creature",
                count: 1,
                controller: "active",
            };
            const ids = getLegalTargets(state, req, [], "p2").map((t) => t.id);
            expect(ids).toEqual(["own"]); // p1 is active
        });
    });
});

// ---------------------------------------------------------------------------
// Target exclusion filters — excludeTypes ("nonland permanent") and
// excludeInstanceIds (reflexive self / "other than ~"). Phelia, Exuberant
// Shepherd: "exile up to one OTHER target nonland permanent". These narrow the
// OFFERED set here; the accepted set (`selectTarget`, game.ts) mirrors the same
// `pt.excludeTypes` / `pt.excludeInstanceIds` gates, and the raised
// PendingTarget carries both (pendingTargetFiltersFromRequirement) so the two
// can't diverge. Regression: the filters were dropped from the interactive
// PendingTarget, letting Phelia exile herself / a land (CR 109.1 / 601.2c).
// ---------------------------------------------------------------------------

describe("target exclusion filters (CR 109.1 / 601.2c, Phelia)", () => {
    const PHELIA = makeCard({
        id: "phelia",
        types: ["Creature"],
        controllerId: "p1",
    });
    const LAND_PERM = makeCard({
        id: "land",
        types: ["Land"],
        controllerId: "p1",
    });
    const OTHER = makeCard({
        id: "other",
        types: ["Creature"],
        controllerId: "p2",
    });
    const state = makeGameState({
        players: [
            makePlayer({ id: "p1", battlefield: [PHELIA, LAND_PERM] }),
            makePlayer({ id: "p2", battlefield: [OTHER] }),
        ],
    });

    it("excludeTypes: 'Land' drops the land from the offered set (nonland permanent)", () => {
        const req: TargetRequirement = {
            type: ["Creature", "Land"],
            count: { min: 0, max: 1 },
            excludeTypes: "Land",
        };
        const ids = getLegalTargets(state, req, [], "p1").map((t) => t.id);
        expect(ids).not.toContain("land");
        expect(ids).toEqual(expect.arrayContaining(["phelia", "other"]));
    });

    it("excludeInstanceIds drops the named permanent (reflexive self / 'other')", () => {
        const req: TargetRequirement = {
            type: ["Creature", "Land"],
            count: { min: 0, max: 1 },
            excludeInstanceIds: ["phelia"],
        };
        const ids = getLegalTargets(state, req, [], "p1").map((t) => t.id);
        expect(ids).not.toContain("phelia");
    });

    it("both together = 'up to one other nonland permanent' (Phelia): only the opponent's creature", () => {
        const req: TargetRequirement = {
            type: ["Creature", "Land"],
            count: { min: 0, max: 1 },
            excludeTypes: "Land",
            excludeInstanceIds: ["phelia"],
        };
        const ids = getLegalTargets(state, req, [], "p1").map((t) => t.id);
        expect(ids).toEqual(["other"]);
    });
});

// ---------------------------------------------------------------------------
// Token-ness filter (CR 111.5, issue #1195) — Satya, Aetherflux Genius / Dance
// of Many: "target NONTOKEN creature". `isToken: false` keeps only nontoken
// permanents; `isToken: true` (the inverse, unused by any shipped card yet)
// keeps only tokens. Closes the DIVERGENCE Dance of Many's ETB has documented
// since #1459 ("TargetRequirement has no token filter field").
// ---------------------------------------------------------------------------

describe("isToken target filter (CR 111.5, issue #1195)", () => {
    const NONTOKEN = makeCard({
        id: "nontoken-creature",
        types: ["Creature"],
        controllerId: "p1",
    });
    const TOKEN = makeCard({
        id: "token-creature",
        types: ["Creature"],
        controllerId: "p1",
        isToken: true,
    });
    const state = makeGameState({
        players: [
            makePlayer({ id: "p1", battlefield: [NONTOKEN, TOKEN] }),
            makePlayer({ id: "p2" }),
        ],
    });

    it("isToken: false — offered set excludes the token creature", () => {
        const req: TargetRequirement = {
            type: "Creature",
            count: 1,
            isToken: false,
        };
        const ids = getLegalTargets(state, req, [], "p1").map((t) => t.id);
        expect(ids).toEqual(["nontoken-creature"]);
    });

    it("isToken: true — offered set keeps ONLY the token creature", () => {
        const req: TargetRequirement = {
            type: "Creature",
            count: 1,
            isToken: true,
        };
        const ids = getLegalTargets(state, req, [], "p1").map((t) => t.id);
        expect(ids).toEqual(["token-creature"]);
    });

    it("omitted — both are legal (no filter applied)", () => {
        const req: TargetRequirement = { type: "Creature", count: 2 };
        const ids = getLegalTargets(state, req, [], "p1").map((t) => t.id);
        expect(ids).toEqual(
            expect.arrayContaining(["nontoken-creature", "token-creature"])
        );
    });

    it("intrinsicPermanentTargetViolation: rejects a token for isToken:false, allows a nontoken permanent", () => {
        expect(
            intrinsicPermanentTargetViolation(state, TOKEN, {
                isToken: false,
            })
        ).not.toBeNull();
        expect(
            intrinsicPermanentTargetViolation(state, NONTOKEN, {
                isToken: false,
            })
        ).toBeNull();
    });

    it("the raised PendingTarget carries isToken (offered/accepted parity, ADR 0068)", () => {
        const req: TargetRequirement = {
            type: "Creature",
            count: { min: 0, max: 1 },
            isToken: false,
        };
        const pt = pendingTargetFiltersFromRequirement(req, undefined);
        expect(pt.isToken).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Single-authority intrinsic filter gate (Phelia bug class, CR 109.1 / 115 /
// 202 / 205 / 613 / 701.20). `intrinsicPermanentTargetViolation` is the ONE
// function both getLegalTargets (offered set) and selectTarget (accepted set)
// run per permanent, so offered == accepted by construction. These guard the
// five filters that were previously honored ONLY by getLegalTargets and
// silently dropped by the interactive PendingTarget + selectTarget (like
// Phelia's excludeTypes/excludeInstanceIds), plus a carry-completeness guard
// that fails if a filter is added to the shared gate but not propagated onto
// the PendingTarget by pendingTargetFiltersFromRequirement.
// ---------------------------------------------------------------------------

describe("intrinsicPermanentTargetViolation — shared offered/accepted gate", () => {
    const st = makeGameState();

    it("tappedFilter: rejects an untapped permanent for 'target tapped ~', allows a tapped one", () => {
        const untapped = makeCard({ types: ["Creature"], isTapped: false });
        const tapped = makeCard({ types: ["Creature"], isTapped: true });
        expect(
            intrinsicPermanentTargetViolation(st, untapped, {
                tappedFilter: "tapped",
            })
        ).not.toBeNull();
        expect(
            intrinsicPermanentTargetViolation(st, tapped, {
                tappedFilter: "tapped",
            })
        ).toBeNull();
    });

    it("combatRoleFilter: rejects a non-attacking creature for 'target attacking ~'", () => {
        const idle = makeCard({ types: ["Creature"] });
        const attacking = makeCard({ types: ["Creature"] });
        attacking.isAttacking = true;
        expect(
            intrinsicPermanentTargetViolation(st, idle, {
                combatRoleFilter: "attacking",
            })
        ).not.toBeNull();
        expect(
            intrinsicPermanentTargetViolation(st, attacking, {
                combatRoleFilter: "attacking",
            })
        ).toBeNull();
    });

    it("requireAbility: rejects a creature without the keyword, allows one with it", () => {
        const noFly = makeCard({ types: ["Creature"], staticAbilities: [] });
        const flyer = makeCard({
            types: ["Creature"],
            staticAbilities: ["flying"],
        });
        expect(
            intrinsicPermanentTargetViolation(st, noFly, {
                requireAbility: "flying",
            })
        ).not.toBeNull();
        expect(
            intrinsicPermanentTargetViolation(st, flyer, {
                requireAbility: "flying",
            })
        ).toBeNull();
    });

    it("requireAbilityAny: accepts a creature with EITHER keyword, rejects one with neither (CR 702 OR semantics)", () => {
        // "target creature with trample or haste" (Minsc & Boo) — a
        // DISJUNCTION the single-keyword `requireAbility` cannot express.
        const trampler = makeCard({
            types: ["Creature"],
            staticAbilities: ["trample"],
        });
        const hasty = makeCard({
            types: ["Creature"],
            staticAbilities: ["haste"],
        });
        const vanilla = makeCard({ types: ["Creature"], staticAbilities: [] });
        const req = { requireAbilityAny: ["trample", "haste"] };
        expect(intrinsicPermanentTargetViolation(st, trampler, req)).toBeNull();
        expect(intrinsicPermanentTargetViolation(st, hasty, req)).toBeNull();
        expect(
            intrinsicPermanentTargetViolation(st, vanilla, req)
        ).not.toBeNull();
    });

    it("requireAbilityAny is carried across the async target choice (pendingTargetFiltersFromRequirement)", () => {
        // The Phelia bug class: a filter honored by `getLegalTargets` but
        // dropped on the way to `selectTarget` lets the server accept an
        // illegal target. Both read it from the carry below.
        const pt = pendingTargetFiltersFromRequirement(
            {
                type: "Creature",
                count: { min: 0, max: 1 },
                requireAbilityAny: ["trample", "haste"],
            },
            undefined
        );
        expect(pt.requireAbilityAny).toEqual(["trample", "haste"]);
    });

    it("excludeAbility: rejects a creature WITH the keyword ('without flying')", () => {
        const flyer = makeCard({
            types: ["Creature"],
            staticAbilities: ["flying"],
        });
        const grounded = makeCard({ types: ["Creature"], staticAbilities: [] });
        expect(
            intrinsicPermanentTargetViolation(st, flyer, {
                excludeAbility: "flying",
            })
        ).not.toBeNull();
        expect(
            intrinsicPermanentTargetViolation(st, grounded, {
                excludeAbility: "flying",
            })
        ).toBeNull();
    });

    it("excludeColors: rejects a black creature for 'nonblack' (Terror)", () => {
        const black = makeCard({
            types: ["Creature"],
            card: { id: "b", manaCost: { B: 1 } },
        });
        const white = makeCard({
            types: ["Creature"],
            card: { id: "w", manaCost: { W: 1 } },
        });
        expect(
            intrinsicPermanentTargetViolation(st, black, {
                excludeColors: ["B"],
            })
        ).not.toBeNull();
        expect(
            intrinsicPermanentTargetViolation(st, white, {
                excludeColors: ["B"],
            })
        ).toBeNull();
    });

    // Carry-completeness anti-drift guard: a requirement that sets every
    // intrinsic filter must round-trip ALL of them onto the PendingTarget via
    // pendingTargetFiltersFromRequirement. If a new filter is added to the
    // shared gate but not propagated here, the interactive choice silently
    // loses it (the exact Phelia regression) — this fails the moment that
    // happens.
    it("pendingTargetFiltersFromRequirement carries every intrinsic filter onto the PendingTarget", () => {
        const req: TargetRequirement = {
            type: "Creature",
            count: 1,
            subtypeFilter: "Goblin",
            supertypeFilter: "Legendary",
            excludeSubtypes: "Wall",
            excludeSupertypes: "Basic",
            excludeTypes: "Land",
            excludeColors: "B",
            colorFilter: "R",
            colorFilterAny: ["R", "G"],
            tappedFilter: "tapped",
            combatRoleFilter: "attacking",
            requireAbility: "flying",
            excludeAbility: "defender",
            excludeInstanceIds: ["x"],
            powerFilter: { min: 2 },
            toughnessFilter: { max: 4 },
            mvFilter: { equals: 3 },
        };
        const pt = pendingTargetFiltersFromRequirement(req, undefined);
        expect(pt.subtypeFilter).toEqual(["Goblin"]);
        expect(pt.supertypeFilter).toEqual(["Legendary"]);
        expect(pt.excludeSubtypes).toEqual(["Wall"]);
        expect(pt.excludeSupertypes).toEqual(["Basic"]);
        expect(pt.excludeTypes).toEqual(["Land"]);
        expect(pt.excludeColors).toEqual(["B"]);
        expect(pt.colorFilter).toBe("R");
        expect(pt.colorFilterAny).toEqual(["R", "G"]);
        expect(pt.tappedFilter).toBe("tapped");
        expect(pt.combatRoleFilter).toBe("attacking");
        expect(pt.requireAbility).toBe("flying");
        expect(pt.excludeAbility).toBe("defender");
        expect(pt.excludeInstanceIds).toEqual(["x"]);
        expect(pt.powerFilter).toEqual({ min: 2 });
        expect(pt.toughnessFilter).toEqual({ max: 4 });
        expect(pt.mvFilter).toEqual({ equals: 3 });
    });

    // getLegalTargets end-to-end: the offered set runs the SAME shared gate,
    // so a tapped/combat-role filter narrows it identically.
    it("getLegalTargets offered set honors the shared gate (tapped + attacking)", () => {
        const tapped = makeCard({
            id: "tap",
            types: ["Creature"],
            isTapped: true,
            controllerId: "p1",
        });
        const untapped = makeCard({
            id: "untap",
            types: ["Creature"],
            controllerId: "p1",
        });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [tapped, untapped] }),
                makePlayer({ id: "p2" }),
            ],
        });
        const req: TargetRequirement = {
            type: "Creature",
            count: 1,
            tappedFilter: "tapped",
        };
        const ids = getLegalTargets(state, req, [], "p1").map((t) => t.id);
        expect(ids).toEqual(["tap"]);
    });
});

// ---------------------------------------------------------------------------
// Target-filter registry (ADR 0068, PRD #1407, issue #1408 — slice T1).
// `checkPermanentTargetFilters` is the registry's runner: it drives EVERY
// permanent-kind `FilterDescriptor.check` — the same function `getLegalTargets`
// and `selectTarget` (game.ts) both call, so this IS the "shared offered/
// accepted gate" seam, just entered through the registry instead of the old
// `intrinsicPermanentTargetViolation` name. One passing + one excluded
// candidate per filter (PRD "Testing Decisions" — a new filter earns one such
// test; reuse rides free). `controller` is new to this slice (folded in from
// `matchesBattlefieldController`, previously validated only inline at each
// call site) — not tested via `intrinsicPermanentTargetViolation`, which never
// took it, so it gets full coverage here instead.
// ---------------------------------------------------------------------------

describe("target-filter registry — checkPermanentTargetFilters (ADR 0068, #1408)", () => {
    const baseCtx = (
        overrides: Partial<TargetFilterCtx> = {}
    ): TargetFilterCtx => ({
        state: makeGameState(),
        sourceColors: [],
        sourceTypes: [],
        sourceSubtypes: [],
        activePlayerId: "p1",
        ...overrides,
    });

    it("controller: 'you' accepts the chooser's own permanent, rejects an opponent's", () => {
        const mine = makeCard({ controllerId: "p1" });
        const theirs = makeCard({ controllerId: "p2" });
        const ctx = baseCtx({ chooserId: "p1" });
        expect(
            checkPermanentTargetFilters(ctx, mine, { controller: "you" })
        ).toBeNull();
        expect(
            checkPermanentTargetFilters(ctx, theirs, { controller: "you" })
        ).toBe("Must target a permanent you control");
    });

    it("controller: 'opponent' accepts an opponent's permanent, rejects the chooser's own", () => {
        const mine = makeCard({ controllerId: "p1" });
        const theirs = makeCard({ controllerId: "p2" });
        const ctx = baseCtx({ chooserId: "p1" });
        expect(
            checkPermanentTargetFilters(ctx, theirs, { controller: "opponent" })
        ).toBeNull();
        expect(
            checkPermanentTargetFilters(ctx, mine, { controller: "opponent" })
        ).toBe("Must target a permanent an opponent controls");
    });

    it("controller: 'active' accepts the active player's permanent regardless of chooser", () => {
        const activePlayers = makeCard({ controllerId: "p1" });
        const otherPlayer = makeCard({ controllerId: "p2" });
        const ctx = baseCtx({ chooserId: "p2", activePlayerId: "p1" });
        expect(
            checkPermanentTargetFilters(ctx, activePlayers, {
                controller: "active",
            })
        ).toBeNull();
        expect(
            checkPermanentTargetFilters(ctx, otherPlayer, {
                controller: "active",
            })
        ).toBe("Must target a permanent the active player controls");
    });

    it("subtypeFilter: accepts a matching subtype, rejects a non-matching one", () => {
        const goblin = makeCard({ types: ["Creature"], subtypes: ["Goblin"] });
        const elf = makeCard({ types: ["Creature"], subtypes: ["Elf"] });
        const ctx = baseCtx();
        expect(
            checkPermanentTargetFilters(ctx, goblin, {
                subtypeFilter: ["Goblin"],
            })
        ).toBeNull();
        expect(
            checkPermanentTargetFilters(ctx, elf, { subtypeFilter: ["Goblin"] })
        ).toBe("Target must be Goblin");
    });

    it("supertypeFilter: accepts a permanent with ALL listed live supertypes, rejects one missing any", () => {
        // `hasSupertypeLive` reads the EMBEDDED `card.card.supertypes` (token/
        // copy shape), not a top-level CardInstanceState field — set it there
        // directly rather than through `makeCard`'s stripped-down cardRef.
        const legendary = {
            ...makeCard({ types: ["Creature"] }),
            card: { id: "sup-legend", supertypes: ["Legendary"] },
        };
        const nonLegendary = makeCard({ types: ["Creature"] });
        const ctx = baseCtx();
        expect(
            checkPermanentTargetFilters(ctx, legendary, {
                supertypeFilter: ["Legendary"],
            })
        ).toBeNull();
        expect(
            checkPermanentTargetFilters(ctx, nonLegendary, {
                supertypeFilter: ["Legendary"],
            })
        ).toBe("Target must be Legendary");
    });

    it("excludeSubtypes: rejects a permanent with an excluded subtype, allows one without it", () => {
        const wall = makeCard({ types: ["Creature"], subtypes: ["Wall"] });
        const goblin = makeCard({ types: ["Creature"], subtypes: ["Goblin"] });
        const ctx = baseCtx();
        expect(
            checkPermanentTargetFilters(ctx, wall, {
                excludeSubtypes: ["Wall"],
            })
        ).toBe("Target must not be Wall");
        expect(
            checkPermanentTargetFilters(ctx, goblin, {
                excludeSubtypes: ["Wall"],
            })
        ).toBeNull();
    });

    it("excludeSupertypes: rejects a basic land, allows a nonbasic one (Wasteland)", () => {
        const basic = {
            ...makeCard({ types: ["Land"] }),
            card: { id: "sup-basic", supertypes: ["Basic"] },
        };
        const nonbasic = makeCard({ types: ["Land"] });
        const ctx = baseCtx();
        expect(
            checkPermanentTargetFilters(ctx, basic, {
                excludeSupertypes: ["Basic"],
            })
        ).toBe("Target must not be Basic");
        expect(
            checkPermanentTargetFilters(ctx, nonbasic, {
                excludeSupertypes: ["Basic"],
            })
        ).toBeNull();
    });

    it("colorFilter: accepts a permanent of the given color, rejects one that isn't", () => {
        const red = makeCard({
            types: ["Creature"],
            card: { id: "cf-r", manaCost: { R: 1 } },
        });
        const white = makeCard({
            types: ["Creature"],
            card: { id: "cf-w", manaCost: { W: 1 } },
        });
        const ctx = baseCtx();
        expect(
            checkPermanentTargetFilters(ctx, red, { colorFilter: "R" })
        ).toBeNull();
        expect(
            checkPermanentTargetFilters(ctx, white, { colorFilter: "R" })
        ).toBe("Target must be R");
    });

    it("colorFilterAny: accepts a permanent matching any listed color, rejects one matching none", () => {
        const red = makeCard({
            types: ["Creature"],
            card: { id: "cfa-r", manaCost: { R: 1 } },
        });
        const blue = makeCard({
            types: ["Creature"],
            card: { id: "cfa-u", manaCost: { U: 1 } },
        });
        const ctx = baseCtx();
        expect(
            checkPermanentTargetFilters(ctx, red, {
                colorFilterAny: ["R", "G"],
            })
        ).toBeNull();
        expect(
            checkPermanentTargetFilters(ctx, blue, {
                colorFilterAny: ["R", "G"],
            })
        ).toBe("Target must be R or G");
    });

    it("powerFilter: accepts a permanent within bounds, rejects one below the minimum", () => {
        const strong = makeCard({ types: ["Creature"], power: 4 });
        const weak = makeCard({ types: ["Creature"], power: 1 });
        const ctx = baseCtx();
        expect(
            checkPermanentTargetFilters(ctx, strong, {
                powerFilter: { min: 2 },
            })
        ).toBeNull();
        expect(
            checkPermanentTargetFilters(ctx, weak, { powerFilter: { min: 2 } })
        ).toBe("Target must have power ≥ 2");
    });

    it("toughnessFilter: accepts a permanent within bounds, rejects one above the maximum", () => {
        const small = makeCard({ types: ["Creature"], toughness: 2 });
        const big = makeCard({ types: ["Creature"], toughness: 6 });
        const ctx = baseCtx();
        expect(
            checkPermanentTargetFilters(ctx, small, {
                toughnessFilter: { max: 4 },
            })
        ).toBeNull();
        expect(
            checkPermanentTargetFilters(ctx, big, {
                toughnessFilter: { max: 4 },
            })
        ).toBe("Target must have toughness ≤ 4");
    });

    it("mvFilter: accepts a permanent matching the mana-value bound, rejects one that doesn't", () => {
        const cheap = makeCard({
            types: ["Creature"],
            card: { id: "test-artcreat" },
        });
        const expensive = makeCard({
            types: ["Creature"],
            card: { id: "test-enchant" },
        });
        const ctx = baseCtx();
        // Fixtures don't register mana costs, so both report mv 0 — assert the
        // "equals" bound accepts mv 0 and rejects a nonzero requirement instead.
        expect(
            checkPermanentTargetFilters(ctx, cheap, {
                mvFilter: { equals: 0 },
            })
        ).toBeNull();
        expect(
            checkPermanentTargetFilters(ctx, expensive, {
                mvFilter: { equals: 1 },
            })
        ).toBe("Target does not match the required mana value");
    });

    it("loop semantics: an undefined filter value is skipped, never excludes the candidate", () => {
        const anyCreature = makeCard({ types: ["Creature"] });
        const ctx = baseCtx();
        expect(
            checkPermanentTargetFilters(ctx, anyCreature, {
                subtypeFilter: undefined,
                controller: undefined,
            })
        ).toBeNull();
    });

    it("controller violation surfaces before an intrinsic-filter violation (matches the prior hand-written check order)", () => {
        const theirsAndWrongType = makeCard({
            types: ["Land"],
            controllerId: "p2",
        });
        const ctx = baseCtx({ chooserId: "p1" });
        expect(
            checkPermanentTargetFilters(ctx, theirsAndWrongType, {
                controller: "you",
                excludeTypes: ["Land"],
            })
        ).toBe("Must target a permanent you control");
    });
});

// ---------------------------------------------------------------------------
// Mass destruction — destroyAll (types / subtypes / keyword filters)
// ---------------------------------------------------------------------------

describe("mass destruction", () => {
    it("destroyAll('Creature') destroys all creatures on both sides", () => {
        const wrathDef = getDefinition("a2788d69-6a3a-42f0-8736-cc6b57755ecd"); // Wrath of God
        const bear1 = makeCard({ id: "b1", card: CREATURE });
        const bear2 = makeCard({
            id: "b2",
            card: CREATURE,
            controllerId: "p2",
            ownerId: "p2",
        });
        const mox = makeCard({ id: "mox", card: ARTIFACT });

        const stackItem: StackItem = {
            ...makeCard({
                id: "wrath",
                card: { id: wrathDef.id, name: "Wrath of God" },
                types: ["Sorcery"],
                zone: "stack",
            }),
            castById: "p1",
        };

        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [bear1, mox] }),
                makePlayer({ id: "p2", battlefield: [bear2] }),
            ],
            stack: [stackItem],
        });

        resolveTopOfStack(state);

        expect(getPlayer(state, "p1").battlefield).toHaveLength(1); // mox survives
        expect(getPlayer(state, "p1").battlefield[0].id).toBe("mox");
        expect(getPlayer(state, "p2").battlefield).toHaveLength(0);
        expect(getPlayer(state, "p1").graveyard).toHaveLength(2); // bear1 + wrath
        expect(getPlayer(state, "p2").graveyard).toHaveLength(1); // bear2
    });

    it("destroyAll('Land') destroys all lands (Armageddon)", () => {
        const armaDef = getDefinition("5b6ddce7-b9c5-431d-a0b0-46d4aa93cbcb"); // Armageddon
        const land1 = makeCard({
            id: "l1",
            card: LAND,
            types: ["Land"],
            subtypes: ["Island"],
        });
        const land2 = makeCard({
            id: "l2",
            card: LAND,
            types: ["Land"],
            subtypes: ["Island"],
            controllerId: "p2",
            ownerId: "p2",
        });
        const bear = makeCard({ id: "b1", card: CREATURE });

        const stackItem: StackItem = {
            ...makeCard({
                id: "arma",
                card: { id: armaDef.id, name: "Armageddon" },
                types: ["Sorcery"],
                zone: "stack",
            }),
            castById: "p1",
        };

        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [land1, bear] }),
                makePlayer({ id: "p2", battlefield: [land2] }),
            ],
            stack: [stackItem],
        });

        resolveTopOfStack(state);

        expect(getPlayer(state, "p1").battlefield).toHaveLength(1); // bear survives
        expect(getPlayer(state, "p2").battlefield).toHaveLength(0);
    });

    it("destroyAll(['Artifact','Creature','Enchantment']) (Nevinyrral's Disk)", () => {
        const diskDef = getDefinition("12926dc8-8e6f-4a47-a12b-4d674189615a");
        const ability = diskDef.activatedAbilities![0];

        const disk = makeCard({
            id: "disk",
            card: { id: diskDef.id, name: "Nevinyrral's Disk" },
            types: ["Artifact"],
            isTapped: true,
        });
        const bear = makeCard({ id: "bear", card: CREATURE });
        const mox = makeCard({
            id: "mox",
            card: ARTIFACT,
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeCard({
            id: "aura",
            card: ENCHANTMENT,
            controllerId: "p2",
            ownerId: "p2",
        });
        const land = makeCard({
            id: "land",
            card: LAND,
            types: ["Land"],
            subtypes: ["Island"],
        });

        // Ability stack item
        const stackItem: StackItem = {
            ...makeCard({
                id: "disk-ability",
                card: { id: diskDef.id, name: "Nevinyrral's Disk" },
                types: ["Artifact"],
                zone: "stack",
            }),
            castById: "p1",
            abilityId: ability.id,
        };

        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [disk, bear, land] }),
                makePlayer({ id: "p2", battlefield: [mox, aura] }),
            ],
            stack: [stackItem],
        });

        resolveTopOfStack(state);

        // Disk destroys itself (artifact), bear (creature), mox (artifact), aura (enchantment)
        // Land survives
        expect(getPlayer(state, "p1").battlefield).toHaveLength(1);
        expect(getPlayer(state, "p1").battlefield[0].id).toBe("land");
        expect(getPlayer(state, "p2").battlefield).toHaveLength(0);
        expect(getPlayer(state, "p1").graveyard).toHaveLength(2); // disk + bear
        expect(getPlayer(state, "p2").graveyard).toHaveLength(2); // mox + aura
    });

    it("destroyAll({ subtypes: 'Island' }) destroys only Islands (Tsunami)", () => {
        const tsunamiDef = getDefinition(
            "9ed67d61-cf47-446b-b454-eb404a8686b7"
        );

        const island = makeCard({
            id: "island",
            card: LAND,
            types: ["Land"],
            subtypes: ["Island"],
        });
        const plains = makeCard({
            id: "plains",
            types: ["Land"],
            subtypes: ["Plains"],
            card: { name: "Plains", types: ["Land"], subtypes: ["Plains"] },
        });

        const stackItem: StackItem = {
            ...makeCard({
                id: "tsunami",
                card: { id: tsunamiDef.id, name: "Tsunami" },
                types: ["Sorcery"],
                zone: "stack",
            }),
            castById: "p1",
        };

        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [island, plains] }),
                makePlayer({ id: "p2" }),
            ],
            stack: [stackItem],
        });

        resolveTopOfStack(state);

        expect(getPlayer(state, "p1").battlefield).toHaveLength(1);
        expect(getPlayer(state, "p1").battlefield[0].id).toBe("plains");
    });

    it("destroyAll({ subtypes: 'Plains' }) destroys only Plains (Flashfires)", () => {
        const flashDef = getDefinition("ee8a05a4-0ce3-4abe-bb60-08af53cf08e5");

        const plains1 = makeCard({
            id: "p1-plains",
            types: ["Land"],
            subtypes: ["Plains"],
            card: { name: "Plains", types: ["Land"], subtypes: ["Plains"] },
        });
        const mountain = makeCard({
            id: "mountain",
            types: ["Land"],
            subtypes: ["Mountain"],
            card: {
                name: "Mountain",
                types: ["Land"],
                subtypes: ["Mountain"],
            },
            controllerId: "p2",
            ownerId: "p2",
        });
        const plains2 = makeCard({
            id: "p2-plains",
            types: ["Land"],
            subtypes: ["Plains"],
            card: { name: "Plains", types: ["Land"], subtypes: ["Plains"] },
            controllerId: "p2",
            ownerId: "p2",
        });

        const stackItem: StackItem = {
            ...makeCard({
                id: "flash",
                card: { id: flashDef.id, name: "Flashfires" },
                types: ["Sorcery"],
                zone: "stack",
            }),
            castById: "p1",
        };

        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [plains1] }),
                makePlayer({ id: "p2", battlefield: [mountain, plains2] }),
            ],
            stack: [stackItem],
        });

        resolveTopOfStack(state);

        expect(getPlayer(state, "p1").battlefield).toHaveLength(0);
        expect(getPlayer(state, "p2").battlefield).toHaveLength(1);
        expect(getPlayer(state, "p2").battlefield[0].id).toBe("mountain");
    });

    it("destroyAll('Enchantment') destroys all enchantments (Tranquility)", () => {
        const tranqDef = getDefinition("774cc5a6-3a69-4812-add4-eb5eb6389238");

        const aura1 = makeCard({ id: "e1", card: ENCHANTMENT });
        const aura2 = makeCard({
            id: "e2",
            card: ENCHANTMENT,
            controllerId: "p2",
            ownerId: "p2",
        });
        const bear = makeCard({ id: "bear", card: CREATURE });

        const stackItem: StackItem = {
            ...makeCard({
                id: "tranq",
                card: { id: tranqDef.id, name: "Tranquility" },
                types: ["Sorcery"],
                zone: "stack",
            }),
            castById: "p1",
        };

        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [aura1, bear] }),
                makePlayer({ id: "p2", battlefield: [aura2] }),
            ],
            stack: [stackItem],
        });

        resolveTopOfStack(state);

        expect(getPlayer(state, "p1").battlefield).toHaveLength(1); // bear
        expect(getPlayer(state, "p2").battlefield).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// entersTapped
// ---------------------------------------------------------------------------

describe("entersTapped", () => {
    it("Nevinyrral's Disk enters the battlefield tapped", () => {
        const diskDef = getDefinition("12926dc8-8e6f-4a47-a12b-4d674189615a");

        const stackItem: StackItem = {
            ...makeCard({
                id: "disk",
                card: { id: diskDef.id, name: "Nevinyrral's Disk" },
                types: ["Artifact"],
                zone: "stack",
            }),
            castById: "p1",
        };

        const state = makeGameState({
            players: [makePlayer({ id: "p1" }), makePlayer({ id: "p2" })],
            stack: [stackItem],
        });

        resolveTopOfStack(state);

        const disk = getPlayer(state, "p1").battlefield[0];
        expect(disk.isTapped).toBe(true);
    });

    it("normal artifact enters untapped", () => {
        const moxDef = getDefinition("b0e1427c-05cd-465b-be59-97ed6e39f7ba"); // Mox Emerald

        const stackItem: StackItem = {
            ...makeCard({
                id: "mox",
                card: { id: moxDef.id, name: "Mox Emerald" },
                types: ["Artifact"],
                zone: "stack",
            }),
            castById: "p1",
        };

        const state = makeGameState({
            players: [makePlayer({ id: "p1" }), makePlayer({ id: "p2" })],
            stack: [stackItem],
        });

        resolveTopOfStack(state);

        const mox = getPlayer(state, "p1").battlefield[0];
        expect(mox.isTapped).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Activated ability on stack
// ---------------------------------------------------------------------------

describe("activated ability stack resolution", () => {
    it("ability resolves without moving source to graveyard", () => {
        const diskDef = getDefinition("12926dc8-8e6f-4a47-a12b-4d674189615a");
        const ability = diskDef.activatedAbilities![0];

        // Disk on battlefield (tapped from paying cost)
        const disk = makeCard({
            id: "disk",
            card: { id: diskDef.id, name: "Nevinyrral's Disk" },
            types: ["Artifact"],
            isTapped: true,
        });

        // Ability on stack
        const abilityItem: StackItem = {
            ...makeCard({
                id: "disk-ability",
                card: { id: diskDef.id, name: "Nevinyrral's Disk" },
                types: ["Artifact"],
                zone: "stack",
            }),
            castById: "p1",
            abilityId: ability.id,
        };

        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [disk] }),
                makePlayer({ id: "p2" }),
            ],
            stack: [abilityItem],
        });

        const resolved = resolveTopOfStack(state)!;

        // Ability item is returned (not placed anywhere)
        expect(resolved.abilityId).toBe(ability.id);
        // Disk itself was destroyed by its own effect (artifact)
        expect(getPlayer(state, "p1").battlefield).toHaveLength(0);
        expect(getPlayer(state, "p1").graveyard).toHaveLength(1);
        expect(getPlayer(state, "p1").graveyard[0].id).toBe("disk");
    });

    it("sorcery resolves to graveyard (not ability behavior)", () => {
        const wrathDef = getDefinition("a2788d69-6a3a-42f0-8736-cc6b57755ecd");

        const stackItem: StackItem = {
            ...makeCard({
                id: "wrath",
                card: { id: wrathDef.id, name: "Wrath of God" },
                types: ["Sorcery"],
                zone: "stack",
            }),
            castById: "p1",
        };

        const state = makeGameState({
            players: [makePlayer({ id: "p1" }), makePlayer({ id: "p2" })],
            stack: [stackItem],
        });

        resolveTopOfStack(state);

        // Sorcery goes to graveyard
        expect(getPlayer(state, "p1").graveyard).toHaveLength(1);
        expect(getPlayer(state, "p1").graveyard[0].id).toBe("wrath");
    });
});

// ---------------------------------------------------------------------------
// getLegalTargets — spell targets (CR 114.1)
// ---------------------------------------------------------------------------

describe("getLegalTargets: spell targeting (CR 114.1)", () => {
    it("returns all stack items for 'spell' requirement", () => {
        const bolt: StackItem = {
            ...makeCard({
                id: "bolt1",
                card: { name: "Lightning Bolt" },
                types: ["Instant"],
                zone: "stack",
            }),
            castById: "p1",
        };
        const bear: StackItem = {
            ...makeCard({
                id: "bear1",
                card: { name: "Bear" },
                types: ["Creature"],
                zone: "stack",
            }),
            castById: "p2",
        };
        const state = makeGameState({ stack: [bear, bolt] });

        const req: TargetRequirement = { type: "spell", count: 1 };
        const targets = getLegalTargets(state, req);

        expect(targets).toHaveLength(2);
        expect(targets.every((t) => t.type === "spell")).toBe(true);
        const ids = targets.map((t) => t.id).sort();
        expect(ids).toEqual(["bear1", "bolt1"]);
    });

    it("returns empty when stack is empty", () => {
        const state = makeGameState({ stack: [] });
        const req: TargetRequirement = { type: "spell", count: 1 };
        expect(getLegalTargets(state, req)).toHaveLength(0);
    });

    it("does NOT include permanents or players when only 'spell' is requested", () => {
        const bear = makeCard({
            id: "bear",
            card: CREATURE,
            zone: "battlefield",
        });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [bear] }),
                makePlayer({ id: "p2" }),
            ],
            stack: [],
        });
        const req: TargetRequirement = { type: "spell", count: 1 };
        expect(getLegalTargets(state, req)).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// spellExcludeTypeFilter / spellCreaturePtFilter — CR 114.1 (issue #683)
// Spell Pierce ("target noncreature spell") and Stern Scolding ("target
// creature spell with power or toughness 2 or less").
// ---------------------------------------------------------------------------

describe("getLegalTargets: spellExcludeTypeFilter (CR 114.1, Spell Pierce)", () => {
    it("excludes creature spells, keeps every other spell type", () => {
        const bolt: StackItem = {
            ...makeCard({ id: "bolt1", types: ["Instant"] }),
            castById: "p1",
        };
        const bear: StackItem = {
            ...makeCard({ id: "bear1", types: ["Creature"] }),
            castById: "p2",
        };
        const state = makeGameState({ stack: [bear, bolt] });
        const req: TargetRequirement = {
            type: "spell",
            count: 1,
            spellExcludeTypeFilter: "Creature",
        };
        const targets = getLegalTargets(state, req);
        expect(targets.map((t) => t.id)).toEqual(["bolt1"]);
    });

    it("excludes an activated ability on the stack (it is never a spell)", () => {
        const ability: StackItem = {
            ...makeCard({ id: "ab1", types: ["Artifact"] }),
            castById: "p1",
            abilityId: "some-ability",
        };
        const state = makeGameState({ stack: [ability] });
        const req: TargetRequirement = {
            type: "spell",
            count: 1,
            spellExcludeTypeFilter: "Creature",
        };
        expect(getLegalTargets(state, req)).toHaveLength(0);
    });
});

describe("getLegalTargets: spellCreaturePtFilter (CR 114.1 + 208.2, Stern Scolding)", () => {
    it("keeps creature spells at or under the power-or-toughness threshold", () => {
        const weak: StackItem = {
            ...makeCard({
                id: "weak1",
                types: ["Creature"],
                power: 1,
                toughness: 1,
            }),
            castById: "p1",
        };
        const strong: StackItem = {
            ...makeCard({
                id: "strong1",
                types: ["Creature"],
                power: 4,
                toughness: 4,
            }),
            castById: "p1",
        };
        const state = makeGameState({ stack: [weak, strong] });
        const req: TargetRequirement = {
            type: "spell",
            count: 1,
            spellTypeFilter: "Creature",
            spellCreaturePtFilter: { maxPowerOrToughness: 2 },
        };
        const targets = getLegalTargets(state, req);
        expect(targets.map((t) => t.id)).toEqual(["weak1"]);
    });

    it("matches on toughness alone (power over the threshold, toughness at it)", () => {
        const lanky: StackItem = {
            ...makeCard({
                id: "lanky1",
                types: ["Creature"],
                power: 5,
                toughness: 2,
            }),
            castById: "p1",
        };
        const state = makeGameState({ stack: [lanky] });
        const req: TargetRequirement = {
            type: "spell",
            count: 1,
            spellCreaturePtFilter: { maxPowerOrToughness: 2 },
        };
        expect(getLegalTargets(state, req).map((t) => t.id)).toEqual([
            "lanky1",
        ]);
    });

    it("excludes a noncreature spell regardless of power/toughness", () => {
        const bolt: StackItem = {
            ...makeCard({ id: "bolt2", types: ["Instant"] }),
            castById: "p1",
        };
        const state = makeGameState({ stack: [bolt] });
        const req: TargetRequirement = {
            type: "spell",
            count: 1,
            spellCreaturePtFilter: { maxPowerOrToughness: 2 },
        };
        expect(getLegalTargets(state, req)).toHaveLength(0);
    });
});

// Backend integration: `spellMatchesExcludeTypeFilter` /
// `spellMatchesCreaturePtFilter` are the EXACT predicates `selectTarget`
// (game.ts) calls to accept/reject a submitted target, shared with
// `getLegalTargets` above (one predicate, two call sites — same pattern as
// `spellWouldDestroyLandControlledBy` / Equinox). Mirrors that precedent's
// "backend: selectTarget ACCEPTS/REJECTS" shape.
describe("backend: selectTarget spell-filter predicates (issue #683)", () => {
    it("spellMatchesExcludeTypeFilter REJECTS a creature spell, ACCEPTS a noncreature spell", () => {
        const bear: StackItem = {
            ...makeCard({ id: "bear2", types: ["Creature"] }),
            castById: "p1",
        };
        const bolt: StackItem = {
            ...makeCard({ id: "bolt3", types: ["Instant"] }),
            castById: "p1",
        };
        expect(spellMatchesExcludeTypeFilter(bear, ["Creature"])).toBe(false);
        expect(spellMatchesExcludeTypeFilter(bolt, ["Creature"])).toBe(true);
    });

    it("spellMatchesCreaturePtFilter ACCEPTS a small creature spell, REJECTS a big one", () => {
        const small: StackItem = {
            ...makeCard({
                id: "small1",
                types: ["Creature"],
                power: 1,
                toughness: 1,
            }),
            castById: "p1",
        };
        const big: StackItem = {
            ...makeCard({
                id: "big1",
                types: ["Creature"],
                power: 6,
                toughness: 6,
            }),
            castById: "p1",
        };
        expect(
            spellMatchesCreaturePtFilter(small, { maxPowerOrToughness: 2 })
        ).toBe(true);
        expect(
            spellMatchesCreaturePtFilter(big, { maxPowerOrToughness: 2 })
        ).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// checkSpellTargetFilters — single shared spell-kind gate (ADR 0068, T2,
// issue #1409). THE authority both getLegalTargets (offered set) and
// selectTarget (accepted set, game.ts) run per stack-item candidate; a
// filter that passes here is legal at BOTH sites by construction — closing
// the spell-flavored half of the Phelia bug class (T1 closed the permanent
// half via checkPermanentTargetFilters / intrinsicPermanentTargetViolation).
// ---------------------------------------------------------------------------

describe("checkSpellTargetFilters — shared offered/accepted gate (ADR 0068, issue #1409)", () => {
    const baseCtx: TargetFilterCtx = {
        state: makeGameState(),
        sourceColors: [],
        sourceTypes: [],
        sourceSubtypes: [],
        chooserId: "p1",
        activePlayerId: "p1",
    };

    const spellItem = (overrides: Partial<StackItem> = {}): StackItem => ({
        ...makeCard({ id: "spell1", types: ["Instant"] }),
        castById: "p1",
        ...overrides,
    });

    it("spellStackKind: 'spell' (the lowered default for an omitted requirement, CR 701.5a) rejects an ability, accepts a spell", () => {
        const anAbility = spellItem({ abilityId: "some-ability" });
        const aSpell = spellItem();
        // `lowerSpellFilters` resolves an omitted requirement to the explicit
        // "spell" default (never `undefined`, see `lowerSpellFilters` doc) —
        // `checkSpellTargetFilters` is always called with already-lowered
        // values, so this is the value it actually receives in real usage.
        expect(
            checkSpellTargetFilters(baseCtx, anAbility, {
                spellStackKind: "spell",
            })
        ).not.toBeNull();
        expect(
            checkSpellTargetFilters(baseCtx, aSpell, {
                spellStackKind: "spell",
            })
        ).toBeNull();
    });

    it("spellStackKind: 'activated-ability' accepts only an activated ability", () => {
        const activated = spellItem({ abilityId: "ability-1" });
        const triggered = spellItem({ triggeredAbilityId: "trigger-1" });
        expect(
            checkSpellTargetFilters(baseCtx, activated, {
                spellStackKind: "activated-ability",
            })
        ).toBeNull();
        expect(
            checkSpellTargetFilters(baseCtx, triggered, {
                spellStackKind: "activated-ability",
            })
        ).not.toBeNull();
    });

    it("spellStackKind: 'any' (Ward, CR 702.21a) accepts a spell, an activated ability, AND a triggered ability", () => {
        const aSpell = spellItem();
        const activated = spellItem({ abilityId: "ability-1" });
        const triggered = spellItem({ triggeredAbilityId: "trigger-1" });
        for (const candidate of [aSpell, activated, triggered]) {
            expect(
                checkSpellTargetFilters(baseCtx, candidate, {
                    spellStackKind: "any",
                })
            ).toBeNull();
        }
    });

    it("controller: 'you' rejects an opponent's spell, accepts your own (CR 109.3 / 114.1, Lutri)", () => {
        const own = spellItem({ castById: "p1" });
        const opp = spellItem({ castById: "p2" });
        expect(
            checkSpellTargetFilters(baseCtx, own, { controller: "you" })
        ).toBeNull();
        expect(
            checkSpellTargetFilters(baseCtx, opp, { controller: "you" })
        ).not.toBeNull();
    });

    it("stackSourceTypeFilter: rejects a source whose card types don't match, accepts one that does (CR 113.7a)", () => {
        const fromArtifact = spellItem({
            types: ["Artifact"],
            abilityId: "a1",
        });
        const fromCreature = spellItem({
            types: ["Creature"],
            abilityId: "a1",
        });
        expect(
            checkSpellTargetFilters(baseCtx, fromArtifact, {
                stackSourceTypeFilter: ["Artifact"],
            })
        ).toBeNull();
        expect(
            checkSpellTargetFilters(baseCtx, fromCreature, {
                stackSourceTypeFilter: ["Artifact"],
            })
        ).not.toBeNull();
    });

    it("spellTargetsInstanceIds: rejects a spell not targeting the given permanent, accepts one that does (CR 114.1, Mistfolk)", () => {
        const targetingIt = spellItem({
            targets: [{ type: "permanent", id: "mist" }],
        });
        const targetingOther = spellItem({
            targets: [{ type: "permanent", id: "other" }],
        });
        expect(
            checkSpellTargetFilters(baseCtx, targetingIt, {
                spellTargetsInstanceIds: ["mist"],
            })
        ).toBeNull();
        expect(
            checkSpellTargetFilters(baseCtx, targetingOther, {
                spellTargetsInstanceIds: ["mist"],
            })
        ).not.toBeNull();
    });

    it("spellTargetsInstanceIds admits an ABILITY when spellStackKind: 'any' (Ward, CR 702.21a — the kind gate alone governs kind eligibility)", () => {
        const abilityTargetingIt = spellItem({
            abilityId: "ward",
            targets: [{ type: "permanent", id: "warded" }],
        });
        expect(
            checkSpellTargetFilters(baseCtx, abilityTargetingIt, {
                spellStackKind: "any",
                spellTargetsInstanceIds: ["warded"],
            })
        ).toBeNull();
    });

    it("colorFilter: rejects a spell of the wrong color, accepts a matching one (CR 202.2)", () => {
        const red = spellItem({ card: { id: "r", manaCost: { R: 1 } } });
        const white = spellItem({ card: { id: "w", manaCost: { W: 1 } } });
        expect(
            checkSpellTargetFilters(baseCtx, red, { colorFilter: "R" })
        ).toBeNull();
        expect(
            checkSpellTargetFilters(baseCtx, white, { colorFilter: "R" })
        ).not.toBeNull();
    });

    // Fixup (T2 review, issue #1409): `colorFilterAny`'s `spell` check was
    // dropped when the spell kind was added, silently loosening Greater
    // Realm of Preservation's "black or red source" gate. Regression guard.
    it("colorFilterAny: accepts a spell matching any listed color, rejects one matching none (CR 202.2, Greater Realm of Preservation)", () => {
        const black = spellItem({ card: { id: "b", manaCost: { B: 1 } } });
        const white = spellItem({ card: { id: "w2", manaCost: { W: 1 } } });
        expect(
            checkSpellTargetFilters(baseCtx, black, {
                colorFilterAny: ["B", "R"],
            })
        ).toBeNull();
        expect(
            checkSpellTargetFilters(baseCtx, white, {
                colorFilterAny: ["B", "R"],
            })
        ).not.toBeNull();
    });

    it("mvFilter: rejects a spell outside the mana-value bound, accepts one matching it (CR 202.3, Spell Blast)", () => {
        // Mirrors the permanent-kind mvFilter test's convention above: the
        // fixture doesn't register a mana cost for these ids, so
        // `mvOfStackItem` (which resolves mv via `tryGetDefinition`, same as
        // `mvOfPermanent`) reports 0 for both — assert the "equals" bound
        // accepts mv 0 and rejects a nonzero requirement instead.
        const cheap = spellItem({ card: { id: "test-cheap-instant" } });
        const expensive = spellItem({ card: { id: "test-expensive-instant" } });
        expect(
            checkSpellTargetFilters(baseCtx, cheap, { mvFilter: { equals: 0 } })
        ).toBeNull();
        expect(
            checkSpellTargetFilters(baseCtx, expensive, {
                mvFilter: { equals: 1 },
            })
        ).not.toBeNull();
    });

    it("spellTypeFilter: rejects an out-of-type spell and any ability, accepts a matching spell (CR 114.1, Fork)", () => {
        const instant = spellItem({ types: ["Instant"] });
        const creatureSpell = spellItem({ types: ["Creature"] });
        const ability = spellItem({ types: ["Instant"], abilityId: "a1" });
        expect(
            checkSpellTargetFilters(baseCtx, instant, {
                spellTypeFilter: ["Instant", "Sorcery"],
            })
        ).toBeNull();
        expect(
            checkSpellTargetFilters(baseCtx, creatureSpell, {
                spellTypeFilter: ["Instant", "Sorcery"],
            })
        ).not.toBeNull();
        expect(
            checkSpellTargetFilters(baseCtx, ability, {
                spellTypeFilter: ["Instant", "Sorcery"],
            })
        ).not.toBeNull();
    });

    it("spellExcludeTypeFilter: rejects a creature spell, accepts a noncreature spell (CR 114.1, Spell Pierce)", () => {
        const bear = spellItem({ types: ["Creature"] });
        const bolt = spellItem({ types: ["Instant"] });
        expect(
            checkSpellTargetFilters(baseCtx, bear, {
                spellExcludeTypeFilter: ["Creature"],
            })
        ).not.toBeNull();
        expect(
            checkSpellTargetFilters(baseCtx, bolt, {
                spellExcludeTypeFilter: ["Creature"],
            })
        ).toBeNull();
    });

    it("spellCreaturePtFilter: rejects a big creature spell, accepts a small one (CR 114.1 + 208.2, Stern Scolding)", () => {
        const small = spellItem({
            types: ["Creature"],
            power: 1,
            toughness: 1,
        });
        const big = spellItem({ types: ["Creature"], power: 6, toughness: 6 });
        expect(
            checkSpellTargetFilters(baseCtx, small, {
                spellCreaturePtFilter: { maxPowerOrToughness: 2 },
            })
        ).toBeNull();
        expect(
            checkSpellTargetFilters(baseCtx, big, {
                spellCreaturePtFilter: { maxPowerOrToughness: 2 },
            })
        ).not.toBeNull();
    });

    it("spellSingleTargetingController: rejects a spell not solely targeting the chooser, accepts one that does (CR 114.6 / 115.10, Reflecting Mirror)", () => {
        const targetsChooser = spellItem({
            targets: [{ type: "player", id: "p1" }],
        });
        const targetsOther = spellItem({
            targets: [{ type: "player", id: "p2" }],
        });
        expect(
            checkSpellTargetFilters(baseCtx, targetsChooser, {
                spellSingleTargetingController: true,
            })
        ).toBeNull();
        expect(
            checkSpellTargetFilters(baseCtx, targetsOther, {
                spellSingleTargetingController: true,
            })
        ).not.toBeNull();
    });

    it("spellWouldDestroyLandYouControl: rejects a spell that would not destroy the chooser's land, accepts one that would (CR 114.1 + 701.7, Equinox)", () => {
        const land = makeCard({
            id: "land1",
            types: ["Land"],
            controllerId: "p1",
        });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [land] }),
                makePlayer({ id: "p2" }),
            ],
        });
        const ctx: TargetFilterCtx = { ...baseCtx, state };
        registerTokenDefinition({
            id: "stone-rain-t2",
            name: "stone-rain-t2",
            rarity: "common",
            manaCost: { R: 1 },
            types: ["Sorcery"],
            effect: "destroy-target",
        });
        const destroysLand = spellItem({
            card: { id: "stone-rain-t2" },
            targets: [{ type: "permanent", id: "land1" }],
        });
        const harmless = spellItem({ types: ["Instant"] });
        expect(
            checkSpellTargetFilters(ctx, destroysLand, {
                spellWouldDestroyLandYouControl: true,
            })
        ).toBeNull();
        expect(
            checkSpellTargetFilters(ctx, harmless, {
                spellWouldDestroyLandYouControl: true,
            })
        ).not.toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Carry-completeness — every spell filter must round-trip onto the
// PendingTarget via pendingTargetFiltersFromRequirement (ADR 0068, T2). If a
// filter is added to checkSpellTargetFilters but not propagated here, the
// interactive choice silently loses it (the spell-flavored Phelia
// regression) — this fails the moment that happens.
// ---------------------------------------------------------------------------

describe("pendingTargetFiltersFromRequirement — spell filter carry-completeness (issue #1409)", () => {
    it("carries every spell filter onto the PendingTarget", () => {
        const req: TargetRequirement = {
            type: "spell",
            count: 1,
            spellStackKind: "any",
            controller: "you",
            stackSourceTypeFilter: "Artifact",
            spellTargetsInstanceIds: ["src1"],
            colorFilter: "R",
            colorFilterAny: ["B", "R"],
            mvFilter: { equals: 3 },
            spellTypeFilter: "Instant",
            spellExcludeTypeFilter: "Creature",
            spellCreaturePtFilter: { maxPowerOrToughness: 2 },
            spellSingleTargetingController: true,
            spellWouldDestroyLandYouControl: true,
        };
        const pt = pendingTargetFiltersFromRequirement(req, undefined);
        expect(pt.spellStackKind).toBe("any");
        expect(pt.controller).toBe("you");
        expect(pt.stackSourceTypeFilter).toEqual(["Artifact"]);
        expect(pt.spellTargetsInstanceIds).toEqual(["src1"]);
        expect(pt.colorFilter).toBe("R");
        expect(pt.colorFilterAny).toEqual(["B", "R"]);
        expect(pt.mvFilter).toEqual({ equals: 3 });
        expect(pt.spellTypeFilter).toEqual(["Instant"]);
        expect(pt.spellExcludeTypeFilter).toEqual(["Creature"]);
        expect(pt.spellCreaturePtFilter).toEqual({ maxPowerOrToughness: 2 });
        expect(pt.spellSingleTargetingController).toBe(true);
        expect(pt.spellWouldDestroyLandYouControl).toBe(true);
    });

    it("spellStackKind defaults to 'spell' when omitted (always-active filter, never skipped — CR 701.5a)", () => {
        const req: TargetRequirement = { type: "spell", count: 1 };
        const pt = pendingTargetFiltersFromRequirement(req, undefined);
        expect(pt.spellStackKind).toBe("spell");
    });

    // Fixup (T2 review, issue #1409): `lowerSpellFilters` always resolves
    // `spellStackKind` to its explicit default "spell" (never `undefined`),
    // so an earlier version of this function spread it unconditionally and
    // stamped `spellStackKind: "spell"` onto EVERY PendingTarget, including
    // permanent/player-only requirements that never target a spell. Only a
    // requirement whose `type` actually admits a spell target should carry
    // any spell-only filter field.
    it("does NOT carry spell-only filters (spellStackKind) for a permanent-only requirement", () => {
        const req: TargetRequirement = { type: "Creature", count: 1 };
        const pt = pendingTargetFiltersFromRequirement(req, undefined);
        expect(pt.spellStackKind).toBeUndefined();
    });

    it("does NOT carry spell-only filters (spellStackKind) for a player-only requirement", () => {
        const req: TargetRequirement = { type: "player", count: 1 };
        const pt = pendingTargetFiltersFromRequirement(req, undefined);
        expect(pt.spellStackKind).toBeUndefined();
    });

    it("DOES carry spell-only filters for a 'spell-or-permanent' requirement (CR 114)", () => {
        const req: TargetRequirement = {
            type: "spell-or-permanent",
            count: 1,
        };
        const pt = pendingTargetFiltersFromRequirement(req, undefined);
        expect(pt.spellStackKind).toBe("spell");
    });
});

// ---------------------------------------------------------------------------
// checkPlayerTargetFilters — single shared player-kind gate (ADR 0068, T3,
// issue #1410). THE authority both getLegalTargets (offered set) and
// selectTarget (accepted set, game.ts) run per player candidate; a filter
// that passes here is legal at BOTH sites by construction — closing the
// player-flavored half of the Phelia bug class (T1 closed the permanent half,
// T2 the spell half).
// ---------------------------------------------------------------------------

describe("checkPlayerTargetFilters — shared offered/accepted gate (ADR 0068, issue #1410)", () => {
    const baseCtx: TargetFilterCtx = {
        state: makeGameState(),
        sourceColors: [],
        sourceTypes: [],
        sourceSubtypes: [],
        chooserId: "p1",
        activePlayerId: "p1",
    };

    describe("controller (CR 109.3 / 102.1 — Word of Command's 'target opponent')", () => {
        it("'you' accepts the chooser, rejects an opponent", () => {
            const me = makePlayer({ id: "p1" });
            const opp = makePlayer({ id: "p2" });
            expect(
                checkPlayerTargetFilters(baseCtx, me, { controller: "you" })
            ).toBeNull();
            expect(
                checkPlayerTargetFilters(baseCtx, opp, { controller: "you" })
            ).toBe("Must target yourself");
        });

        it("'opponent' accepts an opponent, rejects the chooser", () => {
            const me = makePlayer({ id: "p1" });
            const opp = makePlayer({ id: "p2" });
            expect(
                checkPlayerTargetFilters(baseCtx, opp, {
                    controller: "opponent",
                })
            ).toBeNull();
            expect(
                checkPlayerTargetFilters(baseCtx, me, {
                    controller: "opponent",
                })
            ).toBe("Must target an opponent");
        });

        it("'active' accepts the active player regardless of chooser", () => {
            const ctx = { ...baseCtx, chooserId: "p2", activePlayerId: "p1" };
            const activePlayer = makePlayer({ id: "p1" });
            const other = makePlayer({ id: "p2" });
            expect(
                checkPlayerTargetFilters(ctx, activePlayer, {
                    controller: "active",
                })
            ).toBeNull();
            expect(
                checkPlayerTargetFilters(ctx, other, { controller: "active" })
            ).toBe("Must target the active player");
        });
    });

    describe("playerAttackedThisTurn (CR 506.2, Fire and Brimstone)", () => {
        it("accepts a player who attacked, rejects one who didn't", () => {
            const attacker = makeCard({ id: "atk", card: CREATURE });
            attacker.hasAttackedThisTurn = true;
            const attacked = makePlayer({ id: "p1", battlefield: [attacker] });
            const notAttacked = makePlayer({ id: "p2" });
            expect(
                checkPlayerTargetFilters(baseCtx, attacked, {
                    playerAttackedThisTurn: true,
                })
            ).toBeNull();
            expect(
                checkPlayerTargetFilters(baseCtx, notAttacked, {
                    playerAttackedThisTurn: true,
                })
            ).toBe("Target player did not attack this turn");
        });
    });
});

// ---------------------------------------------------------------------------
// checkCardTargetFilters — single shared card-kind gate (ADR 0068, T3, issue
// #1410). THE authority both getLegalTargets (offered set) and selectTarget
// (accepted set, game.ts) run per graveyard-card candidate. Closes the
// card-flavored half of the Phelia bug class AND a real latent gap:
// selectTarget's pre-T3 graveyard-card branch never implemented `controller:
// "active"` at all, while getLegalTargets already did.
// ---------------------------------------------------------------------------

describe("checkCardTargetFilters — shared offered/accepted gate (ADR 0068, issue #1410)", () => {
    const baseCtx: TargetFilterCtx = {
        state: makeGameState(),
        sourceColors: [],
        sourceTypes: [],
        sourceSubtypes: [],
        chooserId: "p1",
        activePlayerId: "p1",
    };

    const gyCard = (
        ownerId: string,
        overrides: Partial<CardInstanceState> = {}
    ) =>
        makeCard({
            id: `gy-${ownerId}`,
            card: CREATURE,
            zone: "graveyard",
            controllerId: ownerId,
            ownerId,
            ...overrides,
        });

    describe("controller (CR 109.3 / 400.7 — Regrowth-style graveyard recursion)", () => {
        it("'you' accepts a card in the chooser's own graveyard, rejects an opponent's", () => {
            const mine = gyCard("p1");
            const theirs = gyCard("p2");
            expect(
                checkCardTargetFilters(baseCtx, mine, { controller: "you" })
            ).toBeNull();
            expect(
                checkCardTargetFilters(baseCtx, theirs, { controller: "you" })
            ).toBe("Must target a card in your graveyard");
        });

        it("'opponent' accepts a card in an opponent's graveyard, rejects the chooser's own", () => {
            const mine = gyCard("p1");
            const theirs = gyCard("p2");
            expect(
                checkCardTargetFilters(baseCtx, theirs, {
                    controller: "opponent",
                })
            ).toBeNull();
            expect(
                checkCardTargetFilters(baseCtx, mine, {
                    controller: "opponent",
                })
            ).toBe("Must target a card in opponent's graveyard");
        });

        it("'active' accepts a card in the active player's graveyard regardless of chooser (fixes a latent gap: selectTarget never implemented this case before T3)", () => {
            const ctx = { ...baseCtx, chooserId: "p2", activePlayerId: "p1" };
            const activeOwners = gyCard("p1");
            const otherOwners = gyCard("p2");
            expect(
                checkCardTargetFilters(ctx, activeOwners, {
                    controller: "active",
                })
            ).toBeNull();
            expect(
                checkCardTargetFilters(ctx, otherOwners, {
                    controller: "active",
                })
            ).toBe("Must target a card the active player owns");
        });

        // `card.controllerId` is NOT reliably reset once an object leaves the
        // battlefield (CR 108.4 / 110.2) — the check must read `ownerId`
        // (whose graveyard array it sits in), not `controllerId`.
        it("reads ownerId, not a stale controllerId, for the graveyard-owner relationship", () => {
            const stale = gyCard("p1", { controllerId: "p2" });
            expect(
                checkCardTargetFilters(baseCtx, stale, { controller: "you" })
            ).toBeNull();
        });
    });

    describe("mvFilter (CR 202.3, Sevinne's Reclamation's 'mana value 3 or less')", () => {
        it("accepts a card within bounds, rejects one outside them", () => {
            const cheap = makeCard({
                id: "cheap",
                card: { id: "test-cheap", manaCost: { generic: 1 } },
                zone: "graveyard",
            });
            const expensive = makeCard({
                id: "expensive",
                card: { id: "test-expensive", manaCost: { generic: 5 } },
                zone: "graveyard",
            });
            expect(
                checkCardTargetFilters(baseCtx, cheap, {
                    mvFilter: { max: 3 },
                })
            ).toBeNull();
            expect(
                checkCardTargetFilters(baseCtx, expensive, {
                    mvFilter: { max: 3 },
                })
            ).toBe("Target does not match the required mana value");
        });
    });
});

// ---------------------------------------------------------------------------
// T4 keystone (ADR 0068, issue #1411): `REGISTRY` in `targetFilters.ts` is now
// declared `satisfies Record<FilterKey, FilterDescriptor<unknown>>`, so tsc
// already refuses to compile if any non-structural `TargetRequirement` field
// lacks an entry. This is a RUNTIME belt-and-suspenders companion (PRD #1407
// Testing Decisions): a stray `as FilterDescriptor<unknown>` / `as any` cast
// anywhere in the object literal could defeat `satisfies`'s structural check
// while still "compiling", so this test independently walks every actually
// registered key and asserts each descriptor is well-formed — a `lower`
// function plus at least one `checks` predicate — without relying on the
// type system at all.
// ---------------------------------------------------------------------------

describe("target-filter registry — FilterKey exhaustiveness keystone (ADR 0068, issue #1411)", () => {
    it("REGISTRY is non-empty and covers every filter migrated by T1-T3", () => {
        const keys = Object.keys(REGISTRY);
        // 20 permanent + 8 spell-only + 1 player-only (T1 + T2 + T3) — see
        // PERMANENT_FILTER_KEYS / SPELL_ONLY_FILTER_KEYS / PLAYER_ONLY_FILTER_KEYS
        // in targetFilters.ts. Card-kind reuses `controller`/`mvFilter`, both
        // already counted under the permanent set — no additional keys.
        // (`requireAbilityAny` joined the permanent set with Minsc & Boo;
        // `sameController` joined it with Barrin's Spite, issue #1104;
        // `isToken` joined it with Satya, Aetherflux Genius / Dance of Many,
        // issue #1195.)
        expect(keys.length).toBe(29);
    });

    it("every registered filter has a `lower` function and at least one `checks` predicate", () => {
        const keys = Object.keys(REGISTRY) as Array<keyof typeof REGISTRY>;
        for (const key of keys) {
            const descriptor = REGISTRY[key];
            expect(descriptor, `REGISTRY.${key}`).toBeDefined();
            expect(typeof descriptor.lower, `REGISTRY.${key}.lower`).toBe(
                "function"
            );
            const checkEntries = Object.entries(descriptor.checks);
            expect(
                checkEntries.length,
                `REGISTRY.${key}.checks must declare at least one TargetKind`
            ).toBeGreaterThan(0);
            for (const [kind, check] of checkEntries) {
                expect(typeof check, `REGISTRY.${key}.checks.${kind}`).toBe(
                    "function"
                );
            }
        }
    });

    it("does not register any StructuralKey field (type/count/zone/divideAsChosen/excludeSource/spellTargetsSelfSource)", () => {
        const keys = new Set(Object.keys(REGISTRY));
        for (const structural of [
            "type",
            "count",
            "zone",
            "divideAsChosen",
            "excludeSource",
            "spellTargetsSelfSource",
        ]) {
            expect(
                keys.has(structural),
                `REGISTRY should not have "${structural}"`
            ).toBe(false);
        }
    });
});

// ---------------------------------------------------------------------------
// sameController — CR 601.2c cross-slot constraint (issue #1104, Barrin's
// Spite: "Choose two target creatures controlled by the same player").
// Offered set (`getLegalTargets`) and accepted set (`checkPermanentTargetFilters`
// — the exact function `selectTarget` in game.ts calls, ADR 0068, no
// convex-test harness) both routed through `siblingControllerIdFor`.
// ---------------------------------------------------------------------------

describe("getLegalTargets: sameController (CR 601.2c, issue #1104)", () => {
    it("the FIRST pick is unconstrained — every creature from either player is legal", () => {
        const bear1 = makeCard({ id: "bear1", card: CREATURE });
        const bear2 = makeCard({
            id: "bear2",
            card: CREATURE,
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [bear1] }),
                makePlayer({ id: "p2", battlefield: [bear2] }),
            ],
        });
        const req: TargetRequirement = {
            type: "Creature",
            count: 2,
            sameController: true,
        };
        // No `alreadySelected` — nothing to compare against yet.
        const targets = getLegalTargets(state, req);
        expect(targets.map((t) => t.id).sort()).toEqual(["bear1", "bear2"]);
    });

    it("the SECOND pick is restricted to the first pick's live controller", () => {
        const bear1 = makeCard({ id: "bear1", card: CREATURE });
        const bear2 = makeCard({
            id: "bear2",
            card: CREATURE,
            controllerId: "p2",
            ownerId: "p2",
        });
        const bear3 = makeCard({ id: "bear3", card: CREATURE });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [bear1, bear3] }),
                makePlayer({ id: "p2", battlefield: [bear2] }),
            ],
        });
        const req: TargetRequirement = {
            type: "Creature",
            count: 2,
            sameController: true,
        };
        // bear1 (p1) already picked — the sameController filter now excludes
        // p2's bear2 from the offered set. (Self-exclusion of an
        // already-picked id for a multi-count SAME requirement is a separate,
        // pre-existing concern this filter does not address — `getLegalTargets`
        // reports every controller-matching candidate, bear1 included.)
        const targets = getLegalTargets(
            state,
            req,
            [],
            undefined,
            undefined,
            [],
            [],
            undefined,
            [{ type: "permanent", id: "bear1" }]
        );
        expect(targets.map((t) => t.id).sort()).toEqual(["bear1", "bear3"]);
    });

    it("siblingControllerIdFor: undefined when unset, when nothing selected, or when the sibling left the battlefield", () => {
        const state = makeGameState();
        expect(siblingControllerIdFor(state, undefined, [])).toBeUndefined();
        expect(siblingControllerIdFor(state, true, [])).toBeUndefined();
        expect(
            siblingControllerIdFor(state, true, [
                { type: "permanent", id: "gone" },
            ])
        ).toBeUndefined();
    });

    it("siblingControllerIdFor resolves the first selected permanent's live controller", () => {
        const bear1 = makeCard({
            id: "bear1",
            card: CREATURE,
            controllerId: "p2",
        });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1" }),
                makePlayer({ id: "p2", battlefield: [bear1] }),
            ],
        });
        expect(
            siblingControllerIdFor(state, true, [
                { type: "permanent", id: "bear1" },
            ])
        ).toBe("p2");
    });
});

describe("checkPermanentTargetFilters — sameController (ADR 0068, issue #1104, selectTarget authority)", () => {
    it("accepts a second target sharing the first's controller", () => {
        const bear2 = makeCard({
            id: "bear2",
            card: CREATURE,
            controllerId: "p1",
        });
        const ctx: TargetFilterCtx = {
            state: makeGameState(),
            sourceColors: [],
            sourceTypes: [],
            sourceSubtypes: [],
            activePlayerId: "p1",
            siblingControllerId: "p1",
        };
        expect(
            checkPermanentTargetFilters(ctx, bear2, { sameController: true })
        ).toBeNull();
    });

    it("rejects a second target controlled by a DIFFERENT player — the exact CR 601.2c gate selectTarget runs", () => {
        const bear2 = makeCard({
            id: "bear2",
            card: CREATURE,
            controllerId: "p2",
        });
        const ctx: TargetFilterCtx = {
            state: makeGameState(),
            sourceColors: [],
            sourceTypes: [],
            sourceSubtypes: [],
            activePlayerId: "p1",
            siblingControllerId: "p1",
        };
        const violation = checkPermanentTargetFilters(ctx, bear2, {
            sameController: true,
        });
        expect(violation).not.toBeNull();
    });

    it("imposes no constraint when siblingControllerId is undefined (first pick)", () => {
        const bear2 = makeCard({
            id: "bear2",
            card: CREATURE,
            controllerId: "p2",
        });
        const ctx: TargetFilterCtx = {
            state: makeGameState(),
            sourceColors: [],
            sourceTypes: [],
            sourceSubtypes: [],
            activePlayerId: "p1",
        };
        expect(
            checkPermanentTargetFilters(ctx, bear2, { sameController: true })
        ).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// getLegalTargets: player/graveyard-card parity (ADR 0068, T3, issue #1410).
// Regression coverage for the exact gap closed by this slice: `getLegalTargets`
// already honored `controller: "active"` for both player and graveyard-card
// targets; `selectTarget` (game.ts) never implemented it for either. Now both
// route through the SAME registry check, so the offered set (asserted here)
// and the accepted set (asserted via checkPlayerTargetFilters /
// checkCardTargetFilters above, since there's no convex-test harness, ADR
// 0001) can never diverge again.
// ---------------------------------------------------------------------------

describe("getLegalTargets: player controller 'active' (CR 102.1, T3 parity)", () => {
    it("offers only the active player's player-target regardless of chooser", () => {
        const state = makeGameState();
        const req: TargetRequirement = {
            type: "player",
            count: 1,
            controller: "active",
        };
        // Chooser p2, active player p1 (default makeGameState activePlayerId).
        const targets = getLegalTargets(state, req, [], "p2");
        expect(targets).toEqual([{ type: "player", id: "p1" }]);
    });
});

describe("getLegalTargets: graveyard-card zone targeting (CR 400.7 / 109.2, T3 parity)", () => {
    function graveyardState() {
        const mine = makeCard({
            id: "gy-mine",
            card: CREATURE,
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const theirs = makeCard({
            id: "gy-theirs",
            card: CREATURE,
            zone: "graveyard",
            controllerId: "p2",
            ownerId: "p2",
        });
        return makeGameState({
            players: [
                makePlayer({ id: "p1", graveyard: [mine] }),
                makePlayer({ id: "p2", graveyard: [theirs] }),
            ],
        });
    }

    it("controller:'you' offers only the chooser's own graveyard card", () => {
        const state = graveyardState();
        const req: TargetRequirement = {
            type: "Creature",
            count: 1,
            zone: "graveyard",
            controller: "you",
        };
        const targets = getLegalTargets(state, req, [], "p1");
        expect(targets).toEqual([
            { type: "graveyard-card", id: "gy-mine", playerId: "p1" },
        ]);
    });

    it("controller:'opponent' offers only the opponent's graveyard card", () => {
        const state = graveyardState();
        const req: TargetRequirement = {
            type: "Creature",
            count: 1,
            zone: "graveyard",
            controller: "opponent",
        };
        const targets = getLegalTargets(state, req, [], "p1");
        expect(targets).toEqual([
            { type: "graveyard-card", id: "gy-theirs", playerId: "p2" },
        ]);
    });

    it("controller:'active' offers only the active player's graveyard card, regardless of chooser (the exact gap this slice closes at selectTarget)", () => {
        const state = graveyardState(); // activePlayerId defaults to "p1"
        const req: TargetRequirement = {
            type: "Creature",
            count: 1,
            zone: "graveyard",
            controller: "active",
        };
        const targets = getLegalTargets(state, req, [], "p2");
        expect(targets).toEqual([
            { type: "graveyard-card", id: "gy-mine", playerId: "p1" },
        ]);
    });

    it("mvFilter restricts graveyard-card targets by mana value (Sevinne's Reclamation)", () => {
        const cheap = makeCard({
            id: "gy-cheap",
            card: { id: "test-gy-cheap", manaCost: { generic: 1 } },
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const expensive = makeCard({
            id: "gy-expensive",
            card: { id: "test-gy-expensive", manaCost: { generic: 5 } },
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", graveyard: [cheap, expensive] }),
                makePlayer({ id: "p2" }),
            ],
        });
        const req: TargetRequirement = {
            type: "card",
            count: 1,
            zone: "graveyard",
            mvFilter: { max: 3 },
        };
        const targets = getLegalTargets(state, req);
        expect(targets).toEqual([
            { type: "graveyard-card", id: "gy-cheap", playerId: "p1" },
        ]);
    });

    it("excludeTypes: 'Land' excludes a DUAL-TYPED land Creature from a graveyard-card target, includes a plain Creature (issue #1378 review follow-up, Guardian Scalelord's 'nonland permanent card')", () => {
        // CR 300.1 — a permanent can have BOTH "Land" and "Creature" among its
        // printed types (Dryad Arbor). A graveyard-zone requirement's own
        // STRUCTURAL `type` field is a plain OR-membership test with no
        // negation, so `type: PERMANENT_TYPES` alone (no `excludeTypes`)
        // would wrongly admit this card via its "Creature" membership even
        // under a "nonland" restriction — exactly what `excludeTypes`'s NEW
        // `card` check (`excludeTypesDescriptor`, `targetFilters.ts`) closes.
        const landCreature = makeCard({
            id: "gy-land-creature",
            card: { id: "test-gy-land-creature", manaCost: { generic: 0 } },
            types: ["Land", "Creature"],
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const plainCreature = makeCard({
            id: "gy-plain-creature",
            card: { id: "test-gy-plain-creature", manaCost: { generic: 2 } },
            types: ["Creature"],
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeGameState({
            players: [
                makePlayer({
                    id: "p1",
                    graveyard: [landCreature, plainCreature],
                }),
                makePlayer({ id: "p2" }),
            ],
        });
        const req: TargetRequirement = {
            type: [
                "Artifact",
                "Battle",
                "Creature",
                "Enchantment",
                "Planeswalker",
            ],
            count: 1,
            zone: "graveyard",
            excludeTypes: "Land",
        };
        const targets = getLegalTargets(state, req, [], "p1");
        expect(targets).toEqual([
            { type: "graveyard-card", id: "gy-plain-creature", playerId: "p1" },
        ]);
    });
});

// ---------------------------------------------------------------------------
// mvFilter "sourcePower" — dynamic power-based cap (issue #1378, Guardian
// Scalelord: "return target nonland permanent card with mana value X or
// less from your graveyard to the battlefield, where X is this creature's
// power", CR 603.3d). Mirrors the literal-cap mvFilter suite above; proves
// the new grammar member resolves against the announced `sourcePower`
// argument instead of a static bound, and that `getTriggerSourcePower`
// reads the LIVE battlefield permanent (not a stale snapshot).
// ---------------------------------------------------------------------------

describe("mvFilter 'sourcePower' — dynamic power-based cap (issue #1378, CR 603.3d)", () => {
    function graveyardPowerState() {
        const cheap = makeCard({
            id: "gy-cheap",
            card: { id: "test-gy-cheap-power", manaCost: { generic: 2 } },
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const pricey = makeCard({
            id: "gy-pricey",
            card: { id: "test-gy-pricey-power", manaCost: { generic: 4 } },
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", graveyard: [cheap, pricey] }),
                makePlayer({ id: "p2" }),
            ],
        });
        return { state, cheap, pricey };
    }

    const dynamicReq: TargetRequirement = {
        type: "card",
        count: 1,
        zone: "graveyard",
        controller: "you",
        mvFilter: { max: "sourcePower" },
    };

    it("regression: a LITERAL mvFilter.max still resolves to a plain number cap, unaffected by the new sentinel", () => {
        const { state } = graveyardPowerState();
        const literalReq: TargetRequirement = {
            ...dynamicReq,
            mvFilter: { max: 3 },
        };
        // A large sourcePower argument must NOT leak into a literal bound.
        const targets = getLegalTargets(
            state,
            literalReq,
            [],
            "p1",
            undefined,
            [],
            [],
            false,
            [],
            999
        );
        expect(targets).toEqual([
            { type: "graveyard-card", id: "gy-cheap", playerId: "p1" },
        ]);
    });

    it("'sourcePower' resolves the cap to the announced sourcePower argument", () => {
        const { state } = graveyardPowerState();
        const atTwo = getLegalTargets(
            state,
            dynamicReq,
            [],
            "p1",
            undefined,
            [],
            [],
            false,
            [],
            2
        );
        expect(atTwo).toEqual([
            { type: "graveyard-card", id: "gy-cheap", playerId: "p1" },
        ]);
        // An unthreaded call (no sourcePower argument) falls back to 0
        // (CR 608.2b convention) — neither graveyard card qualifies.
        const unthreaded = getLegalTargets(state, dynamicReq, [], "p1");
        expect(unthreaded).toEqual([]);
    });

    it("the cap TRACKS a power change — a higher source power widens the legal set", () => {
        const { state } = graveyardPowerState();
        const before = getLegalTargets(
            state,
            dynamicReq,
            [],
            "p1",
            undefined,
            [],
            [],
            false,
            [],
            2
        );
        expect(before).toEqual([
            { type: "graveyard-card", id: "gy-cheap", playerId: "p1" },
        ]);
        // SAME state, source now read at power 4 (e.g. buffed by a +1/+1
        // counter before this attack trigger's target is chosen) — the
        // mv-4 card is now ALSO legal.
        const after = getLegalTargets(
            state,
            dynamicReq,
            [],
            "p1",
            undefined,
            [],
            [],
            false,
            [],
            4
        );
        expect(after).toHaveLength(2);
        expect(after).toEqual(
            expect.arrayContaining([
                { type: "graveyard-card", id: "gy-cheap", playerId: "p1" },
                { type: "graveyard-card", id: "gy-pricey", playerId: "p1" },
            ])
        );
    });

    it("getTriggerSourcePower reads the LIVE effective power (CR 613 layer 7c) off the battlefield permanent, counters included", () => {
        const base = makeCard({
            id: "scalelord",
            types: ["Creature"],
            power: 3,
            toughness: 4,
        });
        const buffed = makeCard({
            id: "scalelord",
            types: ["Creature"],
            power: 3,
            toughness: 4,
            counters: { "+1/+1": 2 },
        });
        const baseState = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [base] }),
                makePlayer({ id: "p2" }),
            ],
        });
        const buffedState = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [buffed] }),
                makePlayer({ id: "p2" }),
            ],
        });
        expect(getTriggerSourcePower(baseState, "scalelord")).toBe(3);
        expect(getTriggerSourcePower(buffedState, "scalelord")).toBe(5);
    });

    it("getTriggerSourcePower falls back to 0 when the source can't be found (CR 608.2b) or is undefined", () => {
        const state = makeGameState();
        expect(getTriggerSourcePower(state, "not-on-any-battlefield")).toBe(0);
        expect(getTriggerSourcePower(state, undefined)).toBe(0);
    });

    it("pendingTargetFiltersFromRequirement carries the sourcePower-RESOLVED mvFilter (a plain number) onto the PendingTarget", () => {
        const pt = pendingTargetFiltersFromRequirement(
            dynamicReq,
            undefined,
            3
        );
        expect(pt.mvFilter).toEqual({ max: 3 });
    });
});

// ---------------------------------------------------------------------------
// pendingTargetFiltersFromRequirement — player/card filter carry-completeness
// (ADR 0068, T3, issue #1410). Mirrors the spell carry-completeness suite
// above: a requirement setting a player-only or card-only field must survive
// onto the interactive PendingTarget with the SAME resolution getLegalTargets
// and selectTarget use — dropping the carry silently regresses the offered
// set back to divergence-prone (the Phelia bug class this whole registry
// exists to close).
// ---------------------------------------------------------------------------

describe("pendingTargetFiltersFromRequirement — player/card filter carry-completeness (issue #1410)", () => {
    it("carries controller + playerAttackedThisTurn onto the PendingTarget for a player requirement", () => {
        const req: TargetRequirement = {
            type: "player",
            count: 1,
            controller: "opponent",
            playerAttackedThisTurn: true,
        };
        const pt = pendingTargetFiltersFromRequirement(req, undefined);
        expect(pt.controller).toBe("opponent");
        expect(pt.playerAttackedThisTurn).toBe(true);
    });

    it("does NOT carry playerAttackedThisTurn for a permanent-only requirement", () => {
        const req: TargetRequirement = {
            type: "Creature",
            count: 1,
            playerAttackedThisTurn: true,
        };
        const pt = pendingTargetFiltersFromRequirement(req, undefined);
        expect(pt.playerAttackedThisTurn).toBeUndefined();
    });

    it("DOES carry playerAttackedThisTurn for an 'any' requirement (CR 115.4)", () => {
        const req: TargetRequirement = {
            type: "any",
            count: 1,
            playerAttackedThisTurn: true,
        };
        const pt = pendingTargetFiltersFromRequirement(req, undefined);
        expect(pt.playerAttackedThisTurn).toBe(true);
    });

    it("carries controller + mvFilter onto the PendingTarget for a graveyard-zone requirement", () => {
        const req: TargetRequirement = {
            type: "Creature",
            count: 1,
            zone: "graveyard",
            controller: "you",
            mvFilter: { max: 3 },
        };
        const pt = pendingTargetFiltersFromRequirement(req, undefined);
        expect(pt.controller).toBe("you");
        expect(pt.mvFilter).toEqual({ max: 3 });
        expect(pt.zone).toBe("graveyard");
    });
});

// ---------------------------------------------------------------------------
// Counterspell — CR 701.5a
// "Counter target spell."
// ---------------------------------------------------------------------------

import { counterspell, lightningBolt, giantGrowth } from "../../cards/sets/lea";

describe("spell resolution: Counterspell (CR 701.5a)", () => {
    function makeCounterspellItem(
        castBy: string,
        targets: StackItem["targets"]
    ): StackItem {
        return {
            ...makeCard({
                id: crypto.randomUUID(),
                card: {
                    id: counterspell.id,
                    name: counterspell.name,
                    types: counterspell.types,
                },
                types: counterspell.types,
                zone: "stack",
                ownerId: castBy,
                controllerId: castBy,
            }),
            castById: castBy,
            targets,
        };
    }

    function makeBoltItem(castBy: string): StackItem {
        return {
            ...makeCard({
                id: crypto.randomUUID(),
                card: {
                    id: lightningBolt.id,
                    name: lightningBolt.name,
                    types: lightningBolt.types,
                },
                types: lightningBolt.types,
                zone: "stack",
                ownerId: castBy,
                controllerId: castBy,
            }),
            castById: castBy,
            targets: [{ type: "player", id: "p1" }],
        };
    }

    it("counters target spell: target goes to its owner's graveyard (CR 701.5a)", () => {
        const state = makeGameState();
        const bolt = makeBoltItem("p2");
        state.stack.push(bolt);
        const counter = makeCounterspellItem("p1", [
            { type: "spell", id: bolt.id },
        ]);
        state.stack.push(counter);

        resolveTopOfStack(state); // resolve Counterspell (top)

        // Stack is empty after Counterspell resolves
        expect(state.stack).toHaveLength(0);
        // Bolt never resolves — p1 still at 20 life
        expect(getPlayer(state, "p1").life).toBe(20);
        // Bolt goes to its owner's (p2) graveyard
        const p2Grave = getPlayer(state, "p2").graveyard;
        expect(p2Grave).toHaveLength(1);
        expect((p2Grave[0].card as { id: string }).id).toBe(lightningBolt.id);
        // Counterspell goes to its own owner's (p1) graveyard (CR 608.2k)
        const p1Grave = getPlayer(state, "p1").graveyard;
        expect(p1Grave).toHaveLength(1);
        expect((p1Grave[0].card as { id: string }).id).toBe(counterspell.id);
    });

    it("counters a creature spell before it enters the battlefield", () => {
        const state = makeGameState();
        const bearSpell: StackItem = {
            ...makeCard({
                id: "bear-spell",
                card: { name: "Bear", types: ["Creature"] },
                types: ["Creature"],
                zone: "stack",
                ownerId: "p2",
                controllerId: "p2",
            }),
            castById: "p2",
        };
        state.stack.push(bearSpell);
        state.stack.push(
            makeCounterspellItem("p1", [{ type: "spell", id: "bear-spell" }])
        );

        resolveTopOfStack(state);

        // Bear never hits the battlefield
        expect(getPlayer(state, "p2").battlefield).toHaveLength(0);
        // Bear goes to p2's graveyard (not battlefield)
        expect(getPlayer(state, "p2").graveyard).toHaveLength(1);
        expect(getPlayer(state, "p2").graveyard[0].id).toBe("bear-spell");
    });

    it("Counterspell countering Counterspell: double counter", () => {
        const state = makeGameState();
        const bolt = makeBoltItem("p1");
        state.stack.push(bolt); // index 0

        const cs1 = makeCounterspellItem("p2", [
            { type: "spell", id: bolt.id },
        ]);
        state.stack.push(cs1); // index 1: counter the Bolt

        const cs2 = makeCounterspellItem("p1", [{ type: "spell", id: cs1.id }]);
        state.stack.push(cs2); // index 2 (top): counter cs1

        // Resolve cs2 (top) → counters cs1
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].id).toBe(bolt.id);
        // cs1 goes to p2's graveyard; cs2 goes to p1's graveyard
        expect(getPlayer(state, "p2").graveyard).toHaveLength(1);
        expect(getPlayer(state, "p1").graveyard).toHaveLength(1);

        // Now resolve bolt → deals 3 to p1
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
        expect(getPlayer(state, "p1").life).toBe(17);
    });

    it("fizzles silently when target is no longer on stack (CR 608.2b)", () => {
        const state = makeGameState();
        // Counterspell targeting a non-existent id (e.g. already countered)
        const counter = makeCounterspellItem("p1", [
            { type: "spell", id: "ghost-spell" },
        ]);
        state.stack.push(counter);

        resolveTopOfStack(state);

        // No crash; Counterspell still goes to graveyard
        expect(state.stack).toHaveLength(0);
        expect(getPlayer(state, "p1").graveyard).toHaveLength(1);
        expect(
            (getPlayer(state, "p1").graveyard[0].card as { id: string }).id
        ).toBe(counterspell.id);
    });

    it("counters a targeted spell without applying its effect", () => {
        // Giant Growth on p1's creature, then Counterspell: creature stays 1/1
        const state = makeGameState();
        const elf = makeCard({
            id: "elf1",
            card: {
                name: "Llanowar Elves",
                types: ["Creature"],
                power: 1,
                toughness: 1,
            },
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            power: 1,
            toughness: 1,
        });
        getPlayer(state, "p1").battlefield.push(elf);

        const growth: StackItem = {
            ...makeCard({
                id: "gg-spell",
                card: {
                    id: giantGrowth.id,
                    name: giantGrowth.name,
                    types: giantGrowth.types,
                },
                types: giantGrowth.types,
                zone: "stack",
                ownerId: "p1",
                controllerId: "p1",
            }),
            castById: "p1",
            targets: [{ type: "permanent", id: "elf1" }],
        };
        state.stack.push(growth);

        state.stack.push(
            makeCounterspellItem("p2", [{ type: "spell", id: "gg-spell" }])
        );

        // Resolve Counterspell
        resolveTopOfStack(state);

        // Giant Growth did NOT resolve — elf stays 1/1
        const elfAfter = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "elf1"
        );
        expect(elfAfter?.power).toBe(1);
        expect(elfAfter?.toughness).toBe(1);
        // gg-spell is in p1's graveyard
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === "gg-spell")
        ).toBe(true);
    });

    it("counters an activated ability: ability item is removed but no card moves", () => {
        // Build a fake activated ability on the stack
        const state = makeGameState();
        const abilityItem: StackItem = {
            ...makeCard({
                id: "ability1",
                card: {
                    id: "some-source-id",
                    name: "Source Permanent",
                    types: ["Artifact"],
                },
                types: ["Artifact"],
                zone: "stack",
                ownerId: "p2",
                controllerId: "p2",
            }),
            castById: "p2",
            abilityId: "ability-slot-1",
        };
        state.stack.push(abilityItem);

        state.stack.push(
            makeCounterspellItem("p1", [{ type: "spell", id: "ability1" }])
        );

        resolveTopOfStack(state);

        // Stack emptied; ability item vanishes (not a card, doesn't go to graveyard).
        expect(state.stack).toHaveLength(0);
        expect(getPlayer(state, "p2").graveyard).toHaveLength(0);
        // Counterspell itself still goes to p1's graveyard.
        expect(getPlayer(state, "p1").graveyard).toHaveLength(1);
    });

    it("ignores non-spell target passed to Counterspell (defensive)", () => {
        // Counterspell's resolve guards against non-spell targets — no crash,
        // spell simply fizzles to graveyard without countering anything.
        const state = makeGameState();
        const bolt = makeBoltItem("p2");
        state.stack.push(bolt);
        // Malformed targets: a player instead of a spell.
        state.stack.push(
            makeCounterspellItem("p1", [{ type: "player", id: "p2" }])
        );

        resolveTopOfStack(state);

        // Bolt is still on the stack (not countered)
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].id).toBe(bolt.id);
        // Counterspell still goes to p1's graveyard
        expect(getPlayer(state, "p1").graveyard).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Shroud / "can't be the target" backend gate (#382, CR 702.18 / 611 / 109.5)
//
// Mirrors the exact decision the `selectTarget` mutation makes server-side:
// locate the pending source's types + subtypes + spell-vs-ability, then call
// `isGuardedAgainst("cantBeTargeted", source)`. This is the authoritative
// rejection — `selectTarget` throws when it returns true.
// ---------------------------------------------------------------------------

describe("can't-be-targeted backend gate (#382)", () => {
    // Real shipped C6 cards (registry-resolved by id).
    const SPECTRAL_CLOAK = "7524fd0d-a675-41d6-bc99-bd3ba336893b";
    const ANTI_MAGIC_AURA = "ff78eef1-efaa-4a12-bf5d-fec83c14aff8";
    const BARTEL_RUNEAXE = "f1a42691-98bb-4234-9b56-085e6677f3e4";

    it("getPendingTargetSourceSubtypes reads the cast source's subtypes", () => {
        // A spell waiting in hand carrying the Aura subtype.
        const auraSpell = makeCard({
            id: ANTI_MAGIC_AURA,
            zone: "hand",
            subtypes: ["Aura"],
        });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", hand: [auraSpell] }),
                makePlayer({ id: "p2" }),
            ],
        });
        expect(
            getPendingTargetSourceSubtypes(state, auraSpell.id, "cast")
        ).toEqual(["Aura"]);
    });

    it("rejects a spell targeting an untapped Spectral-Cloaked creature", () => {
        const bear = makeCard({
            id: "bear",
            card: CREATURE,
            isTapped: false,
        });
        const cloak = makeCard({
            id: "cloak",
            card: { id: SPECTRAL_CLOAK },
        });
        // makeCard does not spread arbitrary overrides — set the host link.
        cloak.attachedTo = "bear";
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [bear, cloak] }),
                makePlayer({ id: "p2" }),
            ],
        });
        // Server gate: a spell source can't pick the cloaked bear.
        expect(
            isGuardedAgainst(state, bear, "cantBeTargeted", { isSpell: true })
        ).toBe(true);
    });

    it("Anti-Magic Aura host: rejects spell, accepts ability", () => {
        const bear = makeCard({ id: "bear", card: CREATURE });
        const aura = makeCard({
            id: "aura",
            card: { id: ANTI_MAGIC_AURA },
        });
        aura.attachedTo = "bear";
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [bear, aura] }),
                makePlayer({ id: "p2" }),
            ],
        });
        expect(
            isGuardedAgainst(state, bear, "cantBeTargeted", { isSpell: true })
        ).toBe(true);
        // An activated/triggered ability source is NOT a spell (CR 113.3).
        expect(
            isGuardedAgainst(state, bear, "cantBeTargeted", { isSpell: false })
        ).toBe(false);
    });

    it("Bartel Runeaxe: rejects an Aura spell only", () => {
        const bartel = makeCard({
            id: "bartel",
            card: { id: BARTEL_RUNEAXE },
        });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [bartel] }),
                makePlayer({ id: "p2" }),
            ],
        });
        // Aura spell → rejected.
        expect(
            isGuardedAgainst(state, bartel, "cantBeTargeted", {
                subtypes: ["Aura"],
                isSpell: true,
            })
        ).toBe(true);
        // Non-Aura spell → accepted.
        expect(
            isGuardedAgainst(state, bartel, "cantBeTargeted", {
                subtypes: [],
                isSpell: true,
            })
        ).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Hexproof backend gate (#958, CR 702.11b)
//
// The `selectTarget` mutation threads the SELECTING player (args.playerId) as
// the guard's `controllerId`. Hexproof — the controller-relative cousin of
// shroud — bars the target only when that controller differs from the
// permanent's controller: an opponent's spell/ability is rejected server-side,
// the permanent's own controller is accepted. Mirrors the exact decision the
// mutation makes.
// ---------------------------------------------------------------------------

describe("hexproof backend gate (#958, CR 702.11b)", () => {
    const SYLVAN_CARYATID = "d40b65c1-b24d-492d-81b9-d8474ebdc08c";

    const makeBoard = () => {
        const caryatid = makeCard({
            id: "caryatid",
            card: { id: SYLVAN_CARYATID },
        });
        caryatid.controllerId = "p1";
        caryatid.ownerId = "p1";
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [caryatid] }),
                makePlayer({ id: "p2" }),
            ],
        });
        return { state, caryatid };
    };

    it("rejects an opponent's spell/ability (controllerId = opponent)", () => {
        const { state, caryatid } = makeBoard();
        // Opponent's Lightning Bolt (a spell) — rejected.
        expect(
            isGuardedAgainst(state, caryatid, "cantBeTargeted", {
                types: ["Instant"],
                isSpell: true,
                controllerId: "p2",
            })
        ).toBe(true);
        // Opponent's activated ability (not a spell) — also rejected (702.11b
        // covers spells AND abilities).
        expect(
            isGuardedAgainst(state, caryatid, "cantBeTargeted", {
                isSpell: false,
                controllerId: "p2",
            })
        ).toBe(true);
    });

    it("accepts the permanent's own controller's spell/ability", () => {
        const { state, caryatid } = makeBoard();
        // p1's own aura / pump — accepted.
        expect(
            isGuardedAgainst(state, caryatid, "cantBeTargeted", {
                subtypes: ["Aura"],
                isSpell: true,
                controllerId: "p1",
            })
        ).toBe(false);
    });

    it("stays conservative (rejects) when the source controller is unknown", () => {
        const { state, caryatid } = makeBoard();
        expect(
            isGuardedAgainst(state, caryatid, "cantBeTargeted", {
                isSpell: true,
            })
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Player-scoped shroud (CR 702.18 applied to a player via CR 115.4, #1128)
//
// A player-level sibling of the `permanent-guard`/`isGuardedAgainst` suite
// above: `StaticPlayerGuard` (`kind: "player-guard"`) is materialized/derived
// like `StaticHandSizeOverride` (player-scoped, no per-permanent `applies`
// predicate) and read by `playerHasShroud`. No shipped card grants this yet
// (Solitary Confinement is the real consumer, the blocked-by child of
// #1058) — verified here with a fixture permanent registered via
// `registerTokenDefinition`, mirroring `intervening-if.test.ts`'s
// synthetic-card pattern ("no real card this slice", per the issue).
// ---------------------------------------------------------------------------

const PLAYER_SHROUD_SOURCE_ID = "test-player-shroud-source";
const playerShroudFixture: CardDefinition = {
    id: PLAYER_SHROUD_SOURCE_ID,
    name: "Test Player Shroud Source",
    rarity: "common",
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "player-guard",
            id: "test-player-shroud",
            cantBeTargeted: true,
        },
    ],
};

beforeAll(() => {
    registerTokenDefinition(playerShroudFixture);
});

function makeShroudSource(controllerId = "p1"): CardInstanceState {
    return makeCard({
        id: "shroud-source",
        card: { id: PLAYER_SHROUD_SOURCE_ID },
        controllerId,
        ownerId: controllerId,
    });
}

describe("player-scoped shroud (CR 702.18 / 115.4, #1128)", () => {
    it("playerHasShroud is true for the granting permanent's controller, false otherwise", () => {
        const source = makeShroudSource("p1");
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [source] }),
                makePlayer({ id: "p2" }),
            ],
        });
        expect(playerHasShroud(state, "p1")).toBe(true);
        // Non-shrouded player unaffected — no regression.
        expect(playerHasShroud(state, "p2")).toBe(false);
    });

    it("getLegalTargets excludes the shrouded player from player candidates (regression: non-shrouded player stays targetable)", () => {
        const source = makeShroudSource("p1");
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [source] }),
                makePlayer({ id: "p2" }),
            ],
        });
        const req: TargetRequirement = { type: "player", count: 1 };
        const targets = getLegalTargets(state, req);
        expect(targets).toEqual([{ type: "player", id: "p2" }]);
    });

    it("backend gate: mirrors the exact decision game.ts::selectTarget's player branch makes (server-authoritative)", () => {
        // selectTarget's player branch calls `playerHasShroud(state, found.id)`
        // and throws when it returns true — this replicates that decision the
        // same way the "can't-be-targeted backend gate" suite above does for
        // the permanent branch's `isGuardedAgainst` call.
        const source = makeShroudSource("p1");
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [source] }),
                makePlayer({ id: "p2" }),
            ],
        });
        expect(playerHasShroud(state, "p1")).toBe(true); // rejected
        expect(playerHasShroud(state, "p2")).toBe(false); // accepted
    });

    it("shroud exclusion survives the wire-format projection (#1128)", () => {
        const source = makeShroudSource("p1");
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [source] }),
                makePlayer({ id: "p2" }),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        // The guard reads card definitions by id from the registry, so the
        // restriction must hold on the slim projected state too.
        expect(playerHasShroud(projected, "p1")).toBe(true);
        expect(playerHasShroud(projected, "p2")).toBe(false);

        const req: TargetRequirement = { type: "player", count: 1 };
        const projectedTargets = getLegalTargets(
            projected as unknown as GameState,
            req
        );
        expect(projectedTargets).toEqual([{ type: "player", id: "p2" }]);
    });

    it("appliesTo defaults to 'controller' — a copy of the source controlled by the other player shrouds that player instead", () => {
        const source = makeShroudSource("p2");
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1" }),
                makePlayer({ id: "p2", battlefield: [source] }),
            ],
        });
        expect(playerHasShroud(state, "p2")).toBe(true);
        expect(playerHasShroud(state, "p1")).toBe(false);
    });
});
