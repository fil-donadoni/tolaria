// ULG (Urza's Legacy) — black: Unearth (issue #689). {B} Sorcery: "Return
// target creature card with mana value 3 or less from your graveyard to the
// battlefield." plus Cycling {2} (CR 702.29). Cycling is exercised in
// convex/gre/__tests__/cycling.test.ts; this covers Unearth's on-resolution
// reanimation and the CR 601.2c mvFilter target legality.

import { describe, it, expect } from "vitest";
import {
    beginApplyingStaticEffects,
    resolveTopOfStack,
} from "../../../../gre/state";
import type { GameState } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";
import { projectPublicState } from "../../../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { getDefinition } from "../../../index";

const unearth = getDefinition("b6cb2549-e485-44d6-9d65-7605c568909e");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");
const crawWurm = getDefinition("bfed1a95-bd67-4e16-a781-81866028af2f");
const engineeredPlague = getDefinition("27e158d5-efb2-4f90-8898-60ede98f7d29");
const llanowarElves = getDefinition("d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb");
const conspiracy = getDefinition("411c9f22-2df0-4a63-b2be-fa02612a6ef8");

describe("Unearth (CR 400.7 reanimation, CR 601.2c mvFilter, CR 702.29 Cycling)", () => {
    it("returns a target creature card with MV<=3 from your graveyard to the battlefield", () => {
        // Grizzly Bears is {1}{G} — mana value 2 (CR 202.3), a legal target.
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [bears] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, unearth.id, "p1", [
            { type: "graveyard-card", id: "bears", playerId: "p1" },
        ]);
        resolveTopOfStack(state);

        const reanimated = state.players[0].battlefield.find(
            (c) => c.id === "bears"
        );
        expect(reanimated).toBeDefined();
        expect(reanimated!.controllerId).toBe("p1");
        expect(state.players[0].graveyard.some((c) => c.id === "bears")).toBe(
            false
        );

        // Wire format: the reanimated creature crosses projectPublicState.
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[0].battlefield.some((c) => c.id === "bears")
        ).toBe(true);
    });

    it("cannot target a creature card with mana value greater than 3 (CR 601.2c)", () => {
        // Craw Wurm is {4}{G}{G} — mana value 6, above the ceiling.
        const wurm = makeInstance(crawWurm.id, {
            id: "wurm",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [wurm, bears] }),
                makePlayer("p2"),
            ],
        });
        const legal = getLegalTargets(
            state,
            unearth.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        );
        const legalIds = legal.map((t) =>
            t.type === "graveyard-card" ? t.id : ""
        );
        expect(legalIds).toContain("bears");
        expect(legalIds).not.toContain("wurm");
    });
});

// ---------------------------------------------------------------------------
// Engineered Plague — {2}{B} Enchantment. "As this enchantment enters, choose a
// creature type. All creatures of the chosen type get -1/-1."
// ---------------------------------------------------------------------------

/** Submit the head pending choice with the given ordered ids (mirrors the
 *  game.ts mutation), as `sets/mmq/__tests__/black.test.ts` does for the other
 *  as-enters creature-type card. */
function submitHeadChoice(state: GameState, ids: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
}

