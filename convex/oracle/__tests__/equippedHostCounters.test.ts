// "Equipped creature" as the object of an Equipment's own triggered ability
// (CR 301.5a), and its "If equipped creature is a <subtype>, … instead"
// replacement (CR 608.2c) — the `triggered › effect clause › equipped
// creature` Grammar Gap.
//
// Three layers:
//
//  1. GOLDEN — real corpus rows compiled whole: Ghost Lantern's plain host
//     counter, Blade of the Bloodchief's host counter with its Vampire
//     upgrade. Both reach `ready`; Blade's GOLDEN_FIXTURES row is what clears
//     the smoke skips `$host` raises for both.
//  2. REFUSALS — the neighbours the rule must NOT read: Oathkeeper's
//     leaves-the-battlefield exile, a self-departure trigger reading the
//     host, an Equipment creature, an activated site, a non-creature subtype,
//     and an upgrade naming a different counter.
//  3. BEHAVIOUR — the compiled trigger resolved through the real interpreter
//     on a real attachment: one counter on a non-Vampire host, two on a
//     Vampire, none on a bystander, nothing when unattached (CR 608.2b), and
//     the counters survive the wire projection.

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

const BLADE_TEXT =
    "Whenever a creature dies, put a +1/+1 counter on equipped creature. If equipped creature is a Vampire, put two +1/+1 counters on it instead.";
const BLADE = equipment(
    "Blade of the Bloodchief",
    "{1}",
    `${BLADE_TEXT}\nEquip {1}`
);
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

describe("equipped creature — goldens (CR 301.5a, CR 608.2c)", () => {
    it("Ghost Lantern: a +1/+1 counter on `$host`, ready", () => {
        const outcome = compiled(GHOST_LANTERN);
        expect(outcome.state).toBe("ready");
        expect(sortKeys(outcome.definition.compiledTriggeredAbilities)).toEqual(
            sortKeys([
                {
                    id: "ghost-lantern-trigger",
                    oracleText: GHOST_LANTERN_TEXT,
                    head: { kind: "died", scope: "yours" },
                    effects: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            target: { ref: "$host" },
                            count: 1,
                        },
                    ],
                },
            ])
        );
    });

    it("Blade of the Bloodchief: the whole definition equals its GOLDEN_FIXTURES row, ready", () => {
        const fixture = GOLDEN_FIXTURES.find(
            (f) => f.card.name === "Blade of the Bloodchief"
        )!;
        expect(fixture.rule).toBe("effect clause");
        const outcome = compiled(BLADE);
        expect(outcome.state).toBe("ready");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys(fixture.expected)
        );
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

    it("a non-creature subtype in the condition is refused", () => {
        expect(
            refusal(
                equipment(
                    "Test Blade",
                    "{1}",
                    "Whenever a creature dies, put a +1/+1 counter on equipped creature. If equipped creature is a Forest, put two +1/+1 counters on it instead.\nEquip {1}"
                )
            )
        ).toContain("If equipped creature is a Forest");
    });

    it("an upgrade naming a different counter is refused", () => {
        expect(
            refusal(
                equipment(
                    "Test Blade",
                    "{1}",
                    "Whenever a creature dies, put a +1/+1 counter on equipped creature. If equipped creature is a Vampire, put two -1/-1 counters on it instead.\nEquip {1}"
                )
            )
        ).toContain('"path":["sentence assembly"]');
    });
});

/** Blade attached (or not) to `host`, a bystander beside it. */
function bladeBoard(hostName: string, attached: boolean): GameState {
    const blade = makeInstance("compiled-blade-8593", {
        id: "blade1",
        controllerId: "p1",
        ownerId: "p1",
        ...(attached ? { attachedTo: "host1" } : {}),
    });
    const host = makeInstance(getCardByName(hostName).id, {
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
    const blade = {
        ...(compiled(BLADE).definition as CardDefinition),
        id: "compiled-blade-8593",
        rarity: "common" as const,
    };

    it("one counter on a non-Vampire host, none on the bystander, and it survives the projection", () => {
        withTemporaryDefinition(blade, () => {
            const state = bladeBoard("Grizzly Bears", true);
            resolveTrigger(state, blade);
            expect(getEffectivePower(state, permanent(state, "host1"))).toBe(3);
            expect(getEffectivePower(state, permanent(state, "bear2"))).toBe(2);
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0]!.battlefield.find(
                (c) => c.id === "host1"
            )!;
            expect(getEffectivePower(projected, slim)).toBe(3);
        });
    });

    it("two counters on a Vampire host instead", () => {
        withTemporaryDefinition(blade, () => {
            const state = bladeBoard("Sengir Vampire", true);
            const before = getEffectivePower(state, permanent(state, "host1"));
            resolveTrigger(state, blade);
            expect(getEffectivePower(state, permanent(state, "host1"))).toBe(
                before + 2
            );
        });
    });

    it("an unattached Blade puts no counter anywhere", () => {
        withTemporaryDefinition(blade, () => {
            const state = bladeBoard("Sengir Vampire", false);
            const before = getEffectivePower(state, permanent(state, "host1"));
            resolveTrigger(state, blade);
            expect(getEffectivePower(state, permanent(state, "host1"))).toBe(
                before
            );
            expect(getEffectivePower(state, permanent(state, "bear2"))).toBe(2);
        });
    });
});
