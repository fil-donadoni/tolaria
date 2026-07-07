// SOS (Secrets of Strixhaven) — multicolor behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import {
    traumaticCritique,
    witherbloomCharm,
    silverquillCharm,
    quandrixCharm,
} from "../multicolor";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import {
    applyPendingChoiceSubmit,
    applyMayPaySubmit,
} from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { registerTokenDefinition } from "../../..";

const CREATURE_ID = "6914c5a8-2114-41c5-a471-ca97524d622f"; // Sabretooth Tiger
// A NON-creature artifact (Black Lotus, mv 0 — no toughness, so it can't die
// to an unrelated SBA and mask a broken sacrifice/destroy).
const ARTIFACT_ID = "b0faa7f2-b547-42c4-a810-839da50dadfe"; // Black Lotus

// Quandrix Charm (issue #683) test fixtures — an ad-hoc filler spell (mode
// 1's counter target) and enchantment (mode 2's destroy target); neither
// needs any real behavior, just the right card type.
const QC_FILLER_SPELL_ID = "test-quandrix-charm-filler-spell";
registerTokenDefinition({
    id: QC_FILLER_SPELL_ID,
    name: "Test Filler Spell",
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Sorcery"],
});
const QC_ENCHANTMENT_ID = "test-quandrix-charm-enchantment";
registerTokenDefinition({
    id: QC_ENCHANTMENT_ID,
    name: "Test Filler Enchantment",
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Enchantment"],
});

