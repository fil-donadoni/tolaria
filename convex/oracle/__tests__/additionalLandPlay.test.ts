// "You may play an additional land on each of your turns." — the static clause
// frame (CR 305.2, issue #4570).
//
//  1. GOLDEN — Exploration compiled whole equals this Compiled Definition.
//  2. REFUSALS — the conditioned and counted neighbours stay unparsed.
//  3. BEHAVIOUR — the compiled definition, registered as-is, raises the land
//     allowance the engine reads (`getExtraLandDrops`), and a control run
//     without the permanent does not.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { makeInstance, makePlayer } from "../../cards/__tests__/setup.helper";
import { getExtraLandDrops } from "../../gre/rules";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { routeLine } from "../grammar/router";
import { staticSlot } from "../grammar/slots/staticSlot";
import { oracleCard, parseContext } from "./oracle.fixture";

const EXPLORATION = oracleCard({
    oracleId: "0c2841bb-038c-4fbf-8360-bc0a1522b58d",
    name: "Exploration",
    manaCost: "{G}",
    typeLine: "Enchantment",
    oracleText: "You may play an additional land on each of your turns.",
    power: undefined,
    toughness: undefined,
});

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "ready")
        throw new Error(`${card.name} ${outcome.state}`);
    return outcome.definition;
}

describe("additional land play — golden fixture (CR 305.2)", () => {
    it("Exploration: one extra land drop", () => {
        expect(sortKeys(compiled(EXPLORATION))).toEqual(
            sortKeys({
                name: "Exploration",
                types: ["Enchantment"],
                manaCost: { G: 1 },
                oracleText:
                    "You may play an additional land on each of your turns.",
                extraLandDrops: 1,
            })
        );
    });

    it("reads the sentence into the clause and routes it to the static slot", () => {
        const line = "You may play an additional land on each of your turns.";
        const parsed = staticSlot.run(line, parseContext());
        expect(parsed.ok).toBe(true);
        if (parsed.ok && parsed.value.kind === "static")
            expect(parsed.value.clause).toEqual({
                kind: "extra-land-drop",
                count: 1,
            });
        const routed = routeLine(line, parseContext());
        expect(routed.ok).toBe(true);
        if (routed.ok) expect(routed.value.slot).toBe("static");
    });

    it("two printed sentences add up (CR 305.2 — each effect raises the count)", () => {
        const definition = compiled(
            oracleCard({
                name: "Exploration",
                manaCost: "{G}",
                typeLine: "Enchantment",
                oracleText:
                    "You may play an additional land on each of your turns.\nYou may play an additional land on each of your turns.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(definition.extraLandDrops).toBe(2);
    });
});

describe("additional land play — refusals (fail-closed neighbours)", () => {
    const refused = [
        // A condition the engine encoding has no place for.
        "As long as you control another Elf, you may play an additional land on each of your turns.",
        // A count other than one, or an unbounded one.
        "You may play two additional lands on each of your turns.",
        "You may play any number of additional lands on each of your turns.",
        // Another holder or another window.
        "Each player may play an additional land on each of their turns.",
        "You may play an additional land this turn.",
        // Not a land play.
        "You may cast an additional spell on each of your turns.",
    ];
    for (const line of refused)
        it(`refuses "${line}"`, () => {
            expect(staticSlot.run(line, parseContext()).ok).toBe(false);
        });
});

describe("additional land play — the compiled definition in the real engine", () => {
    const ID = "compiled-exploration-4570";

    function withExploration<T>(fn: () => T): T {
        const definition: CardDefinition = {
            ...compiled(EXPLORATION),
            id: ID,
            rarity: "rare",
        };
        return withTemporaryDefinition(definition, fn);
    }

    it("raises the controller's land allowance by one", () => {
        withExploration(() => {
            const player = makePlayer("p1", {
                battlefield: [makeInstance(ID, { id: "exploration" })],
            });
            expect(getExtraLandDrops({}, player)).toBe(1);
        });
    });

    it("control: without the permanent the allowance is not raised", () => {
        withExploration(() => {
            expect(getExtraLandDrops({}, makePlayer("p1"))).toBe(0);
        });
    });
});

// "You may play an additional land this turn." — the ONE-SHOT twin, a spell
// effect sentence lowered to the `grantExtraLandDrops` Op (CR 305.2 / 514.2,
// issue #7220).

const EXPLORE_TEXT = "You may play an additional land this turn.\nDraw a card.";

function sorcery(oracleText: string, name = "Probe Sorcery") {
    return oracleCard({
        name,
        manaCost: "{1}{G}",
        typeLine: "Sorcery",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

describe("additional land play this turn — golden fixture (CR 305.2)", () => {
    it("Explore: one more land play, then a draw", () => {
        expect(sortKeys(compiled(sorcery(EXPLORE_TEXT, "Explore")))).toEqual(
            sortKeys({
                name: "Explore",
                types: ["Sorcery"],
                manaCost: { X: 1, G: 1 },
                oracleText: EXPLORE_TEXT,
                effects: [
                    {
                        op: "grantExtraLandDrops",
                        player: "controller",
                        count: 1,
                    },
                    { op: "draw", player: "controller", count: 1 },
                ],
            })
        );
    });
});

describe("additional land play this turn — refusals (fail-closed)", () => {
    it.each([
        "You may play up to two additional lands this turn.",
        "Each player may play an additional land this turn.",
        "Target player may play an additional land this turn.",
        "You may play an additional land this turn and an additional land next turn.",
    ])("refuses %s", (text) => {
        expect(compileCard(sorcery(text)).state).toBe("unparsed");
    });
});
