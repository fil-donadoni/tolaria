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
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
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

    it("the Dismantling Blow golden fixture takes a kicked spell to ready", () => {
        // The smoke scenario casts unkicked, so the kicker-count gate is a
        // card-dependent skip; the registered fixture is what clears it.
        const fixture = GOLDEN_FIXTURES.find(
            (f) => f.card.name === "Dismantling Blow"
        );
        expect(fixture?.rule).toBe("kicker");
        expect(compileCard(fixture!.card).state).toBe("ready");
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

describe("kicked entry riders that also grant an ability (CR 614.1c / 702.33e–f, issue #3864)", () => {
    // Golden: the WHOLE compiled definition, so every field the "and with …"
    // tail and the "with its {A} kicker" qualifier produce is pinned.
    it("single kicker, counters + keyword (Kavu Titan)", () => {
        const text =
            "Kicker {2}{G}\nIf this creature was kicked, it enters with three +1/+1 counters on it and with trample.";
        expect(compiled(creature("Kavu Titan", "{1}{G}", text))).toEqual({
            name: "Kavu Titan",
            types: ["Creature"],
            manaCost: { X: 1, G: 1 },
            power: 2,
            toughness: 2,
            oracleText: text,
            kickers: [
                {
                    id: "kicker",
                    description: "Kicker {2}{G}",
                    mana: { X: 2, G: 1 },
                },
            ],
            entersWith: {
                counters: [
                    { type: "+1/+1", count: "kicker" },
                    { type: "+1/+1", count: "kicker" },
                    { type: "+1/+1", count: "kicker" },
                ],
            },
            compiledStaticEffects: [
                {
                    kind: "keyword-grant",
                    keyword: "trample",
                    appliesTo: "self-if-kicked",
                },
            ],
        });
    });

    it("per-kicker id, counters + keyword on both riders (Cetavolver)", () => {
        const text =
            "Kicker {1}{R} and/or {G}\nIf this creature was kicked with its {1}{R} kicker, it enters with two +1/+1 counters on it and with first strike.\nIf this creature was kicked with its {G} kicker, it enters with a +1/+1 counter on it and with trample.";
        expect(compiled(creature("Cetavolver", "{1}{U}", text))).toEqual({
            name: "Cetavolver",
            types: ["Creature"],
            manaCost: { X: 1, U: 1 },
            power: 2,
            toughness: 2,
            oracleText: text,
            kickers: [
                {
                    id: "kicker-r",
                    description: "Kicker {1}{R}",
                    mana: { X: 1, R: 1 },
                },
                { id: "kicker-g", description: "Kicker {G}", mana: { G: 1 } },
            ],
            entersWith: {
                counters: [
                    {
                        type: "+1/+1",
                        count: { additionalCostPaid: "kicker-r" },
                    },
                    {
                        type: "+1/+1",
                        count: { additionalCostPaid: "kicker-r" },
                    },
                    {
                        type: "+1/+1",
                        count: { additionalCostPaid: "kicker-g" },
                    },
                ],
            },
            compiledStaticEffects: [
                {
                    kind: "keyword-grant",
                    keyword: "first strike",
                    appliesTo: "self-if-kicked",
                    kickerId: "kicker-r",
                },
                {
                    kind: "keyword-grant",
                    keyword: "trample",
                    appliesTo: "self-if-kicked",
                    kickerId: "kicker-g",
                },
            ],
        });
    });

    it("per-kicker id, counters + quoted ability (Anavolver)", () => {
        const text =
            'Kicker {1}{U} and/or {B}\nIf this creature was kicked with its {1}{U} kicker, it enters with two +1/+1 counters on it and with flying.\nIf this creature was kicked with its {B} kicker, it enters with a +1/+1 counter on it and with "Pay 3 life: Regenerate this creature."';
        expect(compiled(creature("Anavolver", "{3}{G}", text))).toEqual({
            name: "Anavolver",
            types: ["Creature"],
            manaCost: { X: 3, G: 1 },
            power: 2,
            toughness: 2,
            oracleText: text,
            kickers: [
                {
                    id: "kicker-u",
                    description: "Kicker {1}{U}",
                    mana: { X: 1, U: 1 },
                },
                { id: "kicker-b", description: "Kicker {B}", mana: { B: 1 } },
            ],
            entersWith: {
                counters: [
                    {
                        type: "+1/+1",
                        count: { additionalCostPaid: "kicker-u" },
                    },
                    {
                        type: "+1/+1",
                        count: { additionalCostPaid: "kicker-u" },
                    },
                    {
                        type: "+1/+1",
                        count: { additionalCostPaid: "kicker-b" },
                    },
                ],
            },
            compiledStaticEffects: [
                {
                    kind: "keyword-grant",
                    keyword: "flying",
                    appliesTo: "self-if-kicked",
                    kickerId: "kicker-u",
                },
                {
                    kind: "activated-grant",
                    abilityId: "anavolver-kicked",
                    appliesTo: "self-if-kicked",
                    kickerId: "kicker-b",
                },
            ],
            grantTemplates: [
                {
                    id: "anavolver-kicked",
                    oracleText: "Pay 3 life: Regenerate this creature.",
                    cost: { life: 3 },
                    useStack: true,
                    effects: [{ op: "regenerate", target: { ref: "$source" } }],
                },
            ],
        });
    });

    // CR 614.1c / 113.1a — the TRIGGERED twin of the activated-grant case
    // above (issue #4139): the "and with …" tail's quoted ability is read by
    // the SAME `readQuotedAbilityIn` dispatch, now including the triggered
    // slot, and lowers to a `compiledTriggeredGrantTemplates[]` descriptor
    // rather than `grantTemplates[]` — `matches` is a required closure and the
    // compiler emits JSON only (see `CardDefinition.compiledTriggeredGrantTemplates`).
    const GAIN_THAT_MUCH = [
        {
            op: "gainLife",
            player: "controller",
            amount: { ref: "$event.amount" },
        },
    ];

    it("per-kicker id, counters + quoted TRIGGERED ability on the second rider (Necravolver)", () => {
        const text =
            'Kicker {1}{G} and/or {W}\nIf this creature was kicked with its {1}{G} kicker, it enters with two +1/+1 counters on it and with trample.\nIf this creature was kicked with its {W} kicker, it enters with a +1/+1 counter on it and with "Whenever this creature deals damage, you gain that much life."';
        expect(compiled(creature("Necravolver", "{2}{B}", text))).toEqual({
            name: "Necravolver",
            types: ["Creature"],
            manaCost: { X: 2, B: 1 },
            power: 2,
            toughness: 2,
            oracleText: text,
            kickers: [
                {
                    id: "kicker-g",
                    description: "Kicker {1}{G}",
                    mana: { X: 1, G: 1 },
                },
                { id: "kicker-w", description: "Kicker {W}", mana: { W: 1 } },
            ],
            entersWith: {
                counters: [
                    {
                        type: "+1/+1",
                        count: { additionalCostPaid: "kicker-g" },
                    },
                    {
                        type: "+1/+1",
                        count: { additionalCostPaid: "kicker-g" },
                    },
                    {
                        type: "+1/+1",
                        count: { additionalCostPaid: "kicker-w" },
                    },
                ],
            },
            compiledStaticEffects: [
                {
                    kind: "keyword-grant",
                    keyword: "trample",
                    appliesTo: "self-if-kicked",
                    kickerId: "kicker-g",
                },
                {
                    kind: "triggered-grant",
                    abilityId: "necravolver-kicked",
                    appliesTo: "self-if-kicked",
                    kickerId: "kicker-w",
                },
            ],
            compiledTriggeredGrantTemplates: [
                {
                    id: "necravolver-kicked",
                    oracleText:
                        "Whenever this creature deals damage, you gain that much life.",
                    head: {
                        kind: "damage-dealt",
                        source: "self",
                        recipient: "any",
                    },
                    effects: GAIN_THAT_MUCH,
                },
            ],
        });
    });

    it("per-kicker id, quoted TRIGGERED ability on the first rider + keyword on the second (Rakavolver)", () => {
        const text =
            'Kicker {1}{W} and/or {U}\nIf this creature was kicked with its {1}{W} kicker, it enters with two +1/+1 counters on it and with "Whenever this creature deals damage, you gain that much life."\nIf this creature was kicked with its {U} kicker, it enters with a +1/+1 counter on it and with flying.';
        expect(compiled(creature("Rakavolver", "{2}{R}", text))).toEqual({
            name: "Rakavolver",
            types: ["Creature"],
            manaCost: { X: 2, R: 1 },
            power: 2,
            toughness: 2,
            oracleText: text,
            kickers: [
                {
                    id: "kicker-w",
                    description: "Kicker {1}{W}",
                    mana: { X: 1, W: 1 },
                },
                { id: "kicker-u", description: "Kicker {U}", mana: { U: 1 } },
            ],
            entersWith: {
                counters: [
                    {
                        type: "+1/+1",
                        count: { additionalCostPaid: "kicker-w" },
                    },
                    {
                        type: "+1/+1",
                        count: { additionalCostPaid: "kicker-w" },
                    },
                    {
                        type: "+1/+1",
                        count: { additionalCostPaid: "kicker-u" },
                    },
                ],
            },
            compiledStaticEffects: [
                {
                    kind: "triggered-grant",
                    abilityId: "rakavolver-kicked",
                    appliesTo: "self-if-kicked",
                    kickerId: "kicker-w",
                },
                {
                    kind: "keyword-grant",
                    keyword: "flying",
                    appliesTo: "self-if-kicked",
                    kickerId: "kicker-u",
                },
            ],
            compiledTriggeredGrantTemplates: [
                {
                    id: "rakavolver-kicked",
                    oracleText:
                        "Whenever this creature deals damage, you gain that much life.",
                    head: {
                        kind: "damage-dealt",
                        source: "self",
                        recipient: "any",
                    },
                    effects: GAIN_THAT_MUCH,
                },
            ],
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

describe("Kicker refusals — kicked entry riders the engine still has no surface for", () => {
    // The "and with …" tail grants a keyword list or ONE activated/mana/
    // triggered ability (issue #3864, widened to triggered by issue #4139). A
    // quoted STATIC ability has no self-grant reader, so it must leave the
    // card unparsed — never compiled to its counters alone.
    it.each([
        [
            "Prison Barricade",
            'Defender\nKicker {1}{W}\nIf this creature was kicked, it enters with a +1/+1 counter on it and with "This creature can attack as though it didn\'t have defender."',
            'If this creature was kicked, it enters with a +1/+1 counter on it and with "This creature can attack as though it didn\'t have defender."',
        ],
        [
            "a tail that is not a keyword list",
            "Kicker {2}{G}\nIf this creature was kicked, it enters with three +1/+1 counters on it and with trample until end of turn.",
            "If this creature was kicked, it enters with three +1/+1 counters on it and with trample until end of turn.",
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

    it("a gated target becomes a gated GROUP (CR 702.33g, issue #4220)", () => {
        // CR 601.2c — "A spell may require some targets only if an
        // alternative or additional cost (such as a kicker cost) ... was
        // chosen for it; otherwise, the spell is cast as though it did not
        // require those targets." The base half announces nothing, so the
        // gated group is the card's ONLY group and there is no primary
        // requirement to put it in.
        const r = lowerOn("Instant", [
            "Kicker {1}{R}",
            "You gain 1 life. If this spell was kicked, destroy target land.",
        ]);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.definition.targetRequirement).toBeUndefined();
        expect(r.definition.additionalTargetRequirements).toEqual([
            { type: "Land", count: 1, announcedOnlyIfKicked: true },
        ]);
    });

    it("refuses a SECOND kicker gate announcing a target (CR 601.2c)", () => {
        // Issue #4220 — the first gate makes the announcement's width depend
        // on the kicker decision (1 unkicked, 2 kicked), so the second gate's
        // group has no positional slot that can be written down: unkicked it
        // would sit at the index the first gate's op already claims.
        expect(
            refusal("Instant", [
                "Kicker {1}{R}",
                "If this spell was kicked, destroy target land. If this spell was kicked, destroy target creature.",
            ])
        ).toMatch(/after a variable-width announcement/);
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

    it("refuses two riders naming the SAME kicker (CR 702.33f)", () => {
        expect(
            refusal("Creature — Bear", [
                "Kicker {1}{G} and/or {W}",
                "If this creature was kicked with its {W} kicker, it enters with a +1/+1 counter on it.",
                "If this creature was kicked with its {W} kicker, it enters with a +1/+1 counter on it and with flying.",
            ])
        ).toMatch(/kicked entry rider twice/);
    });

    it("refuses a named rider beside a tally rider — their counts would sum", () => {
        expect(
            refusal("Creature — Bear", [
                "Kicker {1}{G} and/or {W}",
                "If this creature was kicked with its {W} kicker, it enters with a +1/+1 counter on it.",
                "This creature enters with a +1/+1 counter on it for each time it was kicked.",
            ])
        ).toMatch(/kicked entry rider twice/);
    });

    it("refuses an entry rider naming a kicker the card does not print (CR 702.33f)", () => {
        expect(
            refusal("Creature — Bear", [
                "Kicker {1}{G} and/or {W}",
                "If this creature was kicked with its {U} kicker, it enters with a +1/+1 counter on it and with flying.",
            ])
        ).toMatch(/702\.33f/);
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
