// Frontend wiring for a MULTI-permanent `sacrificeFilter` activation cost
// (CR 602.1 / 118.5 — `ActivatedAbility.cost.sacrificeFilterCount`, issue
// #2398, Bolas's Citadel's "Sacrifice ten nonland permanents").
//
// Before the count existed, `getStackAbilities`' sacrifice gate asked only
// "does SOME matching permanent exist" — correct for every one-permanent cost
// and fail-OPEN for a ten-permanent one: the ability would be offered with a
// single Bear on the board and the server would throw "No legal permanent to
// pay the sacrifice cost" on click. The catalogue sweep
// (`activation-affordability.catalogue.test.ts`) cannot cover this particular
// card — it skips any ability whose `sacrificeFilter` matches its OWN source,
// which Citadel's nonland filter does — so the gate needs this explicit test.
//
// Every assertion drives the SURFACE through the REAL reducer
// (`buildTriggerStateView`); a hand-built view would mask a dropped field.

import { describe, it, expect } from "vitest";
import type { CardDefinition } from "@convex/cards/types";
import { bolassCitadel } from "@convex/cards/sets/war/black";
import { grizzlyBears } from "@convex/cards/sets/lea";
import { mountain } from "@convex/cards/sets/lea/colorless";
import type { CardInstance } from "../../types/game";
import { buildTriggerStateView, getStackAbilities } from "../card-utils";

const VIEWER = "p1";
const DRAIN_ID = "bolass-citadel-drain";

function perm(
    id: string,
    def: CardDefinition,
    overrides: Partial<CardInstance> = {}
): CardInstance {
    return {
        id,
        card: { id: def.id },
        controllerId: VIEWER,
        ownerId: VIEWER,
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: def.types,
        subtypes: def.subtypes ?? [],
        staticAbilities: def.staticAbilities ?? [],
        power: def.power,
        toughness: def.toughness,
        ...overrides,
    };
}

/** A board with the Citadel plus `nonlands` Bears and `lands` Mountains. */
function board(nonlands: number, lands: number): CardInstance[] {
    const citadel = perm("citadel", bolassCitadel);
    const bears = Array.from({ length: nonlands }, (_, i) =>
        perm(`bear-${i}`, grizzlyBears)
    );
    const mountains = Array.from({ length: lands }, (_, i) =>
        perm(`mtn-${i}`, mountain)
    );
    return [citadel, ...bears, ...mountains];
}

function offeredAbilityIds(battlefield: CardInstance[]): string[] {
    const view = buildTriggerStateView(
        [
            { id: VIEWER, life: 20, hand: [], battlefield, graveyard: [] },
            { id: "p2", life: 20, hand: [], battlefield: [], graveyard: [] },
        ],
        VIEWER
    );
    const source = battlefield.find((c) => c.id === "citadel")!;
    return getStackAbilities(source, "PRECOMBAT_MAIN", true, view, 20).map(
        (a) => a.id
    );
}

describe("multi-permanent sacrifice cost affordability (CR 602.1 / 118.5)", () => {
    it("offers the drain with exactly ten nonland permanents (the Citadel itself counts)", () => {
        // Nine Bears + the Citadel = ten nonland permanents. CR 701.21 puts no
        // restriction on sacrificing the source of the ability being paid for.
        expect(offeredAbilityIds(board(9, 0))).toContain(DRAIN_ID);
    });

    it("hides the drain at nine nonland permanents", () => {
        expect(offeredAbilityIds(board(8, 0))).not.toContain(DRAIN_ID);
    });

    it("CR 205 — lands never make up the shortfall, however many are out", () => {
        expect(offeredAbilityIds(board(8, 12))).not.toContain(DRAIN_ID);
    });
});
