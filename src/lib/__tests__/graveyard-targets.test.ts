import { describe, it, expect } from "vitest";
import type { CardInstance, PendingTarget, Player } from "~/types/game";
import {
    getEligibleGraveyards,
    isGraveyardTargetForViewer,
    matchesGraveyardTarget,
} from "~/lib/graveyard-targets";
import { projectPublicState } from "@convex/gameProjections";
import type {
    CardInstanceState,
    GameState,
    PlayerState,
} from "@convex/gre/state";

function gyCard(
    id: string,
    ownerId: string,
    types: string[],
    manaCost?: Record<string, number>
): CardInstance {
    return {
        id,
        card: { id: `def-${id}`, ...(manaCost ? { manaCost } : {}) },
        controllerId: ownerId,
        ownerId,
        zone: "graveyard",
        isTapped: false,
        types,
    } as CardInstance;
}

function player(id: string, graveyard: CardInstance[]): Player {
    return {
        id,
        name: id === "me" ? "Me" : "Opp",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard,
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

function pending(over: Partial<PendingTarget>): PendingTarget {
    return {
        playerId: "me",
        cardInstanceId: "src",
        targetType: "Creature",
        count: 1,
        zone: "graveyard",
        selected: [],
        ...over,
    } as PendingTarget;
}

describe("isGraveyardTargetForViewer", () => {
    it("true only for a graveyard-zone target owned by the viewer", () => {
        expect(
            isGraveyardTargetForViewer(pending({ playerId: "me" }), "me")
        ).toBe(true);
        expect(
            isGraveyardTargetForViewer(pending({ playerId: "opp" }), "me")
        ).toBe(false);
        expect(
            isGraveyardTargetForViewer(pending({ zone: "battlefield" }), "me")
        ).toBe(false);
        expect(isGraveyardTargetForViewer(undefined, "me")).toBe(false);
    });
});

describe("matchesGraveyardTarget (mirror of server filter, CR 109.2)", () => {
    it("controller 'you' rejects the opponent's graveyard", () => {
        const card = gyCard("c", "opp", ["Creature"]);
        expect(
            matchesGraveyardTarget(
                card,
                "opp",
                pending({ controller: "you" }),
                "me"
            )
        ).toBe(false);
    });
    it("controller 'opponent' rejects the viewer's own graveyard", () => {
        const card = gyCard("c", "me", ["Creature"]);
        expect(
            matchesGraveyardTarget(
                card,
                "me",
                pending({ controller: "opponent" }),
                "me"
            )
        ).toBe(false);
    });
    it("controller 'any' accepts either graveyard", () => {
        expect(
            matchesGraveyardTarget(
                gyCard("c", "opp", ["Creature"]),
                "opp",
                pending({ controller: "any" }),
                "me"
            )
        ).toBe(true);
    });
    it("rejects a card whose type does not match the requirement", () => {
        const land = gyCard("l", "me", ["Land"]);
        expect(
            matchesGraveyardTarget(
                land,
                "me",
                pending({ targetType: "Creature" }),
                "me"
            )
        ).toBe(false);
    });
    it("type 'card' matches any card type", () => {
        const land = gyCard("l", "me", ["Land"]);
        expect(
            matchesGraveyardTarget(
                land,
                "me",
                pending({ targetType: "card" }),
                "me"
            )
        ).toBe(true);
    });
});

// issue #1378 (Guardian Scalelord's dynamic power-based mana-value ceiling):
// `PendingTarget.mvFilter` was previously NEVER checked here — the server
// already resolves any `"X"` / `"sourcePower"` sentinel into a plain number
// bound before it ever reaches `PendingTarget`
// (`pendingTargetFiltersFromRequirement`, `gre/rules.ts`), so the client only
// ever needs to compare against a resolved bound, same as `matchesMvFilter`
// (`gre/targetFilters.ts`) does server-side. Closes a pre-existing gap
// affecting every mvFilter-restricted graveyard target (Sevinne's
// Reclamation, sos/multicolor.ts, ulg/black.ts), not just this new card.
describe("matchesGraveyardTarget — mvFilter (CR 202.3, issue #1378)", () => {
    it("accepts a card within the resolved mana-value bound, rejects one outside it", () => {
        const cheap = gyCard("cheap", "me", ["Creature"], { generic: 2 });
        const pricey = gyCard("pricey", "me", ["Creature"], { generic: 4 });
        const pt = pending({ mvFilter: { max: 3 } });
        expect(matchesGraveyardTarget(cheap, "me", pt, "me")).toBe(true);
        expect(matchesGraveyardTarget(pricey, "me", pt, "me")).toBe(false);
    });

    it("mvFilter still applies when targetType is the catch-all 'card' (the short-circuit this fix removed)", () => {
        const pricey = gyCard("pricey2", "me", ["Artifact"], { generic: 5 });
        const pt = pending({ targetType: "card", mvFilter: { max: 3 } });
        expect(matchesGraveyardTarget(pricey, "me", pt, "me")).toBe(false);
    });

    it("no mvFilter on the PendingTarget leaves the target unrestricted by mana value", () => {
        const pricey = gyCard("pricey3", "me", ["Creature"], { generic: 9 });
        const pt = pending({});
        expect(matchesGraveyardTarget(pricey, "me", pt, "me")).toBe(true);
    });

    it("mvFilter.min / .equals are also enforced, mirroring the server's matchesMvFilter", () => {
        const three = gyCard("three", "me", ["Creature"], { generic: 3 });
        expect(
            matchesGraveyardTarget(
                three,
                "me",
                pending({ mvFilter: { min: 4 } }),
                "me"
            )
        ).toBe(false);
        expect(
            matchesGraveyardTarget(
                three,
                "me",
                pending({ mvFilter: { equals: 2 } }),
                "me"
            )
        ).toBe(false);
        expect(
            matchesGraveyardTarget(
                three,
                "me",
                pending({ mvFilter: { equals: 3 } }),
                "me"
            )
        ).toBe(true);
    });
});

// issue #1378 review follow-up: `PendingTarget.excludeTypes` (CR 109.1, the
// Phelia "nonland permanent" idiom, now also checked for a graveyard CARD
// candidate server-side — see `excludeTypesDescriptor`'s new `card` check,
// `gre/targetFilters.ts`) was likewise never checked here. A DUAL-TYPED card
// (a land Creature) can satisfy a POSITIVE `targetType` match while still
// needing to be excluded — checked independently, not folded into the
// positive-type branch above.
describe("matchesGraveyardTarget — excludeTypes (CR 109.1, issue #1378)", () => {
    it("excludes a DUAL-TYPED land Creature even though it matches the positive 'Creature' targetType", () => {
        const landCreature = gyCard("land-creature", "me", [
            "Land",
            "Creature",
        ]);
        const pt = pending({
            targetType: "Creature",
            excludeTypes: ["Land"],
        });
        expect(matchesGraveyardTarget(landCreature, "me", pt, "me")).toBe(
            false
        );
    });

    it("includes a plain Creature (no excluded type present)", () => {
        const plainCreature = gyCard("plain-creature", "me", ["Creature"]);
        const pt = pending({
            targetType: "Creature",
            excludeTypes: ["Land"],
        });
        expect(matchesGraveyardTarget(plainCreature, "me", pt, "me")).toBe(
            true
        );
    });

    it("no excludeTypes on the PendingTarget leaves the target unrestricted", () => {
        const landCreature = gyCard("land-creature2", "me", [
            "Land",
            "Creature",
        ]);
        const pt = pending({ targetType: "Creature" });
        expect(matchesGraveyardTarget(landCreature, "me", pt, "me")).toBe(true);
    });
});

// Wiring-rule compliance (`.claude/rules/gre-development.md` § Frontend
// wiring analysis): drives the SAME excludeTypes/mvFilter assertion through
// the real server projection (`projectPublicState`) instead of a hand-built
// `PendingTarget`/`CardInstance` — `pendingTarget` and a graveyard card's
// `types` cross the wire untouched (`projectPublicState` spreads
// `...state` for `pendingTarget` and `slimCard` preserves `types` on a
// graveyard card), so this proves the client-visible wire shape, not just
// the hand-rolled fixture shape the suite above uses.
describe("matchesGraveyardTarget — driven through projectPublicState (wiring rule)", () => {
    function makeInstance(
        overrides: Partial<CardInstanceState> = {}
    ): CardInstanceState {
        return {
            id: "gy-1",
            card: { id: "def-gy-1" },
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
            types: ["Creature"],
            subtypes: [],
            staticAbilities: [],
            isTapped: false,
            ...overrides,
        } as CardInstanceState;
    }

    function makeServerPlayer(
        id: string,
        graveyard: CardInstanceState[]
    ): PlayerState {
        return {
            id,
            name: id,
            bgColor: "#000",
            life: 20,
            hand: [],
            library: [],
            graveyard,
            exile: [],
            battlefield: [],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        };
    }

    it("a projected PendingTarget with excludeTypes still bars a projected dual-typed land Creature", () => {
        const landCreature = makeInstance({
            id: "gy-land-creature",
            types: ["Land", "Creature"],
        });
        const plainCreature = makeInstance({
            id: "gy-plain-creature",
            types: ["Creature"],
        });
        const state: GameState = {
            players: [
                makeServerPlayer("p1", [landCreature, plainCreature]),
                makeServerPlayer("p2", []),
            ],
            stack: [],
            turn: 1,
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            passCount: 0,
            phase: "PRECOMBAT_MAIN",
            rngSeed: 0,
            rngCounter: 0,
            pendingTarget: {
                playerId: "p1",
                cardInstanceId: "src",
                targetType: "Creature",
                count: 1,
                zone: "graveyard",
                selected: [],
                controller: "you",
                excludeTypes: ["Land"],
            },
        };
        const projected = projectPublicState(state, 1, "p1");
        const projectedPendingTarget = projected.pendingTarget as PendingTarget;
        const projectedGraveyard = projected.players[0]
            .graveyard as unknown as CardInstance[];
        const projectedLandCreature = projectedGraveyard.find(
            (c) => c.id === "gy-land-creature"
        )!;
        const projectedPlainCreature = projectedGraveyard.find(
            (c) => c.id === "gy-plain-creature"
        )!;
        expect(
            matchesGraveyardTarget(
                projectedLandCreature,
                "p1",
                projectedPendingTarget,
                "p1"
            )
        ).toBe(false);
        expect(
            matchesGraveyardTarget(
                projectedPlainCreature,
                "p1",
                projectedPendingTarget,
                "p1"
            )
        ).toBe(true);
    });
});

describe("getEligibleGraveyards", () => {
    it("returns only graveyards with ≥1 legal card, viewer's own first", () => {
        const me = player("me", [
            gyCard("m1", "me", ["Creature"]),
            gyCard("m2", "me", ["Land"]),
        ]);
        const opp = player("opp", [gyCard("o1", "opp", ["Creature"])]);
        const result = getEligibleGraveyards(
            pending({ controller: "any" }),
            [opp, me],
            "me"
        );
        expect(result.map((g) => g.playerId)).toEqual(["me", "opp"]);
        // Only the creature in my graveyard is legal.
        expect(result[0].cards.map((c) => c.id)).toEqual(["m1"]);
        expect(result[1].cards.map((c) => c.id)).toEqual(["o1"]);
    });

    it("omits an empty-after-filter graveyard (single eligible → skip choice)", () => {
        const me = player("me", [gyCard("m1", "me", ["Creature"])]);
        const opp = player("opp", [gyCard("o1", "opp", ["Land"])]);
        const result = getEligibleGraveyards(
            pending({ controller: "any" }),
            [me, opp],
            "me"
        );
        expect(result.length).toBe(1);
        expect(result[0].playerId).toBe("me");
    });
});
