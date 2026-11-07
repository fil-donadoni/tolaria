// "This land enters tapped unless you control a basic land" (CR 614.1d, issue
// #8655) — the board-conditional entry replacement, lowered to the data field
// `entersTappedUnlessControls` that `cards/entersTapped.ts` reads. "Basic" is
// the supertype, never a basic land type (CR 205.4c).

import { describe, expect, it } from "vitest";
import {
    abandonedAirTemple,
    baSingSe,
} from "../../cards/sets/tla/colorless.cards";
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
            "another object (a basic land TYPE)",
            "This land enters tapped unless you control a Forest.",
        ],
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
