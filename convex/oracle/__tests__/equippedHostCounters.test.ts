// "Equipped creature" as the object of an Equipment's own triggered ability
// (CR 301.5a) — the `triggered › effect clause › equipped creature` Grammar
// Gap.
//
// Three layers:
//
//  1. GOLDEN — Ghost Lantern's real corpus row compiled whole, equal to its
//     GOLDEN_FIXTURES row, which is what clears the smoke skip `$host` raises.
//  2. REFUSALS — the neighbours the rule must NOT read: Blade of the
//     Bloodchief's "If equipped creature is a Vampire, … instead" replacement
//     (a sentence kind the shrink-only census refuses), Oathkeeper's
//     leaves-the-battlefield exile, a self-departure trigger reading the host,
//     an Equipment creature and an activated site.
//  3. BEHAVIOUR — the compiled trigger resolved through the real interpreter
//     on a real attachment: one counter on the host, none on a bystander,
//     nothing when unattached (CR 608.2b), and the counter survives the wire
//     projection.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards/catalogue";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { projectPublicState } from "../../gameProjections";
import { getEffectivePower } from "../../gre/layers";
import { resolveTopOfStack } from "../../gre/state";
import type { GameState, StackItem } from "../../gre/state";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

/** A real Equipment's row, with only the fields the rows here differ in. */
function equipment(
    name: string,
    manaCost: string,
    oracleText: string,
    typeLine = "Artifact — Equipment"
): OracleCard {
    return oracleCard({
        name,
        manaCost,
        typeLine,
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

const GHOST_LANTERN_TEXT =
    "Whenever a creature you control dies, put a +1/+1 counter on equipped creature.";
const GHOST_LANTERN = oracleCard({
    oracleId: "4af03564-1d1c-4582-9248-cfe9551bad30",
    name: "Ghost Lantern // Bind Spirit",
    manaCost: "{B} // {1}{B}",
    typeLine: "Artifact — Equipment // Instant — Adventure",
    oracleText: "",
    layout: "adventure",
    power: undefined,
    toughness: undefined,
    faces: [
        {
            name: "Ghost Lantern",
            manaCost: "{B}",
            typeLine: "Artifact — Equipment",
            oracleText: `${GHOST_LANTERN_TEXT}\nEquip {1}`,
        },
        {
            name: "Bind Spirit",
            manaCost: "{1}{B}",
            typeLine: "Instant — Adventure",
            oracleText:
                "Return target creature card from your graveyard to your hand. (Then exile this card. You may cast the artifact later from exile.)",
        },
    ],
});

function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome;
}

/** The refusal's gap reasons and fragments, joined — what a test greps. */
function refusal(card: OracleCard): string {
    const outcome = compileCard(card);
    expect(outcome.state).toBe("unparsed");
    if (outcome.state !== "unparsed") return "";
    return JSON.stringify(outcome.gaps);
}

describe("equipped creature — golden (CR 301.5a, CR 115.10)", () => {
    it("Ghost Lantern: the whole definition equals its GOLDEN_FIXTURES row, ready", () => {
        const fixture = GOLDEN_FIXTURES.find(
            (f) => f.card.name === "Ghost Lantern // Bind Spirit"
        )!;
        expect(fixture.rule).toBe("effect clause");
        expect(sortKeys(fixture.card)).toEqual(
            sortKeys({
                ...GHOST_LANTERN,
                power: undefined,
                toughness: undefined,
            })
        );
        const outcome = compiled(GHOST_LANTERN);
        expect(outcome.state).toBe("ready");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys(fixture.expected)
        );
        expect(
            outcome.definition.compiledTriggeredAbilities?.[0]?.effects
        ).toEqual([
            {
                op: "counters",
                action: "add",
                counter: "+1/+1",
                target: { ref: "$host" },
                count: 1,
            },
        ]);
    });
});

describe("equipped creature — refusals (fail-closed, ADR 0105 § 2)", () => {
    it("Oathkeeper's leaves-the-battlefield exile stays a gap", () => {
        expect(
            refusal(
                equipment(
                    "Oathkeeper, Takeno's Daisho",
                    "{3}",
                    "When Oathkeeper, Takeno's Daisho is put into a graveyard from the battlefield, exile equipped creature.\nEquip {2}",
                    "Legendary Artifact — Equipment"
                )
            )
        ).toContain("exile equipped creature");
    });

    it("a trigger on the source's own departure cannot read its host (CR 603.10a)", () => {
        expect(
            refusal(
                equipment(
                    "Test Blade",
                    "{1}",
                    "When Test Blade is put into a graveyard from the battlefield, put a +1/+1 counter on equipped creature.\nEquip {1}"
                )
            )
        ).toContain("leaves-the-battlefield trigger cannot read");
    });

    it("an Equipment creature is not read (CR 301.5c)", () => {
        expect(
            refusal(
                equipment(
                    "Test Blade",
                    "{1}",
                    "Whenever a creature dies, put a +1/+1 counter on equipped creature.",
                    "Artifact Creature — Equipment Golem"
                )
            )
        ).toContain("equipped creature");
    });

    it("an activated site keeps its own gap", () => {
        expect(
            refusal(
                equipment(
                    "Test Blade",
                    "{1}",
                    "{T}: Put a +1/+1 counter on equipped creature.\nEquip {1}"
                )
            )
        ).toContain("equipped creature");
    });

    it("Blade of the Bloodchief's host-subtype replacement stays a gap", () => {
        expect(
            refusal(
                equipment(
                    "Blade of the Bloodchief",
                    "{1}",
                    "Whenever a creature dies, put a +1/+1 counter on equipped creature. If equipped creature is a Vampire, put two +1/+1 counters on it instead.\nEquip {1}"
                )
            )
        ).toContain("If equipped creature is a Vampire");
    });
});

/** The Equipment attached (or not) to a bear, a bystander beside it. */
function equipmentBoard(attached: boolean): GameState {
    const blade = makeInstance("compiled-equipment-8593", {
        id: "blade1",
        controllerId: "p1",
        ownerId: "p1",
        ...(attached ? { attachedTo: "host1" } : {}),
    });
    const host = makeInstance(getCardByName("Grizzly Bears").id, {
        id: "host1",
        controllerId: "p1",
        ownerId: "p1",
    });
    const bystander = makeInstance(getCardByName("Grizzly Bears").id, {
        id: "bear2",
        controllerId: "p1",
        ownerId: "p1",
    });
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [blade, host, bystander] }),
            makePlayer("p2"),
        ],
    });
}

