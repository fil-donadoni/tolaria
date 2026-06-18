// Antiquities (ATQ) walking skeleton (#270) — per-card behavior tests (twin of
// arn.test.ts). The slice ships two vanilla keyword artifact creatures; the
// tests assert external behavior only (keyword presence on the definition and
// on the live/projected instance), per the PRD testing decisions.

import { describe, it, expect } from "vitest";
import { ornithopter, yotianSoldier } from "../atq";
import { getCardById } from "../..";
import { makeInstance, makePlayer, makeState } from "../../__tests__/setup";
import { isCreature } from "../../../gre/constants";
import { projectPublicState } from "../../../gameProjections";

// ---------------------------------------------------------------------------
// Registry wiring — the atq set must be resolvable from the card registry
// (acceptance criterion: "atq set is registered and resolvable").
// ---------------------------------------------------------------------------

describe("ATQ set registration", () => {
    it("Ornithopter resolves from the registry by id", () => {
        expect(getCardById(ornithopter.id).name).toBe("Ornithopter");
    });
    it("Yotian Soldier resolves from the registry by id", () => {
        expect(getCardById(yotianSoldier.id).name).toBe("Yotian Soldier");
    });
});

// ---------------------------------------------------------------------------
// Keyword artifact creatures (CR 702 — staticAbilities; CR 301 — artifact
// creatures are both Artifact and Creature).
// ---------------------------------------------------------------------------

describe("ATQ keyword artifact creatures (CR 702 — staticAbilities)", () => {
    it("Ornithopter is a 0/2 artifact creature with flying", () => {
        expect(ornithopter.types).toEqual(
            expect.arrayContaining(["Artifact", "Creature"])
        );
        expect(ornithopter.power).toBe(0);
        expect(ornithopter.toughness).toBe(2);
        expect(ornithopter.manaCost).toEqual({});
        expect(ornithopter.staticAbilities).toContain("flying");
    });

    it("Yotian Soldier is a 1/4 artifact creature with vigilance", () => {
        expect(yotianSoldier.types).toEqual(
            expect.arrayContaining(["Artifact", "Creature"])
        );
        expect(yotianSoldier.power).toBe(1);
        expect(yotianSoldier.toughness).toBe(4);
        expect(yotianSoldier.manaCost).toEqual({ X: 3 });
        expect(yotianSoldier.staticAbilities).toContain("vigilance");
    });
});

// ---------------------------------------------------------------------------
// Wire format — both cards must survive projectPublicState. The projection
// slims `card.card` to `{ id }`, so the engine must re-derive every
// characteristic from the registry by id. These tests prove the keyword and
// creature-ness survive the wire (catches fat-field reads stripped at
// projection).
// ---------------------------------------------------------------------------

describe("ATQ walking skeleton survives projection (wire format)", () => {
    it("Ornithopter keeps flying + creature-ness after projection", () => {
        const orni = makeInstance(ornithopter.id, { id: "orni" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [orni] }),
                makePlayer("p2"),
            ],
        });

        // GRE behavior on fat state.
        expect(isCreature(orni)).toBe(true);
        expect(orni.staticAbilities).toContain("flying");

        // Same behavior survives projection.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "orni")!;
        // The slim card carries only `{ id }`; the keyword rides the instance
        // and the definition is re-resolvable from the registry by that id.
        expect(slim.card.id).toBe(ornithopter.id);
        expect(slim.staticAbilities).toContain("flying");
        expect(getCardById(slim.card.id).staticAbilities).toContain("flying");
    });

    it("Yotian Soldier keeps vigilance + creature-ness after projection", () => {
        const yot = makeInstance(yotianSoldier.id, { id: "yot" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [yot] }),
                makePlayer("p2"),
            ],
        });

        expect(isCreature(yot)).toBe(true);
        expect(yot.staticAbilities).toContain("vigilance");

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "yot")!;
        expect(slim.card.id).toBe(yotianSoldier.id);
        expect(slim.staticAbilities).toContain("vigilance");
        expect(getCardById(slim.card.id).staticAbilities).toContain(
            "vigilance"
        );
    });
});
