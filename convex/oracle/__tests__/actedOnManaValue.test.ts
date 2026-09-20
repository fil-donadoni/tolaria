// "That permanent's mana value" — a back-reference to the permanent an
// earlier sentence acted on, read as a value (issue #4221, CR 202.3 /
// 608.2h / 110.1).
//
// The engine already expressed the whole thing before this rule existed:
// `destroy` carries an optional binding that snapshots the object it
// destroyed, and a bound object's mana value is readable in any numeric
// position. What was missing was the READING — the umbrella noun "that
// permanent", and a damage amount that is a phrase rather than one token.
//
//  1. GOLDENS — the two real corpus cards that print the form, compiled whole
//     and compared with `sortKeys` equality, plus the `ready` state their
//     golden fixtures buy (the canned smoke scenario cannot plan an amount
//     only a runtime binding knows, so without the fixtures both quarantine).
//  2. REFUSALS — the neighbours this rule must NOT read: the phrase with no
//     preceding sentence that bound anything, an antecedent that was never a
//     permanent, an antecedent a later announcement made stale, and one a
//     gate means may never have existed at all.
//  3. BEHAVIOUR — the compiled scripts run through the real interpreter. By
//     the time the value is read the permanent is in a graveyard, so a live
//     read would be 0 and a snapshot read is the printed mana value: the one
//     assertion that tells the two apart.

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

/** Orim's Thunder's corpus row, verbatim (`data/oracle-corpus.json.gz`). */
const ORIMS_THUNDER: OracleCard = {
    oracleId: "380429d5-82db-449c-b9b9-3e82ab987972",
    name: "Orim's Thunder",
    manaCost: "{2}{W}",
    typeLine: "Instant",
    oracleText:
        "Kicker {R} (You may pay an additional {R} as you cast this spell.)\nDestroy target artifact or enchantment. If this spell was kicked, it deals damage equal to that permanent's mana value to target creature.",
    layout: "normal",
};

/** Feed the Swarm's corpus row, verbatim. */
const FEED_THE_SWARM: OracleCard = {
    oracleId: "5825997b-10d7-4a36-972c-a80ddd90b8ed",
    name: "Feed the Swarm",
    manaCost: "{1}{B}",
    typeLine: "Sorcery",
    oracleText:
        "Destroy target creature or enchantment an opponent controls. You lose life equal to that permanent's mana value.",
    layout: "normal",
};

function sorcery(oracleText: string, name = "Snapshot Probe"): OracleCard {
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

describe("acted-on mana value — goldens (CR 202.3, issue #4221)", () => {
    it("Orim's Thunder: the kicked half's damage reads the destroyed permanent's snapshot", () => {
        expect(sortKeys(compiled(ORIMS_THUNDER).effects)).toEqual(
            sortKeys([
                { op: "destroy", target: { target: 0 }, bind: "$that1" },
                {
                    op: "if",
                    predicate: {
                        left: { kickerCount: true },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            op: "dealDamage",
                            amount: { ref: "$that1.manaValue" },
                            to: { target: 1 },
                        },
                    ],
                },
            ])
        );
    });

    it("Orim's Thunder: the creature is the kicked half's own target group (CR 702.33g)", () => {
        const definition = compiled(ORIMS_THUNDER);
        expect(definition.targetRequirement).toEqual({
            type: ["Artifact", "Enchantment"],
            count: 1,
        });
        expect(definition.additionalTargetRequirements).toEqual([
            { type: "Creature", count: 1, announcedOnlyIfKicked: true },
        ]);
    });

    it("Feed the Swarm: the life loss reads the same snapshot at a life site", () => {
        expect(sortKeys(compiled(FEED_THE_SWARM).effects)).toEqual(
            sortKeys([
                { op: "destroy", target: { target: 0 }, bind: "$that1" },
                {
                    op: "loseLife",
                    player: "controller",
                    amount: { ref: "$that1.manaValue" },
                },
            ])
        );
    });

    it("both reach `ready` — the golden fixtures clear the runtime-amount smoke skip", () => {
        expect([
            compileCard(ORIMS_THUNDER).state,
            compileCard(FEED_THE_SWARM).state,
        ]).toEqual(["ready", "ready"]);
    });

    it("no new Op: the whole rule lowers to Ops the catalogue already runs", () => {
        const outcome = compileCard(ORIMS_THUNDER);
        if (outcome.state === "unparsed") throw new Error("unparsed");
        expect([...outcome.opsUsed].sort()).toEqual([
            "dealDamage",
            "destroy",
            "if",
        ]);
    });
});

