// Airbend (CR 701.65, issue #3551): exile an object, then its owner may cast the
// card for {2} rather than its mana cost for as long as it stays exiled.
//   - GRE: the Op through Aang's and Appa's triggers, the price, the permission.
//   - Integration: `announceCast` through its handler, `applyOneTargetSelection`.
//   - Wire format: the route and the "cast" action through `projectPublicState`.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveActivated,
} from "../../cards/__tests__/setup.helper";
import { getCardByName, getDefinition, getInstanceManaCost } from "../../cards";
import {
    announceCast,
    applyOneTargetSelection,
    finalizeTargetSelection,
} from "../../game";
import {
    makeMutationCtx,
    gameStateSeed,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness.fixture";
import type { Id } from "../../_generated/dataModel";
import { projectPublicState } from "../../gameProjections";
import { runEffectScript } from "../effects/interpreter";
import {
    castAlternativeCostForZone,
    castRawManaCost,
    exileCastRoutes,
} from "../castCost";
import { adventureCastAltCostId, adventureCastOptionFor } from "../adventure";
import { finalizeCleanup } from "../phases";
import { checkStateBasedActions } from "../sba";
import {
    getLegalActions,
    getLegalTargets,
    NO_TARGETING_SOURCE,
    raiseTriggerTargetSelection,
    applySourceDirectives,
} from "../rules";
import { compactState, expandState } from "../serialize";
import {
    buildSpellContext,
    getPlayer,
    processPendingActionTriggers,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../state";

const AANG = getCardByName("Aang, Swift Savior").id;
const APPA = getCardByName("Appa, Steadfast Guardian").id;
const BEARS = getCardByName("Grizzly Bears").id;
const UNCOUNTERABLE = getCardByName("Obliterate").id;
const COLOSSUS = getCardByName("Darksteel Colossus").id;
const BORROWER = getCardByName("Brazen Borrower").id;
const FOREST = getCardByName("Forest").id;
const ISLAND = getCardByName("Island").id;

const permanent = (
    cardId: string,
    id: string,
    who = "p1",
    overrides: Partial<CardInstanceState> = {}
) =>
    makeInstance(cardId, {
        id,
        controllerId: who,
        ownerId: who,
        zone: "battlefield",
        ...overrides,
    });

/** p1's main phase, priority, with `lands` untapped Islands. */
function board(
    p1: Partial<GameState["players"][number]> = {},
    p2: Partial<GameState["players"][number]> = {},
    lands = 0
): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                ...p1,
                battlefield: [
                    ...(p1.battlefield ?? []),
                    ...Array.from({ length: lands }, (_, i) =>
                        permanent(ISLAND, `land${i}`)
                    ),
                ],
            }),
            makePlayer("p2", p2),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        turn: 5,
    });
}

/** The source's enter trigger on the stack with `targets` already announced. */
function pushEnterTrigger(
    state: GameState,
    source: CardInstanceState,
    abilityId: string
): StackItem {
    const trigger: StackItem = {
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: abilityId,
        triggerSourceId: source.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: source.id,
            controllerId: source.controllerId,
            types: source.types,
        } as StackItem["triggerEvent"],
        targets: undefined,
    };
    state.stack.push(trigger);
    return trigger;
}

type CastArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};

const AANG_TRIGGER = "aang-swift-savior-airbend";
const APPA_TRIGGER = "appa-steadfast-guardian-airbend";

/** Announces `selected` through the real CR 603.3d machinery, then resolves. */
function announceAndResolve(
    state: GameState,
    selected: { type: "permanent" | "spell"; id: string }[]
): void {
    expect(raiseTriggerTargetSelection(state)).toBe(true);
    state.pendingTarget!.selected = selected;
    finalizeTargetSelection(
        state,
        state.pendingTarget!,
        state.pendingTarget!.playerId
    );
    resolveTopOfStack(state);
}

const exiled = (state: GameState, id: string) =>
    state.players.flatMap((p) => p.exile).find((c) => c.id === id);

