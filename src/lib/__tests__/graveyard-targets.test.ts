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
import { pendingTargetFiltersFromRequirement } from "@convex/gre/rules";
import { lordOfTheUndead } from "@convex/cards/sets/pls/black";
import { dreamsOfTheDead } from "@convex/cards/sets/ice/blue";
import { kjeldoranWarrior } from "@convex/cards/sets/ice/white";
import { balduvianBears } from "@convex/cards/sets/ice/green";
import {
    checkCardTargetFilters,
    type CardFilterValues,
    type TargetFilterCtx,
} from "@convex/gre/targetFilters";

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
                "me",
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
                "me",
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
                "me",
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
                "me",
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
                "me",
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
        expect(matchesGraveyardTarget(cheap, "me", pt, "me", "me")).toBe(true);
        expect(matchesGraveyardTarget(pricey, "me", pt, "me", "me")).toBe(
            false
        );
    });

    it("mvFilter still applies when targetType is the catch-all 'card' (the short-circuit this fix removed)", () => {
        const pricey = gyCard("pricey2", "me", ["Artifact"], { generic: 5 });
        const pt = pending({ targetType: "card", mvFilter: { max: 3 } });
        expect(matchesGraveyardTarget(pricey, "me", pt, "me", "me")).toBe(
            false
        );
    });

    it("no mvFilter on the PendingTarget leaves the target unrestricted by mana value", () => {
        const pricey = gyCard("pricey3", "me", ["Creature"], { generic: 9 });
        const pt = pending({});
        expect(matchesGraveyardTarget(pricey, "me", pt, "me", "me")).toBe(true);
    });

    it("mvFilter.min / .equals are also enforced, mirroring the server's matchesMvFilter", () => {
        const three = gyCard("three", "me", ["Creature"], { generic: 3 });
        expect(
            matchesGraveyardTarget(
                three,
                "me",
                pending({ mvFilter: { min: 4 } }),
                "me",
                "me"
            )
        ).toBe(false);
        expect(
            matchesGraveyardTarget(
                three,
                "me",
                pending({ mvFilter: { equals: 2 } }),
                "me",
                "me"
            )
        ).toBe(false);
        expect(
            matchesGraveyardTarget(
                three,
                "me",
                pending({ mvFilter: { equals: 3 } }),
                "me",
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
        expect(matchesGraveyardTarget(landCreature, "me", pt, "me", "me")).toBe(
            false
        );
    });

    it("includes a plain Creature (no excluded type present)", () => {
        const plainCreature = gyCard("plain-creature", "me", ["Creature"]);
        const pt = pending({
            targetType: "Creature",
            excludeTypes: ["Land"],
        });
        expect(
            matchesGraveyardTarget(plainCreature, "me", pt, "me", "me")
        ).toBe(true);
    });

    it("no excludeTypes on the PendingTarget leaves the target unrestricted", () => {
        const landCreature = gyCard("land-creature2", "me", [
            "Land",
            "Creature",
        ]);
        const pt = pending({ targetType: "Creature" });
        expect(matchesGraveyardTarget(landCreature, "me", pt, "me", "me")).toBe(
            true
        );
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
                "p1",
                "p1"
            )
        ).toBe(false);
        expect(
            matchesGraveyardTarget(
                projectedPlainCreature,
                "p1",
                projectedPendingTarget,
                "p1",
                "p1"
            )
        ).toBe(true);
    });

    // Issue #1950 review round 3, MAJOR 2 — the round-2 fixup (delegating
    // `matchesGraveyardTarget` to `checkCardTargetFilters` via
    // `pickCardFilterValues`) shipped with no assertion that `subtypeFilter`
    // / `colorFilterAny` actually change the client's accept/reject outcome,
    // and nothing drove it through `pendingTargetFiltersFromRequirement` (the
    // REAL carry the server uses) or `projectPublicState` (the wire). These
    // two tests close that: each builds the PendingTarget from the SHIPPED
    // card's own `targetRequirement` (Lord of the Undead's `subtypeFilter`,
    // Dreams of the Dead's `colorFilterAny`), not a hand-picked filter value.
    it("Lord of the Undead's REAL subtypeFilter requirement: a Zombie graveyard card matches, a Bear does not", () => {
        const req = lordOfTheUndead.activatedAbilities![0].targetRequirement!;
        const zombie = makeInstance({ id: "gy-zombie", subtypes: ["Zombie"] });
        const bear = makeInstance({ id: "gy-bear", subtypes: ["Bear"] });
        const state: GameState = {
            players: [
                makeServerPlayer("p1", [zombie, bear]),
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
                cardInstanceId: "lord",
                targetType: req.type,
                count: 1,
                kind: "ability",
                abilityId: "lord-of-the-undead-return",
                selected: [],
                ...pendingTargetFiltersFromRequirement(req, undefined),
            } as PendingTarget,
        };
        const projected = projectPublicState(state, 1, "p1");
        const projectedPendingTarget = projected.pendingTarget as PendingTarget;
        const projectedGraveyard = projected.players[0]
            .graveyard as unknown as CardInstance[];
        const projectedZombie = projectedGraveyard.find(
            (c) => c.id === "gy-zombie"
        )!;
        const projectedBear = projectedGraveyard.find(
            (c) => c.id === "gy-bear"
        )!;
        expect(
            matchesGraveyardTarget(
                projectedZombie,
                "p1",
                projectedPendingTarget,
                "p1",
                "p1"
            )
        ).toBe(true);
        expect(
            matchesGraveyardTarget(
                projectedBear,
                "p1",
                projectedPendingTarget,
                "p1",
                "p1"
            )
        ).toBe(false);
    });

    it("Dreams of the Dead's REAL colorFilterAny requirement: a white creature card matches, a green one does not", () => {
        const req = dreamsOfTheDead.activatedAbilities![0].targetRequirement!;
        // Real registered card ids (not a synthetic `def-…` id): the wire
        // projection's `slimCard` reduces `card` to `{ id }` ONLY, stripping
        // any embedded `manaCost` — so `hasColor` must resolve colour through
        // `tryGetDefinition(id)`, the same as the real server/client path.
        const green = makeInstance({
            id: "gy-green",
            card: { id: balduvianBears.id },
        });
        const white = makeInstance({
            id: "gy-white",
            card: { id: kjeldoranWarrior.id },
        });
        const state: GameState = {
            players: [
                makeServerPlayer("p1", [green, white]),
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
                cardInstanceId: "dreams",
                targetType: req.type,
                count: 1,
                kind: "ability",
                abilityId: "dreams-of-the-dead-reanimate",
                selected: [],
                ...pendingTargetFiltersFromRequirement(req, undefined),
            } as PendingTarget,
        };
        const projected = projectPublicState(state, 1, "p1");
        const projectedPendingTarget = projected.pendingTarget as PendingTarget;
        const projectedGraveyard = projected.players[0]
            .graveyard as unknown as CardInstance[];
        const projectedGreen = projectedGraveyard.find(
            (c) => c.id === "gy-green"
        )!;
        const projectedWhite = projectedGraveyard.find(
            (c) => c.id === "gy-white"
        )!;
        expect(
            matchesGraveyardTarget(
                projectedGreen,
                "p1",
                projectedPendingTarget,
                "p1",
                "p1"
            )
        ).toBe(false);
        expect(
            matchesGraveyardTarget(
                projectedWhite,
                "p1",
                projectedPendingTarget,
                "p1",
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
            "me",
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
            "me",
            "me"
        );
        expect(result.length).toBe(1);
        expect(result[0].playerId).toBe("me");
    });
});