function resolveTrigger(state: GameState, definition: CardDefinition): void {
    const source = state.players[0]!.battlefield.find(
        (c) => c.id === "blade1"
    )!;
    state.stack.push({
        ...source,
        id: "blade-trigger",
        zone: "stack",
        castById: "p1",
        triggeredAbilityId: definition.compiledTriggeredAbilities?.[0]?.id,
        triggerSourceId: source.id,
        triggerEvent: {
            type: "CREATURE_DIED",
            instanceId: "victim",
            controllerId: "p2",
        } as StackItem["triggerEvent"],
        targets: undefined,
    } as StackItem);
    resolveTopOfStack(state);
}

const permanent = (state: GameState, id: string) =>
    state.players[0]!.battlefield.find((c) => c.id === id)!;

describe("equipped creature — behaviour through the interpreter (CR 301.5a, CR 608.2b)", () => {
    const lantern = {
        ...(compiled(GHOST_LANTERN).definition as CardDefinition),
        id: "compiled-equipment-8593",
        rarity: "common" as const,
    };

    it("one counter on the host, none on the bystander, and it survives the projection", () => {
        withTemporaryDefinition(lantern, () => {
            const state = equipmentBoard(true);
            resolveTrigger(state, lantern);
            expect(getEffectivePower(state, permanent(state, "host1"))).toBe(3);
            expect(getEffectivePower(state, permanent(state, "bear2"))).toBe(2);
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0]!.battlefield.find(
                (c) => c.id === "host1"
            )!;
            expect(getEffectivePower(projected, slim)).toBe(3);
        });
    });

    it("an unattached Equipment puts no counter anywhere", () => {
        withTemporaryDefinition(lantern, () => {
            const state = equipmentBoard(false);
            resolveTrigger(state, lantern);
            expect(getEffectivePower(state, permanent(state, "host1"))).toBe(2);
            expect(getEffectivePower(state, permanent(state, "bear2"))).toBe(2);
        });
    });
});
