// The generated vector (ADR 0186, Decision 1; issue #10853): the column
// census, the no-card-name guard, determinism, and what the seat may read.
//
// The census mirrors `opValuerCoverage.bot.test.ts`: every list it checks the
// columns against is recomputed HERE from the registries, never taken from
// the module under test — a derivation that drops a row must not be able to
// drop it from its own exam as well.

import { describe, expect, it } from "vitest";
import {
    catalogueDefinitions,
    getCardByName,
    getDefinition,
    withTemporaryDefinition,
} from "../../../../cards";
import {
    EFFECT_OP_REGISTRY,
    MECHANICS_REGISTRY,
} from "../../../../cards/mechanicsRegistry";
import {
    CARD_TYPES,
    PLAYER_COUNTER_KINDS,
    colors,
    type CardDefinition,
    type EffectOp,
} from "../../../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../../cards/__tests__/setup.helper";
import { projectPublicState } from "../../../../gameProjections";
import { PHASE_ORDER } from "../../../phases";
import { cloneGameState } from "../../../clone";
import { newManaCensusMemo } from "../../../manaCensusMemo";
import type { GameState } from "../../../state";
import { SCRIPT_HOST_FIELDS } from "../../effectOpChildren";
import { projectedToGameState } from "../../stateAdapter";
import {
    CARRIERS,
    COUNT_ZONES,
    MANA_SYMBOLS,
    MANA_UNIT_KINDS,
    NEED_MEASURES,
    NEED_SIDES,
    READ_ZONES,
    SIDES,
    countOf,
    generatedColumnFamilies,
    generatedColumnIndex,
    generatedColumns,
    generatedVector,
    namedEntries,
    subtractVectors,
} from "..";

const implementedOps = EFFECT_OP_REGISTRY.filter(
    (row) => row.status === "implemented"
).map((row) => row.op);

const implementedKeywords = MECHANICS_REGISTRY.filter(
    (row) => row.kind === "keyword-ability" && row.status === "implemented"
);

const id = (name: string): string => getCardByName(name).id;

const inZone = (
    name: string,
    zone: "hand" | "battlefield" | "graveyard",
    owner: string
) => makeInstance(id(name), { zone, controllerId: owner, ownerId: owner });

/** A small real board: p1 to move in its main phase, a spell on the stack. */
function board(): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    inZone("Lightning Bolt", "hand", "p1"),
                    inZone("Giant Growth", "hand", "p1"),
                    inZone("Serra Angel", "hand", "p1"),
                ],
                battlefield: [
                    inZone("Mountain", "battlefield", "p1"),
                    inZone("Forest", "battlefield", "p1"),
                    inZone("Prodigal Sorcerer", "battlefield", "p1"),
                ],
                graveyard: [inZone("Grizzly Bears", "graveyard", "p1")],
            }),
            makePlayer("p2", {
                life: 17,
                hand: [
                    inZone("Counterspell", "hand", "p2"),
                    inZone("Lightning Bolt", "hand", "p2"),
                    inZone("Island", "hand", "p2"),
                ],
                battlefield: [
                    inZone("Island", "battlefield", "p2"),
                    inZone("Serra Angel", "battlefield", "p2"),
                ],
            }),
        ],
    });
    pushSpell(state, id("Lightning Bolt"), "p2");
    return state;
}

