// Kicker: the "Kicker <cost>" line and the clauses that read it back
// (CR 702.33, issue #3826).
//
// Four layers, each watching a different way a kicker can go wrong:
//
//  1. GOLDEN fixtures — a real Oracle card (or a real kicker line) compiled
//     whole must produce exactly this Compiled Definition: one kicker, an
//     "and/or" pair with its per-kicker ids, a non-mana leg, Multikicker, the
//     spell's "If this spell was kicked, …" gate (any and per-kicker), and the
//     permanent's kicker-counted entry riders.
//  2. GOLD over the hand-written catalogue — every hand-written kicker line
//     compiles to the `kickers[]` its author wrote, or is refused; never to a
//     different cost.
//  3. REFUSALS — the per-kicker "enters with … and with <ability>" forms the
//     engine has no JSON surface for (fail-closed until it does), costs the
//     kicker path cannot pay, and a gated target (CR 702.33g).
//  4. LOWERING invariants — what only the whole card can decide: which kicker
//     "its {A} kicker" names, and whether the kicker tally reads 0 or N.

import { describe, expect, it } from "vitest";
import { getAllRawCards } from "../../cards/catalogue";
import type { KickerCost } from "../../cards/types";
import { compileCard } from "../compile";
import { canonicaliseShorthands, sortKeys } from "../gates";
import { routeLine } from "../grammar/router";
import { kickerRule, keywordLineSlot } from "../grammar/slots/keywordLine";
import { lowerCard } from "../lower";
import { lowerKickers } from "../lowerSpell";
import { readTypeLine } from "../typeLine";
import { oracleCard, parseContext } from "./fixtures";

function creature(name: string, manaCost: string, oracleText: string) {
    return oracleCard({ name, manaCost, oracleText, typeLine: "Creature" });
}

function spell(name: string, manaCost: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine: "Instant",
        power: undefined,
        toughness: undefined,
    });
}

/** Compile a card and return its definition, failing the test if refused. */
function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

/** The kicker line alone, through the keyword-line slot and lowering. */
function kickersOf(line: string): KickerCost[] {
    const parsed = keywordLineSlot.run(line, parseContext());
    if (!parsed.ok) throw new Error(`${line}: ${parsed.reason}`);
    if (parsed.value.kind !== "kicker") throw new Error(`${line}: not kicker`);
    const lowered = lowerKickers(parsed.value.kickers);
    if (!lowered.ok) throw new Error(`${line}: ${lowered.reason}`);
    return lowered.value;
}

describe("Kicker line — golden fixtures (CR 702.33a–c)", () => {
    it("single kicker: Kicker {2}{U} is one kicker with id 'kicker'", () => {
        expect(kickersOf("Kicker {2}{U}")).toEqual([
            {
                id: "kicker",
                description: "Kicker {2}{U}",
                mana: { X: 2, U: 1 },
            },
        ]);
    });

    it("and/or (CR 702.33b): two kickers, each named for its colours", () => {
        // Anavolver's line. The ids are the catalogue's own convention —
        // Nightscape Battlemage writes "kicker-u" / "kicker-r".
        expect(kickersOf("Kicker {1}{U} and/or {B}")).toEqual([
            {
                id: "kicker-u",
                description: "Kicker {1}{U}",
                mana: { X: 1, U: 1 },
            },
            { id: "kicker-b", description: "Kicker {B}", mana: { B: 1 } },
        ]);
    });

    it("non-mana leg: Kicker—Pay 3 life. (Phyrexian Scuta)", () => {
        expect(kickersOf("Kicker—Pay 3 life.")).toEqual([
            { id: "kicker", description: "Kicker—Pay 3 life", life: 3 },
        ]);
    });

    it("non-mana leg: Kicker—Sacrifice two lands. (Bog Down)", () => {
        expect(kickersOf("Kicker—Sacrifice two lands.")).toEqual([
            {
                id: "kicker",
                description: "Kicker—Sacrifice two lands",
                permanent: {
                    action: "sacrifice",
                    filter: { types: ["Land"] },
                    count: 2,
                },
            },
        ]);
    });

    it("mana AND a non-mana leg: Kicker—{2}{R}, Sacrifice a land. (Dwarven Landslide)", () => {
        expect(kickersOf("Kicker—{2}{R}, Sacrifice a land.")).toEqual([
            {
                id: "kicker",
                description: "Kicker—{2}{R}, Sacrifice a land",
                mana: { X: 2, R: 1 },
                permanent: {
                    action: "sacrifice",
                    filter: { types: ["Land"] },
                    count: 1,
                },
            },
        ]);
    });

    it("Multikicker (CR 702.33c) is one kicker with multi: true", () => {
        expect(kickersOf("Multikicker {1}{G}")).toEqual([
            {
                id: "kicker",
                description: "Multikicker {1}{G}",
                mana: { X: 1, G: 1 },
                multi: true,
            },
        ]);
    });

    it("reminder text is stripped before the line is read", () => {
        const def = compiled(
            creature(
                "Stronghold Confessor",
                "{B}",
                "Kicker {3} (You may pay an additional {3} as you cast this spell.)\nMenace\nIf this creature was kicked, it enters with two +1/+1 counters on it."
            )
        );
        expect(def.kickers).toEqual([
            { id: "kicker", description: "Kicker {3}", mana: { X: 3 } },
        ]);
    });
});

