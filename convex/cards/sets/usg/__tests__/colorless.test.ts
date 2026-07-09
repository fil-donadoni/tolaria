import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { gaeasCradle, tolarianAcademy, powderKeg } from "../colorless";
import {
    getDynamicManaProduced,
    getFixedManaAmount,
} from "../../../../gre/constants";
import {
    resolveTopOfStack,
    removePermanentTo,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { registerTokenDefinition } from "../../../";
import type { CardDefinition } from "../../../types";
import { collectTriggers } from "../../../../gre/triggers";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { tapSourceIntoPayment } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";

const LLANOWAR_ELVES_ID = "d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb";
const SOL_RING_ID = "c4300d24-1cae-4dd5-be7e-38cc677cf5bd";

// Gaea's Cradle / Tolarian Academy — board-conditional mana (CR 106.1,
// 605.1a) via the `manaAmount` hook, the same primitive the Urza land trio
// uses (`convex/cards/sets/atq/colorless.ts`), generalized here to a COUNT
// of a permanent type instead of a binary assembled/not-assembled check
// (issue #675, ADR 0041).
describe("Gaea's Cradle ({T}: Add {G} for each creature you control, CR 605.1a)", () => {
    it("produces no mana with zero creatures on the battlefield", () => {
        const cradle = makeInstance(gaeasCradle.id);
        const battlefield: CardInstanceState[] = [cradle];
        expect(getDynamicManaProduced(cradle, battlefield)).toEqual({ G: 0 });
        expect(getFixedManaAmount(cradle, "G", battlefield)).toBe(0);
    });

    it("scales {G} output with the number of creatures controlled", () => {
        const cradle = makeInstance(gaeasCradle.id);
        const creatures = [
            makeInstance(LLANOWAR_ELVES_ID),
            makeInstance(LLANOWAR_ELVES_ID),
            makeInstance(LLANOWAR_ELVES_ID),
        ];
        const battlefield: CardInstanceState[] = [cradle, ...creatures];
        expect(getDynamicManaProduced(cradle, battlefield)).toEqual({ G: 3 });
        expect(getFixedManaAmount(cradle, "G", battlefield)).toBe(3);
    });

    it("does not count noncreature permanents (an artifact stays uncounted)", () => {
        const cradle = makeInstance(gaeasCradle.id);
        const battlefield: CardInstanceState[] = [
            cradle,
            makeInstance(SOL_RING_ID),
        ];
        expect(getFixedManaAmount(cradle, "G", battlefield)).toBe(0);
    });

    // Full path through the real tap-for-mana entry point (mirrors the atq
    // Urza-trio / ICE painland harness — `tapSourceIntoPayment`), with actual
    // creatures on the controller's battlefield.
    it("activating the mana ability through the engine adds {G} for each creature controlled", () => {
        const cradle = makeInstance(gaeasCradle.id, {
            id: "cradle",
            controllerId: "p1",
            ownerId: "p1",
        });
        const creatures = [
            makeInstance(LLANOWAR_ELVES_ID),
            makeInstance(LLANOWAR_ELVES_ID),
            makeInstance(LLANOWAR_ELVES_ID),
        ];
        const player = makePlayer("p1", {
            battlefield: [cradle, ...creatures],
        });
        const state = makeState({ players: [player, makePlayer("p2")] });
        state.activePlayerId = "p1";
        tapSourceIntoPayment(state, player, cradle, undefined, []);
        expect(player.manaPool.G).toBe(3);
        expect(cradle.isTapped).toBe(true);
    });

    it("the assembled {G} output survives the wire-format projection (CR 106.1)", () => {
        const cradle = makeInstance(gaeasCradle.id, { id: "cradle" });
        const creatures = [
            makeInstance(LLANOWAR_ELVES_ID),
            makeInstance(LLANOWAR_ELVES_ID),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cradle, ...creatures] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimBattlefield = projected.players[0].battlefield;
        const slimCradle = slimBattlefield.find((c) => c.id === "cradle")!;
        expect(
            getFixedManaAmount(
                slimCradle as unknown as CardInstanceState,
                "G",
                slimBattlefield as unknown as CardInstanceState[]
            )
        ).toBe(2);
    });
});

describe("Tolarian Academy ({T}: Add {U} for each artifact you control, CR 605.1a)", () => {
    it("produces no mana with zero artifacts on the battlefield", () => {
        const academy = makeInstance(tolarianAcademy.id);
        const battlefield: CardInstanceState[] = [academy];
        expect(getDynamicManaProduced(academy, battlefield)).toEqual({
            U: 0,
        });
        expect(getFixedManaAmount(academy, "U", battlefield)).toBe(0);
    });

    it("scales {U} output with the number of artifacts controlled", () => {
        const academy = makeInstance(tolarianAcademy.id);
        const artifacts = [
            makeInstance(SOL_RING_ID),
            makeInstance(SOL_RING_ID),
        ];
        const battlefield: CardInstanceState[] = [academy, ...artifacts];
        expect(getDynamicManaProduced(academy, battlefield)).toEqual({
            U: 2,
        });
        expect(getFixedManaAmount(academy, "U", battlefield)).toBe(2);
    });

    it("does not count nonartifact permanents (a creature stays uncounted)", () => {
        const academy = makeInstance(tolarianAcademy.id);
        const battlefield: CardInstanceState[] = [
            academy,
            makeInstance(LLANOWAR_ELVES_ID),
        ];
        expect(getFixedManaAmount(academy, "U", battlefield)).toBe(0);
    });

    // Tolarian Academy itself is a Land, not an Artifact (CR 205.3a — the
    // condition keys off `types.includes("Artifact")`), so it never
    // self-counts. Assert this explicitly rather than relying on it being an
    // incidental consequence of the type check above.
    it("does not count itself (Academy is a Land, not an Artifact)", () => {
        expect(tolarianAcademy.types).toEqual(["Land"]);
        const academy = makeInstance(tolarianAcademy.id);
        const artifact = makeInstance(SOL_RING_ID);
        const battlefield: CardInstanceState[] = [academy, artifact];
        // Exactly 1 (the Sol Ring) — Academy is not double-counted alongside it.
        expect(getFixedManaAmount(academy, "U", battlefield)).toBe(1);
    });

    // Full path through the real tap-for-mana entry point.
    it("activating the mana ability through the engine adds {U} for each artifact controlled", () => {
        const academy = makeInstance(tolarianAcademy.id, {
            id: "academy",
            controllerId: "p1",
            ownerId: "p1",
        });
        const artifacts = [
            makeInstance(SOL_RING_ID),
            makeInstance(SOL_RING_ID),
        ];
        const player = makePlayer("p1", {
            battlefield: [academy, ...artifacts],
        });
        const state = makeState({ players: [player, makePlayer("p2")] });
        state.activePlayerId = "p1";
        tapSourceIntoPayment(state, player, academy, undefined, []);
        expect(player.manaPool.U).toBe(2);
        expect(academy.isTapped).toBe(true);
    });

    it("the assembled {U} output survives the wire-format projection (CR 106.1)", () => {
        const academy = makeInstance(tolarianAcademy.id, { id: "academy" });
        const artifacts = [makeInstance(SOL_RING_ID)];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [academy, ...artifacts] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimBattlefield = projected.players[0].battlefield;
        const slimAcademy = slimBattlefield.find((c) => c.id === "academy")!;
        expect(
            getFixedManaAmount(
                slimAcademy as unknown as CardInstanceState,
                "U",
                slimBattlefield as unknown as CardInstanceState[]
            )
        ).toBe(1);
    });
});

// Powder Keg (Premodern SB, PRD #979 / issue #997). A DSL card that earns a
// dedicated GRE test because it exercises a NOVEL interaction: reading a
// source's counter count as LAST-KNOWN information AFTER the source has been
// sacrificed as an activation COST (CR 608.2g). The interpreter's `counters`
// EffectValue gained an off-battlefield `$source` fallback for exactly this
// card.
const FUSE_TRIGGER = "powder-keg-fuse";
const DETONATE = "powder-keg-detonate";

type UpkeepEvent = Parameters<typeof collectTriggers>[1][number];
/** A PHASE_BEGIN UPKEEP trigger event for `playerId` (CR 500.1). */
const upkeepEvent = (playerId: string): UpkeepEvent =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: playerId,
    }) as UpkeepEvent;

