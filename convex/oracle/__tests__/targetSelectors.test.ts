// Target selectors: the three announcement shapes a spell can print beyond
// "target <thing>" (CR 115.1 / 115.3 / 601.2c / 702.33g, issue #4133).
//
// Four layers, each watching a different way an announcement can go wrong:
//
//  1. GOLDEN fixtures — a real corpus card compiled whole must produce exactly
//     this Compiled Definition: the WIDE group ("up to two target creature
//     cards from your graveyard"), the SECOND group ("Another target creature
//     gets -2/-2"), and the KICKED swap ("If this spell was kicked, destroy
//     another target land").
//  2. REFUSALS — every neighbour the encoding cannot say: a wide group under a
//     verb that does not fan out, a bare plural count, a number that disagrees
//     with its head, "another" with nothing earlier to exclude, a second group
//     that never printed the word, a kicked gate naming a different set, and a
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

    it("refuses a second group that did not print the word", () => {
        // CR 115.3 lets two plain instances of "target" name the SAME object,
        // which `excludePriorTargets` would forbid — a narrower spell than the
        // card. That form belongs to issue #3875, with its own evidence.
        expect(
            refusalReason(
                spell("Destroy target artifact. Destroy target creature.")
            )
        ).toMatch(/a second target group that is not "another target"/);
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

    it("refuses a gate naming a different set — there is no count to widen", () => {
        const card = landslide();
        expect(
            refusalReason(
                oracleCard({
                    ...card,
                    oracleText: card.oracleText.replace(
                        "destroy another target land.",
                        "destroy another target creature."
                    ),
                })
            )
        ).toMatch(/not another of the same/);
    });

    it("refuses a gate that omitted 'another' — the picks may coincide", () => {
        // CR 601.2c — a count of 2 on ONE requirement forbids naming the same
        // land twice, which is what "another" says. Without the word the two
        // instances of "target" may name one object, and the widened count
        // would silently forbid it.
        const card = landslide();
        expect(
            refusalReason(
                oracleCard({
                    ...card,
                    oracleText: card.oracleText.replace(
                        "destroy another target land.",
                        "destroy target land."
                    ),
                })
            )
        ).toMatch(/a second target group that is not "another target"/);
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