describe("airbend a permanent (CR 701.65a)", () => {
    it("exiles it face up and gives its OWNER, not the airbender, a {2} cast", () => {
        const aang = permanent(AANG, "aang");
        // p1 controls it, p2 owns it: the card lands in p2's exile.
        const stolen = permanent(BEARS, "stolen", "p1", { ownerId: "p2" });
        const state = board({ battlefield: [aang, stolen] });
        pushEnterTrigger(state, aang, AANG_TRIGGER);

        announceAndResolve(state, [{ type: "permanent", id: "stolen" }]);

        const card = getPlayer(state, "p2").exile.find(
            (c) => c.id === "stolen"
        )!;
        expect(card.castableFromExileBy).toBe("p2");
        expect(card.castFromExileAlternativeCost).toEqual({ X: 2 });
        // CR 406.3 — face up: nobody's knowledge narrows, no face-down sentinel.
        expect(card.faceDown).toBeFalsy();
        expect(card.knownTo).toBeUndefined();
        // "for as long as it remains exiled" — no upper bound on the window.
        expect(card.castableFromExileUntilTurn).toBeUndefined();
        expect(card.castableFromExileUntilOwnTurn).toBeUndefined();
        expect(card.castableFromExileFromTurn).toBeUndefined();
    });

    it("a token ceases to exist and grants nothing (CR 111.7)", () => {
        const aang = permanent(AANG, "aang");
        const token = permanent(BEARS, "token", "p2", { isToken: true });
        const state = board({ battlefield: [aang] }, { battlefield: [token] });
        pushEnterTrigger(state, aang, AANG_TRIGGER);

        announceAndResolve(state, [{ type: "permanent", id: "token" }]);

        expect(getPlayer(state, "p2").battlefield).toHaveLength(0);
        // CR 704.5d — the state-based action takes it out of exile for good.
        checkStateBasedActions(state);
        expect(exiled(state, "token")).toBeUndefined();
    });

    it("a card that already reached exile is not re-granted (CR 608.2b / 400.7)", () => {
        const state = board(
            {},
            {
                exile: [
                    makeInstance(BEARS, {
                        id: "gone",
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "exile",
                    }),
                ],
            }
        );
        const aang = permanent(AANG, "aang");
        const trigger = pushEnterTrigger(state, aang, AANG_TRIGGER);
        trigger.targets = [{ type: "permanent", id: "gone" }];

        runEffectScript(buildSpellContext(state, trigger), [
            { op: "airbend", target: { target: 0 } },
        ]);

        expect(exiled(state, "gone")!.castableFromExileBy).toBeUndefined();
    });

    it("zero targets is legal on both cards, and resolves to nothing (CR 601.2c)", () => {
        for (const [cardId, ability] of [
            [AANG, AANG_TRIGGER],
            [APPA, APPA_TRIGGER],
        ] as const) {
            const source = permanent(cardId, "source");
            const state = board({
                battlefield: [source, permanent(BEARS, "bears")],
            });
            pushEnterTrigger(state, source, ability);

            announceAndResolve(state, []);

            expect(getPlayer(state, "p1").battlefield).toHaveLength(2);
            expect(state.stack).toHaveLength(0);
        }
    });
});

describe("airbend a spell (CR 701.65a) — not a counter (CR 701.6a)", () => {
    function onStack(cardId: string, overrides: Partial<StackItem> = {}) {
        return {
            ...makeInstance(cardId, {
                id: "spell",
                controllerId: "p2",
                ownerId: "p2",
                zone: "stack",
            }),
            castById: "p2",
            ...overrides,
        } as unknown as StackItem;
    }

    it("a can't-be-countered spell is still removed, and its owner may recast it", () => {
        const aang = permanent(AANG, "aang");
        const state = board({ battlefield: [aang] });
        state.stack.push(onStack(UNCOUNTERABLE));
        pushEnterTrigger(state, aang, AANG_TRIGGER);

        announceAndResolve(state, [{ type: "spell", id: "spell" }]);

        expect(state.stack).toHaveLength(0);
        const card = getPlayer(state, "p2").exile.find(
            (c) => c.id === "spell"
        )!;
        expect(card.zone).toBe("exile");
        expect(card.castableFromExileBy).toBe("p2");
        expect(card.castFromExileAlternativeCost).toEqual({ X: 2 });
        expect((card as Partial<StackItem>).castById).toBeUndefined();
        expect(getPlayer(state, "p2").graveyard).toHaveLength(0);
    });

    it("a copy of a spell ceases to exist and grants nothing (CR 707.10a)", () => {
        const aang = permanent(AANG, "aang");
        const state = board({ battlefield: [aang] });
        state.stack.push(onStack(BEARS, { isCopy: true }));
        pushEnterTrigger(state, aang, AANG_TRIGGER);

        announceAndResolve(state, [{ type: "spell", id: "spell" }]);

        expect(state.stack).toHaveLength(0);
        expect(exiled(state, "spell")).toBeUndefined();
    });
});

