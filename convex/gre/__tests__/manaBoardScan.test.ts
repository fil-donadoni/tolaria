// `scanManaBoard` / `declaresTapManaBonus` (issue #7994): a mana census asks its
// whole-board questions once instead of once per source. The scan is only worth
// having if a `false` is a PROOF, so each case here runs the real census over a
// board where the answer changes what a source produces — CR 602.5 (a static
// prohibits the mana ability), CR 614 (a replacement changes what a land taps
// for), CR 605.4 (a triggered mana ability adds to the tap).

import { describe, expect, it } from "vitest";
import { makeInstance, makePlayer } from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards";
import { scanManaBoard } from "../constants";
import { boardManaCensus } from "../manaAvailability";
import { declaresTapManaBonus } from "../tapManaBonus";
import type { CardInstanceState } from "../state";

function perm(
    name: string,
    id: string,
    owner: string,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(getCardByName(name).id, {
        id,
        controllerId: owner,
        ownerId: owner,
        isSummoningSick: false,
        ...overrides,
    });
}

/** Both battlefields, the view a census reads through `opts.battlefields`. */
function boards(
    mine: CardInstanceState[],
    theirs: CardInstanceState[] = []
): { playerId: string; battlefield: CardInstanceState[] }[] {
    return [
        makePlayer("p1", { battlefield: mine }),
        makePlayer("p2", { battlefield: theirs }),
    ].map((p) => ({ playerId: p.id, battlefield: p.battlefield }));
}

/** The units p1's board can pay with right now, as sorted colour strings. */
function nowUnits(view: ReturnType<typeof boards>): string[] {
    return boardManaCensus(view[0].battlefield, {
        controllerId: "p1",
        battlefields: view,
    })
        .now.map((unit) => [...unit].sort().join(""))
        .sort();
}

describe("scanManaBoard", () => {
    it("clears both facts on a board that declares neither", () => {
        expect(
            scanManaBoard(
                boards([perm("Forest", "f", "p1")], [perm("Island", "i", "p2")])
            )
        ).toEqual({ activationRestricted: false, landManaSubstituted: false });
    });

    it("finds a restriction and a substitution on EITHER battlefield", () => {
        const scan = scanManaBoard(
            boards(
                [perm("Forest", "f", "p1")],
                [
                    perm("Cursed Totem", "totem", "p2"),
                    perm("Infernal Darkness", "dark", "p2"),
                ]
            )
        );
        expect(scan).toEqual({
            activationRestricted: true,
            landManaSubstituted: true,
        });
    });
});

describe("boardManaCensus reads through the scan", () => {
    it("CR 602.5 — an opponent's restriction still takes the creature's mana", () => {
        const elves = () => perm("Llanowar Elves", "elves", "p1");
        expect(nowUnits(boards([elves()]))).toEqual(["G"]);
        expect(
            nowUnits(boards([elves()], [perm("Cursed Totem", "totem", "p2")]))
        ).toEqual([]);
    });

    it("CR 614 — an opponent's substitution still changes what a land taps for", () => {
        const forest = () => perm("Forest", "f", "p1");
        expect(nowUnits(boards([forest()]))).toEqual(["G"]);
        expect(
            nowUnits(
                boards([forest()], [perm("Infernal Darkness", "dark", "p2")])
            )
        ).toEqual(["B"]);
    });

    it("CR 605.4 — a tap bonus on the seat's own board still adds its unit", () => {
        const forest = () => perm("Forest", "f", "p1");
        const growth = perm("Wild Growth", "growth", "p1", {
            attachedTo: "f",
        });
        expect(declaresTapManaBonus([forest()])).toBe(false);
        expect(declaresTapManaBonus([forest(), growth])).toBe(true);
        expect(nowUnits(boards([forest(), growth]))).toEqual(["G", "G"]);
    });
});
