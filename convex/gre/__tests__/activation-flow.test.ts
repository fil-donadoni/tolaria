import { describe, it, expect } from "vitest";
import {
    getBasicLandMana,
    getPlayer,
    getOpponentId,
    isManaCostCovered,
    normalizeManaCost,
    payManaCost,
    commitLandsForCost,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type PlayerState,
    type GameState,
    type PendingActivation,
    type StackItem,
} from "../state";
import { getCardById } from "../../cards";
import {
    circleOfProtectionRed,
    jayemdaeTome,
    lightningBolt,
} from "../../cards/sets/lea";

// ---------------------------------------------------------------------------
// Simulated mutation handlers for the pendingActivation payment phase.
// These mirror the production mutations in convex/game.ts (activateAbility,
// tapForActivationPayment, untapForActivationPayment, cancelActivation) but
// are pure functions so tests don't need a Convex context.
// ---------------------------------------------------------------------------

function activateAbility(
    state: GameState,
    playerId: string,
    cardInstanceId: string,
    abilityId: string
): "committed" | "pending" {
    const player = getPlayer(state, playerId);
    const card = player.battlefield.find((c) => c.id === cardInstanceId);
    if (!card) throw new Error("Card not on battlefield");

    const def = getCardById((card.card as { id: string }).id);
    const ability = def.activatedAbilities?.find((a) => a.id === abilityId);
    if (!ability || !ability.useStack) {
        throw new Error("Not a stack ability");
    }
    if (ability.cost.tap && card.isTapped) {
        throw new Error("Already tapped");
    }
    const manaCost = ability.cost.mana
        ? normalizeManaCost(ability.cost.mana)
        : undefined;

    if (manaCost && !isManaCostCovered(player.manaPool, manaCost)) {
        const pa: PendingActivation = {
            playerId,
            cardInstanceId: card.id,
            abilityId,
            manaCost,
            tappedLandIds: [],
            tapSource: !!ability.cost.tap,
            sacrificeSource: !!ability.cost.sacrifice,
        };
        state.pendingActivation = pa;
        return "pending";
    }

    if (ability.cost.tap) card.isTapped = true;
    if (manaCost) {
        payManaCost(player.manaPool, manaCost);
        commitLandsForCost(player, manaCost);
    }
    if (ability.cost.sacrifice) {
        removePermanentTo(state, card.id, "graveyard");
    }

    const stackItem: StackItem = {
        ...structuredClone(card),
        zone: "stack" as const,
        castById: playerId,
        abilityId,
    };
    state.stack.push(stackItem);
    state.passCount = 0;
    state.priorityPlayerId = getOpponentId(state, playerId);
    return "committed";
}

function tapForActivationPayment(
    state: GameState,
    playerId: string,
    landId: string
): "committed" | "tapped" {
    const pa = state.pendingActivation;
    if (!pa) throw new Error("No pending activation");
    const player = getPlayer(state, playerId);
    const land = player.battlefield.find((c) => c.id === landId);
    if (!land) throw new Error("Card not on battlefield");
    if (land.isTapped) throw new Error("Already tapped");

    const manaColor = getBasicLandMana(land);
    if (!manaColor) throw new Error("Land does not produce mana");

    land.isTapped = true;
    player.manaPool[manaColor] = (player.manaPool[manaColor] ?? 0) + 1;
    pa.tappedLandIds.push(land.id);

    if (!isManaCostCovered(player.manaPool, pa.manaCost)) return "tapped";

    // Commit: pay mana, apply deferred tap/sacrifice, push on stack.
    const source = player.battlefield.find((c) => c.id === pa.cardInstanceId);
    if (!source) throw new Error("Source vanished");
    payManaCost(player.manaPool, pa.manaCost);
    commitLandsForCost(player, pa.manaCost);
    if (pa.tapSource) source.isTapped = true;
    if (pa.sacrificeSource) removePermanentTo(state, source.id, "graveyard");

    const stackItem: StackItem = {
        ...structuredClone(source),
        zone: "stack" as const,
        castById: playerId,
        abilityId: pa.abilityId,
        ...(pa.targets && pa.targets.length > 0 ? { targets: pa.targets } : {}),
    };
    state.stack.push(stackItem);
    state.pendingActivation = undefined;
    state.passCount = 0;
    state.priorityPlayerId = getOpponentId(state, playerId);
    return "committed";
}

function untapForActivationPayment(
    state: GameState,
    playerId: string,
    landId: string
): void {
    const pa = state.pendingActivation;
    if (!pa) throw new Error("No pending activation");
    const idx = pa.tappedLandIds.indexOf(landId);
    if (idx === -1) throw new Error("Land not tapped during this activation");

    const player = getPlayer(state, playerId);
    const land = player.battlefield.find((c) => c.id === landId);
    if (!land) throw new Error("Card not on battlefield");

    const manaColor = getBasicLandMana(land);
    if (!manaColor) throw new Error("Land does not produce mana");

    land.isTapped = false;
    player.manaPool[manaColor] = Math.max(
        0,
        (player.manaPool[manaColor] ?? 0) - 1
    );
    pa.tappedLandIds.splice(idx, 1);
}

