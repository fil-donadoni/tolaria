// CR 611.2b + CR 406.3 (issue #7295) — Flameshape's two Op gaps:
//   1. `grantCastFromExile.condition`: "you may play them if you control a
//      Wizard" is an ONGOING effect, re-read at every cast / play attempt.
//   2. `exileTopOfLibrary.faceDown`: "look at the top two cards … exile them
//      face down", known to the looking player alone.
// GRE (the gate across Wizard loss / regain, on the real payment path), wire
// format (the controller sees the cards and the Cast affordance, the opponent
// neither) and the serialize round-trip, all through the real Op pair.
import { describe, it, expect } from "vitest";
import { FACE_DOWN_CARD_ID } from "../../cards";
import { makeInstance } from "../../cards/__tests__/setup.helper";
import type { CardInstanceState, GameState } from "../state";
import { exileCastPermitted } from "../castCost";
import { findCastableExileCard } from "../activation";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import {
    HIT_ID,
    WIZARD_ID,
    resolved,
    wizard,
} from "./conditionalExilePlay.helper";

const exiled = (s: GameState, id: string): CardInstanceState =>
    s.players[0].exile.find((c) => c.id === id)!;
/** The REAL payment path's lookup (`announceCast` → `findCastableExileCard`). */
const cast = (s: GameState, id: string): boolean =>
    findCastableExileCard(s, "p1", id) !== undefined;

describe("exileTopOfLibrary faceDown (CR 406.3, issue #7295)", () => {
    it("exiles exactly the top N face down, known to the looking player alone", () => {
        const s = resolved();
        expect(s.players[0].exile.map((c) => c.id).sort()).toEqual([
            "l1",
            "l2",
        ]);
        expect(s.players[0].library.map((c) => c.id)).toEqual(["l3"]);
        for (const id of ["l1", "l2"]) {
            expect(exiled(s, id).knownTo).toEqual(["p1"]);
            expect(exiled(s, id).faceDownBy).toBe("face-down-exile");
        }
    });

    it("projects the real cards to the controller and the sentinel to the opponent", () => {
        const s = resolved();
        const mine = projectPublicState(s, 1, "p1").players.find(
            (p) => p.id === "p1"
        )!.exile as unknown as { card: { id: string } }[];
        const theirs = projectPublicState(s, 1, "p2").players.find(
            (p) => p.id === "p1"
        )!.exile as unknown as Record<string, unknown>[];
        expect(mine.map((c) => c.card.id)).toEqual([HIT_ID, HIT_ID]);
        expect(theirs.map((c) => (c.card as { id: string }).id)).toEqual([
            FACE_DOWN_CARD_ID,
            FACE_DOWN_CARD_ID,
        ]);
        // The gate itself is not for the opponent's eyes.
        for (const c of theirs) {
            expect(c.castableFromExileCondition).toBeUndefined();
            expect(c.legalActions).toBeUndefined();
        }
    });
});

describe("grantCastFromExile condition (CR 611.2b, issue #7295)", () => {
    it("stamps the condition on the exiled card and round-trips the wire format", () => {
        const s = resolved();
        expect(exiled(s, "l1").castableFromExileCondition).toEqual({
            kind: "control",
            filter: { subtype: "Wizard" },
        });
        const back = expandState(compactState(s));
        expect(
            back.players[0].exile.find((c) => c.id === "l1")!
                .castableFromExileCondition
        ).toEqual({ kind: "control", filter: { subtype: "Wizard" } });
    });

    it("is live only while the controller controls a Wizard — lost and regained", () => {
        const s = resolved();
        const p1 = s.players[0];
        // No Wizard at resolution: the grant exists but the permission is off.
        expect(exileCastPermitted(s, exiled(s, "l1"), "p1")).toBe(false);
        expect(cast(s, "l1")).toBe(false);

        p1.battlefield.push(wizard());
        expect(exileCastPermitted(s, exiled(s, "l1"), "p1")).toBe(true);
        expect(cast(s, "l1")).toBe(true);

        // The Wizard dies: the SAME card, untouched, is no longer castable.
        p1.battlefield = p1.battlefield.filter((c) => c.id !== "wiz");
        expect(cast(s, "l1")).toBe(false);

        // A Wizard returns: the permission is back.
        p1.battlefield.push(wizard());
        expect(cast(s, "l1")).toBe(true);
    });

    it("a Wizard the OPPONENT controls does not satisfy it", () => {
        const s = resolved();
        s.players[1].battlefield.push(
            makeInstance(WIZARD_ID, {
                id: "oppwiz",
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        expect(cast(s, "l1")).toBe(false);
    });

    it("the Cast affordance reaches the controller's projection only while it holds", () => {
        const s = resolved();
        const legal = (st: GameState): unknown =>
            (
                projectPublicState(st, 1, "p1").players.find(
                    (p) => p.id === "p1"
                )!.exile as unknown as { legalActions?: string[] }[]
            )[0].legalActions;
        expect(legal(s) ?? []).not.toContain("cast");
        s.players[0].battlefield.push(wizard());
        expect(legal(s)).toContain("cast");
    });
});