describe("generated vector — the column census (issue #10853)", () => {
    it("every implemented Op has a column for each carrier, read zone and side", () => {
        const missing: string[] = [];
        for (const op of implementedOps) {
            for (const carrier of ["spell", "activated", "triggered"]) {
                for (const zone of [
                    "hand",
                    "battlefield",
                    "graveyard",
                    "stack",
                ]) {
                    for (const side of ["self", "opp"]) {
                        const name = `op.${op}.${carrier}.${zone}.${side}`;
                        if (generatedColumnIndex(name) === undefined) {
                            missing.push(name);
                        }
                    }
                }
            }
        }
        expect(implementedOps.length).toBeGreaterThan(100);
        expect(
            missing,
            "registered Ops with NO generated column — the column list is " +
                "derived from EFFECT_OP_REGISTRY (generatedVector/columns.ts); " +
                "a row it skips is a mechanic the vector cannot see"
        ).toEqual([]);
    });

    it("every implemented keyword ability has a column on the battlefield, for both sides", () => {
        const missing: string[] = [];
        for (const row of implementedKeywords) {
            for (const zone of ["hand", "battlefield", "graveyard", "stack"]) {
                for (const side of ["self", "opp"]) {
                    const name = `kw.${row.id}.${zone}.${side}`;
                    if (generatedColumnIndex(name) === undefined) {
                        missing.push(name);
                    }
                }
            }
        }
        expect(implementedKeywords.length).toBeGreaterThan(50);
        expect(
            missing,
            "implemented keywords with NO generated column — derived from " +
                "MECHANICS_REGISTRY (generatedVector/columns.ts)"
        ).toEqual([]);
    });

    it("every Op COUNTS in its own column: a script of that one Op, on a card in hand", () => {
        // A nesting construct needs a well-formed body to be walked at all;
        // the next test nests one for real.
        const hosts = new Set<string>(Object.keys(SCRIPT_HOST_FIELDS));
        const base = getDefinition(id("Lightning Bolt"));
        const wrong: string[] = [];
        for (const op of implementedOps) {
            if (hosts.has(op)) continue;
            const def: CardDefinition = {
                ...base,
                id: `generated-vector-census-${op}`,
                effects: [{ op } as unknown as EffectOp],
            };
            withTemporaryDefinition(def, () => {
                const state = makeState({
                    players: [
                        makePlayer("p1", {
                            hand: [
                                makeInstance(def.id, {
                                    zone: "hand",
                                    controllerId: "p1",
                                }),
                            ],
                        }),
                        makePlayer("p2"),
                    ],
                });
                const counted = namedEntries(generatedVector(state, "p1"))
                    .filter(([name]) => name.startsWith("op."))
                    .map(([name, count]) => `${name}=${count}`);
                const expected = [`op.${op}.spell.hand.self=1`];
                if (counted.join() !== expected.join()) {
                    wrong.push(`${op}: ${counted.join(" ") || "nothing"}`);
                }
            });
        }
        expect(wrong).toEqual([]);
    });

    it("an Op nested in a construct is counted, and so is the construct", () => {
        const base = getDefinition(id("Lightning Bolt"));
        const def: CardDefinition = {
            ...base,
            id: "generated-vector-census-nested",
            effects: [
                {
                    op: "if",
                    condition: { kind: "always" },
                    then: [{ op: "draw", count: 1, player: "controller" }],
                    else: [
                        { op: "gainLife", amount: 1, player: "controller" },
                        { op: "draw", count: 1, player: "controller" },
                    ],
                } as unknown as EffectOp,
            ],
        };
        withTemporaryDefinition(def, () => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        hand: [
                            makeInstance(def.id, {
                                zone: "hand",
                                controllerId: "p1",
                            }),
                        ],
                    }),
                    makePlayer("p2"),
                ],
            });
            const vector = generatedVector(state, "p1");
            expect(countOf(vector, "op.if.spell.hand.self")).toBe(1);
            expect(countOf(vector, "op.draw.spell.hand.self")).toBe(2);
            expect(countOf(vector, "op.gainLife.spell.hand.self")).toBe(1);
        });
    });

    it("every plainly-named keyword counts in its own column on the battlefield", () => {
        const wrong: string[] = [];
        for (const row of implementedKeywords) {
            // A parametrized keyword ("protection from red") has no bare
            // string a card could declare.
            if (row.bindingPattern) continue;
            const bears = makeInstance(id("Grizzly Bears"), {
                zone: "battlefield",
                controllerId: "p2",
                staticAbilities: [row.name.toLowerCase()],
            });
            const state = makeState({
                players: [
                    makePlayer("p1"),
                    makePlayer("p2", { battlefield: [bears] }),
                ],
            });
            const counted = namedEntries(generatedVector(state, "p1"))
                .filter(([name]) => name.startsWith("kw."))
                .map(([name, count]) => `${name}=${count}`);
            if (counted.join() !== `kw.${row.id}.battlefield.opp=1`) {
                wrong.push(`${row.id}: ${counted.join(" ") || "nothing"}`);
            }
        }
        expect(wrong).toEqual([]);
    });

    it("a column's name is its identity: unique, and it finds its own index back", () => {
        const names = generatedColumns();
        expect(new Set(names).size).toBe(names.length);
        const lost = names.filter(
            (name, i) => generatedColumnIndex(name) !== i
        );
        expect(lost).toEqual([]);
        const total = generatedColumnFamilies().reduce(
            (sum, family) =>
                sum + family.axes.reduce((n, axis) => n * axis.length, 1),
            0
        );
        expect(names.length).toBe(total);
    });
});