function cancelActivation(state: GameState, playerId: string): void {
    const pa = state.pendingActivation;
    if (!pa) throw new Error("No pending activation");
    const player = getPlayer(state, playerId);
    for (const landId of pa.tappedLandIds) {
        const land = player.battlefield.find((c) => c.id === landId);
        if (!land) continue;
        land.isTapped = false;
        const manaColor = getBasicLandMana(land);
        if (manaColor) {
            player.manaPool[manaColor] = Math.max(
                0,
                (player.manaPool[manaColor] ?? 0) - 1
            );
        }
    }
    state.pendingActivation = undefined;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ISLAND_CARD = {
    name: "Island",
    types: ["Land"],
    supertypes: ["Basic"],
    subtypes: ["Island"],
};

function makeInstance(
    overrides: Partial<CardInstanceState> & {
        card?: Record<string, unknown>;
    }
): CardInstanceState {
    const card = overrides.card ?? {};
    return {
        id: overrides.id ?? crypto.randomUUID(),
        card,
        types: overrides.types ?? (((card.types as string[]) ?? []) as never),
        subtypes: (overrides.subtypes as string[]) ?? [],
        power: overrides.power,
        toughness: overrides.toughness,
        staticAbilities: (overrides.staticAbilities as string[]) ?? [],
        controllerId: overrides.controllerId ?? "p1",
        ownerId: overrides.ownerId ?? "p1",
        zone: overrides.zone ?? "battlefield",
        isTapped: overrides.isTapped ?? false,
    };
}

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
    return {
        id: "p1",
        name: "Player 1",
        bgColor: "#000",
        life: 20,
        deck: {},
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...overrides,
    };
}

function makeGame(overrides: Partial<GameState> = {}): GameState {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("activation flow — Jayemdae Tome ({4}, {T}: Draw a card)", () => {
    function setup() {
        const tome = makeInstance({
            id: "tome",
            card: { id: jayemdaeTome.id, name: "Jayemdae Tome" },
            types: ["Artifact"],
        });
        const islands = Array.from({ length: 4 }, (_, i) =>
            makeInstance({
                id: `island-${i}`,
                card: ISLAND_CARD,
                types: ["Land"],
                subtypes: ["Island"],
            })
        );
        const library = Array.from({ length: 3 }, (_, i) =>
            makeInstance({
                id: `lib-${i}`,
                card: { id: jayemdaeTome.id, name: "Jayemdae Tome" },
                zone: "library",
                types: ["Artifact"],
            })
        );
        return makeGame({
            players: [
                makePlayer({
                    id: "p1",
                    battlefield: [tome, ...islands],
                    library,
                }),
                makePlayer({ id: "p2" }),
            ],
        });
    }

    it("enters pendingActivation when pool is empty", () => {
        const state = setup();
        const result = activateAbility(
            state,
            "p1",
            "tome",
            "jayemdae-tome-draw"
        );
        expect(result).toBe("pending");
        expect(state.pendingActivation?.abilityId).toBe("jayemdae-tome-draw");
        expect(state.pendingActivation?.tapSource).toBe(true);
        expect(state.pendingActivation?.manaCost).toEqual({ X: 4 });
        // Source is NOT tapped yet — deferred to commit.
        const tome = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "tome"
        )!;
        expect(tome.isTapped).toBe(false);
    });

    it("auto-commits after tapping four Islands and puts ability on stack", () => {
        const state = setup();
        activateAbility(state, "p1", "tome", "jayemdae-tome-draw");

        expect(tapForActivationPayment(state, "p1", "island-0")).toBe("tapped");
        expect(tapForActivationPayment(state, "p1", "island-1")).toBe("tapped");
        expect(tapForActivationPayment(state, "p1", "island-2")).toBe("tapped");
        expect(tapForActivationPayment(state, "p1", "island-3")).toBe(
            "committed"
        );

        expect(state.pendingActivation).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].abilityId).toBe("jayemdae-tome-draw");
        const tome = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "tome"
        )!;
        expect(tome.isTapped).toBe(true);
        expect(state.priorityPlayerId).toBe("p2");

        // Resolution: Jayemdae Tome draws one card.
        resolveTopOfStack(state);
        expect(getPlayer(state, "p1").hand).toHaveLength(1);
        expect(getPlayer(state, "p1").library).toHaveLength(2);
    });

    it("cancel rolls back tapped lands and leaves the source untapped", () => {
        const state = setup();
        activateAbility(state, "p1", "tome", "jayemdae-tome-draw");
        tapForActivationPayment(state, "p1", "island-0");
        tapForActivationPayment(state, "p1", "island-1");

        cancelActivation(state, "p1");

        expect(state.pendingActivation).toBeUndefined();
        const p1 = getPlayer(state, "p1");
        expect(p1.battlefield.find((c) => c.id === "island-0")!.isTapped).toBe(
            false
        );
        expect(p1.battlefield.find((c) => c.id === "island-1")!.isTapped).toBe(
            false
        );
        expect(p1.battlefield.find((c) => c.id === "tome")!.isTapped).toBe(
            false
        );
        expect(p1.manaPool).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
    });

    it("untapForActivationPayment reverses a single tap", () => {
        const state = setup();
        activateAbility(state, "p1", "tome", "jayemdae-tome-draw");
        tapForActivationPayment(state, "p1", "island-0");
        tapForActivationPayment(state, "p1", "island-1");

        untapForActivationPayment(state, "p1", "island-0");

        const p1 = getPlayer(state, "p1");
        expect(p1.manaPool.U).toBe(1);
        expect(p1.battlefield.find((c) => c.id === "island-0")!.isTapped).toBe(
            false
        );
        expect(state.pendingActivation?.tappedLandIds).toEqual(["island-1"]);
    });

    it("commits immediately when pool already covers the cost", () => {
        const state = setup();
        // Pre-float 4 generic mana by tapping Islands outside of payment.
        const p1 = getPlayer(state, "p1");
        for (let i = 0; i < 4; i++) {
            const island = p1.battlefield.find((c) => c.id === `island-${i}`)!;
            island.isTapped = true;
            p1.manaPool.U = (p1.manaPool.U ?? 0) + 1;
        }

        const result = activateAbility(
            state,
            "p1",
            "tome",
            "jayemdae-tome-draw"
        );

        expect(result).toBe("committed");
        expect(state.pendingActivation).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        const tome = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "tome"
        )!;
        expect(tome.isTapped).toBe(true);
    });
});

