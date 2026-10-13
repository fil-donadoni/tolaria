// Shroud as a static clause (CR 702.18, issue #4570) — two frames:
//
//   "You have shroud."                              → player-scoped guard
//   "Other <descriptor> you control have shroud."  → keyword grant that
//                                                     excludes its own source
//
//  1. GOLDEN — Ivory Mask and Sterling Grove's static line compiled whole.
//  2. REFUSALS — other holders and other keywords stay unparsed.
//  3. BEHAVIOUR — the guard reaches the real `playerHasShroud` through the
//     registry seam AND through `projectPublicState` (the wire format); the
//     grant's predicate excludes the source and the other controller's
//     permanents.

import { describe, expect, it } from "vitest";
import {
    resolveCompiledStatic,
    type CompiledStaticEffect,
} from "../../cards/compiledStatics";
import { withTemporaryDefinition } from "../../cards/registry";
import type {
    CardDefinition,
    PermanentView,
    StaticEffectContext,
} from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { projectPublicState } from "../../gameProjections";
import { playerHasShroud } from "../../gre/permanentGuard";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { staticSlot } from "../grammar/slots/staticSlot";
import { oracleCard, parseContext } from "./oracle.fixture";

const IVORY_MASK = oracleCard({
    oracleId: "028bc726-0e86-4c53-9648-625153ae4b01",
    name: "Ivory Mask",
    manaCost: "{2}{W}{W}",
    typeLine: "Enchantment",
    oracleText:
        "You have shroud. (You can't be the target of spells or abilities.)",
    power: undefined,
    toughness: undefined,
});

function clause(line: string): unknown {
    const parsed = staticSlot.run(line, parseContext());
    expect(parsed.ok, `expected "${line}" to parse`).toBe(true);
    if (!parsed.ok || parsed.value.kind !== "static")
        throw new Error("not a static clause");
    return parsed.value.clause;
}

describe("You have shroud — golden fixture (CR 702.18b)", () => {
    it("Ivory Mask: a player-scoped guard", () => {
        const outcome = compileCard(IVORY_MASK);
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Ivory Mask",
                types: ["Enchantment"],
                manaCost: { X: 2, W: 2 },
                oracleText:
                    "You have shroud. (You can't be the target of spells or abilities.)",
                compiledStaticEffects: [
                    {
                        kind: "player-guard",
                        id: "ivory-mask-player-shroud",
                        cantBeTargeted: true,
                    },
                ],
            })
        );
    });
});

describe("Other … have shroud — golden fixture (CR 702.18, CR 201.5)", () => {
    it("reads 'Other' as the source's own exclusion", () => {
        expect(
            clause("Other enchantments you control have shroud.")
        ).toMatchObject({
            kind: "keyword-grant",
            filter: {
                types: ["Enchantment"],
                controllerRelation: "you",
                excludeSource: true,
            },
            keyword: { ability: "shroud" },
        });
    });

    it("Kobold Overlord: the same 'Other' on a creature lord (the class, not the card)", () => {
        expect(
            clause("Other Kobold creatures you control have first strike.")
        ).toMatchObject({
            kind: "keyword-grant",
            filter: {
                types: ["Creature"],
                subtypes: ["Kobold"],
                controllerRelation: "you",
                excludeSource: true,
            },
            keyword: { ability: "first strike" },
        });
    });

    it("without 'Other' the source is NOT excluded", () => {
        const read = clause("Enchantments you control have shroud.") as {
            filter: Record<string, unknown>;
        };
        expect(read.filter.excludeSource).toBeUndefined();
    });
});

describe("shroud statics — refusals (fail-closed neighbours)", () => {
    const refused = [
        // Another holder.
        "Players have shroud.",
        "Your opponents have shroud.",
        "Target player has shroud.",
        // Another keyword on the player frame: hexproof is controller-relative.
        "You have hexproof.",
        // "Other" on a singular subject names no set.
        "Other enchantment you control has shroud.",
        // The word in the wrong place.
        "Enchantments you control other have shroud.",
    ];
    for (const line of refused)
        it(`refuses "${line}"`, () => {
            expect(staticSlot.run(line, parseContext()).ok).toBe(false);
        });
});

describe("a compiled player guard in the real engine (CR 702.18b)", () => {
    const MASK_ID = "compiled-ivory-mask-4570";

    function withMask<T>(fn: () => T): T {
        const outcome = compileCard(IVORY_MASK);
        if (outcome.state !== "ready") throw new Error(outcome.state);
        const definition: CardDefinition = {
            ...outcome.definition,
            id: MASK_ID,
            rarity: "uncommon",
        };
        return withTemporaryDefinition(definition, fn);
    }

    function board(withPermanent: boolean) {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: withPermanent
                        ? [
                              makeInstance(MASK_ID, {
                                  id: "mask",
                                  controllerId: "p1",
                                  ownerId: "p1",
                              }),
                          ]
                        : [],
                }),
                makePlayer("p2"),
            ],
        });
    }

    it("the controller has shroud and the opponent does not", () => {
        withMask(() => {
            const state = board(true);
            expect(playerHasShroud(state, "p1")).toBe(true);
            expect(playerHasShroud(state, "p2")).toBe(false);
        });
    });

    it("control: without the permanent nobody has shroud", () => {
        withMask(() => {
            expect(playerHasShroud(board(false), "p1")).toBe(false);
        });
    });

    it("wire format: the guard survives projectPublicState", () => {
        withMask(() => {
            const projected = projectPublicState(
                board(true),
                1,
                "p2"
            ) as unknown as ReturnType<typeof board>;
            expect(playerHasShroud(projected, "p1")).toBe(true);
            expect(playerHasShroud(projected, "p2")).toBe(false);
        });
    });
});

describe("a compiled 'Other … have shroud' grant (CR 201.5)", () => {
    const context: StaticEffectContext = {
        getColors: () => [],
        isCreature: (card) => card.types.includes("Creature"),
        hasSubtype: (card, subtype) => card.subtypes.includes(subtype),
        hasSupertype: () => false,
        getManaValue: () => 0,
        getPrintedTypes: (card) => [...card.types],
        getName: () => "",
        hasChosenName: () => false,
        getCounterCount: () => 0,
    };

    function view(
        over: Partial<PermanentView> & { id: string }
    ): PermanentView {
        return {
            controllerId: "p1",
            ownerId: "p1",
            types: ["Enchantment"],
            subtypes: [],
            isTapped: false,
            card: {},
            ...over,
        };
    }

    const grant: CompiledStaticEffect = {
        kind: "keyword-grant",
        filter: {
            types: ["Enchantment"],
            controllerRelation: "you",
            excludeSource: true,
        },
        keyword: "shroud",
    };

    it("grants to the controller's other enchantments, never the source", () => {
        const resolved = resolveCompiledStatic(grant);
        if (resolved.kind !== "keyword-grant") throw new Error("wrong kind");
        const source = view({ id: "grove" });
        expect(resolved.applies(view({ id: "other" }), source, context)).toBe(
            true
        );
        // The "Other" is what fails here when `excludeSource` is dropped.
        expect(resolved.applies(source, source, context)).toBe(false);
        expect(
            resolved.applies(
                view({ id: "theirs", controllerId: "p2" }),
                source,
                context
            )
        ).toBe(false);
        expect(
            resolved.applies(
                view({ id: "land", types: ["Land"] }),
                source,
                context
            )
        ).toBe(false);
    });
});
