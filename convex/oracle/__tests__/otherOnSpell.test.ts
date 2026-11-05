// Issue #8187 — "other" on a spell (CR 608.2c). A resolving spell is on no
// battlefield, so reading the word as the source excluding itself excludes
// nothing and the sweep hits every member. Read as English, the word names what
// the sentence before it named: the earlier sweep's set, or the announced
// target. With neither, the line refuses.

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { getEffectivePower } from "../../gre/layers";
import { type GameState, resolveTopOfStack } from "../../gre/state";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

const PUMP_OTHERS = "Other creatures you control get +1/+1 until end of turn.";

function spell(name: string, oracleText: string) {
    return compileCard(
        oracleCard({
            name,
            manaCost: "{1}{W}",
            typeLine: "Instant",
            oracleText,
            power: undefined,
            toughness: undefined,
        })
    );
}

function ready(name: string, oracleText: string): CardDefinition {
    const outcome = spell(name, oracleText);
    if (outcome.state !== "ready")
        throw new Error(`${name} is ${outcome.state}`);
    return outcome.definition as CardDefinition;
}

function registered(name: string, oracleText: string): string {
    const definition = ready(name, oracleText);
    registerTokenDefinition({ ...definition, id: name, rarity: "common" });
    return name;
}

function creature(
    id: string,
    subtypes: string[] = []
): ReturnType<typeof makeInstance> {
    const cardId = `test-8187-creature-${subtypes.join("-") || "plain"}`;
    registerTokenDefinition({
        id: cardId,
        name: cardId,
        rarity: "common",
        manaCost: { generic: 1 },
        types: ["Creature"],
        subtypes,
        power: 2,
        toughness: 2,
    });
    return makeInstance(cardId, { id, controllerId: "p1", ownerId: "p1" });
}

function powerOf(state: GameState, id: string): number {
    const card = state.players[0]!.battlefield.find((c) => c.id === id)!;
    return getEffectivePower(state, card);
}

const OKETRA =
    "Zombies you control get +2/+1 until end of turn. " + PUMP_OTHERS;
const ELOCUTION =
    "Put two +1/+1 counters on target creature you control. " + PUMP_OTHERS;

describe("CR 205.3 — 'other' after an earlier sweep names that sweep's set", () => {
    it("compiles to the subtype the earlier sweep narrowed to", () => {
        const { effects } = ready("Other After Sweep", OKETRA);
        expect(effects?.[1]).toMatchObject({
            op: "forEach",
            select: {
                controller: "controller",
                filter: { type: "Creature", excludeSubtype: "Zombie" },
            },
        });
        expect(JSON.stringify(effects)).not.toContain("excludeSource");
    });

    it("gives a Zombie one pump and everything else the other", () => {
        const zombie = creature("zombie", ["Zombie"]);
        const bear = creature("bear");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [zombie, bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, registered("Other After Sweep Run", OKETRA), "p1");
        resolveTopOfStack(state);
        expect(powerOf(state, "zombie")).toBe(4);
        expect(powerOf(state, "bear")).toBe(3);
    });

    it("refuses an earlier sweep over another battlefield", () => {
        const outcome = spell(
            "Other After Their Sweep",
            "Zombies get +2/+1 until end of turn. " + PUMP_OTHERS
        );
        expect(outcome.state).toBe("unparsed");
    });
});

describe("CR 115.1 — 'other' after an announced target names that target", () => {
    it("compiles to a sweep sparing the announced target", () => {
        const { effects } = ready("Other After Target", ELOCUTION);
        expect(effects?.[1]).toMatchObject({
            op: "forEach",
            select: {
                controller: "controller",
                filter: { type: "Creature" },
                excludeTargets: true,
            },
        });
        expect(JSON.stringify(effects)).not.toContain("excludeSource");
    });

    it("pumps every creature but the target", () => {
        const chosen = creature("chosen");
        const bear = creature("bear");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [chosen, bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(
            state,
            registered("Other After Target Run", ELOCUTION),
            "p1",
            [{ type: "permanent", id: "chosen" }]
        );
        resolveTopOfStack(state);
        // Two +1/+1 counters and no pump.
        expect(powerOf(state, "chosen")).toBe(4);
        expect(powerOf(state, "bear")).toBe(3);
    });

    it("refuses a target that is not the noun the sweep ranges over", () => {
        const outcome = spell(
            "Other After Player",
            "Target player draws a card. " + PUMP_OTHERS
        );
        expect(outcome.state).toBe("unparsed");
    });
});

describe("CR 608.2c — 'other' with no antecedent", () => {
    it.each([
        ["alone", PUMP_OTHERS],
        ["after a sentence naming nothing", "You gain 2 life. " + PUMP_OTHERS],
    ])("refuses the line %s", (form, oracleText) => {
        const outcome = spell(`Other ${form}`, oracleText);
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(JSON.stringify(outcome)).toContain("names no earlier sweep");
    });
});