describe("generated vector — a column names a class, never a card (ADR 0186, Decision 4)", () => {
    /** Every word a column may be built from, recomputed from the registries
     *  and the engine's closed vocabularies. */
    const mechanicNames = new Set<string>([
        ...implementedOps,
        ...implementedKeywords.map((row) => row.id),
    ]);
    const structural = new Set<string>([
        // family tags
        "op",
        "kw",
        "type",
        "cost",
        "mana",
        "manaValue",
        "activation",
        "now",
        "base",
        "life",
        "counter",
        "cards",
        "hidden",
        "step",
        "need",
        "total",
        // engine vocabularies
        ...SIDES,
        ...READ_ZONES,
        ...COUNT_ZONES,
        ...CARRIERS,
        ...MANA_SYMBOLS,
        ...MANA_UNIT_KINDS,
        ...colors,
        ...CARD_TYPES,
        ...PLAYER_COUNTER_KINDS,
        ...NEED_MEASURES,
        ...NEED_SIDES,
        "MULLIGAN",
        ...PHASE_ORDER,
    ]);

    const segments = new Set<string>();
    for (const name of generatedColumns()) {
        for (const segment of name.split(".")) segments.add(segment);
    }

    it("every segment of every column is a registry name, an engine constant or an activation-cost leg", () => {
        const costLegs = new Set(
            generatedColumnFamilies().find(
                (family) => family.tag === "cost.activation"
            )!.axes[0]
        );
        // The cost legs are the keys of a TYPE (`ActivatedAbility["cost"]`,
        // pinned total by `tsc`); what a test can hold them to is their
        // shape: one camelCase identifier, never a name with spaces or a
        // card id.
        for (const leg of costLegs) expect(leg).toMatch(/^[a-z][A-Za-z]*$/);
        // The `need` family's measures are this module's own closed list,
        // held to the same shape; the catalogue-wide test below holds them
        // against every card's name.
        for (const m of NEED_MEASURES) expect(m).toMatch(/^[a-z][A-Za-z0-9]*$/);
        const foreign = [...segments].filter(
            (segment) =>
                !mechanicNames.has(segment) &&
                !structural.has(segment) &&
                !costLegs.has(segment)
        );
        expect(foreign).toEqual([]);
    });

    it("no column carries a card's id or name, over the whole catalogue", () => {
        // A card's name as a column segment could be written: lower-case
        // words joined by `-`, or camelCase, or run together.
        const spellings = (name: string): string[] => {
            const words = name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, " ")
                .trim()
                .split(" ")
                .filter((word) => word.length > 0);
            if (words.length === 0) return [];
            const camel =
                words[0] +
                words
                    .slice(1)
                    .map((word) => word[0].toUpperCase() + word.slice(1))
                    .join("");
            return [words.join("-"), camel, words.join("")];
        };
        const lowerSegments = new Map<string, string>();
        for (const segment of segments) {
            lowerSegments.set(segment.toLowerCase(), segment);
        }

        let cards = 0;
        const named: string[] = [];
        const shared: string[] = [];
        for (const def of catalogueDefinitions()) {
            cards++;
            if (segments.has(def.id)) named.push(`id of ${def.name}`);
            for (const spelling of spellings(def.name)) {
                const segment =
                    lowerSegments.get(spelling.toLowerCase()) ??
                    (segments.has(spelling) ? spelling : undefined);
                if (segment === undefined) continue;
                // A card may SHARE its name with a mechanic (the card Flash
                // and the keyword flash) or with a word of the game (a card
                // called Life). The column is then the mechanic's: its
                // segment comes from the registry or an engine constant,
                // which the test above pins. Anything else is a card.
                if (mechanicNames.has(segment) || structural.has(segment)) {
                    shared.push(segment);
                } else {
                    named.push(`${def.name} as "${segment}"`);
                }
            }
        }
        expect(cards).toBeGreaterThan(1000);
        expect(named).toEqual([]);
        // Not vacuous: the catalogue does hold cards named like mechanics,
        // and the check above met them.
        expect(shared.length).toBeGreaterThan(0);
    });
});

