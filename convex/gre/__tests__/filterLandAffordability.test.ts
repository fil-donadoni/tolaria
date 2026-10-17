// Issue #5444 — a filter land ("{1}, {T}: Add {W}{U}") is a Mana Ability
// (CR 605.1a): it consumes {1} from ANOTHER source and yields its FULL output.
// The affordability census used to net the {1} out by trimming the END of the
// produced list, which dropped {U} and still counted the funder's own mana.

import { describe, expect, it } from "vitest";
import { getLegalActions } from "../rules";
import { boardManaUnits } from "../manaAvailability";
import { buildAutoTapSources, solveAutoTap } from "../autoTap";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { mountain, plains } from "../../cards/sets/lea/index.cards";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";

const FILTER_ID = "test:filter-land-wu";
const filterLand: CardDefinition = {
    id: FILTER_ID,
    rarity: "common",
    name: "Filter Land WU (test probe)",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "filter-land-wu-mana",
            oracleText: "{1}, {T}: Add {W}{U}.",
            cost: { tap: true, mana: { X: 1 } },
            useStack: false,
            effect: (ctx) => ctx.addMana({ W: 1, U: 1 }),
            manaProduced: { W: 1, U: 1 },
        },
    ],
};
registerTokenDefinition(filterLand);

const BLUE_SPELL_ID = "test:blue-spell-1u";
const blueSpell: CardDefinition = {
    id: BLUE_SPELL_ID,
    rarity: "common",
    name: "Blue Spell {1}{U} (test probe)",
    types: ["Creature"],
    manaCost: { X: 1, U: 1 },
    power: 1,
    toughness: 1,
};
registerTokenDefinition(blueSpell);

function onBattlefield(defId: string, id: string) {
    return makeInstance(defId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
    });
}

function stateWith(battlefield: ReturnType<typeof onBattlefield>[]) {
    const spell = makeInstance(BLUE_SPELL_ID, {
        controllerId: "p1",
        zone: "hand",
    });
    const player = makePlayer("p1", {
        hand: [spell],
        battlefield,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    });
    const state = makeState({ players: [player] });
    state.activePlayerId = "p1";
    state.priorityPlayerId = "p1";
    state.phase = "PRECOMBAT_MAIN";
    return { state, player, spell };
}

describe("filter land affordability (issue #5444, CR 605.1a)", () => {
    it("[filter land, Mountain] offers cast on {1}{U} with no manual activation", () => {
        const { state, player, spell } = stateWith([
            onBattlefield(FILTER_ID, "filter"),
            onBattlefield(mountain().id, "mountain"),
        ]);
        expect(getLegalActions(state, player, spell)).toContain("cast");
    });

    it("the pair yields exactly {W}{U}, not {R}{W}", () => {
        const { player } = stateWith([
            onBattlefield(FILTER_ID, "filter"),
            onBattlefield(mountain().id, "mountain"),
        ]);
        const units = boardManaUnits(player.battlefield);
        expect(units.map((u) => [...u].sort().join(""))).toEqual(["W", "U"]);
    });

    it("a lone filter land contributes nothing and cannot cast", () => {
        const { state, player, spell } = stateWith([
            onBattlefield(FILTER_ID, "filter"),
        ]);
        expect(boardManaUnits(player.battlefield)).toEqual([]);
        expect(getLegalActions(state, player, spell)).not.toContain("cast");
    });

    it("[filter land, Plains] cannot cast {U}{U}-class demand beyond one U", () => {
        const { player } = stateWith([
            onBattlefield(FILTER_ID, "filter"),
            onBattlefield(plains().id, "plains"),
        ]);
        const blue = boardManaUnits(player.battlefield).filter((u) =>
            u.has("U")
        );
        expect(blue).toHaveLength(1);
    });

    it("Auto-Tap pays {1}{U} through the filter land and its funder in one plan", () => {
        const { player } = stateWith([
            onBattlefield(FILTER_ID, "filter"),
            onBattlefield(mountain().id, "mountain"),
        ]);
        const sources = buildAutoTapSources(player.battlefield);
        const plan = solveAutoTap({}, { X: 1, U: 1 }, [], sources);
        expect(plan).not.toBeNull();
        expect(plan!.map((t) => t.cardId).sort()).toEqual([
            "filter",
            "mountain",
        ]);
    });

    it("Auto-Tap refuses a lone filter land", () => {
        const { player } = stateWith([onBattlefield(FILTER_ID, "filter")]);
        const sources = buildAutoTapSources(player.battlefield);
        expect(solveAutoTap({}, { U: 1 }, [], sources)).toBeNull();
    });
});