describe("acted-on mana value — refusals stay fail-closed (issue #4221)", () => {
    /** [what it is, the line, the refusal's reason — so a refusal for the
     *  WRONG reason (an unrelated gap, a typo) cannot pass]. */
    const REFUSED: readonly [string, string, string][] = [
        [
            "no preceding sentence bound anything",
            "You lose life equal to that permanent's mana value.",
            '"that permanent\'s mana value" names no object acted on before it (CR 608.2h)',
        ],
        [
            "the sentence before recorded no antecedent (a counter is not a bind)",
            "Counter target spell. You lose life equal to that permanent's mana value.",
            '"that permanent\'s mana value" names no object acted on before it (CR 608.2h)',
        ],
        [
            "the acted-on object was a card in a graveyard (CR 110.1)",
            "Return target creature card from your graveyard to your hand. You lose life equal to that permanent's mana value.",
            '"that permanent" is not the "Creature" in graveyard acted on before it (CR 110.1)',
        ],
        [
            "a later announcement made the antecedent stale",
            "Destroy target creature. Another target creature gets -2/-2 until end of turn. You lose life equal to that permanent's mana value.",
            '"that permanent\'s mana value" names no object acted on before it (CR 608.2h)',
        ],
        [
            "the sentence that bound it was itself gated, so it may never have run",
            "Kicker {R}\nIf this spell was kicked, destroy target creature. You lose life equal to that permanent's mana value.",
            '"that permanent\'s mana value" names no object acted on before it (CR 608.2h)',
        ],
    ];

    for (const [what, line, reason] of REFUSED)
        it(`refuses: ${what}`, () => {
            expect(refusal(sorcery(line))).toBe(reason);
        });

    // The corpus prints both of these at a DAMAGE site meaning something this
    // rule does not read: "that card's" is the card revealed off a library
    // (Erratic Explosion, Riddle of Lightning — 15 cards) and "its" is the
    // DEALER's own mana value (Goblin Tinkerer, Enchanter's Bane). Each is
    // refused elsewhere today — the dealer is not this spell, or nothing was
    // bound — and this pins the damage site's own noun set so the rule does
    // not lean on those. The LIFE site keeps all three: it has the cards.
    for (const noun of ["its", "that card's"])
        it(`refuses at a damage site: "${noun} mana value" is not this rule's noun`, () => {
            expect(
                refusal(
                    sorcery(
                        `Destroy target creature. Snapshot Probe deals damage equal to ${noun} mana value to another target creature.`
                    )
                )
            ).toBe("no slot consumed the line");
        });

    it("the life site still reads all three nouns (Ghastly Death Tyrant's clause)", () => {
        expect(
            refusal(
                sorcery(
                    "Destroy target creature. You lose life equal to its mana value."
                )
            )
        ).toBeNull();
    });

    it("Carnivorous Canopy's condition form stays refused — a value read is not a comparison", () => {
        // The umbrella noun is the same; the SITE is a condition, which this
        // rule does not reach. It keeps its own Grammar Gap rather than being
        // swallowed by a widened pattern here.
        expect(
            refusal(
                sorcery(
                    "Destroy target artifact, enchantment, or creature with flying. If that permanent's mana value was 3 or less, proliferate.",
                    "Carnivorous Canopy"
                )
            )
        ).toBe("no slot consumed the line");
    });
});

describe("acted-on mana value — behaviour (CR 608.2h)", () => {
    function withCompiled<T>(card: OracleCard, fn: (id: string) => T): T {
        const id = `test-4221-${card.name.toLowerCase().replace(/\W+/g, "-")}`;
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

    it("kicked Orim's Thunder deals the DESTROYED enchantment's printed mana value", () => {
        withCompiled(ORIMS_THUNDER, (id) => {
            // Manabarbs is {3}{R} — mana value 4 — and is in the graveyard
            // by the time the damage is dealt, so a live read would be 0 and
            // only the `destroy` snapshot yields 4. A hostless AURA would be
            // the wrong fixture here (CR 704.5m bins it).
            const enchantment = theirs("Manabarbs", "p2-ench");
            const creature = theirs("Force of Nature", "p2-wall"); // 8/8
            const state = makeState({
                players: [
                    makePlayer("p1", {}),
                    makePlayer("p2", {
                        battlefield: [enchantment, creature],
                    }),
                ],
            });
            const item = pushSpell(state, id, "p1", [
                { type: "permanent", id: "p2-ench" },
                { type: "permanent", id: "p2-wall" },
            ]);
            item.kickerPayments = { kicker: 1 };
            resolveTopOfStack(state);
            const board = getPlayer(state, "p2").battlefield;
            expect(board.map((c) => c.id)).toEqual(["p2-wall"]);
            expect(board[0]!.damageMarked).toBe(4);
        });
    });

    it("unkicked Orim's Thunder: no Kicker paid, so the damage half never runs (CR 702.33d)", () => {
        withCompiled(ORIMS_THUNDER, (id) => {
            const enchantment = theirs("Manabarbs", "p2-ench");
            const creature = theirs("Force of Nature", "p2-wall");
            const state = makeState({
                players: [
                    makePlayer("p1", {}),
                    makePlayer("p2", {
                        battlefield: [enchantment, creature],
                    }),
                ],
            });
            pushSpell(state, id, "p1", [{ type: "permanent", id: "p2-ench" }]);
            resolveTopOfStack(state);
            const board = getPlayer(state, "p2").battlefield;
            expect(board.map((c) => c.id)).toEqual(["p2-wall"]);
            expect(board[0]!.damageMarked ?? 0).toBe(0);
        });
    });

    it("Feed the Swarm loses life equal to the DESTROYED creature's mana value", () => {
        withCompiled(FEED_THE_SWARM, (id) => {
            const angel = theirs("Serra Angel", "p2-angel"); // {3}{W}{W} — MV 5
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
            expect(getPlayer(state, "p1").life).toBe(before - 5);
        });
    });
});
