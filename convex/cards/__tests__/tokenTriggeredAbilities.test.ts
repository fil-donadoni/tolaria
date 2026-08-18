// Unit coverage for `resolveTokenTriggeredAbilities` (CR 707.2, issue #2364)
// — the shared factory that synthesizes real, self-scoped `TriggeredAbility`
// objects from the JSON-pure `TokenTriggeredAbility` descriptor. End-to-end
// coverage through the real `createToken` Op / registry / wire projection
// lives in `abilities/tokens/__tests__/tokenTriggeredAbility.test.ts`; this
// file isolates the pure synthesis step.

import { describe, it, expect } from "vitest";
import {
    TOKEN_TRIGGERED_EVENT_KINDS,
    resolveTokenTriggeredAbilities,
} from "../tokenTriggeredAbilities";
import type { PermanentView, TokenTriggeredEventKind } from "../types";

function selfView(overrides: Partial<PermanentView> = {}): PermanentView {
    return {
        id: "self",
        controllerId: "p1",
        ownerId: "p1",
        types: ["Creature"],
        subtypes: [],
        isTapped: false,
        card: {},
        ...overrides,
    };
}

describe("resolveTokenTriggeredAbilities (CR 707.2, issue #2364)", () => {
    it("returns [] for undefined/empty descriptors", () => {
        expect(resolveTokenTriggeredAbilities(undefined)).toEqual([]);
        expect(resolveTokenTriggeredAbilities([])).toEqual([]);
    });

    it("PERMANENT_ENTERED descriptor synthesizes a self-scoped enteredTrigger", () => {
        const [ability] = resolveTokenTriggeredAbilities([
            {
                id: "test-etb",
                oracleText: "When this token enters, do a thing.",
                event: "PERMANENT_ENTERED",
                effects: [],
            },
        ]);
        expect(ability.id).toBe("test-etb");
        expect(ability.event).toBe("PERMANENT_ENTERED");
        const self = selfView();
        // Self-scoped: matches when the entering permanent IS self...
        expect(
            ability.matches(
                {
                    type: "PERMANENT_ENTERED",
                    instanceId: "self",
                    controllerId: "p1",
                    types: ["Creature"],
                },
                self
            )
        ).toBe(true);
        // ...but not when a DIFFERENT permanent enters (self scope excludes
        // "another creature").
        expect(
            ability.matches(
                {
                    type: "PERMANENT_ENTERED",
                    instanceId: "other",
                    controllerId: "p1",
                    types: ["Creature"],
                },
                self
            )
        ).toBe(false);
    });

    it("CREATURE_DIED descriptor synthesizes a self-scoped diedTrigger", () => {
        const [ability] = resolveTokenTriggeredAbilities([
            {
                id: "test-dies",
                oracleText: "When this token dies, do a thing.",
                event: "CREATURE_DIED",
                effects: [],
            },
        ]);
        expect(ability.id).toBe("test-dies");
        expect(ability.event).toBe("CREATURE_DIED");
        const self = selfView();
        expect(
            ability.matches(
                {
                    type: "CREATURE_DIED",
                    creatureInstanceId: "self",
                    creatureControllerId: "p1",
                    creatureOwnerId: "p1",
                    creatureTypes: ["Creature"],
                    damagedBySources: [],
                    creaturePower: 1,
                    creatureToughness: 1,
                },
                self
            )
        ).toBe(true);
        expect(
            ability.matches(
                {
                    type: "CREATURE_DIED",
                    creatureInstanceId: "other",
                    creatureControllerId: "p1",
                    creatureOwnerId: "p1",
                    creatureTypes: ["Creature"],
                    damagedBySources: [],
                    creaturePower: 1,
                    creatureToughness: 1,
                },
                self
            )
        ).toBe(false);
    });

    it("ATTACKERS_DECLARED descriptor synthesizes a self-scoped attacksTrigger (issue #2399)", () => {
        const [ability] = resolveTokenTriggeredAbilities([
            {
                id: "test-attacks",
                oracleText:
                    "Whenever this token attacks, create a Treasure token.",
                event: "ATTACKERS_DECLARED",
                effects: [],
            },
        ]);
        expect(ability.id).toBe("test-attacks");
        expect(ability.event).toBe("ATTACKERS_DECLARED");
        const self = selfView();
        // CR 508.1m — one batch event carries every attacker, so self-scope is
        // a membership test: fires when the token is among them...
        expect(
            ability.matches(
                {
                    type: "ATTACKERS_DECLARED",
                    attackingPlayerId: "p1",
                    attackerIds: ["other", "self"],
                },
                self
            )
        ).toBe(true);
        // ...and NOT when only a sibling attacks (CR 109.2 — "this token").
        expect(
            ability.matches(
                {
                    type: "ATTACKERS_DECLARED",
                    attackingPlayerId: "p1",
                    attackerIds: ["other"],
                },
                self
            )
        ).toBe(false);
    });

    it("every TokenTriggeredEventKind has a factory — no kind falls through to the drop", () => {
        // The runtime mirror of the switch's compile-time exhaustiveness
        // guard: a kind added to the type AND to the switch, but wired to
        // nothing, would still return [] here.
        const kinds = Object.keys(
            TOKEN_TRIGGERED_EVENT_KINDS
        ) as TokenTriggeredEventKind[];
        for (const event of kinds) {
            const [ability] = resolveTokenTriggeredAbilities([
                { id: `k-${event}`, oracleText: "o", event, effects: [] },
            ]);
            expect(ability, `no factory for ${event}`).toBeDefined();
            expect(ability.event).toBe(event);
        }
        expect(kinds).toHaveLength(3);
    });

    it("multiple descriptors resolve independently, in order", () => {
        const abilities = resolveTokenTriggeredAbilities([
            {
                id: "a",
                oracleText: "a",
                event: "PERMANENT_ENTERED",
                effects: [],
            },
            { id: "b", oracleText: "b", event: "CREATURE_DIED", effects: [] },
        ]);
        expect(abilities.map((a) => a.id)).toEqual(["a", "b"]);
    });
});
