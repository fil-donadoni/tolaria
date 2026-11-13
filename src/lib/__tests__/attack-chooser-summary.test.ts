// Issue #9500 — who the declare-attackers banner names while an attack
// target is chosen (CR 508.1b): the "Attack with all" walk's current
// attacker with its place and who comes next, or every clicked creature
// awaiting a target.
import { describe, it, expect } from "vitest";
import { summarizeAttackChooser } from "../attack-chooser-summary";
import type { CardInstance } from "~/types/game";

const BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // Grizzly Bears
const ANGEL = "f8ac5006-91bd-4803-93da-f87cf196dd2f"; // Serra Angel

const card = (id: string, def: string) =>
    ({
        id,
        card: { id: def },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        types: ["Creature"],
        subtypes: [],
    }) as unknown as CardInstance;

const field = [card("b1", BEARS), card("a1", ANGEL), card("b2", BEARS)];
const walk = (index: number) => ({
    active: true,
    order: ["b1", "a1", "b2"],
    index,
    awaiting: [],
});

describe("summarizeAttackChooser (issue #9500)", () => {
    it("names the walk's current attacker with its place and who comes next", () => {
        const s = summarizeAttackChooser(walk(1), field);
        expect(s?.names).toEqual(["Serra Angel"]);
        expect(s?.position).toBe(2);
        expect(s?.total).toBe(3);
        expect(s?.nextNames).toEqual(["Grizzly Bears"]);
        expect(s?.card.id).toBe("a1");
    });

    it("the last attacker has nobody after it", () => {
        expect(summarizeAttackChooser(walk(2), field)?.nextNames).toEqual([]);
    });

    it("clicked creatures awaiting a target are all named, with no place", () => {
        const s = summarizeAttackChooser(
            { active: false, order: [], index: 0, awaiting: ["b1", "a1"] },
            field
        );
        expect(s?.names).toEqual(["Grizzly Bears", "Serra Angel"]);
        expect(s?.position).toBeUndefined();
    });

    it("null when nobody chooses, or the chooser left the battlefield", () => {
        expect(
            summarizeAttackChooser(
                { active: false, order: [], index: 0, awaiting: [] },
                field
            )
        ).toBeNull();
        expect(summarizeAttackChooser(walk(0), [card("a1", ANGEL)])).toBeNull();
    });
});
