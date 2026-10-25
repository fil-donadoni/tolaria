// Bot-play sweep — the no-target `dealDamageToEach` Op (CR 120.3) is posed as
// a creature sweep: the opponent's surplus of 1/1s dies to it, so a spell that
// damages the opponent and the creatures they control is worth casting. Verdicts
// go through the real `playBotReach` pipeline.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../../cards/registry";
import type { CardDefinition, EffectOp } from "../../../cards/types";
import { playBotReach } from "../botReach";

function sorcery(effects: EffectOp[]): CardDefinition {
    return {
        id: "probe-each-damage",
        name: "Each Damage Probe",
        rarity: "common",
        oracleText: "",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        effects,
    } as CardDefinition;
}

describe("playBotReach on dealDamageToEach", () => {
    it("plays a one-sided 1-damage sweep against the opponent's 1/1s", () => {
        const def = sorcery([
            {
                op: "dealDamageToEach",
                amount: 1,
                creatures: { controller: "opponent" },
                players: "opponent",
            },
        ]);
        withTemporaryDefinition(def, () => {
            expect(playBotReach(def).outcome).toBe("played");
        });
    });
});
