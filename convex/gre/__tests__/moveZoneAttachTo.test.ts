// CR 303.4f — an Aura entering by any means other than resolving as a spell
// lets its controller choose a host ONLY when the effect "doesn't specify the
// object or player the Aura will enchant". `moveZone`'s `attachTo` is that
// specification: the Aura enters already attached, with no prompt. CR 303.4g —
// no legal object to enchant: the Aura stays in its zone.
import { describe, expect, it } from "vitest";
import { buildSpellContext } from "../state";
import { runEffectScript } from "../effects/interpreter";
import { projectPublicState } from "../../gameProjections";
import { registerTokenDefinition } from "../../cards";
import type { EffectOp } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import {
    grizzlyBears,
    mountain,
    savannahLions,
    unholyStrength,
} from "../../cards/sets/lea/index.cards";

const SCRIPT_ID = "test-move-zone-attach-to";

function registerReturn(effects: EffectOp[]): void {
    registerTokenDefinition({
        id: SCRIPT_ID,
        name: SCRIPT_ID,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        effects,
    });
}

/** p1 holds the Aura in the graveyard; two creatures (`bears-1`, `lions-1`)
 *  and a land are on the battlefield. */
function board() {
    const aura = makeInstance(unholyStrength().id, {
        id: "aura-1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "graveyard",
    });
    const bears = makeInstance(grizzlyBears().id, {
        id: "bears-1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    const land = makeInstance(mountain().id, {
        id: "land-1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    const lions = makeInstance(savannahLions().id, {
        id: "lions-1",
        controllerId: "p2",
        ownerId: "p2",
        zone: "battlefield",
    });
    return makeState({
        players: [
            makePlayer("p1", { graveyard: [aura], battlefield: [bears, land] }),
            makePlayer("p2", { battlefield: [lions] }),
        ],
    });
}

function run(hostId: string, withAttachTo: boolean) {
    const effects = [
        {
            op: "moveZone",
            target: { target: 0 },
            to: "battlefield",
            ...(withAttachTo ? { attachTo: { target: 1 } } : {}),
        },
    ] as EffectOp[];
    registerReturn(effects);
    const state = board();
    const item = pushSpell(state, SCRIPT_ID, "p1", [
        { type: "graveyard-card", id: "aura-1", playerId: "p1" },
        { type: "permanent", id: hostId },
    ]);
    runEffectScript(buildSpellContext(state, item), effects);
    return state;
}

describe("moveZone attachTo (CR 303.4f)", () => {
    it("enters attached to the named host without a host prompt, even with 2+ legal hosts", () => {
        const state = run("lions-1", true);
        const aura = state.players[0].battlefield.find(
            (c) => c.id === "aura-1"
        )!;
        expect(aura).toBeDefined();
        expect(aura.attachedTo).toBe("lions-1");
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("discriminator: without attachTo the same board asks the controller to choose (CR 303.4f)", () => {
        const state = run("lions-1", false);
        expect(
            state.players[0].battlefield.some((c) => c.id === "aura-1")
        ).toBe(false);
        expect((state.pendingChoices ?? []).length).toBe(1);
    });

    it("a host that left the battlefield leaves the Aura in the graveyard (CR 303.4g)", () => {
        const state = run("gone-1", true);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["aura-1"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("a host the Aura cannot enchant (enchant creature, a land) leaves it in the graveyard (CR 303.4c/303.4g)", () => {
        const state = run("land-1", true);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["aura-1"]);
        expect(
            state.players[0].battlefield.some((c) => c.id === "aura-1")
        ).toBe(false);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("the attachment survives projectPublicState (wire format)", () => {
        const state = run("lions-1", true);
        const projected = projectPublicState(state, 1, "p1");
        const aura = projected.players[0].battlefield.find(
            (c) => c.id === "aura-1"
        )!;
        expect(aura.attachedTo).toBe("lions-1");
    });
});
