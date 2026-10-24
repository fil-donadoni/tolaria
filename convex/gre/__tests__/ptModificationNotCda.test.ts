// A P/T modification riding on an Aura is not a characteristic-defining
// ability (CR 604.3a), so it lands in 7c and SUMS with the host's own value
// instead of replacing it (CR 613.4a/c).
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getDefinition } from "../../cards";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import type { ContinuousEffect } from "../continuousEffects";

const nightmare = getDefinition("b8cdd6a7-f772-4ccb-914f-63f52ed54d6b");
const swamp = getDefinition("6176936d-72e2-4205-8871-4c5a4f1cb2d8");
const heroicDefiance = getDefinition("0dc1aa36-5d3b-4d25-9d54-937cdabf72a4");
const strengthOfUnity = getDefinition("1a9d4ff8-af35-413f-9aa2-f4c6e34fade2");
const exoticCurse = getDefinition("8ee35d99-9a8a-421b-bf43-74446909d87d");
const dragonWhelp = getDefinition("6bbf1eab-bc32-4835-b566-8634b1fe81b0");

function board(
    extra: { id: string; defId: string; attachedTo?: string }[],
    opts: { swamps?: number } = {}
) {
    const host = makeInstance(nightmare.id, { id: "nm", controllerId: "p1" });
    const lands = Array.from({ length: opts.swamps ?? 4 }, (_, i) =>
        makeInstance(swamp.id, { id: `sw${i}`, controllerId: "p1" })
    );
    const attached = extra.map((e) =>
        makeInstance(e.defId, {
            id: e.id,
            controllerId: "p1",
            attachedTo: e.attachedTo,
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [host, ...lands, ...attached] }),
            makePlayer("p2", { battlefield: [] }),
        ],
    });
    return { state, host };
}

describe("pt-cda host + Aura modification (CR 613.4a/c, CR 604.3a)", () => {
    it("Nightmare alone is 4/4 with four Swamps", () => {
        const { state, host } = board([]);
        expect(getEffectivePower(state, host)).toBe(4);
        expect(getEffectiveToughness(state, host)).toBe(4);
    });

    it("Heroic Defiance adds +3/+3 on top of the CDA, never replaces it", () => {
        // Colour census: Nightmare B=1, Heroic Defiance W=1, three red
        // Whelps R=3 -> red alone is most common, Nightmare (black) is not.
        const { state, host } = board(
            [{ id: "hd", defId: heroicDefiance.id, attachedTo: "nm" }],
            { swamps: 4 }
        );
        const opp = state.players[1];
        for (let i = 0; i < 3; i++) {
            opp.battlefield.push(
                makeInstance(dragonWhelp.id, {
                    id: `dw${i}`,
                    controllerId: "p2",
                })
            );
        }
        expect(getEffectivePower(state, host)).toBe(7);
        expect(getEffectiveToughness(state, host)).toBe(7);
    });

    it("Heroic Defiance's +0 branch leaves the CDA intact (no 0/0)", () => {
        // B=1, W=1 tie -> black is among the most common -> no bonus.
        const { state, host } = board([
            { id: "hd", defId: heroicDefiance.id, attachedTo: "nm" },
        ]);
        expect(getEffectivePower(state, host)).toBe(4);
        expect(getEffectiveToughness(state, host)).toBe(4);
    });

    it("two CDA-shaped Auras sum with each other and with the host", () => {
        // One basic land type (Swamp) -> Domain 1: +1/+1, +1/+1, -1/-1.
        const { state, host } = board([
            { id: "su1", defId: strengthOfUnity.id, attachedTo: "nm" },
            { id: "su2", defId: strengthOfUnity.id, attachedTo: "nm" },
            { id: "ec", defId: exoticCurse.id, attachedTo: "nm" },
        ]);
        expect(getEffectivePower(state, host)).toBe(5);
        expect(getEffectiveToughness(state, host)).toBe(5);
    });

    it("a 7b base set replaces the CDA, then the 7c Aura still applies on top", () => {
        const { state, host } = board([
            { id: "su", defId: strengthOfUnity.id, attachedTo: "nm" },
        ]);
        state.continuousEffects = [
            {
                id: "ce-set",
                layer: 7,
                sublayer: "7b",
                timestamp: 1,
                expiry: { kind: "indefinite", controllerId: "p1" },
                affected: { kind: "instances", instanceIds: ["nm"] },
                payload: { kind: "pt-set", power: 1, toughness: 1 },
                characteristicDefining: false,
            } as ContinuousEffect,
        ];
        expect(getEffectivePower(state, host)).toBe(2);
        expect(getEffectiveToughness(state, host)).toBe(2);
    });
});
