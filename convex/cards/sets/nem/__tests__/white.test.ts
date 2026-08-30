// NEM — white card behavior tests (ADR 0043 per-colour split). One describe per
// non-trivial card.
//
// Parallax Wave is a protocol card (ADR 0028 exile-and-return bundle, resolve()):
// Fading 5 rides the getDefinition seam, and the repeatable "remove a fade
// counter: exile target creature" activation + the leaves-the-battlefield return
// both use the resolve()-only `exileWithAttachments` / `returnExiledForSource`
// pair, so it earns hand-written GRE + wire coverage per § Card testing
// convention.

import { describe, it, expect } from "vitest";
import { parallaxWave } from "..";
import { grizzlyBears } from "../../lea";
import { forest } from "../../lea/colorless";
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
} from "../../../__tests__/setup";
import { resolveActivated, resolveTrigger, LEFT } from "./helpers";

// CR 610.3a — the ACTIVATED half of the exile-until-source-leaves family.
// "If a resolving spell or activated ability creates the initial one-shot
// effect that causes the object to change zones, and the specified event has
// already occurred before that one-shot effect would occur but after that
// spell or ability was put onto the stack, the object doesn't move."
//
// This is a DIFFERENT code path from the triggered case (Leyline Binding /
// Banishing Light, CR 610.3b) and needs its own proof: `buildTriggerItem`
// gives a trigger a FRESH stack-item id, while `buildActivatedAbilityStackItem`
// clones the source permanent and KEEPS its id — so any guard that identifies
// the source by scanning the stack passes the trigger test and silently does
// nothing here.
describe("Parallax Wave — destroyed in response to its own exile activation (CR 610.3a)", () => {
    it("exiles nothing, strands nothing: the target stays on the battlefield", () => {
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
        // resolves first with no bundle held and returns nothing.
        removePermanentTo(state, "wave", "graveyard");
        processPendingActionTriggers(state);
        while (state.stack.length > 0) resolveTopOfStack(state);

        // CR 610.3a — the specified event already happened, so the creature
        // does not move. Before the guard it was exiled under a bundle keyed to
        // a source that can never leave the battlefield again: stranded for the
        // rest of the game.
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "victim",
        ]);
        expect(state.players[1].exile).toHaveLength(0);
        expect(state.exileHeld ?? []).toHaveLength(0);
    });
});

describe("Parallax Wave (Fading 5 + remove-fade-counter: exile target creature; return on leave, CR 702.32 / 603.7a)", () => {
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

    it("exiles the target creature keyed to itself, then returns it to its owner when it leaves (CR 603.7a)", () => {
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
        // ADR 0028 — the exile is keyed to this enchantment's instance id.
        expect(state.exileHeld?.some((b) => b.sourceId === "wave")).toBe(true);

        // Wave leaves the battlefield → the return trigger fires and each owner
        // gets their exiled card back (CR 603.7a).
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

    it("returns EVERY creature exiled across multiple activations (bundle per activation, same sourceId)", () => {
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
