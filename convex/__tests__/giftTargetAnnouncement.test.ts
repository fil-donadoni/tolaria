/**
 * CR 702.174m — a target the spell's controller chooses "only if the gift was
 * promised", driven through the REAL cast path: the `announceCast` and
 * `selectTargets` mutation handlers, then `resolveTopOfStack`.
 *
 * A promised gift is not a kick (CR 702.33d), so its payment sits outside the
 * kicked record, yet it opens the same two announcement encodings a kicker
 * does: the swap (`kickedTargetRequirement`) and the gated group
 * (`announcedOnlyIfKicked`).
 */

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { ankhOfMishra, plains } from "../cards/sets/lea/colorless.cards";
import { grizzlyBears } from "../cards/sets/lea/green.cards";
import { lightningBolt } from "../cards/sets/lea/red.cards";
import { withTemporaryDefinitionAsync } from "../cards";
import { giftCost, giftSpellOps } from "../cards/abilities/gift";
import type { CardDefinition, TargetSelection } from "../cards/types";
import { announceCast, selectTargets } from "../game";
import { projectPublicState } from "../gameProjections";
import { getLegalActions } from "../gre/rules";
import {
    requestCopyRetargetOn,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../gre/state";
import { checkStateBasedActions } from "../gre/sba";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";
import type { Id } from "../_generated/dataModel";

const BASE = { gameId: "game-1" as Id<"games">, playerId: "p1" };
const SPELL = "gift-spell";

/** Into the Flood Maw's announcement, free to cast. */
const BOUNCE: CardDefinition = {
    id: "3a0e1b52-7a66-4f2b-9d57-10348a000001",
    name: "Gift Bounce Probe",
    rarity: "uncommon",
    oracleText:
        "Gift a card\nReturn target creature an opponent controls to its owner's hand. If the gift was promised, instead return target nonland permanent an opponent controls to its owner's hand.",
    manaCost: {},
    types: ["Instant"],
    kickers: [giftCost("card")],
    targetRequirement: { type: "Creature", count: 1, controller: "opponent" },
    kickedTargetRequirement: {
        type: ["Artifact", "Creature", "Enchantment", "Planeswalker"],
        count: 1,
        excludeTypes: ["Land"],
        controller: "opponent",
    },
    effects: [
        ...giftSpellOps("card"),
        { op: "moveZone", target: { target: 0 }, to: "hand" },
    ],
};

/** Long River's Pull's announcement. */
const COUNTER: CardDefinition = {
    id: "3a0e1b52-7a66-4f2b-9d57-10348a000002",
    name: "Gift Counter Probe",
    rarity: "uncommon",
    oracleText:
        "Gift a card\nCounter target creature spell. If the gift was promised, instead counter target spell.",
    manaCost: {},
    types: ["Instant"],
    kickers: [giftCost("card")],
    targetRequirement: {
        type: "spell",
        count: 1,
        spellTypeFilter: "Creature",
    },
    kickedTargetRequirement: { type: "spell", count: 1 },
    effects: [
        ...giftSpellOps("card"),
        { op: "counter", target: { target: 0 } },
    ],
};

/** Wildfire Howl's announcement: only the promised clause has a target. */
const SWEEP: CardDefinition = {
    id: "3a0e1b52-7a66-4f2b-9d57-10348a000003",
    name: "Gift Sweep Probe",
    rarity: "uncommon",
    oracleText:
        "Gift a card\nGift Sweep Probe deals 2 damage to each creature. If the gift was promised, instead Gift Sweep Probe deals 1 damage to any target and 2 damage to each creature.",
    manaCost: {},
    types: ["Sorcery"],
    kickers: [giftCost("card")],
    additionalTargetRequirements: [
        { type: "any", count: 1, announcedOnlyIfKicked: true },
    ],
    effects: [
        ...giftSpellOps("card"),
        {
            op: "if",
            predicate: {
                left: { additionalCostPaid: "gift" },
                op: "ge",
                right: 1,
            },
            then: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
    ],
};

/** Wear Down's announcement: one target, or exactly two when promised. */
const PAIR: CardDefinition = {
    ...BOUNCE,
    id: "3a0e1b52-7a66-4f2b-9d57-10348a000004",
    name: "Gift Pair Probe",
    targetRequirement: { type: ["Artifact", "Enchantment"], count: 1 },
    kickedTargetRequirement: { type: ["Artifact", "Enchantment"], count: 2 },
    effects: [
        ...giftSpellOps("card"),
        { op: "destroy", target: { target: 0 } },
        {
            op: "if",
            predicate: {
                left: { additionalCostPaid: "gift" },
                op: "ge",
                right: 1,
            },
            then: [{ op: "destroy", target: { target: 1 } }],
        },
    ],
};

function card(id: string, name: string, owner: string, zone = "battlefield") {
    return makeInstance(id, {
        id: name,
        controllerId: owner,
        ownerId: owner,
        zone: zone as CardInstanceState["zone"],
    });
}

function board(
    def: CardDefinition,
    theirs: CardInstanceState[],
    stack: CardInstanceState[] = []
): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [card(def.id, SPELL, "p1", "hand")],
                library: [card(plains().id, "p1-lib", "p1", "library")],
            }),
            makePlayer("p2", {
                battlefield: theirs,
                library: [card(plains().id, "p2-lib", "p2", "library")],
            }),
        ],
        stack: stack.map((c) => ({ ...c, zone: "stack", castById: "p2" })),
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    } as Parameters<typeof makeState>[0]);
}