describe("generated vector — pure and deterministic (issue #10853)", () => {
    it("the same position and seat give the same vector, columns strictly ascending", () => {
        const state = board();
        const before = structuredClone(state);
        const first = generatedVector(state, "p1");
        const second = generatedVector(state, "p1");
        expect(second).toEqual(first);
        expect(generatedVector(cloneGameState(state), "p1")).toEqual(first);
        // Pure: the position is only read.
        expect(state).toEqual(before);
        expect(first.columns.length).toBe(first.counts.length);
        expect(first.columns.length).toBeGreaterThan(20);
        for (let i = 1; i < first.columns.length; i++) {
            expect(first.columns[i]).toBeGreaterThan(first.columns[i - 1]);
        }
        expect(first.counts.every((count) => count !== 0)).toBe(true);
    });

    it("a shared mana census memo changes the cost, never the vector", () => {
        const state = board();
        const memo = newManaCensusMemo();
        const shared = generatedVector(state, "p1", memo);
        expect(memo.size).toBe(2);
        expect(shared).toEqual(generatedVector(state, "p1"));
        // The second reader of the same position finds the census taken.
        expect(generatedVector(state, "p2", memo)).toEqual(
            generatedVector(state, "p2")
        );
    });

    it("the order cards sit in a zone does not change the counts", () => {
        const state = board();
        const shuffled = cloneGameState(state);
        for (const player of shuffled.players) {
            player.hand.reverse();
            player.battlefield.reverse();
        }
        expect(generatedVector(shuffled, "p1")).toEqual(
            generatedVector(state, "p1")
        );
    });

    it("reads what the cards declare, per zone and side", () => {
        const vector = generatedVector(board(), "p1");
        // Lightning Bolt in my hand; the opponent's is on the stack.
        expect(countOf(vector, "op.dealDamage.spell.hand.self")).toBe(1);
        expect(countOf(vector, "op.dealDamage.spell.stack.opp")).toBe(1);
        // Prodigal Sorcerer's ping is an activated ability on my battlefield,
        // paid for by tapping.
        expect(
            countOf(vector, "op.dealDamage.activated.battlefield.self")
        ).toBe(1);
        expect(countOf(vector, "cost.activation.tap.battlefield.self")).toBe(1);
        // Serra Angel: flying and vigilance in my hand and on their board.
        expect(countOf(vector, "kw.flying.hand.self")).toBe(1);
        expect(countOf(vector, "kw.flying.battlefield.opp")).toBe(1);
        expect(countOf(vector, "kw.vigilance.battlefield.opp")).toBe(1);
        expect(countOf(vector, "type.Creature.graveyard.self")).toBe(1);
        expect(countOf(vector, "type.Instant.hand.self")).toBe(2);
        // {R} + {G} + {3}{W}{W} in hand.
        expect(countOf(vector, "cost.manaValue.hand.self")).toBe(7);
        expect(countOf(vector, "cost.mana.W.hand.self")).toBe(2);
        expect(countOf(vector, "cost.mana.generic.hand.self")).toBe(3);
        // Two untapped lands: one red unit, one green.
        expect(countOf(vector, "mana.now.total.self")).toBe(2);
        expect(countOf(vector, "mana.now.R.self")).toBe(1);
        expect(countOf(vector, "mana.now.G.self")).toBe(1);
        expect(countOf(vector, "life.self")).toBe(20);
        expect(countOf(vector, "life.opp")).toBe(17);
        expect(countOf(vector, "cards.stack.opp")).toBe(1);
        expect(countOf(vector, "step.PRECOMBAT_MAIN.self")).toBe(1);
        expect(countOf(vector, "step.PRECOMBAT_MAIN.opp")).toBe(0);
    });

    it("the other seat reads the same board mirrored", () => {
        const state = board();
        const mine = generatedVector(state, "p1");
        const theirs = generatedVector(state, "p2");
        expect(countOf(theirs, "life.self")).toBe(countOf(mine, "life.opp"));
        expect(countOf(theirs, "kw.flying.battlefield.self")).toBe(
            countOf(mine, "kw.flying.battlefield.opp")
        );
        expect(countOf(theirs, "step.PRECOMBAT_MAIN.opp")).toBe(1);
    });

    it("a name that is no column throws instead of reading zero", () => {
        expect(() =>
            countOf(generatedVector(board(), "p1"), "op.lightningBolt.hand")
        ).toThrow(/no column named/);
    });
});

