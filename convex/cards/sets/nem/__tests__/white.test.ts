// NEM — white card behavior tests (ADR 0043 per-colour split). One describe per
// non-trivial card.
//
// Parallax Wave: Fading 5 rides the getDefinition seam, and the repeatable
// "remove a fade counter: exile target creature" activation + the leaves-the-
// battlefield return are two LINKED abilities (CR 607.2a): the `exile` Op's
// `linkToSource` stamp and the `forEach { set: "exiledWithSource" }` pile
// return, the first card on both, so it carries GRE + wire coverage here.

import { describe, it, expect } from "vitest";
import {
    processPendingActionTriggers,
    removePermanentTo,
    resolveTopOfStack,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    resolveActivated,
} from "../../../__tests__/setup.helper";
import { resolveTrigger, LEFT } from "./set.helper";
import { getDefinition } from "../../../index";

const parallaxWave = getDefinition("cef789e8-e4cc-4f61-bc15-debc2487777f");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");
const forest = getDefinition("6f1c8cb0-38eb-408b-94e8-16db83999b3b");

// CR 607.2a — the exile and the return are LINKED abilities with no duration:
// Parallax Wave's exile is not an "until" exile, so CR 610.3a's "the object
// doesn't move" does not apply. "The second ability refers only to cards in
// the exile zone that were put there as a result of an instruction to exile
// them in the first ability" — and a Wave destroyed in response has already
// returned its pile, so the late exile is permanent (the card's well-known
// ruling). The `exileWithAttachments` encoding this card used to carry
// applied CR 610.3a here and exiled nothing.
describe("Parallax Wave — destroyed in response to its own exile activation (CR 607.2a)", () => {
    it("still exiles the target, and nothing ever returns it", () => {
        const wave = makeInstance(parallaxWave.id, {
            id: "wave",
            controllerId: "p1",
            ownerId: "p1",
            counters: { fade: 5 },
        });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wave] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });

        // The ability is on the stack (cost paid, target locked)...
        state.stack.push({
            ...wave,
            zone: "stack",
            castById: "p1",
            abilityId: "parallax-wave-exile",
            targets: [{ type: "permanent", id: "victim" }],
        });
        // ...and Parallax Wave is destroyed in response, so its leave trigger
        // resolves first with nothing exiled and returns nothing.
        removePermanentTo(state, "wave", "graveyard");
        processPendingActionTriggers(state);
        while (state.stack.length > 0) resolveTopOfStack(state);

        // CR 607.2a — the exile instruction still resolves; the return that
        // could name its card has come and gone.
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].exile.map((c) => c.id)).toEqual(["victim"]);
    });
});

describe("Parallax Wave (Fading 5 + remove-fade-counter: exile target creature; return on leave, CR 702.32 / 607.2a)", () => {
    it("enters with five fade counters (Fading 5 seam injection, ADR 0054)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, parallaxWave.id, "p1");
        resolveTopOfStack(state);
        const wave = state.players[0].battlefield.find(
            (c) => c.card.id === parallaxWave.id
        )!;
        expect(wave.counters).toEqual({ fade: 5 });
    });

    it("exiling ITSELF returns it with exactly Fading's five counters, not its leftovers plus five (CR 122.2, issue #3590)", () => {
        const wave = makeInstance(parallaxWave.id, {
            id: "wave",
            controllerId: "p1",
            ownerId: "p1",
            counters: { fade: 4 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wave] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, wave, "parallax-wave-exile", [
            { type: "permanent", id: "wave" },
        ]);
        expect(state.players[0].exile.some((c) => c.id === "wave")).toBe(true);
        const exiled = state.players[0].exile.find((c) => c.id === "wave")!;
        resolveTrigger(state, exiled, "parallax-wave-return", LEFT("wave"));
        const back = state.players[0].battlefield.find((c) => c.id === "wave");
        expect(back).toBeDefined();
        expect(back!.counters).toEqual({ fade: 5 });
    });

    it("exiles the target creature linked to itself, then returns it to its owner when it leaves (CR 607.2a)", () => {
        const wave = makeInstance(parallaxWave.id, {
            id: "wave",
            controllerId: "p1",
            ownerId: "p1",
            counters: { fade: 5 },
        });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wave] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });

        // Activate: exile the opponent's creature (cost payment is exercised by
        // game.ts + the affordability catalogue; resolve just does the exile).
        resolveActivated(state, wave, "parallax-wave-exile", [
            { type: "permanent", id: "victim" },
        ]);
        expect(
            state.players[1].battlefield.some((c) => c.id === "victim")
        ).toBe(false);
        expect(state.players[1].exile.some((c) => c.id === "victim")).toBe(
            true
        );
        // CR 607.2a — the exiled card is linked to this enchantment.
        expect(
            state.players[1].exile.find((c) => c.id === "victim")
                ?.exiledBySourceId
        ).toBe("wave");

        // Wave leaves the battlefield → the return trigger fires and each owner
        // gets their exiled card back (CR 607.2a).
        const waveInPlay = state.players[0].battlefield.find(
            (c) => c.id === "wave"
        )!;
        resolveTrigger(state, waveInPlay, "parallax-wave-return", LEFT("wave"));
        expect(state.players[1].exile.some((c) => c.id === "victim")).toBe(
            false
        );
        const returned = state.players[1].battlefield.find(
            (c) => c.id === "victim"
        );
        expect(returned).toBeDefined();
        expect(returned?.ownerId).toBe("p2");
    });

    it("returns EVERY creature exiled across multiple activations (one link per activation, same source)", () => {
        const wave = makeInstance(parallaxWave.id, {
            id: "wave",
            controllerId: "p1",
            ownerId: "p1",
            counters: { fade: 5 },
        });
        const a = makeInstance(grizzlyBears.id, {
            id: "a",
            controllerId: "p2",
            ownerId: "p2",
        });
        const b = makeInstance(grizzlyBears.id, {
            id: "b",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wave] }),
                makePlayer("p2", { battlefield: [a, b] }),
            ],
        });

        resolveActivated(state, wave, "parallax-wave-exile", [
            { type: "permanent", id: "a" },
        ]);
        resolveActivated(
            state,
            state.players[0].battlefield.find((c) => c.id === "wave")!,
            "parallax-wave-exile",
            [{ type: "permanent", id: "b" }]
        );
        expect(state.players[1].exile.map((c) => c.id).sort()).toEqual([
            "a",
            "b",
        ]);

        resolveTrigger(
            state,
            state.players[0].battlefield.find((c) => c.id === "wave")!,
            "parallax-wave-return",
            LEFT("wave")
        );
        expect(state.players[1].exile.length).toBe(0);
        expect(state.players[1].battlefield.map((c) => c.id).sort()).toEqual([
            "a",
            "b",
        ]);
    });

    it("wire format: an exiled creature is off every battlefield after projectPublicState", () => {
        const wave = makeInstance(parallaxWave.id, {
            id: "wave",
            controllerId: "p1",
            ownerId: "p1",
            counters: { fade: 5 },
        });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [wave],
                    library: [
                        makeInstance(forest.id, { id: "f", zone: "library" }),
                    ],
                }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveActivated(state, wave, "parallax-wave-exile", [
            { type: "permanent", id: "victim" },
        ]);
        const projected = projectPublicState(state, 1, "p1");
        const stillOnBoard = projected.players
            .flatMap((p) => p.battlefield)
            .some((c) => c.id === "victim");
        expect(stillOnBoard).toBe(false);
    });
});