describe("mixed target shape, GRE and game.ts (CR 115.1, end-to-end targeting)", () => {
    function position(): { state: GameState } {
        const aang = permanent(AANG, "aang");
        const state = board(
            {
                battlefield: [aang, permanent(BEARS, "mine")],
            },
            {
                battlefield: [
                    permanent(BEARS, "theirs", "p2"),
                    permanent(FOREST, "land", "p2"),
                ],
            }
        );
        state.stack.push({
            ...makeInstance(BEARS, {
                id: "spell",
                controllerId: "p2",
                ownerId: "p2",
                zone: "stack",
            }),
            castById: "p2",
        } as StackItem);
        pushEnterTrigger(state, aang, AANG_TRIGGER);
        return { state };
    }

    it("offers creatures and spells, never a land, an ability or Aang himself", () => {
        const { state } = position();
        const req =
            getDefinition(AANG).triggeredAbilities![0].targetRequirement!;
        const legal = getLegalTargets(
            state,
            applySourceDirectives(req, "aang"),
            NO_TARGETING_SOURCE,
            "p1"
        ).map((t) => t.id);
        expect(legal.sort()).toEqual(["mine", "spell", "theirs"]);
    });

    it("game.ts accepts both halves and refuses a land", () => {
        const { state } = position();
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        expect(() =>
            applyOneTargetSelection(state, "p1", {
                targetType: "permanent",
                targetId: "land",
            })
        ).toThrow();
        applyOneTargetSelection(state, "p1", {
            targetType: "spell",
            targetId: "spell",
        });
        expect(state.pendingTarget?.selected ?? []).not.toHaveLength(2);
    });

    it("game.ts accepts the creature half", () => {
        const { state } = position();
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        expect(() =>
            applyOneTargetSelection(state, "p1", {
                targetType: "permanent",
                targetId: "theirs",
            })
        ).not.toThrow();
    });
});

