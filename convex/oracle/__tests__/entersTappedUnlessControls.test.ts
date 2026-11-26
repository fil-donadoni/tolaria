// "This land enters tapped unless you control a basic land" (CR 614.1d, issue
// #8655) — the board-conditional entry replacement, lowered to the data field
// `entersTappedUnlessControls` that `cards/entersTapped.ts` reads. "Basic" is
// the supertype, never a basic land type (CR 205.4c); "… unless you control a
// Forest" (the Eldraine castles) names one basic land type (CR 305.6), the
// filter's subtype. Its fast-land sibling,
// "… unless you control two or fewer other lands", is the same count read
// from above (`atMost`), "other" kept as the filter's `excludeSource`.

import { describe, expect, it } from "vitest";
import {
    abandonedAirTemple,
    baSingSe,
} from "../../cards/sets/tla/colorless.cards";
import { concealedCourtyard } from "../../cards/sets/kld/colorless.cards";
import { seachromeCoast } from "../../cards/sets/som/colorless.cards";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { staticSlot } from "../grammar/slots/staticSlot";
import { oracleCard, parseContext } from "./oracle.fixture";

const LINE = "This land enters tapped unless you control a basic land.";

const CONDITION = {
    kind: "controls",
    filter: { types: ["Land"], supertypes: ["Basic"] },
    atLeast: 1,
};

const ctx = parseContext();