describe("activation flow — targeted ability (Circle of Protection: Red)", () => {
    function setup() {
        const cop = makeInstance({
            id: "cop",
            card: {
                id: circleOfProtectionRed.id,
                name: "Circle of Protection: Red",
            },
            types: ["Enchantment"],
        });
        const plains = Array.from({ length: 1 }, (_, i) =>
            makeInstance({
                id: `plains-${i}`,
                card: {
                    name: "Plains",
                    types: ["Land"],
                    supertypes: ["Basic"],
                    subtypes: ["Plains"],
                },
                types: ["Land"],
                subtypes: ["Plains"],
            })
        );
        const bolt: StackItem = {
            ...makeInstance({
                id: "bolt",
                card: { id: lightningBolt.id, name: "Lightning Bolt" },
                types: ["Instant"],
                zone: "stack",
                controllerId: "p2",
                ownerId: "p2",
            }),
            castById: "p2",
            targets: [{ type: "player", id: "p1" }],
        };
        return makeGame({
            players: [
                makePlayer({ id: "p1", battlefield: [cop, ...plains] }),
                makePlayer({ id: "p2" }),
            ],
            stack: [bolt],
            priorityPlayerId: "p1",
        });
    }

    it("targets locked in before payment ride along to commit", () => {
        const state = setup();
        const targets = [{ type: "spell" as const, id: "bolt" }];

        // Simulate finalizeTargetSelection's ability branch: mana not covered,
        // so we enter pendingActivation carrying the selected target.
        state.pendingActivation = {
            playerId: "p1",
            cardInstanceId: "cop",
            abilityId: "cop-prevent",
            manaCost: { X: 1 },
            tappedLandIds: [],
            tapSource: false,
            sacrificeSource: false,
            targets,
        };

        // Tap the Plains to pay {1} — auto-commits.
        const result = tapForActivationPayment(state, "p1", "plains-0");
        expect(result).toBe("committed");

        expect(state.pendingActivation).toBeUndefined();
        // Bolt (stack[0]) + CoP ability (stack[1]).
        expect(state.stack).toHaveLength(2);
        const activationItem = state.stack[1];
        expect(activationItem.abilityId).toBe("cop-prevent");
        expect(activationItem.targets).toEqual(targets);
    });

    it("cancel from pendingActivation with targets refunds lands, leaves source untouched", () => {
        const state = setup();
        const targets = [{ type: "spell" as const, id: "bolt" }];
        state.pendingActivation = {
            playerId: "p1",
            cardInstanceId: "cop",
            abilityId: "cop-prevent",
            manaCost: { X: 1 },
            tappedLandIds: [],
            tapSource: false,
            sacrificeSource: false,
            targets,
        };

        // User floats no mana, cancels instead.
        cancelActivation(state, "p1");

        expect(state.pendingActivation).toBeUndefined();
        const p1 = getPlayer(state, "p1");
        expect(p1.battlefield.find((c) => c.id === "cop")!.isTapped).toBe(
            false
        );
        expect(p1.battlefield.find((c) => c.id === "plains-0")!.isTapped).toBe(
            false
        );
    });
});