async function announce(
    harness: ReturnType<typeof makeMutationCtx>,
    promised: boolean
): Promise<void> {
    await runMutation(
        announceCast as unknown as Handler<Record<string, unknown>, void>,
        harness.ctx,
        {
            ...BASE,
            cardInstanceId: SPELL,
            ...(promised ? { kickerPayments: { gift: 1 } } : {}),
        }
    );
}

async function pick(
    harness: ReturnType<typeof makeMutationCtx>,
    ...targets: { targetType: string; targetId: string }[]
): Promise<void> {
    await runMutation(
        selectTargets as unknown as Handler<Record<string, unknown>, void>,
        harness.ctx,
        { ...BASE, targets }
    );
}

const permanent = (targetId: string) => ({ targetType: "permanent", targetId });
const theirIds = (state: GameState) =>
    state.players[1]!.battlefield.map((c) => c.id);

describe("a promised gift swaps the announcement (CR 702.174m)", () => {
    it("promised: the wider requirement is offered, projected, accepted and resolved", async () => {
        await withTemporaryDefinitionAsync(BOUNCE, async () => {
            const harness = makeMutationCtx("p1", [
                gameStateSeed(
                    board(BOUNCE, [card(ankhOfMishra().id, "ankh", "p2")])
                ),
            ]);
            await announce(harness, true);
            // SURFACE — the client reads the pending target off the projection.
            const projected = projectPublicState(harness.state(), 1, "p1");
            expect(projected.pendingTarget?.targetType).toEqual(
                BOUNCE.kickedTargetRequirement!.type
            );
            await pick(harness, permanent("ankh"));
            const state = harness.state();
            const before = state.players[1]!.hand.length;
            resolveTopOfStack(state);
            expect(theirIds(state)).toEqual([]);
            // The artifact, plus the card the gift delivered.
            expect(state.players[1]!.hand.length).toBe(before + 2);
        });
    });

    it("unpromised: the base requirement refuses the artifact", async () => {
        await withTemporaryDefinitionAsync(BOUNCE, async () => {
            const harness = makeMutationCtx("p1", [
                gameStateSeed(
                    board(BOUNCE, [
                        card(ankhOfMishra().id, "ankh", "p2"),
                        card(grizzlyBears().id, "bears", "p2"),
                    ])
                ),
            ]);
            await announce(harness, false);
            expect(harness.state().pendingTarget?.targetType).toBe("Creature");
            await expect(pick(harness, permanent("ankh"))).rejects.toThrow();
        });
    });

    it("is castable when only the promised announcement can be filled", async () => {
        await withTemporaryDefinitionAsync(BOUNCE, async () => {
            const castable = (theirs: CardInstanceState[]) => {
                const state = board(BOUNCE, theirs);
                return getLegalActions(
                    state,
                    state.players[0]!,
                    state.players[0]!.hand[0]!
                ).includes("cast");
            };
            expect(castable([card(ankhOfMishra().id, "ankh", "p2")])).toBe(
                true
            );
            expect(castable([card(plains().id, "land", "p2")])).toBe(false);
        });
    });

    it("an exact pair is announced whole: one pick does not complete it", async () => {
        await withTemporaryDefinitionAsync(PAIR, async () => {
            const harness = makeMutationCtx("p1", [
                gameStateSeed(
                    board(PAIR, [
                        card(ankhOfMishra().id, "ankh-1", "p2"),
                        card(ankhOfMishra().id, "ankh-2", "p2"),
                    ])
                ),
            ]);
            await announce(harness, true);
            expect(harness.state().pendingTarget?.count).toBe(2);
            await pick(harness, permanent("ankh-1"));
            expect(harness.state().pendingTarget).toBeDefined();
            expect(harness.state().stack).toEqual([]);
            await pick(harness, permanent("ankh-2"));
            const state = harness.state();
            resolveTopOfStack(state);
            checkStateBasedActions(state);
            expect(theirIds(state)).toEqual([]);
        });
    });
});