function land(name: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost: "",
        typeLine: "Land",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

describe("enters tapped unless you control a basic land (CR 614.1d)", () => {
    it("reads the printed line into the controls IR", () => {
        const parsed = staticSlot.run(LINE, ctx);
        expect(parsed.ok).toBe(true);
        if (parsed.ok)
            expect(parsed.value).toEqual({
                kind: "static",
                clause: {
                    kind: "enters-tapped-unless-controls",
                    condition: CONDITION,
                },
            });
    });

    it("golden — Agna Qel'a compiles whole, the entry condition as data", () => {
        const outcome = compileCard(
            land(
                "Agna Qel'a",
                `${LINE}\n{T}: Add {U}.\n{2}{U}, {T}: Draw a card, then discard a card.`
            )
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Agna Qel'a",
                types: ["Land"],
                oracleText: `${LINE}\n{T}: Add {U}.\n{2}{U}, {T}: Draw a card, then discard a card.`,
                entersTappedUnlessControls: CONDITION,
                activatedAbilities: [
                    {
                        id: "agna-qel-a-mana",
                        oracleText: "{T}: Add {U}.",
                        cost: { tap: true },
                        useStack: false,
                        manaProduced: { U: 1 },
                    },
                    {
                        id: "agna-qel-a-ability-2",
                        oracleText:
                            "{2}{U}, {T}: Draw a card, then discard a card.",
                        cost: { mana: { X: 2, U: 1 }, tap: true },
                        useStack: true,
                        effects: [
                            { op: "draw", player: "controller", count: 1 },
                            {
                                op: "choice",
                                kind: "choose-hand-card",
                                player: "controller",
                                zone: "hand",
                                count: 1,
                                prompt: "Discard a card.",
                                bind: "$discard1",
                            },
                            {
                                op: "discard",
                                player: "controller",
                                cards: { ref: "$discard1" },
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("gold — the hand-written cards declare exactly what the rule reads", () => {
        expect(abandonedAirTemple().entersTappedUnlessControls).toEqual(
            CONDITION
        );
        expect(baSingSe().entersTappedUnlessControls).toEqual(CONDITION);
    });

    it("Ba Sing Se's residual gap is Earthbend alone (the hand-tail marker's fragment)", () => {
        const outcome = compileCard(
            land(
                "Ba Sing Se",
                `${LINE}\n{T}: Add {G}.\n{2}{G}, {T}: Earthbend 2. Activate only as a sorcery.`
            )
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps.map((gap) => gap.fragment)).toEqual([
            "{2}{G}, {T}: Earthbend 2. Activate only as a sorcery.",
        ]);
    });

    it.each([
        [
            "a count",
            "This land enters tapped unless you control two or more basic lands.",
        ],
        [
            "a compound object",
            "This land enters tapped unless you control a basic land or a Forest.",
        ],
        [
            "another controller",
            "This land enters tapped unless an opponent controls a basic land.",
        ],
        [
            "a trailing rider",
            "This land enters tapped unless you control a basic land and it's your turn.",
        ],
        [
            "another subject",
            "Creatures enter tapped unless you control a basic land.",
        ],
    ])("REFUSES %s", (_label, line) => {
        expect(staticSlot.run(line, ctx).ok).toBe(false);
    });
});

describe("enters tapped unless you control a basic land TYPE (CR 614.1d / 305.6)", () => {
    const VANTRESS_TEXT =
        "This land enters tapped unless you control an Island.\n{T}: Add {U}.\n{2}{U}{U}, {T}: Scry 2.";

    it.each([
        ["a Plains", "Plains"],
        ["an Island", "Island"],
        ["a Swamp", "Swamp"],
        ["a Mountain", "Mountain"],
        ["a Forest", "Forest"],
    ])("reads %s into a subtype controls IR", (object, subtype) => {
        const parsed = staticSlot.run(
            `This land enters tapped unless you control ${object}.`,
            ctx
        );
        expect(parsed.ok).toBe(true);
        if (parsed.ok)
            expect(parsed.value).toEqual({
                kind: "static",
                clause: {
                    kind: "enters-tapped-unless-controls",
                    condition: {
                        kind: "controls",
                        filter: { subtypes: [subtype] },
                        atLeast: 1,
                    },
                },
            });
    });

    it("golden — Castle Vantress compiles whole, the land type as data", () => {
        const outcome = compileCard(land("Castle Vantress", VANTRESS_TEXT));
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Castle Vantress",
                types: ["Land"],
                oracleText: VANTRESS_TEXT,
                entersTappedUnlessControls: {
                    kind: "controls",
                    filter: { subtypes: ["Island"] },
                    atLeast: 1,
                },
                activatedAbilities: [
                    {
                        id: "castle-vantress-mana",
                        oracleText: "{T}: Add {U}.",
                        cost: { tap: true },
                        useStack: false,
                        manaProduced: { U: 1 },
                    },
                    {
                        id: "castle-vantress-ability-2",
                        oracleText: "{2}{U}{U}, {T}: Scry 2.",
                        cost: { mana: { X: 2, U: 2 }, tap: true },
                        useStack: true,
                        effects: [
                            {
                                op: "scryReorder",
                                player: "controller",
                                count: 2,
                                destination: "library-bottom",
                            },
                        ],
                    },
                ],
            })
        );
    });

    it.each([
        [
            "a non-basic subtype",
            "This land enters tapped unless you control an Equipment.",
        ],
        [
            "an article mismatch",
            "This land enters tapped unless you control an Plains.",
        ],
        [
            "two basic land types (the check lands)",
            "This land enters tapped unless you control a Plains or an Island.",
        ],
        [
            "a count of a land type",
            "This land enters tapped unless you control two or more Forests.",
        ],
        [
            "another controller",
            "This land enters tapped unless an opponent controls a Forest.",
        ],
    ])("REFUSES %s", (_label, line) => {
        expect(staticSlot.run(line, ctx).ok).toBe(false);
    });
});

describe("enters tapped unless you control two or fewer other lands (CR 614.1d)", () => {
    const FAST_LINE =
        "This land enters tapped unless you control two or fewer other lands.";
    const FAST_CONDITION = {
        kind: "controls",
        filter: { types: ["Land"], excludeSource: true },
        atMost: 2,
    };

    it("reads the printed line into the upper-bound controls IR", () => {
        const parsed = staticSlot.run(FAST_LINE, ctx);
        expect(parsed.ok).toBe(true);
        if (parsed.ok)
            expect(parsed.value).toEqual({
                kind: "static",
                clause: {
                    kind: "enters-tapped-unless-controls",
                    condition: FAST_CONDITION,
                },
            });
    });

    it("golden — Concealed Courtyard compiles whole, the bound as data", () => {
        const oracleText = `${FAST_LINE}\n{T}: Add {W} or {B}.`;
        const outcome = compileCard(land("Concealed Courtyard", oracleText));
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Concealed Courtyard",
                types: ["Land"],
                oracleText,
                entersTappedUnlessControls: FAST_CONDITION,
                activatedAbilities: [
                    {
                        id: "concealed-courtyard-mana",
                        oracleText: "{T}: Add {W} or {B}.",
                        cost: { tap: true },
                        useStack: false,
                        manaChoices: [{ W: 1 }, { B: 1 }],
                    },
                ],
            })
        );
    });

    it("gold — the hand-written fast lands declare exactly what the rule reads", () => {
        expect(concealedCourtyard().entersTappedUnlessControls).toEqual(
            FAST_CONDITION
        );
        expect(seachromeCoast().entersTappedUnlessControls).toEqual(
            FAST_CONDITION
        );
    });

    it.each([
        [
            'the bound without "other"',
            "This land enters tapped unless you control two or fewer lands.",
        ],
        [
            "a lower bound",
            "This land enters tapped unless you control two or more other lands.",
        ],
        [
            "another controller",
            "This land enters tapped unless an opponent controls two or fewer other lands.",
        ],
        [
            "another object",
            "This land enters tapped unless you control two or fewer other creatures.",
        ],
        [
            "a numeral bound",
            "This land enters tapped unless you control 2 or fewer other lands.",
        ],
        [
            "a trailing rider",
            "This land enters tapped unless you control two or fewer other lands and it's your turn.",
        ],
    ])("REFUSES %s", (_label, line) => {
        expect(staticSlot.run(line, ctx).ok).toBe(false);
    });
});
