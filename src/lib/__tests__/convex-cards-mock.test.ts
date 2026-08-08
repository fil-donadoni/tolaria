// Drift guard for the test-only mana-cost mock (issue #2339).
//
// `mockInstanceManaCost` stands in for the REAL `getInstanceManaCost`
// (`convex/cards/registry.ts`) inside the ~40 frontend suites that replace the
// whole `@convex/cards` barrel with a partial mock. A stand-in that silently
// disagrees with the thing it replaces is worse than no stand-in at all: every
// one of those suites would then be asserting against a cost resolution the
// product never performs. This file pins the two equal, branch by branch.
//
// The real function is imported UNMOCKED here on purpose — this is one of the
// src suites that loads the genuine catalogue.

import { describe, it, expect } from "vitest";
import { getAllCards, getInstanceManaCost } from "@convex/cards";
import { tryGetDefinition } from "@convex/cards";
import type { ManaCost } from "@convex/cards/types";
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "../testing/convex-cards-mock";

/** The lookup a faithful mock passes: its own `tryGetDefinition`. Here that is
 *  the real one, so both sides see the same catalogue. */
const lookup = (id: string) => tryGetDefinition(id);

/** A real catalogue card that actually has a printed cost, so the
 *  registry-fallback branch is exercised against real data rather than a
 *  fixture that could encode the same mistake on both sides. */
const printed = getAllCards().find(
    (c) => c.manaCost && Object.keys(c.manaCost).length > 0
)!;

const CASES: { name: string; instance: ManaCostSource }[] = [
    {
        name: "instance override wins — CR 707.2 'except it has no mana cost'",
        instance: { card: { id: printed.id }, manaCostOverride: {} },
    },
    {
        name: "instance override wins over an embedded fixture cost",
        instance: {
            card: { id: printed.id, manaCost: { R: 1 } },
            manaCostOverride: { B: 2 },
        },
    },
    {
        name: "embedded fixture cost beats the registry",
        instance: { card: { id: printed.id, manaCost: { G: 3 } } },
    },
    {
        name: "registry fallback for a real card id",
        instance: { card: { id: printed.id } },
    },
    {
        name: "unknown card id resolves to no cost",
        instance: { card: { id: "definitely-not-a-card" } },
    },
    {
        name: "no card id at all resolves to no cost",
        instance: { card: {} },
    },
];

describe("mockInstanceManaCost mirrors getInstanceManaCost (#2339)", () => {
    for (const { name, instance } of CASES) {
        it(name, () => {
            const real = getInstanceManaCost(instance);
            const mocked = mockInstanceManaCost(instance, lookup);
            expect(mocked).toEqual(real);
        });
    }

    it("the registry-fallback case is non-vacuous (the real card has a cost)", () => {
        expect(
            Object.keys(getInstanceManaCost({ card: { id: printed.id } }) ?? {})
                .length
        ).toBeGreaterThan(0);
    });

    it("a mock with no definition lookup resolves no cost from an id — matching a `tryGetDefinition: () => undefined` mock", () => {
        expect(
            mockInstanceManaCost({ card: { id: printed.id } })
        ).toBeUndefined();
        // …but the override and embedded branches still apply.
        const override: ManaCost = {};
        expect(
            mockInstanceManaCost({
                card: { id: printed.id },
                manaCostOverride: override,
            })
        ).toEqual({});
    });
});