describe("If this spell was kicked, … (CR 702.33d–f)", () => {
    it("Dismantling Blow: the gate reads the kicker tally", () => {
        const def = compiled(
            spell(
                "Dismantling Blow",
                "{2}{W}",
                "Kicker {2}{U}\nDestroy target artifact or enchantment. If this spell was kicked, draw two cards."
            )
        );
        expect(def.effects).toEqual([
            { op: "destroy", target: { target: 0 } },
            {
                op: "if",
                predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
                then: [{ op: "draw", player: "controller", count: 2 }],
            },
        ]);
        expect(def.targetRequirement).toEqual({
            type: ["Artifact", "Enchantment"],
            count: 1,
        });
    });

    it("per-kicker (CR 702.33f): 'with its {2}{R} kicker' reads THAT kicker's payment", () => {
        const def = compiled(
            spell(
                "Test Burst",
                "{R}",
                "Kicker {2}{R} and/or {3}{U}\nYou gain 1 life. If this spell was kicked with its {2}{R} kicker, you gain 2 life. If this spell was kicked with its {3}{U} kicker, draw a card."
            )
        );
        expect(def.effects).toEqual([
            { op: "gainLife", player: "controller", amount: 1 },
            {
                op: "if",
                predicate: {
                    left: { additionalCostPaid: "kicker-r" },
                    op: "ge",
                    right: 1,
                },
                then: [{ op: "gainLife", player: "controller", amount: 2 }],
            },
            {
                op: "if",
                predicate: {
                    left: { additionalCostPaid: "kicker-u" },
                    op: "ge",
                    right: 1,
                },
                then: [{ op: "draw", player: "controller", count: 1 }],
            },
        ]);
    });

    it("the card's own name reads as the kicked spell (older templating)", () => {
        const def = compiled(
            spell(
                "Test Blow",
                "{W}",
                "Kicker {U}\nYou gain 2 life. If Test Blow was kicked, draw a card."
            )
        );
        expect(def.effects?.[1]).toMatchObject({
            op: "if",
            predicate: { left: { kickerCount: true } },
        });
    });
});

describe("kicker-counted entry riders (CR 614.1c / 702.33d)", () => {
    it("If this creature was kicked, it enters with two +1/+1 counters on it.", () => {
        const def = compiled(
            creature(
                "Shalai's Acolyte",
                "{3}{G}",
                "Kicker {1}{G}\nFlying\nIf this creature was kicked, it enters with two +1/+1 counters on it."
            )
        );
        expect(def.entersWith).toEqual({
            counters: [
                { type: "+1/+1", count: "kicker" },
                { type: "+1/+1", count: "kicker" },
            ],
        });
        expect(def.staticAbilities).toEqual(["flying"]);
    });

    it("{self} was kicked — the card-name templating", () => {
        const def = compiled(
            creature(
                "Grunn",
                "{3}{G}",
                "Kicker {1}{G}\nIf Grunn was kicked, it enters with five +1/+1 counters on it."
            )
        );
        expect(def.entersWith?.counters).toHaveLength(5);
    });

    it("Multikicker: … enters with a +1/+1 counter on it for each time it was kicked.", () => {
        const def = compiled(
            creature(
                "Gnarlid Pack",
                "{1}{G}",
                "Multikicker {1}{G}\nThis creature enters with a +1/+1 counter on it for each time it was kicked."
            )
        );
        expect(def.kickers).toEqual([
            {
                id: "kicker",
                description: "Multikicker {1}{G}",
                mana: { X: 1, G: 1 },
                multi: true,
            },
        ]);
        expect(def.entersWith).toEqual({
            counters: [{ type: "+1/+1", count: "kicker" }],
        });
    });
});

