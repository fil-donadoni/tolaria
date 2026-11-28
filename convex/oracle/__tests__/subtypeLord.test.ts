// "Other <subtype> you control get +N/+N" — CR 613.4c layer 7c lord, with the
// source excluded, over
// an invariant-plural creature type ("Merfolk", CR 205.3m).

import { describe, expect, it } from "vitest";
import {
    resolveCompiledStatic,
    type CompiledStaticEffect,
} from "../../cards/compiledStatics";
import type {
    PermanentFilter,
    PermanentView,
    StaticEffectContext,
} from "../../cards/types";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { staticSlot } from "../grammar/slots/staticSlot";
import { oracleCard, parseContext } from "./oracle.fixture";

const HEXCATCHER = oracleCard({
    oracleId: "4246b503-0da8-4de7-9343-9dfb3c3672df",
    name: "Vodalian Hexcatcher",
    manaCost: "{1}{U}",
    typeLine: "Creature — Merfolk Wizard",
    oracleText:
        "Flash\nOther Merfolk you control get +1/+1.\nSacrifice a Merfolk: Counter target noncreature spell unless its controller pays {1}.",
    power: "1",
    toughness: "1",
});

const LORD_FILTER: PermanentFilter = {
    types: ["Creature"],
    subtypes: ["Merfolk"],
    controllerRelation: "you",
    excludeSource: true,
};

function read(line: string) {
    return staticSlot.run(line, parseContext());
}

describe("Other Merfolk you control get +1/+1 — golden (CR 613.4c)", () => {
    it("Vodalian Hexcatcher compiles whole", () => {
        const outcome = compileCard(HEXCATCHER);
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        const definition = sortKeys(outcome.definition) as {
            compiledStaticEffects: unknown;
            staticAbilities: unknown;
        };
        expect(definition.compiledStaticEffects).toEqual(
            sortKeys([
                {
                    kind: "pt-buff",
                    filter: LORD_FILTER,
                    power: 1,
                    toughness: 1,
                },
            ])
        );
        expect(definition.staticAbilities).toEqual(["flash"]);
    });

    it("without 'Other' the source is not excluded", () => {
        const parsed = read("Merfolk you control get +1/+1.");
        expect(parsed.ok).toBe(true);
        if (!parsed.ok || parsed.value.kind !== "static") return;
        expect(parsed.value.clause).toMatchObject({ kind: "pt-buff" });
        expect(
            (parsed.value.clause as { filter: { excludeSource?: true } }).filter
                .excludeSource
        ).toBeUndefined();
    });
});

describe("refused neighbours stay unparsed", () => {
    it.each([
        // singular verb: an attached-scope or self sentence, not a set
        "Other Merfolk you control gets +1/+1.",
        // a conditional tail is another form (CR 611.3a)
        "Other Merfolk you control get +1/+1 as long as you control an Island.",
        // an irregular plural the subtype table cannot read
        "Other Elves you control get +1/+1.",
        // an invariant plural never licenses a bare card type
        "Other Merfolk and Elves you control get +1/+1.",
    ])("%s", (line) => {
        expect(read(line).ok).toBe(false);
    });
});

describe("a compiled 'Other Merfolk' lord (CR 613.4c)", () => {
    const context: StaticEffectContext = {
        getColors: () => [],
        isCreature: (card) => card.types.includes("Creature"),
        hasSubtype: (card, subtype) => card.subtypes.includes(subtype),
        hasSupertype: () => false,
        getManaValue: () => 0,
        getPrintedTypes: (card) => [...card.types],
        getName: () => "",
        hasChosenName: () => false,
        getCounterCount: () => 0,
        getDevotion: () => 0,
    };

    function view(
        over: Partial<PermanentView> & { id: string }
    ): PermanentView {
        return {
            controllerId: "p1",
            ownerId: "p1",
            types: ["Creature"],
            subtypes: ["Merfolk"],
            isTapped: false,
            card: {},
            ...over,
        };
    }

    const effect: CompiledStaticEffect = {
        kind: "pt-buff",
        filter: LORD_FILTER,
        power: 1,
        toughness: 1,
    };

    it("buffs the controller's other Merfolk, never the source or others", () => {
        const resolved = resolveCompiledStatic(effect);
        if (resolved.kind !== "pt-buff") throw new Error("wrong kind");
        const source = view({ id: "hexcatcher" });
        const applies = (target: PermanentView) =>
            resolved.applies(target, source, context);
        expect(applies(view({ id: "other" }))).toBe(true);
        expect(applies(source)).toBe(false);
        expect(applies(view({ id: "theirs", controllerId: "p2" }))).toBe(false);
        expect(applies(view({ id: "bear", subtypes: ["Bear"] }))).toBe(false);
    });
});
