import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { gaeasCradle, tolarianAcademy } from "../colorless";
import {
    getDynamicManaProduced,
    getFixedManaAmount,
} from "../../../../gre/constants";
import { type CardInstanceState } from "../../../../gre/state";
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