describe("Traumatic Critique (X damage + draw two, discard one; CR 107.3 / 115.4 / 121.1)", () => {
    it("is an {X}{U}{R} instant targeting any target", () => {
        expect(traumaticCritique.manaCost).toEqual({ X: "X", U: 1, R: 1 });
        expect(traumaticCritique.types).toEqual(["Instant"]);
        expect(traumaticCritique.targetRequirement).toMatchObject({
            type: "any",
            count: 1,
        });
    });

    it("deals X damage to a player, draws two, then discards one", () => {
        const lib = [0, 1].map((i) =>
            makeInstance(traumaticCritique.id, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const handCard = makeInstance(traumaticCritique.id, {
            id: "h0",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib, hand: [handCard] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        const item = pushSpell(state, traumaticCritique.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 3;

        // First resolution step: 3 damage to p2 + draw 2 (irreversible), then
        // it suspends on the discard choice.
        const first = resolveTopOfStack(state);
        expect(first).toBeNull(); // suspended on the discard pick
        expect(state.players[1].life).toBe(17); // 20 - 3
        // Drew 2 (lib0, lib1) added to the pre-existing hand card.
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "h0",
            "lib0",
            "lib1",
        ]);

        // Submit the discard choice (discard the original hand card).
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["h0"],
        });
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "lib0",
            "lib1",
        ]);
        expect(state.players[0].graveyard.some((c) => c.id === "h0")).toBe(
            true
        );
    });

    it("wire format: the damage and net card count survive projection", () => {
        const lib = [0, 1].map((i) =>
            makeInstance(traumaticCritique.id, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const handCard = makeInstance(traumaticCritique.id, {
            id: "h0",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: lib, hand: [handCard] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        const item = pushSpell(state, traumaticCritique.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["h0"],
        });
        // p1 drew 2, discarded 1 → net hand of 2; p2 at 18 life.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand.length).toBe(2);
        expect(projected.players[1].life).toBe(18);
    });
});

describe("Witherbloom Charm (CR 700.2 modal — may-sacrifice, life gain, or destroy)", () => {
    it("declares three modes; only the destroy mode targets", () => {
        expect(witherbloomCharm.modes).toHaveLength(3);
        const destroy = witherbloomCharm.modes!.find(
            (m) => m.id === "destroy"
        )!;
        expect(destroy.targetRequirement).toMatchObject({
            mvFilter: { max: 2 },
        });
        expect(
            witherbloomCharm.modes!.find((m) => m.id === "sacrifice-draw")!
                .targetRequirement
        ).toBeUndefined();
        expect(
            witherbloomCharm.modes!.find((m) => m.id === "gain-life")!
                .targetRequirement
        ).toBeUndefined();
    });

    it("sacrifice-draw mode: accepting sacrifices a permanent and draws two (CR 701.16 / 121.1)", () => {
        const fodder = makeInstance(ARTIFACT_ID, {
            id: "fodder",
            controllerId: "p1",
            ownerId: "p1",
        });
        const lib = [0, 1].map((i) =>
            makeInstance(traumaticCritique.id, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fodder], library: lib }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, witherbloomCharm.id, "p1");
        item.chosenModeId = "sacrifice-draw";
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on may-pay
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(
            state.players[0].battlefield.some((c) => c.id === "fodder")
        ).toBe(false);
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "lib0",
            "lib1",
        ]);
    });

    it("sacrifice-draw mode: single candidate auto-resolves (no pick prompt, CR 701.16b)", () => {
        // Exactly one sacrificeable permanent → nothing to choose, so the
        // may-pay choice stays a bare Pay/Skip (no battlefield pick fields).
        const fodder = makeInstance(ARTIFACT_ID, {
            id: "fodder",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fodder] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, witherbloomCharm.id, "p1");
        item.chosenModeId = "sacrifice-draw";
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("may-pay");
        // No real choice: no battlefield pick machinery is attached.
        expect(head?.zone).toBeUndefined();
        expect(head?.candidateIds).toBeUndefined();
    });

    it("sacrifice-draw mode: MULTIPLE candidates prompt a victim pick; only the chosen one dies (CR 701.16b)", () => {
        // Two sacrificeable permanents → the payer must choose which to
        // sacrifice; the other is untouched (the reported Witherbloom Charm bug).
        const keep = makeInstance(ARTIFACT_ID, {
            id: "keep",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = makeInstance(ARTIFACT_ID, {
            id: "victim",
            controllerId: "p1",
            ownerId: "p1",
        });
        const lib = [0, 1].map((i) =>
            makeInstance(traumaticCritique.id, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [keep, victim],
                    library: lib,
                }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, witherbloomCharm.id, "p1");
        item.chosenModeId = "sacrifice-draw";
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on may-pay

        // The choice lights up the battlefield with both permanents as candidates.
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("may-pay");
        expect(head?.zone).toBe("battlefield");
        expect((head?.candidateIds ?? []).sort()).toEqual(["keep", "victim"]);

        // Wire format (mandatory for a board-visible effect): the pick fields
        // survive the projection so the client can render the picker.
        const projectedChoice = projectPublicState(state, 1, "p1")
            .pendingChoices?.[0];
        expect(projectedChoice?.zone).toBe("battlefield");
        expect((projectedChoice?.candidateIds ?? []).sort()).toEqual([
            "keep",
            "victim",
        ]);

        applyMayPaySubmit(state, {
            playerId: "p1",
            accept: true,
            sacrificeIds: ["victim"],
        });

        // Only the chosen permanent was sacrificed; the other stays.
        expect(state.players[0].battlefield.map((c) => c.id).sort()).toEqual([
            "keep",
        ]);
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "lib0",
            "lib1",
        ]);
    });

    it("sacrifice-draw mode: accepting without a pick when one is required is rejected (CR 701.16b)", () => {
        const a = makeInstance(ARTIFACT_ID, {
            id: "a",
            controllerId: "p1",
            ownerId: "p1",
        });
        const b = makeInstance(ARTIFACT_ID, {
            id: "b",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a, b] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, witherbloomCharm.id, "p1");
        item.chosenModeId = "sacrifice-draw";
        resolveTopOfStack(state);
        expect(() =>
            applyMayPaySubmit(state, { playerId: "p1", accept: true })
        ).toThrow(/choose 1 permanent/i);
        // Nothing was sacrificed by the rejected submission.
        expect(state.players[0].battlefield).toHaveLength(2);
    });

    it("sacrifice-draw mode: an illegal victim id is rejected (CR 701.16b)", () => {
        const a = makeInstance(ARTIFACT_ID, {
            id: "a",
            controllerId: "p1",
            ownerId: "p1",
        });
        const b = makeInstance(ARTIFACT_ID, {
            id: "b",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a, b] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, witherbloomCharm.id, "p1");
        item.chosenModeId = "sacrifice-draw";
        resolveTopOfStack(state);
        expect(() =>
            applyMayPaySubmit(state, {
                playerId: "p1",
                accept: true,
                sacrificeIds: ["not-on-battlefield"],
            })
        ).toThrow(/illegal sacrifice/i);
    });

    it("sacrifice-draw mode: declining draws nothing and sacrifices nothing", () => {
        const fodder = makeInstance(ARTIFACT_ID, {
            id: "fodder",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fodder] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, witherbloomCharm.id, "p1");
        item.chosenModeId = "sacrifice-draw";
        expect(resolveTopOfStack(state)).toBeNull();
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(
            state.players[0].battlefield.some((c) => c.id === "fodder")
        ).toBe(true);
        expect(state.players[0].hand).toHaveLength(0);
    });

    it("gain-life mode: you gain 5 life (CR 119.3a)", () => {
        const state = makeState({
            players: [makePlayer("p1", { life: 20 }), makePlayer("p2")],
        });
        const item = pushSpell(state, witherbloomCharm.id, "p1");
        item.chosenModeId = "gain-life";
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(25);
    });

    it("destroy mode: destroys target nonland permanent with mana value 2 or less (CR 701.7)", () => {
        const cheapArtifact = makeInstance(ARTIFACT_ID, {
            id: "cheap",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [cheapArtifact] }),
            ],
        });
        const item = pushSpell(state, witherbloomCharm.id, "p1", [
            { type: "permanent", id: "cheap" },
        ]);
        item.chosenModeId = "destroy";
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.some((c) => c.id === "cheap")).toBe(
            false
        );
    });
});