// Test tokens with fixed mana values (getManaValue reads the def's cost).
const ARTIFACT_MV3 = "test-pk-artifact-mv3";
const CREATURE_MV3 = "test-pk-creature-mv3";
const CREATURE_MV2 = "test-pk-creature-mv2";
const ARTIFACT_MV4 = "test-pk-artifact-mv4";
const ENCHANT_MV3 = "test-pk-enchant-mv3";

function registerSweepTokens(): void {
    const defs: CardDefinition[] = [
        {
            id: ARTIFACT_MV3,
            name: ARTIFACT_MV3,
            rarity: "common",
            manaCost: { generic: 3 },
            types: ["Artifact"],
        },
        {
            id: CREATURE_MV3,
            name: CREATURE_MV3,
            rarity: "common",
            manaCost: { generic: 2, R: 1 },
            types: ["Creature"],
            subtypes: ["Goblin"],
            power: 2,
            toughness: 2,
        },
        {
            id: CREATURE_MV2,
            name: CREATURE_MV2,
            rarity: "common",
            manaCost: { generic: 1, G: 1 },
            types: ["Creature"],
            subtypes: ["Bear"],
            power: 2,
            toughness: 2,
        },
        {
            id: ARTIFACT_MV4,
            name: ARTIFACT_MV4,
            rarity: "common",
            manaCost: { generic: 4 },
            types: ["Artifact"],
        },
        {
            id: ENCHANT_MV3,
            name: ENCHANT_MV3,
            rarity: "common",
            manaCost: { generic: 3 },
            types: ["Enchantment"],
        },
    ];
    for (const def of defs) registerTokenDefinition(def);
}

