// The `loseAbility` Verb Frame (CR 613.1f + CR 611.2a, issue #2125):
// "<object> loses <keyword>[ until <duration>]" and the group's "<objects> lose
// <keyword> until <duration>", lowered to the `loseAbility` Op.
//
// Three layers:
//
//  1. GOLDENS — one per accepted form, each a real corpus row: an announced
//     target, timed (Radjan Spirit); the anaphor of the sentence before
//     (Vertigo); the source, INDEFINITE (Mist Dragon's "{0}: This creature
//     loses flying."); a group over a sweep (Whiteout's first line).
//  2. REFUSALS — neighbours that must NOT become a keyword loss: a life loss,
//     a two-keyword loss, "loses all abilities", a timeless group loss (a
//     static ability, not a one-shot).
//  3. The Op appears in the lowering exactly as the hand-written card
//     encodes it (Vertigo's DSL definition).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

const RADJAN_SPIRIT: OracleCard = {
    oracleId: "c9ffce6c-a113-4c9d-9148-5ace68f68793",
    name: "Radjan Spirit",
    manaCost: "{3}{G}",
    typeLine: "Creature — Spirit",
    oracleText: "{T}: Target creature loses flying until end of turn.",
    power: "3",
    toughness: "2",
    layout: "normal",
};

const VERTIGO: OracleCard = {
    oracleId: "1dabfade-79e5-44e2-afa6-b20498c6bb8b",
    name: "Vertigo",
    manaCost: "{R}",
    typeLine: "Instant",
    oracleText:
        "Vertigo deals 2 damage to target creature with flying. That creature loses flying until end of turn.",
    layout: "normal",
};

/** The one line of Mist Dragon that is this frame's: the source, no duration
 *  (the card's other lines are other gaps). */
const MIST_DRAGON_LINE = oracleCard({
    name: "Mist Dragon",
    manaCost: "{4}{U}{U}",
    typeLine: "Creature — Dragon",
    oracleText:
        "Flying\n{0}: This creature loses flying. (This effect lasts indefinitely.)",
    power: "4",
    toughness: "4",
});

/** Whiteout's first line on its own (its graveyard line is another gap). */
const WHITEOUT_LINE = oracleCard({
    name: "Whiteout",
    manaCost: "{1}{G}",
    typeLine: "Instant",
    oracleText: "All creatures lose flying until end of turn.",
    power: undefined,
    toughness: undefined,
});

/** The compiled script of `card`. The $source / $each forms are withheld by
 *  the smoke planner (`smoke-scenario`, a card-dependent subject) unless a
 *  golden fixture clears their form — the parse is what is under test here, so
 *  that quarantine, and only that one, is accepted. */
function readyEffects(card: OracleCard): unknown {
    const result = compileCard(card);
    if (result.state === "quarantine")
        expect(result.reasons.map((r) => r.kind)).toEqual(["smoke-scenario"]);
    else expect(result.state).toBe("ready");
    if (result.state === "unparsed") return undefined;
    const def = result.definition as {
        effects?: unknown;
        activatedAbilities?: { effects?: unknown }[];
    };
    return def.effects ?? def.activatedAbilities?.[0]?.effects;
}

/** Every Op name the compile of `text` emits, empty when it does not parse. */
function opsOf(text: string, typeLine = "Instant"): readonly string[] {
    const result = compileCard(
        oracleCard({
            oracleText: text,
            typeLine,
            power: undefined,
            toughness: undefined,
        })
    );
    return result.state === "unparsed" ? [] : (result.opsUsed ?? []);
}

describe("loseAbility frame — goldens (CR 613.1f)", () => {
    it("an announced target loses a keyword until end of turn (Radjan Spirit)", () => {
        expect(readyEffects(RADJAN_SPIRIT)).toEqual([
            {
                op: "loseAbility",
                target: { target: 0 },
                ability: "flying",
                duration: { phase: "end-of-turn" },
            },
        ]);
    });

    it("the anaphor names the earlier sentence's target (Vertigo, CR 608.2c)", () => {
        expect(readyEffects(VERTIGO)).toEqual([
            { op: "dealDamage", amount: 2, to: { target: 0 } },
            {
                op: "loseAbility",
                target: { target: 0 },
                ability: "flying",
                duration: { phase: "end-of-turn" },
            },
        ]);
    });

    it("no printed duration is INDEFINITE — the field is omitted (Mist Dragon, CR 611.2a)", () => {
        expect(readyEffects(MIST_DRAGON_LINE)).toEqual([
            {
                op: "loseAbility",
                target: { ref: "$source" },
                ability: "flying",
            },
        ]);
    });

    it("a group loses a keyword over a sweep (Whiteout)", () => {
        expect(readyEffects(WHITEOUT_LINE)).toEqual([
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    filter: { type: "Creature" },
                },
                effects: [
                    {
                        op: "loseAbility",
                        target: { ref: "$each" },
                        ability: "flying",
                        duration: { phase: "end-of-turn" },
                    },
                ],
            },
        ]);
    });
});

describe("loseAbility frame — refusals", () => {
    it.each([
        // A life loss stays the life sentence's.
        ["Target player loses 2 life."],
        // Two keywords: the Op names ONE (issue #2125 scope bound).
        [
            "Creatures your opponents control lose hexproof and indestructible until end of turn.",
        ],
        // "All abilities" is `loseAllAbilities`' shape, never a keyword.
        ["Target creature loses all abilities until end of turn."],
        // A timeless group loss is a static ability, not a one-shot.
        ["All creatures lose flying."],
        // A word that is no registry keyword.
        ["Target creature loses heart until end of turn."],
    ])("%s → no loseAbility", (text) => {
        expect(opsOf(text)).not.toContain("loseAbility");
    });
});
