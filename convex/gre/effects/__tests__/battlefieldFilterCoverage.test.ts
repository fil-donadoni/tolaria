// Every `EffectCardFilter` field is either READ by the battlefield matcher
// (`toPermanentFilter` → `PermanentFilter`) or REJECTED by the validator at a
// battlefield-guaranteed site. A field that is neither validates cleanly and
// then matches every permanent (fail OPEN).
//
//  1. COVERAGE — a `Record` over `keyof EffectCardFilter`: a new field is a
//     compile error until it is classified here.
//  2. BATTLEFIELD — `manaValueEquals` / `manaValueAtMost` / `excludeColor`
//     narrow the legal picks of a battlefield `choice` (CR 202.3, CR 105.2).
//  3. VALIDATOR — every hidden-zone-only field is refused at a battlefield
//     `choice` and still admitted on a hand `choice`.
//  4. HAND READER — `handCardMatchesFilter` honours the same three fields plus
//     `excludeSupertype` (the alt-cost / discard-cost leg).

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../../cards";
import { withTemporaryDefinition } from "../../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup.helper";
import type {
    CardDefinition,
    EffectCardFilter,
    EffectOp,
} from "../../../cards/types";
import { handCardMatchesFilter } from "../../alternativeCost";
import { applyPendingChoiceSubmit } from "../../pendingChoiceSubmit";
import { resolveTopOfStack } from "../../state";
import { validateEffectScript } from "../validate";

type Coverage = "battlefield" | "hidden-zone-only";

const COVERAGE: Record<keyof EffectCardFilter, Coverage> = {
    type: "battlefield",
    excludeType: "battlefield",
    subtype: "battlefield",
    excludeSubtype: "battlefield",
    sharesCreatureTypeWith: "battlefield",
    supertype: "battlefield",
    excludeSupertype: "battlefield",
    color: "battlefield",
    excludeColor: "battlefield",
    colorCountAtLeast: "battlefield",
    manaValueAtMost: "battlefield",
    manaValueEquals: "battlefield",
    manaCostEquals: "hidden-zone-only",
    hasFlashback: "hidden-zone-only",
    hasCounter: "hidden-zone-only",
    isToken: "battlefield",
    enteredThisTurn: "battlefield",
    controlledSinceTurnStart: "battlefield",
    name: "battlefield",
    hasAbility: "battlefield",
    excludeAbility: "battlefield",
    isAttacking: "battlefield",
    tapped: "battlefield",
    excludeSource: "battlefield",
    any: "battlefield",
};

function card(
    id: string,
    manaValue: number,
    color: string,
    types = ["Creature"]
) {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { [color]: manaValue },
        types,
        power: 1,
        toughness: 1,
    } as CardDefinition);
    return id;
}

const RED_TWO = card("t1904-red-two", 2, "R");
const WHITE_TWO = card("t1904-white-two", 2, "W");
const GREEN_FOUR = card("t1904-green-four", 4, "G");

const held = (owner: string, defId: string, id: string) =>
    makeInstance(defId, { id, controllerId: owner, ownerId: owner });

/** Resolve a spell whose single Op is a battlefield `choice` on p2's side and
 *  return which of p2's permanents the submit validator accepts as the pick. */
function candidates(filter: Record<string, unknown>): string[] {
    const script = [
        {
            op: "choice",
            kind: "sacrifice-permanents",
            player: "opponent",
            zone: "battlefield",
            filter,
            count: 1,
            prompt: "Sacrifice one.",
            bind: "$picked",
        },
    ] as unknown as readonly EffectOp[];
    const id = "t1904-spell";
    const definition = {
        id,
        name: id,
        rarity: "common",
        manaCost: { B: 1 },
        types: ["Sorcery"],
        effects: script,
    } as unknown as CardDefinition;
    return withTemporaryDefinition(definition, () => {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [
                        held("p2", RED_TWO, "red2"),
                        held("p2", WHITE_TWO, "white2"),
                        held("p2", GREEN_FOUR, "green4"),
                    ],
                }),
            ],
        });
        pushSpell(state, id, "p1");
        resolveTopOfStack(state);
        // The pick is legal iff the submit validator accepts it; a candidate
        // outside the filter is refused. Each id is tried on its own copy.
        // No eligible permanent: the engine raises no pick at all.
        const head = state.pendingChoices?.[0];
        if (!head) return [];
        return ["red2", "white2", "green4"]
            .filter((pick) => {
                try {
                    applyPendingChoiceSubmit(structuredClone(state), {
                        playerId: "p2",
                        stackItemId: head.stackItemId,
                        step: head.step,
                        choiceId: head.choiceId,
                        cardInstanceIds: [pick],
                    });
                    return true;
                } catch {
                    return false;
                }
            })
            .sort();
    });
}

