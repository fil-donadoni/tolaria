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
    destroyWithReplacements,
    resolveTopOfStack,
    canPayDiscardLastDrawn,
    payDiscardLastDrawn,
    drawCard,
    type CardInstanceState,
    type PlayerState,
    type GameState,
    type PendingActivation,
    type StackItem,
} from "../state";
import { getDefinition, getCardByName, tryGetDefinition } from "../../cards";
import { tracker } from "../../cards/sets/drk";
import { checkStateBasedActions } from "../sba";
import {
    circleOfProtectionRed,
    jayemdaeTome,
    lightningBolt,
} from "../../cards/sets/lea";
import {
    oasis,
    pyramids,
    dancingScimitar,
    ifhBiffEfreet,
    birdMaiden,
    jandorsRing,
    bazaarOfBaghdad,
} from "../../cards/sets/arn";
import type { CardType } from "../../cards/types";
import { clergyOfTheHolyNimbus } from "../../cards/sets/leg";
import { ashnodsBattleGear } from "../../cards/sets/atq";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { untapStep } from "../phases";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";

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
    // Mirror game.ts: look on the activator's own battlefield first, then fall
    // back to a global search so "any player may activate" sources on another
    // player's battlefield resolve (CR 113.3c). The permission gate below
    // rejects cross-battlefield activations unless the ability opts in.
    let card = player.battlefield.find((c) => c.id === cardInstanceId);
    if (!card) {
        for (const p of state.players) {
            const found = p.battlefield.find((c) => c.id === cardInstanceId);
            if (found) {
                card = found;
                break;
            }
        }
    }
    if (!card) throw new Error("Card not on battlefield");

    const def = getDefinition((card.card as { id: string }).id);
    const ability = def.activatedAbilities?.find((a) => a.id === abilityId);
    if (!ability || !ability.useStack) {
        throw new Error("Not a stack ability");
    }
    // CR 602.1 — "only your opponents may activate" (Clergy of the Holy
    // Nimbus): the controller may NOT activate; any other player may. Checked
    // before the controller-only default. Mirrors convex/game.ts.
    if (ability.activatableByOpponentsOnly) {
        if (card.controllerId === playerId) {
            throw new Error("Only your opponents may activate this ability");
        }
    } else if (
        !ability.activatableByAnyPlayer &&
        card.controllerId !== playerId
    ) {
        throw new Error("You do not control this permanent");
    }
    if (ability.cost.tap && card.isTapped) {
        throw new Error("Already tapped");
    }
    // CR 118.3 — "discard the last card you drew this turn" cost (Jandor's
    // Ring). Validated up-front so we never enter an unpayable activation.
    if (ability.cost.discardLastDrawn && !canPayDiscardLastDrawn(player)) {
        throw new Error("No card drawn this turn left to discard");
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
            ...(ability.cost.discardLastDrawn
                ? { discardLastDrawnSource: true }
                : {}),
        };
        state.pendingActivation = pa;
        return "pending";
    }

    if (ability.cost.tap) card.isTapped = true;
    if (manaCost) {
        payManaCost(player.manaPool, manaCost);
        commitLandsForCost(player, manaCost);
    }
    if (ability.cost.discardLastDrawn) {
        payDiscardLastDrawn(state, player);
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

    // Commit: pay mana, apply deferred tap/sacrifice, push on stack. The
    // source may live on another player's battlefield (CR 113.3c, "any player
    // may activate"), so search globally — mirrors game.ts's
    // tryAutoCommitPendingActivation. Mana is still paid from the activator.
    let source = player.battlefield.find((c) => c.id === pa.cardInstanceId);
    if (!source) {
        for (const p of state.players) {
            const found = p.battlefield.find((c) => c.id === pa.cardInstanceId);
            if (found) {
                source = found;
                break;
            }
        }
    }
    if (!source) throw new Error("Source vanished");
    payManaCost(player.manaPool, pa.manaCost);
    commitLandsForCost(player, pa.manaCost);
    if (pa.tapSource) source.isTapped = true;
    if (pa.discardLastDrawnSource) {
        // CR 118.3 — re-check at commit (the card may have left hand).
        if (!canPayDiscardLastDrawn(player)) {
            state.pendingActivation = undefined;
            throw new Error("No card drawn this turn left to discard");
        }
        payDiscardLastDrawn(state, player);
    }
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

const FOREST_CARD = {
    name: "Forest",
    types: ["Land"],
    supertypes: ["Basic"],
    subtypes: ["Forest"],
};

// SLIM. `card.card` reduces to `{ id }`; runtime fields fall back to the
// registry def when `id` matches, then to inline cardData, then to defaults.
// Inline `manaCost` is preserved for synthetic fixtures.
function makeInstance(
    overrides: Partial<CardInstanceState> & {
        card?: Record<string, unknown>;
    }
): CardInstanceState {
    const cardRef = overrides.card as
        | {
              id?: string;
              manaCost?: unknown;
              types?: CardType[];
              subtypes?: string[];
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
            (overrides.subtypes as string[]) ??
            def?.subtypes ??
            cardRef?.subtypes ??
            [],
        power: overrides.power ?? def?.power,
        toughness: overrides.toughness ?? def?.toughness,
        staticAbilities:
            (overrides.staticAbilities as string[]) ??
            def?.staticAbilities ??
            cardRef?.staticAbilities ??
            [],
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

// ---------------------------------------------------------------------------
// Batch 3 (#175) — prevention / destroy-replacement through the full
// activate → pay → commit → resolve → effect path.
// ---------------------------------------------------------------------------

describe("activation flow — Oasis ({T}: prevent next 1 to target creature)", () => {
    it("activates (tap-only), resolves, and prevents 1 of a later 3 damage", () => {
        const oasisLand = makeInstance({
            id: "oasis",
            card: { id: oasis.id },
            types: ["Land"],
        });
        const bear = makeInstance({
            id: "bear",
            card: { id: dancingScimitar.id },
            types: ["Creature"],
        });
        const state = makeGame({
            players: [
                makePlayer({ id: "p1", battlefield: [oasisLand, bear] }),
                makePlayer({ id: "p2" }),
            ],
        });

        // Tap-only ability commits immediately; target selection (mirrored here)
        // locks the creature onto the committed stack item.
        const result = activateAbility(state, "p1", "oasis", "oasis-prevent");
        expect(result).toBe("committed");
        expect(oasisLand.isTapped).toBe(true);
        state.stack[state.stack.length - 1].targets = [
            { type: "permanent", id: "bear" },
        ];
        resolveTopOfStack(state);

        // Shield recorded against the creature.
        expect(
            state.targetPreventionShields?.some(
                (s) => s.targetType === "permanent" && s.targetId === "bear"
            )
        ).toBe(true);

        // A 3-damage bolt now lands 2 on the bear (1 prevented).
        const bolt: StackItem = {
            ...makeInstance({
                id: "bolt",
                card: { id: lightningBolt.id },
                types: ["Instant"],
                zone: "stack",
                controllerId: "p2",
                ownerId: "p2",
            }),
            castById: "p2",
            targets: [{ type: "permanent", id: "bear" }],
        };
        state.stack.push(bolt);
        resolveTopOfStack(state);

        expect(
            state.players[0].battlefield.find((c) => c.id === "bear")!
                .damageMarked
        ).toBe(2);
    });
});

describe("activation flow — Pyramids save-land ({2}: destroy replacement)", () => {
    it("enters pendingActivation, commits after paying {2}, and records the shield", () => {
        const pyr = makeInstance({
            id: "pyr",
            card: { id: pyramids.id },
            types: ["Artifact"],
        });
        const islands = Array.from({ length: 2 }, (_, i) =>
            makeInstance({
                id: `island-${i}`,
                card: ISLAND_CARD,
                types: ["Land"],
                subtypes: ["Island"],
            })
        );
        const land = makeInstance({
            id: "victim",
            card: { id: "mountain-x" },
            types: ["Land"],
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeGame({
            players: [
                makePlayer({ id: "p1", battlefield: [pyr, ...islands] }),
                makePlayer({ id: "p2", battlefield: [land] }),
            ],
        });

        // Empty pool → pending. Mirror finalizeTargetSelection carrying the
        // chosen land onto the pendingActivation.
        const result = activateAbility(
            state,
            "p1",
            "pyr",
            "pyramids-save-land"
        );
        expect(result).toBe("pending");
        state.pendingActivation!.targets = [
            { type: "permanent", id: "victim" },
        ];

        expect(tapForActivationPayment(state, "p1", "island-0")).toBe("tapped");
        expect(tapForActivationPayment(state, "p1", "island-1")).toBe(
            "committed"
        );

        resolveTopOfStack(state);
        expect(
            state.destroyReplacementShields?.some(
                (s) => s.targetInstanceId === "victim"
            )
        ).toBe(true);
    });
});

describe("activation flow — Ifh-Bíff Efreet ({G}, any player may activate, CR 113.3c)", () => {
    /** p1 controls the Efreet (3/3 flyer); p2 has a Forest to pay {G} and a
     *  flyer (Bird Maiden) to take the sweep. The opponent activates the
     *  controller's permanent — the cross-battlefield case the flag enables. */
    function setup() {
        const efreet = makeInstance({
            id: "efreet",
            card: { id: ifhBiffEfreet.id },
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppFlyer = makeInstance({
            id: "opp-flyer",
            card: { id: birdMaiden.id },
            controllerId: "p2",
            ownerId: "p2",
        });
        const forest = makeInstance({
            id: "forest",
            card: FOREST_CARD,
            types: ["Land"],
            subtypes: ["Forest"],
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeGame({
            players: [
                makePlayer({ id: "p1", battlefield: [efreet] }),
                makePlayer({ id: "p2", battlefield: [oppFlyer, forest] }),
            ],
        });
        return { state };
    }

    it("opponent activates the controller's Efreet, pays {G} from their own Forest, and the sweep resolves", () => {
        const { state } = setup();

        // p2 (the opponent) activates p1's Efreet — empty pool → pending.
        const result = activateAbility(
            state,
            "p2",
            "efreet",
            "ifh-biff-efreet-rain"
        );
        expect(result).toBe("pending");

        // Pay {G} from p2's own Forest → commits.
        expect(tapForActivationPayment(state, "p2", "forest")).toBe(
            "committed"
        );
        // The stack item is owed by the activator (p2), the source untapped.
        expect(state.stack[0]?.castById).toBe("p2");
        expect(
            state.players[0].battlefield.find((c) => c.id === "efreet")!
                .isTapped
        ).toBe(false);

        resolveTopOfStack(state);

        // Both players took 1; both flyers took 1.
        expect(state.players[0].life).toBe(19);
        expect(state.players[1].life).toBe(19);
        expect(
            state.players[0].battlefield.find((c) => c.id === "efreet")!
                .damageMarked
        ).toBe(1);
        expect(
            state.players[1].battlefield.find((c) => c.id === "opp-flyer")!
                .damageMarked
        ).toBe(1);
    });

    it("a controller-only ability still rejects cross-battlefield activation", () => {
        const { state } = setup();
        // Pyramids' {2}: ability has NO any-player flag, so an opponent must not
        // be able to activate it off the controller's battlefield (the default,
        // CR 602.1). Place it on p1; p2 attempts activation → permission error.
        const pyr = makeInstance({
            id: "pyr",
            card: { id: pyramids.id },
            types: ["Artifact"],
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(pyr);
        expect(() =>
            activateAbility(state, "p2", "pyr", "pyramids-save-land")
        ).toThrow(/do not control/);
    });
});

describe("activation flow — Jandor's Ring ({2},{T}, discard last drawn: Draw)", () => {
    function setup() {
        const ring = makeInstance({
            id: "ring",
            card: { id: jandorsRing.id },
            types: ["Artifact"],
        });
        const islands = Array.from({ length: 2 }, (_, i) =>
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
                card: { id: jandorsRing.id },
                zone: "library",
                types: ["Artifact"],
            })
        );
        return makeGame({
            players: [
                makePlayer({
                    id: "p1",
                    battlefield: [ring, ...islands],
                    library,
                }),
                makePlayer({ id: "p2" }),
            ],
        });
    }

    it("rejects activation when no card was drawn this turn", () => {
        const state = setup();
        expect(() =>
            activateAbility(state, "p1", "ring", "jandors-ring-draw")
        ).toThrow(/drew this turn|drawn this turn/);
        expect(state.pendingActivation).toBeUndefined();
    });

    it("full path: draw → activate → tap lands → commit discards and draws", () => {
        const state = setup();
        const p1 = getPlayer(state, "p1");
        // Draw the top card this turn — it becomes the discard cost.
        const drawn = drawCard(p1)!;
        expect(p1.lastDrawnCardId).toBe(drawn.id);
        expect(p1.hand.map((c) => c.id)).toEqual([drawn.id]);

        // Activate: mana pool empty → pendingActivation carrying the cost.
        expect(activateAbility(state, "p1", "ring", "jandors-ring-draw")).toBe(
            "pending"
        );
        expect(state.pendingActivation?.discardLastDrawnSource).toBe(true);
        // Cost not yet paid — card still in hand, source untapped.
        expect(p1.hand.map((c) => c.id)).toEqual([drawn.id]);
        expect(p1.battlefield.find((c) => c.id === "ring")!.isTapped).toBe(
            false
        );

        // Tap two Islands → auto-commit.
        expect(tapForActivationPayment(state, "p1", "island-0")).toBe("tapped");
        expect(tapForActivationPayment(state, "p1", "island-1")).toBe(
            "committed"
        );
        expect(state.pendingActivation).toBeUndefined();
        // Discard cost paid: the drawn card is in the graveyard, tracker clear.
        expect(p1.graveyard.map((c) => c.id)).toEqual([drawn.id]);
        expect(p1.lastDrawnCardId).toBeUndefined();
        // Source tapped, ability on stack.
        expect(p1.battlefield.find((c) => c.id === "ring")!.isTapped).toBe(
            true
        );
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].abilityId).toBe("jandors-ring-draw");

        // Resolve: draw a card.
        const handBefore = p1.hand.length;
        resolveTopOfStack(state);
        expect(p1.hand.length).toBe(handBefore + 1);
    });

    it("cancel from pendingActivation does not discard the card", () => {
        const state = setup();
        const p1 = getPlayer(state, "p1");
        const drawn = drawCard(p1)!;
        activateAbility(state, "p1", "ring", "jandors-ring-draw");
        tapForActivationPayment(state, "p1", "island-0");
        cancelActivation(state, "p1");
        // Card still in hand, tracker intact, lands untapped.
        expect(p1.hand.map((c) => c.id)).toEqual([drawn.id]);
        expect(p1.lastDrawnCardId).toBe(drawn.id);
        expect(p1.battlefield.find((c) => c.id === "island-0")!.isTapped).toBe(
            false
        );
    });
});

// ---------------------------------------------------------------------------
// Cluster E integration (#286) — the real {2},{T} cost-payment path: the tap
// cost actually taps the source, which is what makes the
// "for as long as this remains tapped" buff live (CR 611.2). Then the
// optional-untap step (CR 502.1) lets the controller keep the source tapped.
// Exercises activateAbility → resolveTopOfStack → untapStep → choice submit,
// the same functions the game.ts mutations call.
// ---------------------------------------------------------------------------

describe("activation flow — Ashnod's Battle Gear (+2/-2 while tapped)", () => {
    it("the {T} cost taps the Gear so the buff is live, then optional-untap keeps it", () => {
        const gear = makeInstance({
            id: "gear",
            card: { id: ashnodsBattleGear.id },
        });
        const bear = makeInstance({
            id: "bear",
            card: { id: "synth-bear" },
            types: ["Creature"],
            power: 3,
            toughness: 3,
        });
        const state = makeGame({
            players: [
                makePlayer({
                    id: "p1",
                    battlefield: [gear, bear],
                    // Float {2} so activateAbility auto-commits (taps the Gear).
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 },
                }),
                makePlayer({ id: "p2" }),
            ],
        });

        const result = activateAbility(
            state,
            "p1",
            "gear",
            "ashnods-battle-gear-pump"
        );
        expect(result).toBe("committed");
        // The {T} cost tapped the source.
        expect(
            state.players[0].battlefield.find((c) => c.id === "gear")!.isTapped
        ).toBe(true);

        // Attach the target (locked in during the production target step) and
        // resolve.
        state.stack[state.stack.length - 1].targets = [
            { type: "permanent", id: "bear" },
        ];
        resolveTopOfStack(state);

        const liveBear = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(state, liveBear)).toBe(5);
        expect(getEffectiveToughness(state, liveBear)).toBe(1);

        // Untap step: the Gear is prompted (may choose not to untap), not
        // auto-untapped. Decline → the Gear stays tapped → buff persists.
        state.phase = "UNTAP";
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        untapStep(state);
        expect(state.pendingChoices?.[0]?.kind).toBe("untap-pick");
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [], // decline — keep the Gear tapped
        });
        expect(
            state.players[0].battlefield.find((c) => c.id === "gear")!.isTapped
        ).toBe(true);
        expect(getEffectivePower(state, liveBear)).toBe(5); // buff still live

        // Next untap, choose to untap → buff ends.
        state.phase = "UNTAP";
        untapStep(state);
        const head2 = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head2.playerId,
            stackItemId: head2.stackItemId,
            step: head2.step,
            choiceId: head2.choiceId,
            cardInstanceIds: ["gear"], // untap the Gear
        });
        expect(
            state.players[0].battlefield.find((c) => c.id === "gear")!.isTapped
        ).toBe(false);
        expect(getEffectivePower(state, liveBear)).toBe(3); // buff ended
    });
});

// ---------------------------------------------------------------------------
// Bazaar of Baghdad — stepped activated ability through the real path:
// activateAbility (tap cost, no mana → auto-commit) → resolveTopOfStack
// (step 0 draws two, step 1 suspends) → applyPendingChoiceSubmit (the
// production discard resume). Guards the re-draw bug end-to-end: the draw
// must commit exactly once before the discard choice suspends.
// ---------------------------------------------------------------------------

describe("activation flow — Bazaar of Baghdad ({T}: draw two, discard three)", () => {
    function fillerInstances(
        prefix: string,
        zone: "library" | "hand",
        n: number
    ) {
        return Array.from({ length: n }, (_, i) =>
            makeInstance({
                id: `${prefix}${i}`,
                card: { id: `synth-${prefix}${i}` },
                types: ["Creature"],
                zone,
            })
        );
    }

    it("draws exactly once before suspending, then discards the three chosen cards", () => {
        const bazaar = makeInstance({
            id: "bazaar",
            card: { id: bazaarOfBaghdad.id },
            types: ["Land"],
        });
        const state = makeGame({
            players: [
                makePlayer({
                    id: "p1",
                    battlefield: [bazaar],
                    library: fillerInstances("lib", "library", 5),
                    hand: fillerInstances("h", "hand", 4),
                }),
                makePlayer({ id: "p2" }),
            ],
        });

        // {T} cost, no mana → activation auto-commits and taps Bazaar.
        const result = activateAbility(
            state,
            "p1",
            "bazaar",
            "bazaar-of-baghdad-draw-discard"
        );
        expect(result).toBe("committed");
        expect(
            state.players[0].battlefield.find((c) => c.id === "bazaar")!
                .isTapped
        ).toBe(true);

        // Resolve: step 0 draws two, step 1 suspends on the discard choice.
        resolveTopOfStack(state);
        expect(state.players[0].library).toHaveLength(3); // drew exactly twice
        expect(state.players[0].hand).toHaveLength(6);
        expect(state.pendingChoices?.[0]?.choiceId).toBe("bazaar-discard");

        // Production discard resume.
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["h0", "h1", "lib0"],
        });

        expect(state.players[0].library).toHaveLength(3); // no second draw
        expect(state.players[0].hand).toHaveLength(3);
        expect(state.players[0].graveyard.map((c) => c.id).sort()).toEqual([
            "h0",
            "h1",
            "lib0",
        ]);
        expect(state.stack).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Tracker — full activate ({G}{G},{T}) → pay → tap source → select target →
// resolve → Fight. Integration across the GRE activation/payment/targeting/
// resolution path (mirrors the game.ts mutation chain) for the new generic
// Fight primitive (CR 701.12 mutual damage; #422).
// ---------------------------------------------------------------------------

describe("activation flow — Tracker Fight ({G}{G},{T}: mutual damage)", () => {
    it("pays {G}{G}, taps Tracker, targets a creature, and both fight to the death", () => {
        const trk = makeInstance({
            id: "trk",
            card: { id: tracker.id },
            types: ["Creature"],
            power: 2,
            toughness: 2,
        });
        const forests = Array.from({ length: 2 }, (_, i) =>
            makeInstance({
                id: `forest-${i}`,
                card: FOREST_CARD,
                types: ["Land"],
                subtypes: ["Forest"],
            })
        );
        const foe = makeInstance({
            id: "foe",
            card: { id: getCardByName("Goblin Hero").id },
            types: ["Creature"],
            controllerId: "p2",
            ownerId: "p2",
            power: 2,
            toughness: 2,
        });
        const state = makeGame({
            players: [
                makePlayer({ id: "p1", battlefield: [trk, ...forests] }),
                makePlayer({ id: "p2", battlefield: [foe] }),
            ],
        });

        // Empty pool → pending activation; the source tap is deferred to commit.
        const res = activateAbility(state, "p1", "trk", "tracker-fight");
        expect(res).toBe("pending");
        // Carry the chosen creature onto the pending activation (mirrors
        // finalizeTargetSelection in game.ts).
        state.pendingActivation!.targets = [{ type: "permanent", id: "foe" }];

        // Pay {G}{G} by tapping the two Forests — the second tap commits.
        expect(tapForActivationPayment(state, "p1", "forest-0")).toBe("tapped");
        expect(tapForActivationPayment(state, "p1", "forest-1")).toBe(
            "committed"
        );
        // Source tapped, target carried onto the committed stack item.
        expect(
            state.players[0].battlefield.find((c) => c.id === "trk")!.isTapped
        ).toBe(true);
        expect(state.stack[state.stack.length - 1].targets).toEqual([
            { type: "permanent", id: "foe" },
        ]);

        resolveTopOfStack(state);
        checkStateBasedActions(state);

        // 2/2 vs 2/2 — both deal lethal simultaneously and hit the graveyard.
        expect(state.players[0].battlefield.some((c) => c.id === "trk")).toBe(
            false
        );
        expect(state.players[1].battlefield.some((c) => c.id === "foe")).toBe(
            false
        );
        expect(state.players[0].graveyard.some((c) => c.id === "trk")).toBe(
            true
        );
        expect(state.players[1].graveyard.some((c) => c.id === "foe")).toBe(
            true
        );
    });
});

describe("activation flow — Clergy of the Holy Nimbus ({1}, opponents-only, CR 602.1 / 614.5) — issue #491", () => {
    const CANT_REGEN_ID = "clergy-cant-regen";

    function setup() {
        const clergy = makeInstance({
            id: "clergy",
            card: { id: clergyOfTheHolyNimbus.id },
            controllerId: "p1",
            ownerId: "p1",
        });
        const plains = makeInstance({
            id: "p2-plains",
            card: { name: "Plains", types: ["Land"], subtypes: ["Plains"] },
            types: ["Land"],
            subtypes: ["Plains"],
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeGame({
            players: [
                makePlayer({ id: "p1", battlefield: [clergy] }),
                makePlayer({ id: "p2", battlefield: [plains] }),
            ],
        });
        return { state };
    }

    it("the controller CANNOT activate the opponents-only {1} ability (CR 602.1)", () => {
        const { state } = setup();
        expect(() =>
            activateAbility(state, "p1", "clergy", CANT_REGEN_ID)
        ).toThrow(/Only your opponents/);
    });

    it("an opponent pays {1}, the ability resolves, and the next destroy is lethal (CR 701.15c)", () => {
        const { state } = setup();
        // Opponent (p2) activates the controller's Clergy — empty pool → pending.
        expect(activateAbility(state, "p2", "clergy", CANT_REGEN_ID)).toBe(
            "pending"
        );
        // Pay {1} from p2's own Plains → commits.
        expect(tapForActivationPayment(state, "p2", "p2-plains")).toBe(
            "committed"
        );
        expect(state.stack[0]?.castById).toBe("p2");
        resolveTopOfStack(state);
        const clergy = state.players[0].battlefield.find(
            (c) => c.id === "clergy"
        )!;
        expect(clergy.cantBeRegeneratedThisTurn).toBe(true);
        // Now a destroy is lethal — auto-regen is suppressed.
        const destroyed = destroyWithReplacements(state, "clergy");
        expect(destroyed).toBe(true);
        expect(
            state.players[0].battlefield.some((c) => c.id === "clergy")
        ).toBe(false);
    });

    it("without the opponent's activation, auto-regen saves Clergy from destruction (CR 614.5)", () => {
        const { state } = setup();
        const destroyed = destroyWithReplacements(state, "clergy");
        expect(destroyed).toBe(false);
        const survivor = state.players[0].battlefield.find(
            (c) => c.id === "clergy"
        )!;
        expect(survivor.isTapped).toBe(true);
    });
});
