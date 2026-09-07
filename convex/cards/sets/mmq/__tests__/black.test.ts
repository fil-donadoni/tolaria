import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    beginApplyingStaticEffects,
    resolveTopOfStack,
    type GameState,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition } from "../../../index";

const snuffOut = getDefinition("18a3cca1-e50e-49b6-9e1a-f86640e3b177");
const conspiracy = getDefinition("411c9f22-2df0-4a63-b2be-fa02612a6ef8");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");
const llanowarElves = getDefinition("d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb");

// Snuff Out — {3}{B} Instant. "If you control a Swamp, you may pay 4 life rather
// than pay this spell's mana cost. Destroy target nonblack creature. It can't be
// regenerated." (CR 118.9 pitch cost; CR 701.8 destroy; CR 701.19c no-regen.)
describe("Snuff Out (destroy nonblack creature, can't regenerate — CR 701.8)", () => {
    const bears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870"); // green 2/2 — a nonblack creature

    it("destroys the target creature", () => {
        const victim = makeInstance(bears.id, {
            id: "v",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        pushSpell(state, snuffOut.id, "p1", [{ type: "permanent", id: "v" }]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "v")
        ).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === "v")).toBe(true);
    });

    it("can't be regenerated — a regeneration shield does not save the creature", () => {
        const victim = makeInstance(bears.id, {
            id: "v",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            regenerationShields: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        pushSpell(state, snuffOut.id, "p1", [{ type: "permanent", id: "v" }]);
        resolveTopOfStack(state);
        // CR 701.19c — the shield is bypassed; the creature is destroyed anyway.
        expect(state.players[1].graveyard.some((c) => c.id === "v")).toBe(true);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Conspiracy — {3}{B}{B} Enchantment, "As this enchantment enters, choose a
// creature type. Creatures you control are the chosen type. …"
// CR 614.1c/614.12a as-enters choice + CR 205.1b / 613.1d layer-4 subtype set.
// ───────────────────────────────────────────────────────────────────────────

/** Submit the head pending choice with the given ordered ids (mirrors the
 *  game.ts mutation). */
function submitChoice(state: GameState, ids: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
}

describe("Conspiracy (CR 614.12a as-enters creature type + CR 205.1b layer-4 subtype set)", () => {
    it("raises a one-pick option-pick over the CR 205.3m creature types as it enters", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, conspiracy.id, "p1");
        resolveTopOfStack(state);

        const head = state.pendingChoices![0];
        expect(head.kind).toBe("option-pick");
        expect(head.asEntersKind).toBe("subtypes");
        expect(head.count).toBe(1);
        const ids = head.options!.map((o) => o.id);
        expect(ids).toContain("Goblin");
        expect(ids).toContain("Elf");
        // CR 205.3m only — a LAND type is not a legal answer here.
        expect(ids).not.toContain("Forest");

        submitChoice(state, ["Goblin"]);
        const entered = state.players[0].battlefield.find(
            (c) => c.card.id === conspiracy.id
        )!;
        expect(entered.chosenSubtypes).toEqual(["Goblin"]);
    });

    it("replaces the creature types of creatures YOU control, and only yours", () => {
        const mine = makeInstance(grizzlyBears.id, {
            id: "mine",
            controllerId: "p1",
            zone: "battlefield",
        });
        const theirs = makeInstance(grizzlyBears.id, {
            id: "theirs",
            controllerId: "p2",
            zone: "battlefield",
        });
        const omen = makeInstance(conspiracy.id, {
            id: "consp-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        omen.chosenSubtypes = ["Goblin"];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [omen, mine] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        beginApplyingStaticEffects(state, omen);

        // CR 205.1b — "are the chosen type" REPLACES the creature types.
        expect(mine.subtypes).toEqual(["Goblin"]);
        expect(mine.subtypes).not.toContain("Bear");
        expect(theirs.subtypes).toEqual(["Bear"]);
    });

    it("applies to a creature with two printed creature types, replacing both", () => {
        const elves = makeInstance(llanowarElves.id, {
            id: "elves",
            controllerId: "p1",
            zone: "battlefield",
        });
        const omen = makeInstance(conspiracy.id, {
            id: "consp-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        omen.chosenSubtypes = ["Goblin"];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [omen, elves] }),
                makePlayer("p2"),
            ],
        });
        beginApplyingStaticEffects(state, omen);
        expect(elves.subtypes).toEqual(["Goblin"]);
    });

    // Conspiracy is a noncreature Enchantment its own controller controls, so
    // it sits inside the "creatures you control" scan on every board it is on:
    // without the `isCreature` gate it would rename ITSELF to the chosen type
    // and every other assertion here would still pass.
    it("does NOT rename itself — the enchantment is not a creature you control", () => {
        const mine = makeInstance(grizzlyBears.id, {
            id: "mine",
            controllerId: "p1",
            zone: "battlefield",
        });
        const omen = makeInstance(conspiracy.id, {
            id: "consp-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        omen.chosenSubtypes = ["Goblin"];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [omen, mine] }),
                makePlayer("p2"),
            ],
        });
        beginApplyingStaticEffects(state, omen);
        expect(omen.subtypes).toEqual([]);
        expect(mine.subtypes).toEqual(["Goblin"]);

        const projected = projectPublicState(state, 1, "p1");
        const slimOmen = projected.players[0].battlefield.find(
            (c) => c.id === "consp-1"
        )!;
        expect(slimOmen.subtypes).toEqual([]);
    });

    it("leaves every creature alone until the type is chosen", () => {
        const mine = makeInstance(grizzlyBears.id, {
            id: "mine",
            controllerId: "p1",
            zone: "battlefield",
        });
        const omen = makeInstance(conspiracy.id, {
            id: "consp-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [omen, mine] }),
                makePlayer("p2"),
            ],
        });
        beginApplyingStaticEffects(state, omen);
        expect(mine.subtypes).toEqual(["Bear"]);
    });

    it("survives the wire projection — the client sees the chosen type too", () => {
        const mine = makeInstance(grizzlyBears.id, {
            id: "mine",
            controllerId: "p1",
            zone: "battlefield",
        });
        const omen = makeInstance(conspiracy.id, {
            id: "consp-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        omen.chosenSubtypes = ["Goblin"];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [omen, mine] }),
                makePlayer("p2"),
            ],
        });
        beginApplyingStaticEffects(state, omen);

        const projected = projectPublicState(state, 1, "p1");
        const slimBears = projected.players[0].battlefield.find(
            (c) => c.id === "mine"
        )!;
        expect(slimBears.subtypes).toEqual(["Goblin"]);
        const slimOmen = projected.players[0].battlefield.find(
            (c) => c.id === "consp-1"
        )!;
        expect(slimOmen.chosenSubtypes).toEqual(["Goblin"]);
    });
});
