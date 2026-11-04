// Ward keyword lines (CR 702.21a, issue #7769): "Ward {N}" alone or inside a
// keyword run, and the dashed "Ward—Pay N life." line.
//
//  1. GOLDEN fixtures — a real corpus card compiled whole produces the keyword
//     string and nothing else; the trigger is `expandWard`'s (ADR 0054).
//  2. The compiled string reaches the ENGINE: a compiled definition, registered,
//     counters an opponent's spell. A string alone would be a ward that never
//     counters anything (the Guard A shape), so the golden does not prove this.
//  3. REFUSALS — every printed neighbour with no `MayPayCost` reading.
//     Fail-closed is pinned, not assumed (ADR 0105 § 2).

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { applyMayPaySubmit } from "../../gre/pendingChoiceSubmit";
import {
    emitBecameTargetEvents,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../gre/state";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { keywordLineSlot } from "../grammar/slots/keywordLine";
import { oracleCard, parseContext } from "./oracle.fixture";

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function readLine(line: string) {
    return keywordLineSlot.run(line, parseContext());
}

const TOMAKUL_TEXT =
    "Ward {2} (Whenever this creature becomes the target of a spell or ability an opponent controls, counter it unless that player pays {2}.)";
const LORD_OF_CHANGE_TEXT =
    "Flying, ward {3}\nArchitect of Deception — When this creature enters, draw three cards.";
const SIRE_TEXT =
    "Reach, first strike\nVigilance, menace\nTrample, lifelink\nWard—Pay 7 life.";

describe("Ward keyword lines — goldens (CR 702.21a)", () => {
    it('reads "Ward {2}" alone, past its reminder (Tomakul Honor Guard)', () => {
        expect(
            sortKeys(
                compiled(
                    oracleCard({
                        name: "Tomakul Honor Guard",
                        manaCost: "{1}{G}",
                        typeLine: "Creature — Human Soldier",
                        oracleText: TOMAKUL_TEXT,
                        power: "3",
                        toughness: "1",
                    })
                )
            )
        ).toEqual(
            sortKeys({
                name: "Tomakul Honor Guard",
                types: ["Creature"],
                subtypes: ["Human", "Soldier"],
                manaCost: { X: 1, G: 1 },
                power: 3,
                toughness: 1,
                oracleText: TOMAKUL_TEXT,
                staticAbilities: ["ward {2}"],
            })
        );
    });

    it('reads "ward {N}" inside a keyword run (Lord of Change)', () => {
        expect(
            sortKeys(
                compiled(
                    oracleCard({
                        name: "Lord of Change",
                        manaCost: "{6}{U}",
                        typeLine: "Creature — Demon",
                        oracleText: LORD_OF_CHANGE_TEXT,
                        power: "6",
                        toughness: "6",
                    })
                )
            )
        ).toEqual(
            sortKeys({
                name: "Lord of Change",
                types: ["Creature"],
                subtypes: ["Demon"],
                manaCost: { X: 6, U: 1 },
                power: 6,
                toughness: 6,
                oracleText: LORD_OF_CHANGE_TEXT,
                staticAbilities: ["flying", "ward {3}"],
                compiledTriggeredAbilities: [
                    {
                        id: "lord-of-change-trigger",
                        oracleText:
                            "Architect of Deception — When this creature enters, draw three cards.",
                        head: { kind: "entered", scope: "self" },
                        effects: [
                            { op: "draw", player: "controller", count: 3 },
                        ],
                    },
                ],
            })
        );
    });

    it('reads a dashed "Ward—Pay N life." line (Sire of Seven Deaths)', () => {
        expect(
            sortKeys(
                compiled(
                    oracleCard({
                        name: "Sire of Seven Deaths",
                        manaCost: "{7}",
                        typeLine: "Creature — Eldrazi",
                        oracleText: SIRE_TEXT,
                        power: "7",
                        toughness: "7",
                    })
                )
            )
        ).toEqual(
            sortKeys({
                name: "Sire of Seven Deaths",
                types: ["Creature"],
                subtypes: ["Eldrazi"],
                manaCost: { X: 7 },
                power: 7,
                toughness: 7,
                oracleText: SIRE_TEXT,
                staticAbilities: [
                    "reach",
                    "first strike",
                    "vigilance",
                    "menace",
                    "trample",
                    "lifelink",
                    "ward—pay 7 life",
                ],
            })
        );
    });
});

describe("a compiled ward counters in the engine (CR 702.21a)", () => {
    const REMOVAL_ID = "ward-line-removal";
    registerTokenDefinition({
        id: REMOVAL_ID,
        name: REMOVAL_ID,
        rarity: "common",
        manaCost: { X: 1 },
        types: ["Instant"],
        targetRequirement: { type: "Creature", count: 1 },
        effects: [{ op: "destroy", target: { target: 0 } }],
    });

    it.each([
        ["mana", "ward-line-mana", "Ward {2}"],
        ["life", "ward-line-life", "Ward—Pay 2 life."],
    ])(
        "the %s form: declined, the targeting spell is countered",
        (_form, id, oracleText) => {
            registerTokenDefinition({
                ...compiled(oracleCard({ name: id, oracleText })),
                id,
                rarity: "common",
            });
            const warded = makeInstance(id, {
                id: "warded1",
                controllerId: "p2",
                ownerId: "p2",
            });
            const state = makeState({
                players: [
                    makePlayer("p1"),
                    makePlayer("p2", { battlefield: [warded] }),
                ],
            });
            const spell = pushSpell(state, REMOVAL_ID, "p1", [
                { type: "permanent", id: "warded1" },
            ]);
            emitBecameTargetEvents(
                state,
                spell.targets,
                "p1",
                spell.id,
                "spell"
            );
            processPendingActionTriggers(state);
            expect(
                state.stack[state.stack.length - 1]?.triggeredAbilityId
            ).toBe("ward");
            expect(resolveTopOfStack(state)).toBeNull();
            applyMayPaySubmit(state, { playerId: "p1", accept: false });
            expect(state.stack).toHaveLength(0);
            expect(
                state.players[0].graveyard.some((c) => c.id === spell.id)
            ).toBe(true);
        }
    );
});

describe("Ward refusals — no `MayPayCost` reading (ADR 0105 § 2)", () => {
    it.each([
        ["a coloured mana ward", "Ward {W}"],
        ["a multi-symbol mana ward", "Ward {2}{B}"],
        ["a variable mana ward", "Ward {X}"],
        ["a free ward", "Ward {0}"],
        ["an unbraced number", "Ward 2"],
        ["a discard ward", "Ward—Discard a card."],
        ["a sacrifice ward", "Ward—Sacrifice a creature."],
        ["a mana-and-life pair", "Ward—{2}, Pay 2 life."],
        [
            "a life amount the card computes",
            "Ward—Pay life equal to this creature's power.",
        ],
        ["a free life ward", "Ward—Pay 0 life."],
        ["a dashed ward with no full stop", "Ward—Pay 2 life"],
        ["a dashed ward inside a run", "Flying, ward—pay 2 life"],
    ])("REFUSES %s", (_why, line) => {
        expect(readLine(line).ok).toBe(false);
    });

    it("REFUSES a whole card on a ward it cannot read", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Discard Warded",
                oracleText: "Ward—Discard a card.",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