describe("Silverquill Charm (CR 700.2 modal — counters, exile-weak-creature, or drain)", () => {
    it("declares three modes; only the drain mode has no target", () => {
        expect(silverquillCharm.modes).toHaveLength(3);
        expect(
            silverquillCharm.modes!.find((m) => m.id === "counters")!
                .targetRequirement
        ).toMatchObject({ type: "Creature" });
        expect(
            silverquillCharm.modes!.find((m) => m.id === "exile")!
                .targetRequirement
        ).toMatchObject({ powerFilter: { max: 2 } });
        expect(
            silverquillCharm.modes!.find((m) => m.id === "drain")!
                .targetRequirement
        ).toBeUndefined();
    });

    it("counters mode: puts two +1/+1 counters on target creature (CR 122.1)", () => {
        const creature = makeInstance(CREATURE_ID, {
            id: "creature-1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [creature] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, silverquillCharm.id, "p1", [
            { type: "permanent", id: "creature-1" },
        ]);
        item.chosenModeId = "counters";
        resolveTopOfStack(state);
        const perm = state.players[0].battlefield.find(
            (c) => c.id === "creature-1"
        )!;
        expect(perm.counters?.["+1/+1"]).toBe(2);
    });

    it("exile mode: exiles target creature with power 2 or less (CR 701.13)", () => {
        const weakling = makeInstance(CREATURE_ID, {
            id: "weakling",
            controllerId: "p2",
            ownerId: "p2",
            power: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [weakling] }),
            ],
        });
        const item = pushSpell(state, silverquillCharm.id, "p1", [
            { type: "permanent", id: "weakling" },
        ]);
        item.chosenModeId = "exile";
        resolveTopOfStack(state);
        expect(state.players[1].exile.some((c) => c.id === "weakling")).toBe(
            true
        );
    });

    it("drain mode: each opponent loses 3 life and you gain 3 (CR 119.3)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        const item = pushSpell(state, silverquillCharm.id, "p1");
        item.chosenModeId = "drain";
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(23);
        expect(state.players[1].life).toBe(17);
    });
});

describe("Quandrix Charm (CR 700.2 modal — counter-unless-pay, destroy enchantment, or set P/T; issue #683)", () => {
    it("declares three modes with the three different target shapes", () => {
        expect(quandrixCharm.modes).toHaveLength(3);
        expect(
            quandrixCharm.modes!.find((m) => m.id === "counter")!
                .targetRequirement
        ).toMatchObject({ type: "spell" });
        expect(
            quandrixCharm.modes!.find((m) => m.id === "destroy-enchantment")!
                .targetRequirement
        ).toMatchObject({ type: "Enchantment" });
        expect(
            quandrixCharm.modes!.find((m) => m.id === "set-pt")!
                .targetRequirement
        ).toMatchObject({ type: "Creature" });
    });

    it("counter mode: declining payment counters the target spell (CR 701.5a / 117.3a)", () => {
        const state = makeState();
        const filler = pushSpell(state, QC_FILLER_SPELL_ID, "p2");
        const item = pushSpell(state, quandrixCharm.id, "p1", [
            { type: "spell", id: filler.id },
        ]);
        item.chosenModeId = "counter";
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on may-pay
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.stack.find((s) => s.id === filler.id)).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === filler.id)).toBe(
            true
        );
    });

    it("counter mode: paying {2} lets the target spell resolve", () => {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 },
                }),
            ],
        });
        const filler = pushSpell(state, QC_FILLER_SPELL_ID, "p2");
        const item = pushSpell(state, quandrixCharm.id, "p1", [
            { type: "spell", id: filler.id },
        ]);
        item.chosenModeId = "counter";
        expect(resolveTopOfStack(state)).toBeNull();
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        expect(state.stack.find((s) => s.id === filler.id)).toBeDefined();
    });

    it("destroy-enchantment mode: destroys the target enchantment (CR 701.7)", () => {
        const ench = makeInstance(QC_ENCHANTMENT_ID, {
            id: "ench-1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [ench] }),
            ],
        });
        const item = pushSpell(state, quandrixCharm.id, "p1", [
            { type: "permanent", id: "ench-1" },
        ]);
        item.chosenModeId = "destroy-enchantment";
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.some((c) => c.id === "ench-1")
        ).toBe(false);
    });

    it("set-pt mode: target creature becomes base 5/5 until end of turn (CR 613.4b layer 7b)", () => {
        const creature = makeInstance(CREATURE_ID, {
            id: "tiger-1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [creature] }),
            ],
        });
        const item = pushSpell(state, quandrixCharm.id, "p1", [
            { type: "permanent", id: "tiger-1" },
        ]);
        item.chosenModeId = "set-pt";
        resolveTopOfStack(state);
        expect(getEffectivePower(state, creature)).toBe(5);
        expect(getEffectiveToughness(state, creature)).toBe(5);
    });

    it("wire format: the set-pt mode's base P/T survives projectPublicState", () => {
        const creature = makeInstance(CREATURE_ID, {
            id: "tiger-2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [creature] }),
            ],
        });
        const item = pushSpell(state, quandrixCharm.id, "p1", [
            { type: "permanent", id: "tiger-2" },
        ]);
        item.chosenModeId = "set-pt";
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "tiger-2"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(5);
        expect(getEffectiveToughness(projected, slim)).toBe(5);
    });
});