describe("generated vector — the seat reads what the Brain's projection shows (issue #10853)", () => {
    /** The state the Brain plays from: the wire projection for `seat`,
     *  through the production state adapter. */
    const brainStateFor = (state: GameState, seat: string): GameState =>
        projectedToGameState(
            projectPublicState(state, 1, seat),
            undefined,
            seat
        );

    it("the opponent's hidden hand is counted, never read", () => {
        const vector = generatedVector(board(), "p1");
        // p2 holds Counterspell, Lightning Bolt and an Island: three cards,
        // and nothing of what they are.
        expect(countOf(vector, "cards.hand.opp")).toBe(3);
        expect(countOf(vector, "hidden.hand.opp")).toBe(3);
        expect(countOf(vector, "op.counter.spell.hand.opp")).toBe(0);
        expect(countOf(vector, "op.dealDamage.spell.hand.opp")).toBe(0);
        expect(countOf(vector, "type.Land.hand.opp")).toBe(0);
        expect(countOf(vector, "cost.manaValue.hand.opp")).toBe(0);
        // The same cards ARE read by the seat that holds them.
        const theirs = generatedVector(board(), "p2");
        expect(countOf(theirs, "op.counter.spell.hand.self")).toBe(1);
        expect(countOf(theirs, "hidden.hand.self")).toBe(0);
    });

    it("a full-information state and the Brain's projection of it give the SAME vector", () => {
        const full = board();
        const brain = brainStateFor(full, "p1");
        // The projection really did hide the hand: this is not the full
        // state under another name.
        const theirHand = brain.players.find((p) => p.id === "p2")!.hand;
        expect(theirHand).toHaveLength(3);
        expect(
            theirHand.every((card) => card.id.startsWith("placeholder:"))
        ).toBe(true);
        expect(
            namedEntries(
                subtractVectors(
                    generatedVector(full, "p1"),
                    generatedVector(brain, "p1")
                )
            )
        ).toEqual([]);
    });

    it("a hand card the seat was SHOWN is read, on both states alike", () => {
        const full = board();
        const shown = full.players[1].hand[0];
        shown.knownTo = ["p1"];
        const brain = brainStateFor(full, "p1");
        for (const state of [full, brain]) {
            const vector = generatedVector(state, "p1");
            expect(countOf(vector, "op.counter.spell.hand.opp")).toBe(1);
            expect(countOf(vector, "hidden.hand.opp")).toBe(2);
            expect(countOf(vector, "op.dealDamage.spell.hand.opp")).toBe(0);
        }
        expect(
            namedEntries(
                subtractVectors(
                    generatedVector(full, "p1"),
                    generatedVector(brain, "p1")
                )
            )
        ).toEqual([]);
    });

    it("a library is counted and never read, whatever it holds", () => {
        const state = board();
        state.players[0].library = [
            inZone("Lightning Bolt", "hand", "p1"),
            inZone("Serra Angel", "hand", "p1"),
        ].map((card) => ({ ...card, zone: "library" as const }));
        const withLibrary = generatedVector(state, "p1");
        const without = generatedVector(board(), "p1");
        expect(namedEntries(subtractVectors(withLibrary, without))).toEqual([
            ["cards.library.self", 2],
        ]);
    });
});
