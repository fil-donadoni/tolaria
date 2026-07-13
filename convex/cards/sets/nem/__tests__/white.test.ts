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
import { resolveTopOfStack } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveActivated, resolveTrigger, LEFT } from "./helpers";

describe("Parallax Wave (Fading 5 + remove-fade-counter: exile target creature; return on leave, CR 702.32 / 603.7a)", () => {
    it("declares fading 5, the remove-fade-counter exile ability, and the return trigger", () => {
        expect(parallaxWave.staticAbilities).toEqual(["fading 5"]);
        expect(parallaxWave.types).toEqual(["Enchantment"]);
        const ability = parallaxWave.activatedAbilities![0];
        expect(ability.cost).toEqual({
            removeCounter: { type: "fade", count: 1 },
        });
        expect(ability.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
        });
        expect(parallaxWave.triggeredAbilities?.[0].event).toBe(
            "PERMANENT_LEFT"
        );
    });

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
