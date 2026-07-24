// Scars of Mirrodin (SOM) — colorless behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { copperlineGorge, moxOpal } from "../colorless";
import { island } from "../../lea/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { applyPlayLand } from "../../../../gre/playLand";
import { getPlayer } from "../../../../gre/state";
import { tapSourceIntoPayment } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";
import type { TriggerStateView } from "../../../types";

// The SOM "fast land" cycle — "This land enters tapped unless you control
// two or fewer other lands." (CR 614.1c self-conditional replacement via the
// NEW `entersTappedUnless` field, issue #675.)
describe("Copperline Gorge (fast land, CR 614.1c / 605.1a)", () => {
    it("enters UNTAPPED with two or fewer other lands", () => {
        const otherLands = [
            makeInstance(island.id, { id: "l1" }),
            makeInstance(island.id, { id: "l2" }),
        ];
        const gorge = makeInstance(copperlineGorge.id, {
            id: "gorge",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: otherLands, hand: [gorge] }),
                makePlayer("p2"),
            ],
        });
        const player = getPlayer(state, "p1");
        const played = applyPlayLand(state, player, "gorge")!;
        expect(played.isTapped).toBe(false);
    });

    it("enters TAPPED with three or more other lands", () => {
        const otherLands = [
            makeInstance(island.id, { id: "l1" }),
            makeInstance(island.id, { id: "l2" }),
            makeInstance(island.id, { id: "l3" }),
        ];
        const gorge = makeInstance(copperlineGorge.id, {
            id: "gorge",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: otherLands, hand: [gorge] }),
                makePlayer("p2"),
            ],
        });
        const player = getPlayer(state, "p1");
        const played = applyPlayLand(state, player, "gorge")!;
        expect(played.isTapped).toBe(true);
    });

    it("taps for R or G", () => {
        const ability = copperlineGorge.activatedAbilities![0];
        expect(ability.manaChoices).toEqual([{ R: 1 }, { G: 1 }]);
    });
});

// Mox Opal (issue #1530, parent PRD #1525). "Metalcraft — {T}: Add one mana
// of any color. Activate only if you control three or more artifacts." A
// PREVIOUSLY-STUBBED card (som/#675-era) whose stub comment claimed the
// board-state `canActivate` gate was never consulted on the tap-mana fast
// path — stale: issue #947 (Chrome Mox's un-imprinted-mox fix) already wired
// `canActivate` into every real tap-mana consumer. Same shape as Chrome Mox
// (`canActivate` availability gate + static `manaChoices`), just gated by
// the shared `hasMetalcraft` board scan instead of a per-instance imprint
// counter.
describe("Mox Opal (SOM #179, issue #1530, Metalcraft)", () => {
    function boardWithArtifacts(count: number, opponentArtifacts = 0) {
        const mox = makeInstance(moxOpal.id, {
            id: "mox",
            controllerId: "p1",
            ownerId: "p1",
        });
        const otherArtifacts = Array.from({ length: count - 1 }, (_, i) =>
            makeInstance(moxOpal.id, {
                id: `art${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const oppArtifacts = Array.from(
            { length: opponentArtifacts },
            (_, i) =>
                makeInstance(moxOpal.id, {
                    id: `opp-art${i}`,
                    controllerId: "p2",
                    ownerId: "p2",
                })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mox, ...otherArtifacts] }),
                makePlayer("p2", { battlefield: oppArtifacts }),
            ],
        });
        return { state, mox: state.players[0].battlefield[0] };
    }

    it("definition sanity — {0} Legendary Artifact, one {T} choice mana ability gated by canActivate", () => {
        expect(moxOpal.manaCost).toEqual({});
        expect(moxOpal.types).toEqual(["Artifact"]);
        expect(moxOpal.supertypes).toEqual(["Legendary"]);
        const ability = moxOpal.activatedAbilities![0];
        expect(ability.useStack).toBe(false);
        expect(ability.cost).toEqual({ tap: true });
        expect(ability.canActivate).toBeDefined();
        expect(ability.manaChoices).toEqual([
            { W: 1 },
            { U: 1 },
            { B: 1 },
            { R: 1 },
            { G: 1 },
        ]);
    });

    it("canActivate is false with only Mox Opal itself on the battlefield (1 artifact)", () => {
        const { state, mox } = boardWithArtifacts(1);
        const ability = moxOpal.activatedAbilities![0];
        expect(ability.canActivate!(mox, state as TriggerStateView)).toBe(
            false
        );
    });

    it("canActivate is false with exactly 2 artifacts controlled", () => {
        const { state, mox } = boardWithArtifacts(2);
        const ability = moxOpal.activatedAbilities![0];
        expect(ability.canActivate!(mox, state as TriggerStateView)).toBe(
            false
        );
    });

    it("canActivate is true with 3 artifacts controlled (Mox Opal counts toward its own threshold)", () => {
        const { state, mox } = boardWithArtifacts(3);
        const ability = moxOpal.activatedAbilities![0];
        expect(ability.canActivate!(mox, state as TriggerStateView)).toBe(
            true
        );
    });

    it("only counts artifacts the SAME controller controls — an opponent's artifacts don't count", () => {
        const { state, mox } = boardWithArtifacts(1, 5);
        const ability = moxOpal.activatedAbilities![0];
        expect(ability.canActivate!(mox, state as TriggerStateView)).toBe(
            false
        );
    });

    it("taps for the chosen colour once Metalcraft is active", () => {
        const { state } = boardWithArtifacts(3);
        const player = getPlayer(state, "p1");
        const mox = player.battlefield.find((c) => c.id === "mox")!;
        tapSourceIntoPayment(state, player, mox, 2, []); // index 2 → B
        expect(player.manaPool.B).toBe(1);
    });

    it("the Metalcraft gate survives projection (wire format)", () => {
        const { state } = boardWithArtifacts(3);
        const projected = projectPublicState(state, 1, "p1");
        const slimMox = projected.players[0].battlefield.find(
            (c) => c.id === "mox"
        )!;
        const ability = moxOpal.activatedAbilities![0];
        expect(
            ability.canActivate!(slimMox, projected as TriggerStateView)
        ).toBe(true);
    });

    it("the Metalcraft gate correctly reads OFF below 3 artifacts through projection too", () => {
        const { state } = boardWithArtifacts(2);
        const projected = projectPublicState(state, 1, "p1");
        const slimMox = projected.players[0].battlefield.find(
            (c) => c.id === "mox"
        )!;
        const ability = moxOpal.activatedAbilities![0];
        expect(
            ability.canActivate!(slimMox, projected as TriggerStateView)
        ).toBe(false);
    });
});