/** Fire Powder Keg's optional upkeep counter trigger and answer the may-pay
 *  prompt (accept = add a fuse counter, CR 603.5 / issue #680 cost-free may). */
function fireFuseTrigger(
    state: GameState,
    controller: string,
    accept: boolean
): void {
    state.stack.push(...collectTriggers(state, [upkeepEvent(controller)]));
    expect(resolveTopOfStack(state)).toBeNull(); // suspends on the may-pay
    expect(state.pendingChoices![0].kind).toBe("may-pay");
    applyMayPaySubmit(state, { playerId: controller, accept });
}

/** Activate "{T}, Sacrifice Powder Keg: …": pay the costs and push the ability,
 *  mirroring `commitActivation` in game.ts — the stack item is a snapshot of
 *  the source (retaining its fuse counters) and the source LEAVES the
 *  battlefield before the ability resolves (CR 601.2f sacrifice cost). */
function activateDetonate(
    state: GameState,
    source: CardInstanceState,
    controller: string
): void {
    const stackItem: StackItem = {
        ...structuredClone(source),
        zone: "stack",
        isTapped: true,
        castById: controller,
        abilityId: DETONATE,
        targets: [],
    };
    removePermanentTo(state, source.id, "graveyard", "sacrifice");
    state.stack.push(stackItem);
}