describe("the {2} price (CR 118.9)", () => {
    /** p1's Darksteel Colossus, {11} printed, airbended into exile. */
    function airbended(lands: number): GameState {
        const aang = permanent(AANG, "aang");
        const state = board(
            {
                battlefield: [aang, permanent(COLOSSUS, "colossus")],
            },
            {},
            lands
        );
        pushEnterTrigger(state, aang, AANG_TRIGGER);
        announceAndResolve(state, [{ type: "permanent", id: "colossus" }]);
        return state;
    }

    it("pays {2}, while the mana cost and mana value stay printed (CR 118.9c)", () => {
        const state = airbended(2);
        const card = exiled(state, "colossus")!;
        expect(castRawManaCost(state, card, "exile")).toEqual({ X: 2 });
        expect(exileCastRoutes(state, card, "p1")).toEqual(["grant"]);
        expect(getInstanceManaCost(card)).toEqual(
            getDefinition(COLOSSUS).manaCost
        );
    });

    it("the affordance probes {2}, not the printed cost", () => {
        const owner = (s: GameState) => getPlayer(s, "p1");
        const can = airbended(2);
        expect(
            getLegalActions(can, owner(can), exiled(can, "colossus")!)
        ).toContain("cast");
        const cannot = airbended(1);
        expect(
            getLegalActions(cannot, owner(cannot), exiled(cannot, "colossus")!)
        ).not.toContain("cast");
    });

    it("keeps the card's own timing: a creature is not cast off-turn", () => {
        const state = airbended(2);
        state.activePlayerId = "p2";
        expect(
            getLegalActions(
                state,
                getPlayer(state, "p1"),
                exiled(state, "colossus")!
            )
        ).not.toContain("cast");
    });

    it("the permission survives turns and a persistence round-trip", () => {
        const state = airbended(2);
        finalizeCleanup(state);
        expect(exiled(state, "colossus")!.castFromExileAlternativeCost).toEqual(
            { X: 2 }
        );
        const decoded = expandState(compactState(state));
        const card = exiled(decoded, "colossus")!;
        expect(card.castFromExileAlternativeCost).toEqual({ X: 2 });
        expect(card.castableFromExileBy).toBe("p1");
    });

    const announce = (harness: ReturnType<typeof makeMutationCtx>) =>
        runMutation<CastArgs, void>(
            announceCast as unknown as Handler<CastArgs, void>,
            harness.ctx,
            {
                gameId: "game-1" as Id<"games">,
                playerId: "p1",
                cardInstanceId: "colossus",
            }
        );
    // The harness seeds a live state, and this store's seed form is compact.
    const seeded = (state: GameState) => {
        delete state.lastKnownCopiable;
        return makeMutationCtx("p1", [gameStateSeed(state)]);
    };

    it("announceCast parks {2} when the mana is still on lands", async () => {
        const harness = seeded(airbended(2));
        await announce(harness);
        expect(harness.state().pendingCast?.manaCost).toEqual({ X: 2 });
    });

    it("announceCast spends a floating {2}, and the spell carries no record", async () => {
        const state = airbended(0);
        getPlayer(state, "p1").manaPool.U = 2;
        const harness = seeded(state);
        await announce(harness);
        const after = harness.state();
        const spell = after.stack.find((s) => s.id === "colossus")!;
        expect(spell.castFromZone).toBe("exile");
        expect(spell.castFromExileAlternativeCost).toBeUndefined();
        expect(spell.castableFromExileBy).toBeUndefined();
        expect(getPlayer(after, "p1").manaPool.U).toBe(0);
        expect(exiled(after, "colossus")).toBeUndefined();
    });

    it("an Adventure cast pays the {2}, not its own cost on top (CR 118.9a)", () => {
        const borrower = getDefinition(BORROWER);
        const state = board({
            exile: [
                makeInstance(BORROWER, {
                    id: "borrower",
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "exile",
                    castableFromExileBy: "p1",
                    castFromExileAlternativeCost: { X: 2 },
                }),
            ],
        });
        const altId = adventureCastAltCostId(borrower);
        const alt = adventureCastOptionFor(exiled(state, "borrower")!, {
            state,
            casterId: "p1",
        })!;
        const paid = castAlternativeCostForZone(
            state,
            exiled(state, "borrower")!,
            "exile",
            altId,
            alt
        );
        expect(paid?.mana).toEqual({ X: 2 });
    });

    it("a spell cast off the permission fires Appa's trigger, through the commit", async () => {
        const state = airbended(0);
        const appa = permanent(APPA, "appa");
        getPlayer(state, "p1").battlefield.push(appa);
        getPlayer(state, "p1").manaPool.U = 2;
        const harness = seeded(state);
        await announce(harness);
        expect(
            harness
                .state()
                .stack.some(
                    (s) =>
                        s.triggeredAbilityId === "appa-steadfast-guardian-ally"
                )
        ).toBe(true);
    });

    it("wire: the route says what it pays, and locks X", () => {
        const state = airbended(2);
        const view = projectPublicState(state, 0, "p1");
        const card = view.players
            .flatMap((p) => p.exile)
            .find((c) => c.id === "colossus")! as {
            legalActions?: string[];
            exileCastRouteChoice?: { price: string; xLocked: boolean };
        };
        expect(card.legalActions).toContain("cast");
        expect(card.exileCastRouteChoice).toEqual({
            price: "alternative",
            xLocked: true,
        });
    });
});