describe("EffectCardFilter on a battlefield choice (CR 202.3, CR 105.2)", () => {
    it("manaValueEquals offers only permanents of exactly that mana value", () => {
        expect(candidates({})).toEqual(["green4", "red2", "white2"]);
        expect(candidates({ manaValueEquals: 2 })).toEqual(["red2", "white2"]);
        expect(candidates({ manaValueEquals: 4 })).toEqual(["green4"]);
    });

    it("manaValueAtMost offers only permanents at or under the ceiling", () => {
        expect(candidates({ manaValueAtMost: 2 })).toEqual(["red2", "white2"]);
    });

    it("excludeColor leaves out permanents of that colour (nonwhite)", () => {
        expect(candidates({ excludeColor: "W" })).toEqual(["green4", "red2"]);
        expect(candidates({ excludeColor: ["W", "R"] })).toEqual(["green4"]);
    });

    it("an unresolvable dynamic mana value matches nothing, never everything", () => {
        expect(candidates({ manaValueEquals: { X: true } })).toEqual([]);
    });
});

describe("hidden-zone-only fields are refused on a battlefield choice", () => {
    const sample: Partial<Record<keyof EffectCardFilter, unknown>> = {
        manaCostEquals: { R: 1 },
        hasFlashback: true,
        hasCounter: { type: "void" },
    };
    const choiceOn = (zone: string, filter: Record<string, unknown>) => ({
        id: "t1904-host",
        name: "Host",
        effects: [
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone,
                filter,
                count: 1,
                prompt: "Pick.",
                bind: "$picked",
            },
        ] as never,
    });

    for (const [field, coverage] of Object.entries(COVERAGE)) {
        if (coverage !== "hidden-zone-only") continue;
        it(`${field}: rejected on battlefield`, () => {
            const filter = { [field]: sample[field as keyof EffectCardFilter] };
            expect(
                validateEffectScript(choiceOn("battlefield", filter)).length
            ).toBeGreaterThan(0);
            expect(validateEffectScript(choiceOn("exile", filter))).toEqual([]);
        });
    }
});

describe("handCardMatchesFilter reads the same fields (CR 202.3, CR 105.2, CR 205.4)", () => {
    const BASIC = card("t1904-basic", 0, "G", ["Land"]);
    const inHand = (defId: string) => ({ card: { id: defId } });

    it("manaValueEquals", () => {
        expect(
            handCardMatchesFilter(inHand(RED_TWO), { manaValueEquals: 2 })
        ).toBe(true);
        expect(
            handCardMatchesFilter(inHand(GREEN_FOUR), { manaValueEquals: 2 })
        ).toBe(false);
        expect(
            handCardMatchesFilter(inHand(RED_TWO), {
                manaValueEquals: { X: true },
            })
        ).toBe(false);
    });

    it("excludeColor", () => {
        expect(
            handCardMatchesFilter(inHand(WHITE_TWO), { excludeColor: "W" })
        ).toBe(false);
        expect(
            handCardMatchesFilter(inHand(RED_TWO), { excludeColor: "W" })
        ).toBe(true);
    });

    it("excludeSupertype", () => {
        registerTokenDefinition({
            id: "t1904-snow",
            name: "t1904-snow",
            rarity: "common",
            types: ["Land"],
            supertypes: ["Basic"],
        } as CardDefinition);
        expect(
            handCardMatchesFilter(inHand("t1904-snow"), {
                excludeSupertype: "Basic",
            })
        ).toBe(false);
        expect(
            handCardMatchesFilter(inHand(BASIC), { excludeSupertype: "Basic" })
        ).toBe(true);
    });
});