describe("Powder Keg (usg, issue #997)", () => {
    it("declares its two halves (optional upkeep counter + activated sweep)", () => {
        expect(powderKeg.name).toBe("Powder Keg");
        expect(powderKeg.types).toEqual(["Artifact"]);
        expect(powderKeg.triggeredAbilities?.[0]?.id).toBe(FUSE_TRIGGER);
        expect(powderKeg.activatedAbilities?.[0]?.id).toBe(DETONATE);
        expect(powderKeg.activatedAbilities?.[0]?.cost).toEqual({
            tap: true,
            sacrifice: true,
        });
    });

    describe("upkeep fuse-counter accrual (CR 603.5 optional, CR 122.1)", () => {
        it("adds one fuse counter when the controller accepts", () => {
            const keg = makeInstance(powderKeg.id, {
                id: "keg",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [keg] }),
                    makePlayer("p2"),
                ],
            });
            fireFuseTrigger(state, "p1", true);
            const onBoard = state.players[0].battlefield.find(
                (c) => c.id === "keg"
            )!;
            expect(onBoard.counters?.["fuse"]).toBe(1);

            // Wire format — the fuse counter is board-visible; confirm it
            // survives the projection (the client reads counters off the slim
            // card).
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "keg"
            )!;
            expect(slim.counters?.["fuse"]).toBe(1);
        });

        it("adds no counter when the controller declines", () => {
            const keg = makeInstance(powderKeg.id, {
                id: "keg",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [keg] }),
                    makePlayer("p2"),
                ],
            });
            fireFuseTrigger(state, "p1", false);
            const onBoard = state.players[0].battlefield.find(
                (c) => c.id === "keg"
            )!;
            expect(onBoard.counters?.["fuse"] ?? 0).toBe(0);
        });

        it("accrues across successive upkeeps", () => {
            const keg = makeInstance(powderKeg.id, {
                id: "keg",
                controllerId: "p1",
                ownerId: "p1",
                counters: { fuse: 2 },
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [keg] }),
                    makePlayer("p2"),
                ],
            });
            fireFuseTrigger(state, "p1", true);
            const onBoard = state.players[0].battlefield.find(
                (c) => c.id === "keg"
            )!;
            expect(onBoard.counters?.["fuse"]).toBe(3);
        });
    });

    describe("MV-matched sweep + sacrifice-as-cost last-known count (CR 608.2g)", () => {
        it("destroys exactly the artifacts/creatures with MV == fuse count (3)", () => {
            registerSweepTokens();
            const keg = makeInstance(powderKeg.id, {
                id: "keg",
                controllerId: "p1",
                ownerId: "p1",
                counters: { fuse: 3 },
            });
            const a3 = makeInstance(ARTIFACT_MV3, {
                id: "a3",
                controllerId: "p1",
                ownerId: "p1",
            });
            const c3 = makeInstance(CREATURE_MV3, {
                id: "c3",
                controllerId: "p2",
                ownerId: "p2",
            });
            const c2 = makeInstance(CREATURE_MV2, {
                id: "c2",
                controllerId: "p2",
                ownerId: "p2",
            });
            const a4 = makeInstance(ARTIFACT_MV4, {
                id: "a4",
                controllerId: "p1",
                ownerId: "p1",
            });
            const e3 = makeInstance(ENCHANT_MV3, {
                id: "e3",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [keg, a3, a4, e3] }),
                    makePlayer("p2", { battlefield: [c3, c2] }),
                ],
            });

            activateDetonate(state, keg, "p1");
            expect(resolveTopOfStack(state)).not.toBeNull();

            const alive = (id: string) =>
                state.players.some((p) =>
                    p.battlefield.some((c) => c.id === id)
                );
            // MV 3 artifact + MV 3 creature (either controller) → destroyed.
            expect(alive("a3")).toBe(false);
            expect(alive("c3")).toBe(false);
            // MV 2 creature, MV 4 artifact → survive (MV != 3).
            expect(alive("c2")).toBe(true);
            expect(alive("a4")).toBe(true);
            // MV 3 enchantment → not an artifact/creature (type filter), survives.
            expect(alive("e3")).toBe(true);
            // Powder Keg itself was sacrificed as a cost.
            expect(alive("keg")).toBe(false);

            // Wire format — the surviving/destroyed board is what the client
            // renders; re-assert through the projection.
            const projected = projectPublicState(state, 1, "p1");
            const projAlive = (id: string) =>
                projected.players.some((pl) =>
                    pl.battlefield.some((c) => c.id === id)
                );
            expect(projAlive("a3")).toBe(false);
            expect(projAlive("c3")).toBe(false);
            expect(projAlive("c2")).toBe(true);
            expect(projAlive("a4")).toBe(true);
        });

        it("reads last-known count 0 (nothing destroyed) with no fuse counters", () => {
            registerSweepTokens();
            const keg = makeInstance(powderKeg.id, {
                id: "keg",
                controllerId: "p1",
                ownerId: "p1",
            });
            const a3 = makeInstance(ARTIFACT_MV3, {
                id: "a3",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [keg, a3] }),
                    makePlayer("p2"),
                ],
            });
            activateDetonate(state, keg, "p1");
            expect(resolveTopOfStack(state)).not.toBeNull();
            // 0 fuse counters → only MV-0 permanents match; the MV-3 artifact
            // survives.
            expect(
                state.players[0].battlefield.some((c) => c.id === "a3")
            ).toBe(true);
        });
    });
});
