// "Its power" / "its toughness" / "its mana value" as a LIFE GAIN — a
// characteristic of the object an earlier sentence acted on, read as a value
// (issue #4248, generalising issue #4221's mana-value LOSS; CR 119.3 /
// 202.3 / 208.1 / 608.2h).
//
// The engine already expressed the whole thing: `destroy` and an announced
// `moveZone` carry an optional binding that snapshots the object before it
// leaves the battlefield, and a bound object's power, toughness and mana
// value are readable in any numeric position. What was missing was the
// READING — the characteristic was hard-wired to "mana value" and the action
// to "lose".
//
//  1. GOLDENS — the real corpus cards that print each form, compiled whole
//     and compared with `sortKeys` equality, plus the `ready` state their
//     golden fixtures buy (the canned smoke scenario cannot plan an amount
//     only a runtime binding knows).
//  2. REFUSALS — the neighbours this rule must NOT read: the phrase with no
//     antecedent, an antecedent that has no power to snapshot, a noun whose
//     antecedent is a different object, and the damage site's own family.
//  3. BEHAVIOUR — the compiled scripts run through the real interpreter. The
//     stat is read from the snapshot taken when `destroy` ran, so a creature
//     an anthem was pumping is worth the PUMPED value: the one assertion that
//     tells a snapshot read from the printed value or a live read.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards/catalogue";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { getPlayer, resolveTopOfStack } from "../../gre/state";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { oracleCard } from "./fixtures";

/** Chastise's corpus row, verbatim (`data/oracle-corpus.json.gz`). */
const CHASTISE: OracleCard = {
    oracleId: "b7553f3f-5de1-409c-a184-e12e40f017ab",
    name: "Chastise",
    manaCost: "{3}{W}",
    typeLine: "Instant",
    oracleText:
        "Destroy target attacking creature. You gain life equal to its power.",
    layout: "normal",
};

/** Sever Soul's corpus row, verbatim. */
const SEVER_SOUL: OracleCard = {
    oracleId: "577d027a-96c3-46fe-880b-f8b5dd3f3a3d",
    name: "Sever Soul",
    manaCost: "{3}{B}{B}",
    typeLine: "Sorcery",
    oracleText:
        "Destroy target nonblack creature. It can't be regenerated. You gain life equal to its toughness.",
    layout: "normal",
};

/** Terashi's Grasp's corpus row, verbatim. */
const TERASHIS_GRASP: OracleCard = {
    oracleId: "d4738552-3a5e-43c5-a975-8b77618bacaf",
    name: "Terashi's Grasp",
    manaCost: "{2}{W}",
    typeLine: "Sorcery — Arcane",
    oracleText:
        "Destroy target artifact or enchantment. You gain life equal to its mana value.",
    layout: "normal",
};

/** Razor Hippogriff's corpus row, verbatim: the announced-target `moveZone`. */
const RAZOR_HIPPOGRIFF: OracleCard = {
    oracleId: "d121108e-f0bc-469b-bf94-e5e5308014a2",
    name: "Razor Hippogriff",
    manaCost: "{3}{W}{W}",
    typeLine: "Creature — Hippogriff",
    oracleText:
        "Flying\nWhen this creature enters, return target artifact card from your graveyard to your hand. You gain life equal to that card's mana value.",
    power: "3",
    toughness: "3",
    layout: "normal",
};

/** Bottle Golems' corpus row, verbatim: "its" is the DYING SOURCE, not an
 *  object a sentence acted on. */
const BOTTLE_GOLEMS: OracleCard = {
    oracleId: "46334ae3-e496-4f15-8033-0f42ee0ae375",
    name: "Bottle Golems",
    manaCost: "{4}",
    typeLine: "Artifact Creature — Golem",
    oracleText:
        "Trample\nWhen this creature dies, you gain life equal to its power.",
    power: "3",
    toughness: "3",
    layout: "normal",
};