describe("Engineered Plague (CR 614.12a as-enters creature type + CR 613.4c layer-7c -1/-1)", () => {
    it("raises a one-pick option-pick over the CR 205.3m creature types as it enters", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, engineeredPlague.id, "p1");
        resolveTopOfStack(state);

        const head = state.pendingChoices![0];
        expect(head.kind).toBe("option-pick");
        expect(head.asEntersKind).toBe("subtypes");
        expect(head.count).toBe(1);
        const ids = head.options!.map((o) => o.id);
        expect(ids).toContain("Elf");
        expect(ids).toContain("Goblin");
        // CR 205.3m only — a LAND type is not a legal answer here.
        expect(ids).not.toContain("Swamp");

        submitHeadChoice(state, ["Elf"]);
        const entered = state.players[0].battlefield.find(
            (c) => c.card.id === engineeredPlague.id
        )!;
        expect(entered.chosenSubtypes).toEqual(["Elf"]);
    });

    // The one clause that separates this card from Conspiracy: "ALL creatures",
    // both controllers', with no `controllerId` gate.
    it("gives -1/-1 to creatures of the chosen type on BOTH battlefields", () => {
        const myElves = makeInstance(llanowarElves.id, {
            id: "my-elves",
            controllerId: "p1",
            zone: "battlefield",
        });
        const theirElves = makeInstance(llanowarElves.id, {
            id: "their-elves",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const plague = makeInstance(engineeredPlague.id, {
            id: "plague-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        plague.chosenSubtypes = ["Elf"];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [plague, myElves] }),
                makePlayer("p2", { battlefield: [theirElves] }),
            ],
        });
        beginApplyingStaticEffects(state, plague);

        expect(getEffectivePower(state, myElves)).toBe(1 - 1);
        expect(getEffectiveToughness(state, myElves)).toBe(1 - 1);
        expect(getEffectivePower(state, theirElves)).toBe(1 - 1);
        expect(getEffectiveToughness(state, theirElves)).toBe(1 - 1);
    });

    it("leaves creatures of every OTHER type alone", () => {
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const plague = makeInstance(engineeredPlague.id, {
            id: "plague-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        plague.chosenSubtypes = ["Elf"];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [plague] }),
                makePlayer("p2", { battlefield: [bears] }),
            ],
        });
        beginApplyingStaticEffects(state, plague);

        expect(getEffectivePower(state, bears)).toBe(2);
        expect(getEffectiveToughness(state, bears)).toBe(2);
    });

    it("leaves every creature alone until the type is chosen", () => {
        const elves = makeInstance(llanowarElves.id, {
            id: "elves",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const plague = makeInstance(engineeredPlague.id, {
            id: "plague-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [plague] }),
                makePlayer("p2", { battlefield: [elves] }),
            ],
        });
        beginApplyingStaticEffects(state, plague);

        expect(getEffectiveToughness(state, elves)).toBe(1);
    });

    // CR 704.5f — the whole point of the card against a 1-toughness tribe: the
    // choice is made BEFORE the permanent enters (CR 614.12a), so the SBA pass
    // that follows the resolution already sees the -1/-1.
    it("kills the chosen tribe's 1-toughness creatures on entry (CR 704.5f)", () => {
        const elves = makeInstance(llanowarElves.id, {
            id: "elves",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [elves, bears] }),
            ],
        });
        pushSpell(state, engineeredPlague.id, "p1");
        resolveTopOfStack(state);
        // No hand-run SBA pass: `finalizeAsEnters` sweeps for us, and supplying
        // the pass here would make this test pass even if that sweep were
        // removed — the exact regression its CR 704.5f claim is about.
        submitHeadChoice(state, ["Elf"]);

        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "bears",
        ]);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("elves");
    });

    // The card's own comment claims the buff is LIVE (recomputed at every read,
    // unlike the apply-time grant family). A creature of the chosen type that
    // arrives after the Plague is the cheapest way to hold it to that.
    it("debuffs a creature of the chosen type that enters LATER", () => {
        const plague = makeInstance(engineeredPlague.id, {
            id: "plague-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        plague.chosenSubtypes = ["Elf"];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [plague] }),
                makePlayer("p2"),
            ],
        });
        beginApplyingStaticEffects(state, plague);

        const latecomer = makeInstance(llanowarElves.id, {
            id: "latecomer",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        state.players[1].battlefield.push(latecomer);
        expect(getEffectiveToughness(state, latecomer)).toBe(0);
    });

    // CR 613.1 layer order, and the cross-card seam this card shares with
    // Conspiracy (`sets/mmq/black.ts`): the layer-4 subtype SET is applied
    // before this layer-7c read, so a Bear that Conspiracy has turned into an
    // Elf is a legal victim of a Plague naming Elf — the predicate reads the
    // live subtypes, never the printed ones.
    it("reads the subtypes a layer-4 effect wrote, not the printed ones", () => {
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p1",
            zone: "battlefield",
        });
        const omen = makeInstance(conspiracy.id, {
            id: "consp-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        omen.chosenSubtypes = ["Elf"];
        const plague = makeInstance(engineeredPlague.id, {
            id: "plague-1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        plague.chosenSubtypes = ["Elf"];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [omen, bears] }),
                makePlayer("p2", { battlefield: [plague] }),
            ],
        });
        beginApplyingStaticEffects(state, omen);
        beginApplyingStaticEffects(state, plague);

        expect(bears.subtypes).toEqual(["Elf"]);
        expect(getEffectivePower(state, bears)).toBe(2 - 1);
        expect(getEffectiveToughness(state, bears)).toBe(2 - 1);
    });

    it("survives the wire projection — both seats see the chosen type and the debuffed P/T", () => {
        const elves = makeInstance(llanowarElves.id, {
            id: "elves",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const plague = makeInstance(engineeredPlague.id, {
            id: "plague-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        plague.chosenSubtypes = ["Elf"];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [plague] }),
                makePlayer("p2", { battlefield: [elves] }),
            ],
        });
        beginApplyingStaticEffects(state, plague);

        for (const viewer of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewer);
            const slimPlague = projected.players[0].battlefield.find(
                (c) => c.id === "plague-1"
            )!;
            expect(slimPlague.chosenSubtypes).toEqual(["Elf"]);
            const slimElves = projected.players[1].battlefield.find(
                (c) => c.id === "elves"
            )!;
            expect(getEffectiveToughness(projected, slimElves)).toBe(0);
        }
    });
});
