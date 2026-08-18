// `attacksTrigger` — CR 508.1m ("Any abilities that trigger on attackers
// being declared trigger") scope semantics, issue #2399.
//
// The whole reason this factory exists rather than another inline `matches`:
// `ATTACKERS_DECLARED` is BATCH-shaped (one event per declaration carrying
// every attacker in `attackerIds`), so "whenever THIS creature attacks" is a
// membership test on a list, not the single-affected-permanent shape
// `matchesPermanentScope` is normally handed. These tests pin the per-attacker
// scope resolution — including the two directions a self-scoped token trigger
// can get wrong (firing on a sibling's attack; not firing when the source is
// one of several attackers).

import { describe, it, expect } from "vitest";
import { attacksTrigger } from "../attacksTrigger";
import type {
    AttackersDeclaredEvent,
    PermanentView,
    SpellContext,
} from "../../../types";

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

const declared = (
    attackerIds: string[],
    attackingPlayerId = "p1"
): AttackersDeclaredEvent => ({
    type: "ATTACKERS_DECLARED",
    attackingPlayerId,
    attackerIds,
});

const build = (scope: Parameters<typeof attacksTrigger>[0]["scope"]) =>
    attacksTrigger({
        id: "t",
        oracleText: "Whenever this creature attacks, do a thing.",
        scope,
        effects: [],
    });

describe("attacksTrigger (CR 508.1m / 109.2)", () => {
    it("builds an ATTACKERS_DECLARED ability and passes the script through", () => {
        const ability = attacksTrigger({
            id: "t",
            oracleText: "o",
            scope: "self",
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
        });
        expect(ability.event).toBe("ATTACKERS_DECLARED");
        expect(ability.effects).toHaveLength(1);
        expect(ability.resolve).toBeUndefined();
    });

    it("throws when neither effects nor resolve is given", () => {
        expect(() =>
            attacksTrigger({ id: "t", oracleText: "o", scope: "self" })
        ).toThrow(/effects\[\] or resolve/);
    });

    it("ignores every other event type", () => {
        const ability = build("self");
        expect(
            ability.matches(
                {
                    type: "PERMANENT_ENTERED",
                    instanceId: "self",
                    controllerId: "p1",
                    types: ["Creature"],
                },
                selfView()
            )
        ).toBe(false);
    });

    it("SELF — fires when the source is among the attackers, not otherwise", () => {
        const ability = build("self");
        const self = selfView();
        expect(ability.matches(declared(["self"]), self)).toBe(true);
        // The load-bearing case for a token-carried trigger: the source is one
        // of SEVERAL attackers in the one batch event.
        expect(ability.matches(declared(["other", "self"]), self)).toBe(true);
        // ...and the mirror: a sibling attacking alone must NOT fire it.
        expect(ability.matches(declared(["other"]), self)).toBe(false);
        expect(ability.matches(declared([]), self)).toBe(false);
    });

    it("YOURS / ANOTHER-YOURS / ANY-OTHER read the batch's attacking player as each attacker's controller (CR 508.1a)", () => {
        const self = selfView();
        // Every declared attacker is controlled by the active player, so the
        // batch's `attackingPlayerId` IS the per-attacker controller.
        expect(build("yours").matches(declared(["other"], "p1"), self)).toBe(
            true
        );
        expect(build("yours").matches(declared(["other"], "p2"), self)).toBe(
            false
        );
        expect(
            build("another-yours").matches(declared(["self"], "p1"), self)
        ).toBe(false);
        expect(
            build("another-yours").matches(
                declared(["self", "other"], "p1"),
                self
            )
        ).toBe(true);
        expect(build("any-other").matches(declared(["self"], "p1"), self)).toBe(
            false
        );
        expect(
            build("opponents").matches(declared(["other"], "p2"), self)
        ).toBe(true);
        expect(build("any").matches(declared(["other"], "p2"), self)).toBe(
            true
        );
    });

    it("condition gates after scope, and stamps an undecidable trigger gate (CR 603.4)", () => {
        const ability = attacksTrigger({
            id: "t",
            oracleText: "o",
            scope: "self",
            condition: (event) => event.attackerIds.length === 1,
            effects: [],
        });
        const self = selfView();
        expect(ability.matches(declared(["self"]), self)).toBe(true);
        expect(ability.matches(declared(["self", "other"]), self)).toBe(false);
        expect(ability.gate).toBeDefined();
    });

    it("interveningIf is narrowed to ATTACKERS_DECLARED (CR 603.4)", () => {
        const ability = attacksTrigger({
            id: "t",
            oracleText: "o",
            scope: "self",
            interveningIf: () => true,
            effects: [],
        });
        const self = selfView();
        expect(ability.interveningIf!(declared(["self"]), self)).toBe(true);
        expect(
            ability.interveningIf!(
                {
                    type: "PERMANENT_ENTERED",
                    instanceId: "self",
                    controllerId: "p1",
                    types: ["Creature"],
                },
                self
            )
        ).toBe(false);
    });

    it("the resolve payload carries the whole declaration", () => {
        let seen: { attackingPlayerId: string; attackerIds: string[] } | null =
            null;
        const ability = attacksTrigger({
            id: "t",
            oracleText: "o",
            scope: "self",
            resolve: (_ctx, _event, declaration) => {
                seen = {
                    attackingPlayerId: declaration.attackingPlayerId,
                    attackerIds: [...declaration.attackerIds],
                };
            },
        });
        ability.resolve!({} as SpellContext, declared(["self", "other"]));
        expect(seen).toEqual({
            attackingPlayerId: "p1",
            attackerIds: ["self", "other"],
        });
    });
});
