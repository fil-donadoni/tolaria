// SHM — green behaviour tests (ADR 0043 colour split). Prismatic Omen is the
// additive layer-4 sibling of Blood Moon's replacement: CR 205.1b's "in
// addition to their other types" and CR 305.7's closing sentence both say the
// land KEEPS its own land types and rules text, so this is `subtype-add`
// (Urborg's kind), scoped to the controller.

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { abilitiesSuppressed, hasManaAbility } from "../../../../gre/constants";
import { getProducibleManaOptions } from "../../../../gre/rules";
import {
    beginApplyingStaticEffects,
    stopApplyingStaticEffects,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition } from "../../../index";

const prismaticOmen = getDefinition("e75594cc-de47-49f2-9a8b-ba76c576368e");
const forest = getDefinition("6f1c8cb0-38eb-408b-94e8-16db83999b3b");
const tropicalIsland = getDefinition("a9c6c759-aabf-44e7-ba8c-33c5df232b56");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");

const ALL_BASICS = ["Plains", "Island", "Swamp", "Mountain", "Forest"];

/** Prismatic Omen and `mineCardId` under p1, `theirsCardId` under p2, statics
 *  applied. */
function withOmen(
    mineCardId: string = forest.id,
    theirsCardId: string = forest.id
): {
    state: GameState;
    omen: CardInstanceState;
    mine: CardInstanceState;
    theirs: CardInstanceState;
} {
    const omen = makeInstance(prismaticOmen.id, {
        id: "omen-1",
        controllerId: "p1",
        zone: "battlefield",
    });
    const mine = makeInstance(mineCardId, {
        id: "mine-1",
        controllerId: "p1",
        zone: "battlefield",
    });
    const theirs = makeInstance(theirsCardId, {
        id: "theirs-1",
        controllerId: "p2",
        zone: "battlefield",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [omen, mine] }),
            makePlayer("p2", { battlefield: [theirs] }),
        ],
    });
    beginApplyingStaticEffects(state, omen);
    return { state, omen, mine, theirs };
}

describe("Prismatic Omen ({1}{G} — CR 205.1b / 305.7 additive layer-4 land types)", () => {
    it("adds every basic land type to a land you control, KEEPING its own", () => {
        const { mine } = withOmen();
        for (const basic of ALL_BASICS) expect(mine.subtypes).toContain(basic);
        // Additive, not a replacement: the printed Forest is still there once.
        expect(mine.subtypes.filter((s) => s === "Forest")).toHaveLength(1);
    });

    it("keeps a nonbasic dual land's own types and its printed abilities", () => {
        const { mine } = withOmen(tropicalIsland.id);
        expect(mine.subtypes).toContain("Forest");
        expect(mine.subtypes).toContain("Island");
        for (const basic of ALL_BASICS) expect(mine.subtypes).toContain(basic);
        // CR 305.7's last sentence — a land that GAINS types keeps its rules
        // text, unlike the `subtype-set` family Blood Moon uses.
        expect(abilitiesSuppressed(mine)).toBe(false);
    });

    it("makes an affected land tap for all five colours — CR 305.6 intrinsic mana", () => {
        const { mine } = withOmen();
        expect(hasManaAbility(mine)).toBe(true);
        expect([...getProducibleManaOptions(mine).keys()].sort()).toEqual([
            "B",
            "G",
            "R",
            "U",
            "W",
        ]);
    });

    it("does NOT touch a land an opponent controls", () => {
        const { theirs } = withOmen();
        expect(theirs.subtypes).toEqual(["Forest"]);
        expect([...getProducibleManaOptions(theirs).keys()]).toEqual(["G"]);
    });

    it("does NOT touch a nonland permanent you control", () => {
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const omen = makeInstance(prismaticOmen.id, {
            id: "omen-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [omen, bears] }),
                makePlayer("p2"),
            ],
        });
        beginApplyingStaticEffects(state, omen);
        expect(bears.subtypes).toEqual(["Bear"]);
    });

    it("reverts cleanly when the Omen leaves the battlefield", () => {
        const { state, omen, mine } = withOmen();
        expect(mine.subtypes).toContain("Island");
        stopApplyingStaticEffects(state, omen);
        expect(mine.subtypes).toEqual(["Forest"]);
    });

    it("survives the wire projection — the client sees all five basic types", () => {
        const { state } = withOmen();
        const projected = projectPublicState(state, 1, "p1");
        const slimMine = projected.players[0].battlefield.find(
            (c) => c.id === "mine-1"
        )!;
        for (const basic of ALL_BASICS)
            expect(slimMine.subtypes).toContain(basic);
        expect([...getProducibleManaOptions(slimMine).keys()].sort()).toEqual([
            "B",
            "G",
            "R",
            "U",
            "W",
        ]);
    });
});
