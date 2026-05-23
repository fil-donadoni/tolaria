import { describe, expect, it } from "vitest";
import { matchesPermanentScope, type PermanentScope } from "../shared";
import type { CardType, PermanentView } from "../../../types";

function makeSelf(overrides: Partial<PermanentView> = {}): PermanentView {
    return {
        id: "self",
        controllerId: "p1",
        ownerId: "p1",
        types: ["Enchantment"] as CardType[],
        subtypes: [],
        isTapped: false,
        card: {},
        ...overrides,
    };
}

describe("matchesPermanentScope", () => {
    const self = makeSelf();
    const cases: Array<{
        scope: PermanentScope;
        permanentId: string;
        controllerId: string;
        expected: boolean;
    }> = [
        {
            scope: "self",
            permanentId: "self",
            controllerId: "p1",
            expected: true,
        },
        {
            scope: "self",
            permanentId: "other",
            controllerId: "p1",
            expected: false,
        },
        {
            scope: "yours",
            permanentId: "x",
            controllerId: "p1",
            expected: true,
        },
        {
            scope: "yours",
            permanentId: "x",
            controllerId: "p2",
            expected: false,
        },
        {
            scope: "opponents",
            permanentId: "x",
            controllerId: "p2",
            expected: true,
        },
        {
            scope: "opponents",
            permanentId: "x",
            controllerId: "p1",
            expected: false,
        },
        { scope: "any", permanentId: "x", controllerId: "p1", expected: true },
        { scope: "any", permanentId: "x", controllerId: "p2", expected: true },
        {
            scope: "another-yours",
            permanentId: "x",
            controllerId: "p1",
            expected: true,
        },
        {
            scope: "another-yours",
            permanentId: "self",
            controllerId: "p1",
            expected: false,
        },
        {
            scope: "another-yours",
            permanentId: "x",
            controllerId: "p2",
            expected: false,
        },
        {
            scope: "any-other",
            permanentId: "x",
            controllerId: "p2",
            expected: true,
        },
        {
            scope: "any-other",
            permanentId: "self",
            controllerId: "p1",
            expected: false,
        },
    ];

    for (const c of cases) {
        it(`${c.scope} on ${c.permanentId}/${c.controllerId} → ${c.expected}`, () => {
            expect(
                matchesPermanentScope(
                    c.scope,
                    {
                        permanentId: c.permanentId,
                        controllerId: c.controllerId,
                    },
                    self
                )
            ).toBe(c.expected);
        });
    }
});