describe("Kicker gold over the hand-written catalogue", () => {
    const KICKER_LINE = /^(?:Multi)?[Kk]icker[ —].*$/m;

    it("every hand-written kicker line compiles to its author's kickers[], or is refused", () => {
        const refused: string[] = [];
        let accepted = 0;
        for (const def of getAllRawCards()) {
            const line = def.oracleText?.match(KICKER_LINE)?.[0];
            if (line === undefined) continue;
            const parsed = keywordLineSlot.run(
                line.replace(/ \(.*\)$/, ""),
                parseContext()
            );
            if (!parsed.ok || parsed.value.kind !== "kicker") {
                refused.push(def.name);
                continue;
            }
            const lowered = lowerKickers(parsed.value.kickers);
            if (!lowered.ok) {
                refused.push(def.name);
                continue;
            }
            accepted++;
            expect(
                sortKeys(canonicaliseShorthands(lowered.value)),
                def.name
            ).toEqual(sortKeys(canonicaliseShorthands(def.kickers)));
        }
        // Arctic Merfolk's "Return a creature you control to its owner's hand"
        // is a cost leg the shared cost grammar does not read (it reads a
        // return of the SOURCE only).
        expect(refused.sort()).toEqual(["Arctic Merfolk"]);
        expect(accepted).toBeGreaterThan(40);
    });
});

describe("Kicker refusals — grammar", () => {
    const ctx = parseContext();

    it.each([
        ["Kicker {X}", "X with no announcement (CR 107.3)"],
        ["Kicker {W/U}", "hybrid pip"],
        ["Kicker {1}{U} and/or {B} and/or {G}", "three costs"],
        ["Kicker {1}{U} and/or Pay 3 life", "a non-mana cost in an and/or"],
        [
            "Kicker—Return a creature you control to its owner's hand.",
            "a return leg the cost grammar does not read",
        ],
        ["Kicker—Discard a card.", "a discard leg with no kicker field"],
        ["Kicker—Sacrifice a land", "dashed form without its stop"],
        ["Multikicker—Sacrifice a land.", "a non-mana multikicker"],
    ])("refuses %s (%s)", (line) => {
        expect(kickerRule.run(line, ctx).ok).toBe(false);
        expect(keywordLineSlot.run(line, ctx).ok).toBe(false);
    });

    it("a bare 'Kicker' is not a kicker line (no cost to pay)", () => {
        // The bare word is the registry name, which the keyword RUN rule
        // reads; the kicker rule never claims a line without a cost.
        expect(kickerRule.run("Kicker", ctx).ok).toBe(false);
    });
});

describe("Kicker refusals — per-kicker entry riders (fail-closed until the engine has a surface)", () => {
    // The engine counts `entersWith` by the kicker TALLY and grants a kicked
    // keyword only through a closure (Duskwalker's `applies`), so none of these
    // has a JSON encoding yet. Each must leave the card unparsed — never
    // compiled to its counters alone.
    it.each([
        [
            "Anavolver",
            'Kicker {1}{U} and/or {B}\nIf this creature was kicked with its {1}{U} kicker, it enters with two +1/+1 counters on it and with flying.\nIf this creature was kicked with its {B} kicker, it enters with a +1/+1 counter on it and with "Pay 3 life: Regenerate this creature."',
            "If this creature was kicked with its {1}{U} kicker, it enters with two +1/+1 counters on it and with flying.",
        ],
        [
            "Kavu Titan",
            "Kicker {2}{G}\nIf this creature was kicked, it enters with three +1/+1 counters on it and with trample.",
            "If this creature was kicked, it enters with three +1/+1 counters on it and with trample.",
        ],
        [
            "Prison Barricade",
            'Defender\nKicker {1}{W}\nIf this creature was kicked, it enters with a +1/+1 counter on it and with "This creature can attack as though it didn\'t have defender."',
            'If this creature was kicked, it enters with a +1/+1 counter on it and with "This creature can attack as though it didn\'t have defender."',
        ],
    ])("%s stays unparsed on its entry rider", (name, text, fragment) => {
        const outcome = compileCard(creature(name, "{3}{G}", text));
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps.map((g) => g.fragment)).toContain(fragment);
    });
});

