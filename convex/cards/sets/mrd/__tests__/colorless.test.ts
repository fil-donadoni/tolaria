// mrd (Mirrodin) — colorless behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import {
    talismanOfProgress,
    talismanOfDominance,
    chromeMox,
} from "../colorless";
import { balduvianBears } from "../../ice/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { tapSourceIntoPayment } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";
import { resolveTopOfStack } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import type { GameState, StackItem } from "../../../../gre/state";

// Talisman cycle (issue #675) — same painland shape as ICE's Adarkar Wastes
// cycle (`convex/cards/sets/ice/__tests__/colorless.test.ts`): one choice
// mana ability, index 0 is the painless {C}, indices 1-2 are the two
// colours carrying `dealsDamageToControllerOnColoredTap: 1` (CR 605.1a / 120).
describe.each([
    { def: talismanOfProgress, colors: ["W", "U"] as const },
    { def: talismanOfDominance, colors: ["U", "B"] as const },
])(
    "$def.name (Talisman painland cycle, CR 605.1a / 120)",
    ({ def, colors }) => {
        it("is a {2} Artifact with one {T} choice mana ability: {C} (index 0) + the two colours carrying a 1-damage rider", () => {
            expect(def.types).toEqual(["Artifact"]);
            expect(def.manaCost).toEqual({ X: 2 });
            const mana = def.activatedAbilities?.find(
                (a) => !a.useStack && a.manaChoices
            );
            expect(mana?.useStack).toBe(false);
            expect(mana?.cost).toEqual({ tap: true });
            expect(mana?.manaChoices).toEqual([
                { C: 1 },
                { [colors[0]]: 1 },
                { [colors[1]]: 1 },
            ]);
            expect(mana?.dealsDamageToControllerOnColoredTap).toBe(1);
        });

        it("tapping for {C} (the painless choice) costs no life and adds {C}", () => {
            const rock = makeInstance(def.id, {
                id: "rock",
                controllerId: "p1",
                ownerId: "p1",
            });
            const player = makePlayer("p1", { battlefield: [rock] });
            const state = makeState({ players: [player, makePlayer("p2")] });
            state.activePlayerId = "p1";
            tapSourceIntoPayment(state, player, rock, 0, []);
            expect(player.manaPool.C).toBe(1);
            expect(player.life).toBe(20);
        });

        it(`tapping for ${colors[1]} (a coloured choice) costs 1 life and adds {${colors[1]}}`, () => {
            const rock = makeInstance(def.id, {
                id: "rock",
                controllerId: "p1",
                ownerId: "p1",
            });
            const player = makePlayer("p1", { battlefield: [rock] });
            const state = makeState({ players: [player, makePlayer("p2")] });
            state.activePlayerId = "p1";
            tapSourceIntoPayment(state, player, rock, 2, []);
            expect(player.manaPool[colors[1]]).toBe(1);
            expect(player.life).toBe(19);
        });

        it("the coloured-tap life loss survives the wire-format projection (PublicGameState)", () => {
            const rock = makeInstance(def.id, {
                id: "rock",
                controllerId: "p1",
                ownerId: "p1",
            });
            const player = makePlayer("p1", { battlefield: [rock] });
            const state = makeState({ players: [player, makePlayer("p2")] });
            state.activePlayerId = "p1";
            tapSourceIntoPayment(state, player, rock, 1, []);
            const projected = projectPublicState(state, 1, "p1");
            expect(projected.players[0].life).toBe(19);
        });
    }
);

function etbEvent(instanceId: string): StackItem["triggerEvent"] {
    return {
        type: "PERMANENT_ENTERED",
        instanceId,
        controllerId: "p1",
        types: ["Artifact"],
    } as StackItem["triggerEvent"];
}

function pushEtbTrigger(
    state: GameState,
    mox: ReturnType<typeof makeInstance>
) {
    state.stack.push({
        ...mox,
        zone: "stack",
        castById: "p1",
        triggeredAbilityId: "chrome-mox-imprint",
        triggerSourceId: mox.id,
        triggerEvent: etbEvent(mox.id),
        targets: [],
    });
    resolveTopOfStack(state);
}

function submitChoice(state: GameState, cardInstanceIds: string[]) {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds,
    });
}

describe("Chrome Mox ({0} Artifact — imprint exile + colour-gated mana, CR 603.6a / 605.1a)", () => {
    it("is a {0} Artifact", () => {
        expect(chromeMox.manaCost).toEqual({});
        expect(chromeMox.types).toEqual(["Artifact"]);
    });

    it("ETB exiles the chosen nonartifact, nonland hand card and stamps its colours as imprint counters", () => {
        const mox = makeInstance(chromeMox.id, {
            id: "mox",
            controllerId: "p1",
            ownerId: "p1",
        });
        const greenCard = makeInstance(balduvianBears.id, {
            id: "greenCard",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mox], hand: [greenCard] }),
                makePlayer("p2"),
            ],
        });
        pushEtbTrigger(state, mox);
        submitChoice(state, ["greenCard"]);
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].exile.map((c) => c.id)).toContain("greenCard");
        const moxOnBattlefield = state.players[0].battlefield.find(
            (c) => c.id === "mox"
        )!;
        expect(moxOnBattlefield.counters?.["imprint-G"]).toBe(1);
    });

    it("declining the exile (or an all-land/artifact hand) leaves Chrome Mox with no mana ability available", () => {
        const mox = makeInstance(chromeMox.id, {
            id: "mox",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mox], hand: [] }),
                makePlayer("p2"),
            ],
        });
        pushEtbTrigger(state, mox);
        expect(state.pendingChoices ?? []).toEqual([]);
        const ability = chromeMox.activatedAbilities![0];
        expect(ability.canActivate!(mox, {} as never)).toBe(false);
    });

    it("taps for the exiled card's colour (CR 605.1a) once imprinted", () => {
        const mox = makeInstance(chromeMox.id, {
            id: "mox",
            controllerId: "p1",
            ownerId: "p1",
        });
        const greenCard = makeInstance(balduvianBears.id, {
            id: "greenCard",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const player = makePlayer("p1", {
            battlefield: [mox],
            hand: [greenCard],
        });
        const state = makeState({ players: [player, makePlayer("p2")] });
        state.activePlayerId = "p1";
        pushEtbTrigger(state, mox);
        submitChoice(state, ["greenCard"]);
        const moxOnBattlefield = player.battlefield.find(
            (c) => c.id === "mox"
        )!;
        const ability = chromeMox.activatedAbilities![0];
        expect(ability.canActivate!(moxOnBattlefield, {} as never)).toBe(true);
        expect(ability.getManaChoices!(moxOnBattlefield, "p1", [])).toEqual([
            { G: 1 },
        ]);
        tapSourceIntoPayment(state, player, moxOnBattlefield, 0, []);
        expect(player.manaPool.G).toBe(1);
    });

    it("wire format: the imprint counter is visible to both viewers", () => {
        const mox = makeInstance(chromeMox.id, {
            id: "mox",
            controllerId: "p1",
            ownerId: "p1",
        });
        const greenCard = makeInstance(balduvianBears.id, {
            id: "greenCard",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mox], hand: [greenCard] }),
                makePlayer("p2"),
            ],
        });
        pushEtbTrigger(state, mox);
        submitChoice(state, ["greenCard"]);
        for (const viewer of ["p1", "p2"] as const) {
            const projected = projectPublicState(state, 1, viewer);
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "mox"
            )!;
            expect(slim.counters?.["imprint-G"]).toBe(1);
        }
    });
});
