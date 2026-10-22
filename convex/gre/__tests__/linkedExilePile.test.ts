// CR 607.2a — the linked exile PILE: an `exile` Op with `linkToSource` stamps
// each card it exiles with the resolving source, and `forEach { set:
// "exiledWithSource" }, simultaneous: true` returns every stamped card to the
// battlefield as one event, each under its owner's control (CR 110.2a — "each
// player returns … all cards they own exiled with it", Parallax Wave). The
// engine half of the Parallax grammar rule (issue #5200).

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveActivated,
} from "../../cards/__tests__/setup.helper";
import { getDefinition } from "../../cards/index";
import { resolveTopOfStack, type GameState } from "../state";
import { projectPublicState } from "../../gameProjections";

const parallaxWave = getDefinition("cef789e8-e4cc-4f61-bc15-debc2487777f");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");
const holyStrength = getDefinition("e945a4cd-0eb1-4f54-898d-169ce2748a03");

/** The Wave's leave trigger, resolved as if it had just left. */
function resolveReturn(state: GameState, waveId: string): void {
    const wave = makeInstance(parallaxWave.id, {
        id: waveId,
        controllerId: "p1",
        ownerId: "p1",
    });
    state.stack.push({
        ...wave,
        zone: "stack",
        castById: "p1",
        triggeredAbilityId: "parallax-wave-return",
        triggerSourceId: waveId,
        triggerEvent: {
            type: "PERMANENT_LEFT",
            instanceId: waveId,
            controllerId: "p1",
            ownerId: "p1",
            types: ["Enchantment"],
            wasAura: false,
            toZone: "graveyard",
        },
        targets: [],
    });
    resolveTopOfStack(state);
}

describe("linked exile pile (CR 607.2a)", () => {
    it("the exile Op stamps its card with the source, visible on the wire as pinned to it", () => {
        const wave = makeInstance(parallaxWave.id, {
            id: "wave",
            controllerId: "p1",
            ownerId: "p1",
            counters: { fade: 5 },
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wave] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        resolveActivated(state, wave, "parallax-wave-exile", [
            { type: "permanent", id: "bear" },
        ]);
        expect(state.players[1].exile[0]).toMatchObject({
            id: "bear",
            exiledBySourceId: "wave",
        });
        const projected = projectPublicState(state, 1, "p2");
        const exiled = projected.players[1].exile.find((c) => c.id === "bear");
        expect(exiled?.exiledByPermanentId).toBe("wave");
    });

    it("returns every linked card under its OWNER's control (CR 110.2a), leaving unlinked exile alone", () => {
        // A p2-owned card p1 had stolen, a p1-owned card, and an unrelated
        // exiled card — only the two the Wave exiled come back.
        const stolen = makeInstance(grizzlyBears.id, {
            id: "stolen",
            controllerId: "p2",
            ownerId: "p2",
            zone: "exile",
            exiledBySourceId: "wave",
        });
        const own = makeInstance(grizzlyBears.id, {
            id: "own",
            controllerId: "p1",
            ownerId: "p1",
            zone: "exile",
            exiledBySourceId: "wave",
        });
        const unrelated = makeInstance(grizzlyBears.id, {
            id: "unrelated",
            controllerId: "p2",
            ownerId: "p2",
            zone: "exile",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { exile: [own] }),
                makePlayer("p2", { exile: [stolen, unrelated] }),
            ],
        });
        resolveReturn(state, "wave");

        expect(state.players[0].battlefield.map((c) => c.id)).toEqual(["own"]);
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "stolen",
        ]);
        expect(state.players[1].battlefield[0]!.controllerId).toBe("p2");
        expect(state.players[1].exile.map((c) => c.id)).toEqual(["unrelated"]);
    });

    it("the pile enters as ONE event: an Aura ahead of its only host still finds it (CR 303.4c)", () => {
        // Exile order puts the Aura first. A per-card return would bring it
        // back to an empty battlefield, where it has nothing to enchant and
        // stays in exile (CR 303.4g); the batch stages the creature first.
        const aura = makeInstance(holyStrength.id, {
            id: "aura",
            controllerId: "p2",
            ownerId: "p2",
            zone: "exile",
            exiledBySourceId: "wave",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            zone: "exile",
            exiledBySourceId: "wave",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { exile: [aura, bear] }),
            ],
        });
        resolveReturn(state, "wave");

        const back = state.players[1].battlefield;
        expect(back.map((c) => c.id).sort()).toEqual(["aura", "bear"]);
        expect(back.find((c) => c.id === "aura")!.attachedTo).toBe("bear");
        expect(state.players[1].exile).toHaveLength(0);
    });
});
