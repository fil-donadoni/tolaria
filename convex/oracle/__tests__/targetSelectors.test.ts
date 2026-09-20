// Target selectors: the three announcement shapes a spell can print beyond
// "target <thing>" (CR 115.1 / 115.3 / 601.2c / 702.33g, issue #4133).
//
// Four layers, each watching a different way an announcement can go wrong:
//
//  1. GOLDEN fixtures — a real corpus card compiled whole must produce exactly
//     this Compiled Definition: the WIDE group ("up to two target creature
//     cards from your graveyard"), the SECOND group ("Another target creature
//     gets -2/-2"), the PLAIN second group (Agony Warp's two "Target
//     creature gets …" lines, issue #3875) and the KICKED swap ("If this
//     spell was kicked, destroy another target land").
//  2. REFUSALS — every neighbour the encoding cannot say: a wide group under a
//     verb that does not fan out, a bare plural count, a number that disagrees
//     with its head, "another" with nothing earlier to exclude, a group after
//     a wide one, a kicked gate naming a different set, and a
//     kicked gate that omitted "another".
//  3. SITE ceilings — a triggered ability has no `additionalTargetRequirements`
//     twin, so a second group is refused there even though both sentences
//     read. (Its `kickedTargetRequirement` refusal is unreachable today and
//     kept as a second line; the note beside it says why.)

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./fixtures";