describe("Kicker refusals — lowering invariants", () => {
    function lowerOn(typeLine: string, lines: readonly string[]) {
        const card = oracleCard({
            typeLine,
            oracleText: lines.join("\n"),
            ...(typeLine.startsWith("Creature")
                ? {}
                : { power: undefined, toughness: undefined }),
        });
        const parsedType = readTypeLine(typeLine);
        if (!parsedType.ok) throw new Error("type line");
        const parses = lines.map((line) => {
            const r = routeLine(line, parseContext(card));
            if (!r.ok) throw new Error(`fixture line unparsed: ${line}`);
            return r.value;
        });
        return lowerCard(card, parsedType.parsed, parses);
    }

    function refusal(typeLine: string, lines: readonly string[]): string {
        const r = lowerOn(typeLine, lines);
        if (r.ok) throw new Error(`accepted: ${lines.join(" / ")}`);
        return r.reason;
    }

    it("refuses a gated target (CR 702.33g)", () => {
        expect(
            refusal("Instant", [
                "Kicker {1}{R}",
                "You gain 1 life. If this spell was kicked, destroy target land.",
            ])
        ).toMatch(/702\.33g/);
    });

    it("refuses a kicked gate on a card with no kicker (CR 702.33e)", () => {
        expect(
            refusal("Instant", [
                "You gain 1 life. If this spell was kicked, draw a card.",
            ])
        ).toMatch(/prints no kicker/);
    });

    it("refuses 'its {A} kicker' naming no kicker the card prints (CR 702.33f)", () => {
        expect(
            refusal("Instant", [
                "Kicker {2}{R} and/or {3}{U}",
                "You gain 1 life. If this spell was kicked with its {9} kicker, draw a card.",
            ])
        ).toMatch(/names 0 of/);
    });

    it("refuses 'its {A} kicker' on a single-kicker card (CR 702.33f)", () => {
        expect(
            refusal("Instant", [
                "Kicker {2}{R}",
                "You gain 1 life. If this spell was kicked with its {2}{R} kicker, draw a card.",
            ])
        ).toMatch(/two or more kicker costs/);
    });

    it.each([
        ["no kicker", [], /prints no kicker/],
        ["Multikicker", ["Multikicker {1}{G}"], /exactly one single kicker/],
        ["an and/or pair", ["Kicker {1}{G} and/or {W}"], /exactly one single/],
    ])(
        "refuses 'if it was kicked, it enters with N counters' with %s (CR 702.33d)",
        (_label, kicker, reason) => {
            expect(
                refusal("Creature — Bear", [
                    ...kicker,
                    "If this creature was kicked, it enters with two +1/+1 counters on it.",
                ])
            ).toMatch(reason);
        }
    );

    it("refuses two kicked entry riders rather than summing them", () => {
        expect(
            refusal("Creature — Bear", [
                "Kicker {2}",
                "If this creature was kicked, it enters with a +1/+1 counter on it.",
                "If this creature was kicked, it enters with a +1/+1 counter on it.",
            ])
        ).toMatch(/kicked entry rider twice/);
    });

    it("'for each time it was kicked' on a two-kicker card counts both (CR 702.33d)", () => {
        const r = lowerOn("Creature — Bear", [
            "Kicker {1}{G} and/or {W}",
            "This creature enters with a +1/+1 counter on it for each time it was kicked.",
        ]);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.definition.kickers?.map((k) => k.id)).toEqual([
            "kicker-g",
            "kicker-w",
        ]);
        expect(r.definition.entersWith).toEqual({
            counters: [{ type: "+1/+1", count: "kicker" }],
        });
    });

    it("'If this spell was kicked' on a Multikicker spell reads 'kicked at least once'", () => {
        const r = lowerOn("Instant", [
            "Multikicker {1}",
            "You gain 1 life. If this spell was kicked, draw a card.",
        ]);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.definition.effects?.[1]).toMatchObject({
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
        });
    });

    it("refuses 'for each time it was kicked' with no kicker to count", () => {
        expect(
            refusal("Creature — Bear", [
                "This creature enters with a +1/+1 counter on it for each time it was kicked.",
            ])
        ).toMatch(/prints no kicker/);
    });

    it("refuses two kicker lines rather than merging them", () => {
        expect(
            refusal("Creature — Bear", ["Kicker {1}{G}", "Kicker {W}"])
        ).toMatch(/kicker on two lines/);
    });

    it("refuses a colourless cost in an and/or pair — it has no id", () => {
        expect(refusal("Creature — Bear", ["Kicker {2} and/or {3}"])).toMatch(
            /colourless cost in a kicker pair/
        );
    });

    it("refuses two costs of one colour set in a pair — their ids collide", () => {
        expect(
            refusal("Creature — Bear", ["Kicker {1}{G} and/or {G}"])
        ).toMatch(/both named "kicker-g"/);
    });

    it("refuses a kicker on an instant with no spell text to ride on", () => {
        expect(refusal("Instant", ["Kicker {1}{G}"])).toMatch(
            /no spell text to ride on/
        );
    });

    it("the kicker's linked lines read it however the lines are ordered", () => {
        // The pre-pass lowers the kicker line before any line that reads it,
        // so a gate printed ABOVE its kicker line still names it.
        const r = lowerOn("Instant", [
            "You gain 1 life. If this spell was kicked, draw a card.",
            "Kicker {U}",
        ]);
        expect(r.ok).toBe(true);
    });
});
