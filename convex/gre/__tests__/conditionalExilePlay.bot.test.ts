// CR 611.2b (issue #7295) — Bot reachability for the conditional exile play
// permission: `enumerateMoves` offers the exiled card only while the grant's
// board condition holds (it asks `exileCastPermitted`, like every consumer).
import { describe, it, expect } from "vitest";
import { enumerateMoves } from "../moves";
import { resolved, wizard } from "./conditionalExilePlay.helper";

describe("conditional exile play permission — Bot seam (issue #7295)", () => {
    const casts = (state: ReturnType<typeof resolved>) =>
        enumerateMoves(state, "p1").filter(
            (m) => m.kind === "cast-spell" && m.cardInstanceId === "l1"
        );

    it("offers the cast only while the controller controls a Wizard", () => {
        const s = resolved();
        expect(casts(s)).toHaveLength(0);
        s.players[0].battlefield.push(wizard());
        expect(casts(s).length).toBeGreaterThan(0);
        s.players[0].battlefield = [];
        expect(casts(s)).toHaveLength(0);
    });
});