describe("the resolution judges targets by the announcement that chose them (CR 608.2b)", () => {
    it("a promised counter resolves against a noncreature spell", async () => {
        await withTemporaryDefinitionAsync(COUNTER, async () => {
            const harness = makeMutationCtx("p1", [
                gameStateSeed(
                    board(
                        COUNTER,
                        [],
                        [card(lightningBolt().id, "bolt", "p2", "stack")]
                    )
                ),
            ]);
            await announce(harness, true);
            await pick(harness, { targetType: "spell", targetId: "bolt" });
            const state = harness.state();
            expect(state.stack.map((s) => s.id)).toEqual(["bolt", SPELL]);
            resolveTopOfStack(state);
            expect(state.stack.map((s) => s.id)).toEqual([]);
            expect(state.players[1]!.graveyard.map((c) => c.id)).toEqual([
                "bolt",
            ]);
        });
    });

    it("a promised permanent target is re-checked under the promised requirement", async () => {
        // The base names an opponent's permanent, the promised clause any: the
        // caster's own artifact is illegal under the base alone.
        const own: CardDefinition = {
            ...BOUNCE,
            id: "3a0e1b52-7a66-4f2b-9d57-10348a000005",
            kickedTargetRequirement: { type: "Artifact", count: 1 },
        };
        await withTemporaryDefinitionAsync(own, async () => {
            const seed = board(own, []);
            seed.players[0]!.battlefield.push(
                card(ankhOfMishra().id, "my-ankh", "p1")
            );
            const harness = makeMutationCtx("p1", [gameStateSeed(seed)]);
            await announce(harness, true);
            await pick(harness, permanent("my-ankh"));
            const state = harness.state();
            resolveTopOfStack(state);
            expect(state.players[0]!.hand.map((c) => c.id)).toEqual([
                "my-ankh",
            ]);
        });
    });

    it("a copy of a promised spell is retargeted under the promised requirement (CR 707.10c)", async () => {
        await withTemporaryDefinitionAsync(BOUNCE, async () => {
            const harness = makeMutationCtx("p1", [
                gameStateSeed(
                    board(BOUNCE, [
                        card(ankhOfMishra().id, "ankh-1", "p2"),
                        card(ankhOfMishra().id, "ankh-2", "p2"),
                    ])
                ),
            ]);
            await announce(harness, true);
            await pick(harness, permanent("ankh-1"));
            const state = harness.state();
            requestCopyRetargetOn(state, state.stack[0]!);
            expect(state.pendingTarget?.targetType).toEqual(
                BOUNCE.kickedTargetRequirement!.type
            );
        });
    });
});

describe("a gated group opens on the promise (CR 702.174m)", () => {
    it("unpromised: no target, straight to the stack", async () => {
        await withTemporaryDefinitionAsync(SWEEP, async () => {
            const harness = makeMutationCtx("p1", [
                gameStateSeed(board(SWEEP, [])),
            ]);
            await announce(harness, false);
            const state = harness.state();
            expect(state.pendingTarget).toBeUndefined();
            expect(state.stack.map((s) => s.targets ?? [])).toEqual([[]]);
        });
    });

    it("promised: the group is slot 0 and the damage reaches it", async () => {
        await withTemporaryDefinitionAsync(SWEEP, async () => {
            const harness = makeMutationCtx("p1", [
                gameStateSeed(board(SWEEP, [])),
            ]);
            await announce(harness, true);
            expect(harness.state().pendingTarget?.targetType).toBe("any");
            await pick(harness, { targetType: "player", targetId: "p2" });
            const state = harness.state();
            expect(state.stack[0]!.targets).toEqual([
                { type: "player", id: "p2" } satisfies TargetSelection,
            ]);
            resolveTopOfStack(state);
            expect(state.players[1]!.life).toBe(19);
        });
    });
});