describe("Aang, Swift Savior's back face (CR 701.27, CR 701.67a)", () => {
    it("Waterbend {8} transforms him into Aang and La", () => {
        const aang = permanent(AANG, "aang");
        const state = board({ battlefield: [aang] });
        expect(getDefinition(AANG).activatedAbilities![0].cost).toMatchObject({
            mana: { X: 8 },
        });
        resolveActivated(state, aang, "aang-swift-savior-transform");
        const flipped = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "aang"
        )!;
        expect(flipped.transformed).toBe(true);
        expect(flipped.power).toBe(5);
        expect(flipped.staticAbilities).toEqual(["reach", "trample"]);
    });

    it("attacking, Aang and La put a counter on each tapped creature you control", () => {
        const aang = permanent(AANG, "aang");
        const tapped = permanent(BEARS, "tapped", "p1", { isTapped: true });
        const untapped = permanent(BEARS, "untapped");
        const theirs = permanent(BEARS, "theirs", "p2", { isTapped: true });
        const tappedLand = permanent(ISLAND, "tappedLand", "p1", {
            isTapped: true,
        });
        const state = board(
            { battlefield: [aang, tapped, untapped, tappedLand] },
            { battlefield: [theirs] }
        );
        resolveActivated(state, aang, "aang-swift-savior-transform");
        const flipped = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "aang"
        )!;
        flipped.isTapped = true;
        state.pendingEvents = [
            {
                type: "ATTACKERS_DECLARED",
                attackingPlayerId: "p1",
                attackerIds: ["aang"],
            } as never,
        ];
        processPendingActionTriggers(state);
        expect(state.stack.map((s) => s.triggeredAbilityId)).toEqual([
            "aang-and-la-counters",
        ]);

        resolveTopOfStack(state);

        const counters = (id: string) =>
            state.players
                .flatMap((p) => p.battlefield)
                .find((c) => c.id === id)!.counters?.["+1/+1"] ?? 0;
        expect(counters("aang")).toBe(1);
        expect(counters("tapped")).toBe(1);
        expect(counters("untapped")).toBe(0);
        expect(counters("theirs")).toBe(0);
        expect(counters("tappedLand")).toBe(0);
    });
});

describe("Appa, Steadfast Guardian", () => {
    it("airbends every announced permanent, its own excluded (CR 601.2c)", () => {
        const appa = permanent(APPA, "appa");
        const state = board({
            battlefield: [
                appa,
                permanent(BEARS, "b1"),
                permanent(BEARS, "b2"),
                permanent(FOREST, "land"),
            ],
        });
        const req =
            getDefinition(APPA).triggeredAbilities![0].targetRequirement!;
        const legal = getLegalTargets(
            state,
            applySourceDirectives(req, "appa"),
            NO_TARGETING_SOURCE,
            "p1"
        ).map((t) => t.id);
        expect(legal.sort()).toEqual(["b1", "b2"]);

        pushEnterTrigger(state, appa, APPA_TRIGGER);
        announceAndResolve(state, [
            { type: "permanent", id: "b1" },
            { type: "permanent", id: "b2" },
        ]);

        for (const id of ["b1", "b2"]) {
            expect(exiled(state, id)!.castFromExileAlternativeCost).toEqual({
                X: 2,
            });
        }
    });

    it("only permanents you control are legal", () => {
        const appa = permanent(APPA, "appa");
        const state = board(
            { battlefield: [appa] },
            { battlefield: [permanent(BEARS, "theirs", "p2")] }
        );
        const req =
            getDefinition(APPA).triggeredAbilities![0].targetRequirement!;
        expect(
            getLegalTargets(
                state,
                applySourceDirectives(req, "appa"),
                NO_TARGETING_SOURCE,
                "p1"
            )
        ).toEqual([]);
    });

    function castFrom(zone: "exile" | "hand"): GameState {
        const state = board({ battlefield: [permanent(APPA, "appa")] });
        state.pendingEvents = [
            {
                type: "SPELL_CAST",
                casterId: "p1",
                spellInstanceId: "spell",
                spellCardId: BEARS,
                spellTypes: ["Creature"],
                spellSubtypes: ["Bear"],
                spellColors: ["G"],
                spellCastFromZone: zone,
            },
        ];
        processPendingActionTriggers(state);
        return state;
    }

    it("makes an Ally when you cast a spell from exile, not from hand", () => {
        const fromExile = castFrom("exile");
        expect(
            fromExile.stack.filter(
                (s) => s.triggeredAbilityId === "appa-steadfast-guardian-ally"
            )
        ).toHaveLength(1);
        resolveTopOfStack(fromExile);
        const ally = getPlayer(fromExile, "p1").battlefield.find(
            (c) => c.isToken
        )!;
        expect(ally.subtypes).toContain("Ally");
        expect(ally.power).toBe(1);
        // CR 111 — the token's art resolves to its own TLA token print.
        expect((ally.card as { id: string }).id).toContain(
            "f842c52a-04b6-4625-ba58-45b043ada340"
        );

        expect(castFrom("hand").stack).toHaveLength(0);
    });
});