function spell(oracleText: string, overrides: { manaCost?: string } = {}) {
    return oracleCard({
        name: "Test Spell",
        manaCost: overrides.manaCost ?? "{1}{B}",
        typeLine: "Instant",
        oracleText,
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

/** The attributed SPAN of each gap a card that must NOT compile carries. */
function refusedSpan(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "unparsed")
        throw new Error(`${card.name} compiled: ${outcome.state}`);
    return outcome.gaps.map((g) => g.attribution?.span);
}

/** The single refusal reason a card that must NOT compile carries. */
function refusalReason(card: ReturnType<typeof oracleCard>): string {
    const outcome = compileCard(card);
    if (outcome.state !== "unparsed")
        throw new Error(`${card.name} compiled: ${outcome.state}`);
    expect(outcome.gaps).toHaveLength(1);
    return outcome.gaps[0]!.reason;
}

describe("wide announcement — 'up to two target …' (CR 601.2c)", () => {
    it("Urborg Uprising: one group, two slots, the verb fanned over both", () => {
        const def = compiled(
            oracleCard({
                name: "Urborg Uprising",
                manaCost: "{4}{B}",
                typeLine: "Sorcery",
                oracleText:
                    "Return up to two target creature cards from your graveyard to your hand.\nDraw a card.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(def.targetRequirement).toEqual({
            type: "Creature",
            count: { min: 0, max: 2 },
            zone: "graveyard",
            controller: "you",
        });
        // CR 608.2b — an unchosen slot resolves to nothing and its op is
        // skipped, so the same pair is right for zero, one and two picks.
        expect(def.effects).toEqual([
            { op: "moveZone", target: { target: 0 }, to: "hand" },
            { op: "moveZone", target: { target: 1 }, to: "hand" },
            { op: "draw", player: "controller", count: 1 },
        ]);
        expect(def.additionalTargetRequirements).toBeUndefined();
    });

    it("keeps 'up to one target' at ONE slot", () => {
        const def = compiled(
            spell(
                "Return up to one target creature card from your graveyard to your hand."
            )
        );
        expect(def.targetRequirement).toEqual({
            type: "Creature",
            count: { min: 0, max: 1 },
            zone: "graveyard",
            controller: "you",
        });
        expect(def.effects).toEqual([
            { op: "moveZone", target: { target: 0 }, to: "hand" },
        ]);
    });

    it("refuses a wide group under a verb that does not fan out", () => {
        // "Tap up to two target creatures" (27 corpus cards) and "Destroy up
        // to two target creatures" (2) are real printed forms whose verbs have
        // no fan-out here. Acting on the first slot only would be a card that
        // reads as printed and does half of what it says, so they stay refused
        // under their own gap keys.
        expect(refusalReason(spell("Tap up to two target creatures."))).toMatch(
            /this verb acts on one object/
        );
    });

    it("refuses a bare plural count — the head is what makes it optional", () => {
        // CR 601.2c — "two target creatures" is a FIXED count: an appropriate
        // object is announced for EACH target the spell requires, which is a
        // different announcement, not a wider spelling of "up to two".
        expect(refusedSpan(spell("Tap two target creatures."))).toEqual([
            "two target creatures",
        ]);
    });

    it("refuses a number that disagrees with its head", () => {
        // The count is printed twice ("up to TWO … CARDS"); reading one and
        // defaulting the other is how a one-target spell announces two. The
        // SPAN is pinned, not just the refusal: a card refused for some other
        // reason would pass a bare "unparsed" assertion while the agreement
        // guard did nothing.
        expect(
            refusedSpan(
                spell(
                    "Return up to two target creature card from your graveyard to your hand."
                )
            )
        ).toEqual(["plural"]);
        expect(
            refusedSpan(
                spell(
                    "Return up to one target creature cards from your graveyard to your hand."
                )
            )
        ).toEqual(["plural"]);
    });

    it("refuses a group AFTER a wide one — the later slot index would shift", () => {
        // The flat announcement has no gaps, so a one-card pick leaves the
        // creature at slot 1: the pump aimed at slot 2 would do nothing and
        // the second `moveZone` would bounce the creature instead.
        expect(
            refusalReason(
                spell(
                    "Return up to two target creature cards from your graveyard to your hand. Another target creature gets -1/-1 until end of turn."
                )
            )
        ).toMatch(/after a variable-width announcement/);
    });
});

describe("second group — 'Another target …' (CR 115.3)", () => {
    it("Consume Strength: two groups, the later one excluding the earlier", () => {
        const def = compiled(
            oracleCard({
                name: "Consume Strength",
                manaCost: "{1}{B}{G}",
                typeLine: "Instant",
                oracleText:
                    "Target creature gets +2/+2 until end of turn. Another target creature gets -2/-2 until end of turn.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(def.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
        });
        expect(def.additionalTargetRequirements).toEqual([
            { type: "Creature", count: 1, excludePriorTargets: true },
        ]);
        expect(def.effects).toEqual([
            {
                op: "pump",
                target: { target: 0 },
                power: 2,
                toughness: 2,
                duration: { phase: "end-of-turn" },
            },
            {
                op: "pump",
                target: { target: 1 },
                power: -2,
                toughness: -2,
                duration: { phase: "end-of-turn" },
            },
        ]);
    });

    it("refuses 'another target' with no earlier announcement", () => {
        // The other reading of the word is "another than the SOURCE"
        // (`excludeSource`, a permanent's own ability). This walk cannot tell
        // the two apart, so it refuses rather than guessing one.
        expect(
            refusalReason(
                spell("Another target creature gets -2/-2 until end of turn.")
            )
        ).toMatch(/names no earlier target/);
    });

    it("refuses 'another' on a group no prior pick can exclude", () => {
        // `excludePriorTargets` is applied by merging the earlier picks into
        // `excludeInstanceIds`, and that merge keeps only `type: "permanent"`
        // picks (`game.ts` — `excludingPriorTargets`). On a graveyard-card
        // group the word would compile and never be honoured: the player
        // could return the SAME card twice.
        expect(
            refusalReason(
                spell(
                    "Return target creature card from your graveyard to your hand. Return another target creature card from your graveyard to your hand."
                )
            )
        ).toMatch(/honoured only against battlefield permanents/);
    });

    it("a THIRD group printing 'another' excludes, the plain second one before it does not", () => {
        // A plain second group and a printed "another" are two different
        // announcements; the word is the only thing that carries the
        // exclusion, so a third group printing it excludes ITS earlier picks
        // and a plain one does not.
        const def = compiled(
            spell(
                "Target creature gets +1/+1 until end of turn. Target creature gets +2/+2 until end of turn. Another target creature gets -3/-3 until end of turn."
            )
        );
        expect(def.targetRequirement).toEqual({ type: "Creature", count: 1 });
        expect(def.additionalTargetRequirements).toEqual([
            { type: "Creature", count: 1 },
            { type: "Creature", count: 1, excludePriorTargets: true },
        ]);
    });
});

describe("plain second group — 'Target …' twice (CR 115.3, CR 601.2c, issue #3875)", () => {
    const pumpTwice = (name: string, cost: string, text: string) =>
        oracleCard({
            name,
            manaCost: cost,
            typeLine: "Instant",
            oracleText: text,
            power: undefined,
            toughness: undefined,
        });

    it("Agony Warp: two lines, two groups, neither excluding the other", () => {
        // CR 115.3 — a second plain instance of the word "target" may name the
        // SAME creature as the first (Agony Warp's -3/-0 and -0/-3 on one
        // attacker is the printed use), so the group carries NO
        // `excludePriorTargets`. Widening the first group to count 2 would say
        // "two DIFFERENT creatures" and forbid it (CR 601.2c).
        const def = compiled(
            pumpTwice(
                "Agony Warp",
                "{U}{B}",
                "Target creature gets -3/-0 until end of turn.\nTarget creature gets -0/-3 until end of turn."
            )
        );
        expect(def.targetRequirement).toEqual({ type: "Creature", count: 1 });
        expect(def.additionalTargetRequirements).toEqual([
            { type: "Creature", count: 1 },
        ]);
        expect(def.effects).toEqual([
            {
                op: "pump",
                target: { target: 0 },
                power: -3,
                toughness: 0,
                duration: { phase: "end-of-turn" },
            },
            {
                op: "pump",
                target: { target: 1 },
                power: 0,
                toughness: -3,
                duration: { phase: "end-of-turn" },
            },
        ]);
    });

    it("Bounty of Might: three lines, three groups at slots 0, 1, 2", () => {
        const def = compiled(
            pumpTwice(
                "Bounty of Might",
                "{4}{G}{G}",
                Array(3)
                    .fill("Target creature gets +3/+3 until end of turn.")
                    .join("\n")
            )
        );
        expect(def.targetRequirement).toEqual({ type: "Creature", count: 1 });
        expect(def.additionalTargetRequirements).toEqual([
            { type: "Creature", count: 1 },
            { type: "Creature", count: 1 },
        ]);
        expect(
            def.effects!.map((e) => (e as { target: unknown }).target)
        ).toEqual([{ target: 0 }, { target: 1 }, { target: 2 }]);
    });

    it("Common Bond: the counter verb takes the same second group", () => {
        const def = compiled(
            pumpTwice(
                "Common Bond",
                "{1}{G}{W}",
                "Put a +1/+1 counter on target creature.\nPut a +1/+1 counter on target creature."
            )
        );
        expect(def.additionalTargetRequirements).toEqual([
            { type: "Creature", count: 1 },
        ]);
        expect(
            def.effects!.map((e) => (e as { target: unknown }).target)
        ).toEqual([{ target: 0 }, { target: 1 }]);
    });

    it("a second group over a DIFFERENT descriptor keeps its own requirement", () => {
        const def = compiled(
            spell("Destroy target artifact. Destroy target creature.")
        );
        expect(def.targetRequirement).toEqual({ type: "Artifact", count: 1 });
        expect(def.additionalTargetRequirements).toEqual([
            { type: "Creature", count: 1 },
        ]);
    });

    it("still refuses a plain group AFTER a wide one — the later slot would shift", () => {
        expect(
            refusalReason(
                spell(
                    "Return up to two target creature cards from your graveyard to your hand. Target creature gets -1/-1 until end of turn."
                )
            )
        ).toMatch(/after a variable-width announcement/);
    });
});

describe("kicked swap — 'If this spell was kicked, … another target' (CR 702.33g)", () => {
    const landslide = () =>
        oracleCard({
            name: "Dwarven Landslide",
            manaCost: "{3}{R}",
            typeLine: "Sorcery",
            oracleText:
                "Kicker—{2}{R}, Sacrifice a land. (You may pay {2}{R} and sacrifice a land in addition to any other costs as you cast this spell.)\nDestroy target land. If this spell was kicked, destroy another target land.",
            power: undefined,
            toughness: undefined,
        });

    it("Dwarven Landslide: the count widens, the gated op reads slot 1", () => {
        const def = compiled(landslide());
        expect(def.targetRequirement).toEqual({ type: "Land", count: 1 });
        expect(def.kickedTargetRequirement).toEqual({
            type: "Land",
            count: 2,
        });
        expect(def.effects).toEqual([
            { op: "destroy", target: { target: 0 } },
            {
                op: "if",
                predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
                then: [{ op: "destroy", target: { target: 1 } }],
            },
        ]);
        // The swap is not a second GROUP: there is one announcement, and the
        // kicked cast makes it wider.
        expect(def.additionalTargetRequirements).toBeUndefined();
    });

    it("refuses a group allocated after the swap — the width is no longer fixed", () => {
        // The swap makes the announcement 1 slot unkicked and 2 kicked, so a
        // third group's index cannot be written down: unkicked it would sit
        // at slot 1, which the gated op already claims.
        const card = landslide();
        expect(
            refusalReason(
                oracleCard({
                    ...card,
                    oracleText: `${card.oracleText} Another target creature gets -2/-2 until end of turn.`,
                })
            )
        ).toMatch(/after a variable-width announcement/);
    });

    it("a gate naming a DIFFERENT set becomes its own gated group (CR 702.33g)", () => {
        // Issue #4220 — there is no count to widen here: widening to 2 would
        // offer two lands, which is a different spell. The gate gets its own
        // group instead, with its own descriptor and its own count, announced
        // only on a kicked cast.
        const card = landslide();
        const def = compiled(
            oracleCard({
                ...card,
                oracleText: card.oracleText.replace(
                    "destroy another target land.",
                    "destroy another target creature."
                ),
            })
        );
        expect(def.targetRequirement).toEqual({ type: "Land", count: 1 });
        expect(def.additionalTargetRequirements).toEqual([
            {
                type: "Creature",
                count: 1,
                excludePriorTargets: true,
                announcedOnlyIfKicked: true,
            },
        ]);
        // The swap encoding is NOT also emitted — the two are alternatives.
        expect(def.kickedTargetRequirement).toBeUndefined();
        expect(def.effects).toEqual([
            { op: "destroy", target: { target: 0 } },
            {
                op: "if",
                predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
                then: [{ op: "destroy", target: { target: 1 } }],
            },
        ]);
    });

    it("a gate that omitted 'another' is still a gated group (CR 115.3)", () => {
        // CR 115.3 — two instances of the word "target" may name ONE object,
        // which is exactly what the widened count cannot say (CR 601.2c
        // forbids naming one object twice for a SINGLE instance). Before issue
        // #4220 that left the form unencodable; the gated group says it
        // precisely, carrying no `excludePriorTargets`.
        const card = landslide();
        const def = compiled(
            oracleCard({
                ...card,
                oracleText: card.oracleText.replace(
                    "destroy another target land.",
                    "destroy target land."
                ),
            })
        );
        expect(def.targetRequirement).toEqual({ type: "Land", count: 1 });
        expect(def.additionalTargetRequirements).toEqual([
            { type: "Land", count: 1, announcedOnlyIfKicked: true },
        ]);
        expect(def.kickedTargetRequirement).toBeUndefined();
    });

    it("a gate announcing the ONLY target declares no base group (CR 601.2c)", () => {
        // Probe — "Draw three cards, then discard two cards. If this spell was
        // kicked, target player discards two cards." CR 601.2c: "A spell may
        // require some targets only if an alternative or additional cost (such
        // as a kicker cost) ... was chosen for it". `targetRequirement` is the
        // group EVERY cast announces, so the gated group goes on the
        // additional list and the card declares no primary at all.
        const def = compiled(
            oracleCard({
                name: "Probe",
                manaCost: "{2}{U}",
                typeLine: "Sorcery",
                oracleText:
                    "Kicker {3}{B} (You may pay an additional {3}{B} as you cast this spell.)\nDraw three cards, then discard two cards. If this spell was kicked, target player discards two cards.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(def.targetRequirement).toBeUndefined();
        expect(def.additionalTargetRequirements).toEqual([
            { type: "player", count: 1, announcedOnlyIfKicked: true },
        ]);
        expect(def.kickedTargetRequirement).toBeUndefined();
    });
});

describe("site ceilings — an ability declares neither shape (CR 603.3d)", () => {
    it("a triggered ability refuses a second group", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Test Creature",
                manaCost: "{2}{G}",
                typeLine: "Creature — Bear",
                oracleText:
                    "When this creature enters, target creature gets +1/+1 until end of turn. Another target creature gets -1/-1 until end of turn.",
            })
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps[0]!.reason).toMatch(
            /this site declares at most one/
        );
    });

    // The ability sites' `kickedRequirement()` refusal is UNREACHABLE today
    // and deliberately kept (the `spellSelector` precedent): the grammar
    // refuses "If this spell was kicked" at an activated site before lowering
    // sees it, and at a triggered site the head consumes the line first. It is
    // the second line, on the side that stays right if the grammar ever reads
    // one — an ability has no `kickedTargetRequirement` to declare.
});