// Issue #1950 review round 3, MINOR 4 — `matchesGraveyardTarget`
// (`~/lib/graveyard-targets.ts`) hands `checkCardTargetFilters` a hand-
// stubbed `ctx` (`state: {} as unknown as GameState`, empty
// `sourceColors`/`sourceTypes`/`sourceSubtypes`). That's sound TODAY because
// none of the six `CARD_FILTER_KEYS` checks (`controller`, `mvFilter`,
// `excludeTypes`, `subtypeFilter`, `excludeSubtypes`, `colorFilterAny`) reads
// `ctx.state` or a source quality — but nothing enforces that going forward,
// and a future card-kind check that DOES would be silently wrong (or throw)
// on the CLIENT ONLY, since both server call sites (`getLegalTargets`,
// `selectTarget`) always pass a real live `GameState`. This canary proves the
// contract holds: every currently-registered card-kind check runs clean
// against a `ctx.state` that THROWS if merely read.
describe("checkCardTargetFilters — client stubbed-ctx contract (issue #1950 review round 3, MINOR 4)", () => {
    it("no CARD_FILTER_KEYS check reads ctx.state — the client's hand-stubbed empty state stays safe", () => {
        const poisonedState = new Proxy(
            {},
            {
                get(_target, prop) {
                    throw new Error(
                        `a card-kind filter check read ctx.state.${String(prop)} — ` +
                            "the client mirror (~/lib/graveyard-targets.ts) stubs " +
                            "ctx.state and needs a real GameState built from allPlayers now"
                    );
                },
            }
        ) as unknown as import("@convex/gre/state").GameState;

        const candidate = {
            id: "gy-candidate",
            card: { id: kjeldoranWarrior.id },
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
            types: ["Creature"],
            subtypes: ["Zombie"],
            staticAbilities: [],
            isTapped: false,
        } as unknown as import("@convex/gre/state").CardInstanceState;

        const ctx: TargetFilterCtx = {
            state: poisonedState,
            sourceColors: [],
            sourceTypes: [],
            sourceSubtypes: [],
            chooserId: "p1",
            activePlayerId: "p1",
        };
        const values: CardFilterValues = {
            controller: "you",
            mvFilter: { max: 5 },
            excludeTypes: ["Land"],
            subtypeFilter: ["Zombie"],
            excludeSubtypes: ["Wall"],
            colorFilterAny: ["W", "B"],
        };
        expect(() =>
            checkCardTargetFilters(ctx, candidate, values)
        ).not.toThrow();
    });
});