function sorcery(
    oracleText: string,
    name = "Characteristic Probe"
): OracleCard {
    return oracleCard({
        name,
        manaCost: "{2}{B}",
        typeLine: "Sorcery",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

/** Compile a card and return its definition, failing the test if refused. */
function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

/** The refusal reason, or null when the card compiled. */
function refusal(card: OracleCard): string | null {
    const outcome = compileCard(card);
    return outcome.state === "unparsed"
        ? (outcome.gaps[0]?.reason ?? "")
        : null;
}

describe("acted-on characteristic — goldens (CR 208.1 / 202.3, issue #4248)", () => {
    it("Chastise: the life gain reads the destroyed creature's snapshot power", () => {
        expect(sortKeys(compiled(CHASTISE).effects)).toEqual(
            sortKeys([
                { op: "destroy", target: { target: 0 }, bind: "$that1" },
                {
                    op: "gainLife",
                    player: "controller",
                    amount: { ref: "$that1.power" },
                },
            ])
        );
    });

    it("Sever Soul: the same form reads the snapshot toughness", () => {
        expect(sortKeys(compiled(SEVER_SOUL).effects)).toEqual(
            sortKeys([
                {
                    op: "destroy",
                    target: { target: 0 },
                    cantBeRegenerated: true,
                    bind: "$that1",
                },
                {
                    op: "gainLife",
                    player: "controller",
                    amount: { ref: "$that1.toughness" },
                },
            ])
        );
    });

    it("Terashi's Grasp: the GAIN side reads a mana value too (the loss side shipped in issue #4221)", () => {
        expect(sortKeys(compiled(TERASHIS_GRASP).effects)).toEqual(
            sortKeys([
                { op: "destroy", target: { target: 0 }, bind: "$that1" },
                {
                    op: "gainLife",
                    player: "controller",
                    amount: { ref: "$that1.manaValue" },
                },
            ])
        );
    });

    it("Razor Hippogriff: a graveyard card's mana value survives the zone change", () => {
        const definition = compiled(RAZOR_HIPPOGRIFF);
        expect(
            sortKeys(definition.compiledTriggeredAbilities?.[0]?.effects)
        ).toEqual(
            sortKeys([
                {
                    op: "moveZone",
                    target: { target: 0 },
                    to: "hand",
                    bind: "$that1",
                },
                {
                    op: "gainLife",
                    player: "controller",
                    amount: { ref: "$that1.manaValue" },
                },
            ])
        );
    });

    it("all four reach `ready` — the golden fixtures clear the runtime-amount smoke skip", () => {
        expect(
            [CHASTISE, SEVER_SOUL, TERASHIS_GRASP, RAZOR_HIPPOGRIFF].map(
                (card) => compileCard(card).state
            )
        ).toEqual(["ready", "ready", "ready", "ready"]);
    });

    it("no new Op: the whole rule lowers to Ops the catalogue already runs", () => {
        const outcome = compileCard(CHASTISE);
        if (outcome.state === "unparsed") throw new Error("unparsed");
        expect([...outcome.opsUsed].sort()).toEqual(["destroy", "gainLife"]);
    });
});

describe("acted-on characteristic — accepted neighbours (issue #4248)", () => {
    // No corpus card prints these two, so neither owes a golden fixture; they
    // are the same bind + bound-stat read with another action or another
    // acting Op, and are pinned here so their behaviour is a decision rather
    // than an accident.
    it("a LOSS reads the same snapshot slot, and quarantines until a card earns its form a fixture", () => {
        const outcome = compileCard(
            sorcery(
                "Destroy target creature. You lose life equal to its power."
            )
        );
        if (outcome.state === "unparsed") throw new Error("unparsed");
        expect(sortKeys(outcome.definition.effects)).toEqual(
            sortKeys([
                { op: "destroy", target: { target: 0 }, bind: "$that1" },
                {
                    op: "loseLife",
                    player: "controller",
                    amount: { ref: "$that1.power" },
                },
            ])
        );
        expect(outcome.state).toBe("quarantine");
    });

    it("a bounce from the battlefield binds the creature before it moves", () => {
        expect(
            sortKeys(
                compiled(
                    sorcery(
                        "Return target creature to its owner's hand. You gain life equal to its power."
                    )
                ).effects
            )
        ).toEqual(
            sortKeys([
                {
                    op: "moveZone",
                    target: { target: 0 },
                    to: "hand",
                    bind: "$that1",
                },
                {
                    op: "gainLife",
                    player: "controller",
                    amount: { ref: "$that1.power" },
                },
            ])
        );
    });
});

describe("acted-on characteristic — refusals stay fail-closed (issue #4248)", () => {
    /** [what it is, the line, the refusal's reason — so a refusal for the
     *  WRONG reason (an unrelated gap, a typo) cannot pass]. */
    const REFUSED: readonly [string, string, string][] = [
        [
            "no preceding sentence acted on anything",
            "You gain life equal to its power.",
            '"its power" names no object acted on before it (CR 608.2h)',
        ],
        [
            "the sentence before recorded no antecedent (a counter is not a bind)",
            "Counter target spell. You gain life equal to its toughness.",
            '"its toughness" names no object acted on before it (CR 608.2h)',
        ],
        [
            "a later announcement made the antecedent stale",
            "Destroy target creature. Another target creature gets -2/-2 until end of turn. You gain life equal to its power.",
            '"its power" names no object acted on before it (CR 608.2h)',
        ],
        [
            "the acted-on object was a card in a graveyard, whose snapshot records no power (bindSnapshot)",
            "Return target creature card from your graveyard to your hand. You gain life equal to its power.",
            '"its power" is not read off the "Creature" in graveyard acted on before it — the snapshot records power and toughness only for a creature on the battlefield',
        ],
        [
            "the acted-on object was a noncreature permanent, which has no power (CR 208.3)",
            "Destroy target artifact. You gain life equal to its power.",
            '"its power" is not read off the "Artifact" in battlefield acted on before it — the snapshot records power and toughness only for a creature on the battlefield',
        ],
        [
            "the announcement admits a permanent with no toughness (CR 208.3)",
            "Destroy target creature or planeswalker. You gain life equal to its toughness.",
            '"its toughness" is not read off the ["Creature","Planeswalker"] in battlefield acted on before it — the snapshot records power and toughness only for a creature on the battlefield',
        ],
        [
            "the announcement is optional (`up to one`), so the object may not exist",
            "Destroy up to one target creature. You gain life equal to its power.",
            '"its power" is not read off the "Creature" in battlefield acted on before it — the snapshot records power and toughness only for a creature on the battlefield',
        ],
        [
            "a card noun cannot take power — its antecedent is not a permanent",
            "Destroy target creature. You gain life equal to that card's power.",
            "no slot consumed the line",
        ],
        [
            "a permanent noun is not printed with power anywhere in the corpus",
            "Destroy target creature. You gain life equal to that permanent's toughness.",
            "no slot consumed the line",
        ],
        [
            '"its controller" is a different recipient (Swords to Plowshares\' wording)',
            "Destroy target creature. Its controller gains life equal to its power.",
            "no slot consumed the line",
        ],
    ];

    for (const [what, line, reason] of REFUSED)
        it(`refuses: ${what}`, () => {
            expect(refusal(sorcery(line))).toBe(reason);
        });

    // Bottle Golems: "its" is the dying creature, the ability's own SOURCE —
    // a different referent than an object a sentence acted on. No sentence
    // did, so it is refused for the missing antecedent rather than read as
    // one, and keeps its own backlog entry.
    it('refuses a dies-trigger\'s "its power": the source is not an acted-on object', () => {
        expect(refusal(BOTTLE_GOLEMS)).toBe(
            '"its power" names no object acted on before it (CR 608.2h)'
        );
    });

    // "deals damage equal to its power" is the SOURCE's own power (~200
    // cards) — a different referent and a different Op. The damage site's
    // pattern keeps its literal "mana value", so the widened characteristic
    // set cannot leak into it.
    for (const stat of ["power", "toughness"])
        it(`refuses at a damage site: "its ${stat}" is not this rule's family`, () => {
            expect(
                refusal(
                    sorcery(
                        `Destroy target creature. Characteristic Probe deals damage equal to its ${stat} to another target creature.`
                    )
                )
            ).toBe("no slot consumed the line");
        });
});

describe("acted-on characteristic — behaviour (CR 608.2h)", () => {
    function withCompiled<T>(card: OracleCard, fn: (id: string) => T): T {
        const id = `test-4248-${card.name.toLowerCase().replace(/\W+/g, "-")}`;
        const definition = {
            ...compiled(card),
            id,
            rarity: "common",
        } as unknown as CardDefinition;
        return withTemporaryDefinition(definition, () => fn(id));
    }

    const theirs = (name: string, id: string) =>
        makeInstance(getCardByName(name).id, {
            id,
            controllerId: "p2",
            ownerId: "p2",
        });

    const DESTROY_GAIN_POWER = sorcery(
        "Destroy target creature. You gain life equal to its power."
    );
    const DESTROY_GAIN_TOUGHNESS = sorcery(
        "Destroy target creature. You gain life equal to its toughness.",
        "Toughness Probe"
    );

    it("gains the DESTROYED creature's power", () => {
        withCompiled(DESTROY_GAIN_POWER, (id) => {
            const angel = theirs("Serra Angel", "p2-angel"); // 4/4
            const state = makeState({
                players: [
                    makePlayer("p1", {}),
                    makePlayer("p2", { battlefield: [angel] }),
                ],
            });
            const before = getPlayer(state, "p1").life;
            pushSpell(state, id, "p1", [{ type: "permanent", id: "p2-angel" }]);
            resolveTopOfStack(state);
            expect(getPlayer(state, "p2").battlefield).toHaveLength(0);
            expect(getPlayer(state, "p1").life).toBe(before + 4);
        });
    });

    it("reads the snapshot taken when destroy ran: an anthem's bonus is in it", () => {
        withCompiled(DESTROY_GAIN_POWER, (id) => {
            // Crusade gives white creatures +1/+1, so Savannah Lions (2/1,
            // mana value 1) is a 3/2 when destroyed. By the time the life is
            // gained it is in a graveyard and the anthem no longer reaches
            // it: a live read would be 0, a printed-value read 2, a
            // mana-value read 1, and only the snapshot 3 — every wrong
            // answer is distinct from the right one.
            const lions = theirs("Savannah Lions", "p2-lions");
            const crusade = theirs("Crusade", "p2-crusade");
            const state = makeState({
                players: [
                    makePlayer("p1", {}),
                    makePlayer("p2", { battlefield: [lions, crusade] }),
                ],
            });
            const before = getPlayer(state, "p1").life;
            pushSpell(state, id, "p1", [{ type: "permanent", id: "p2-lions" }]);
            resolveTopOfStack(state);
            expect(getPlayer(state, "p2").battlefield.map((c) => c.id)).toEqual(
                ["p2-crusade"]
            );
            expect(getPlayer(state, "p1").life).toBe(before + 3);
        });
    });

    it("reads the pumped TOUGHNESS the same way", () => {
        withCompiled(DESTROY_GAIN_TOUGHNESS, (id) => {
            // Printed toughness 1, pumped 2, mana value 1: only the snapshot
            // is 2.
            const lions = theirs("Savannah Lions", "p2-lions");
            const crusade = theirs("Crusade", "p2-crusade");
            const state = makeState({
                players: [
                    makePlayer("p1", {}),
                    makePlayer("p2", { battlefield: [lions, crusade] }),
                ],
            });
            const before = getPlayer(state, "p1").life;
            pushSpell(state, id, "p1", [{ type: "permanent", id: "p2-lions" }]);
            resolveTopOfStack(state);
            expect(getPlayer(state, "p1").life).toBe(before + 2);
        });
    });

    it("Sever Soul gains the destroyed creature's toughness", () => {
        withCompiled(SEVER_SOUL, (id) => {
            const angel = theirs("Serra Angel", "p2-angel"); // 4/4
            const state = makeState({
                players: [
                    makePlayer("p1", {}),
                    makePlayer("p2", { battlefield: [angel] }),
                ],
            });
            const before = getPlayer(state, "p1").life;
            pushSpell(state, id, "p1", [{ type: "permanent", id: "p2-angel" }]);
            resolveTopOfStack(state);
            expect(getPlayer(state, "p2").battlefield).toHaveLength(0);
            expect(getPlayer(state, "p1").life).toBe(before + 4);
        });
    });

    it("Terashi's Grasp gains the DESTROYED enchantment's printed mana value", () => {
        withCompiled(TERASHIS_GRASP, (id) => {
            // Manabarbs is {3}{R} — mana value 4 — and is in the graveyard
            // by the time the life is gained, so only the snapshot yields 4.
            const enchantment = theirs("Manabarbs", "p2-ench");
            const state = makeState({
                players: [
                    makePlayer("p1", {}),
                    makePlayer("p2", { battlefield: [enchantment] }),
                ],
            });
            const before = getPlayer(state, "p1").life;
            pushSpell(state, id, "p1", [{ type: "permanent", id: "p2-ench" }]);
            resolveTopOfStack(state);
            expect(getPlayer(state, "p2").battlefield).toHaveLength(0);
            expect(getPlayer(state, "p1").life).toBe(before + 4);
        });
    });
});
