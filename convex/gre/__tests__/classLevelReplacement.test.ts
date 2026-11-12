// CR 716.2a / 614.1a — a replacement effect printed in a Class's level-3
// section applies only while the Class is level 3 or greater. The level must
// reach the `appliesTo` predicate through the replacement view
// (`buildPermanentView`), or every Class reads as level 1.
// Artist's Talent: noncombat damage a source you control deals to an opponent
// or a permanent an opponent controls is 2 greater.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { artistsTalent } from "../../cards/sets/blb/red.cards";
import { lightningBolt } from "../../cards/sets/lea/red.cards";
import { runDamageReplacement } from "../state";

function damageAt(
    classLevel: number | undefined,
    opts: { isCombat?: boolean; targetPlayer?: string } = {}
): number | undefined {
    const talent = makeInstance(artistsTalent().id, {
        controllerId: "p1",
        ...(classLevel !== undefined ? { classLevel } : {}),
    });
    const src = makeInstance(lightningBolt().id, { controllerId: "p1" });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [talent, src] }),
            makePlayer("p2"),
        ],
    });
    const out = runDamageReplacement(
        state,
        src.id,
        "p1",
        { type: "player", id: opts.targetPlayer ?? "p2" },
        3,
        opts.isCombat ?? false
    );
    return out?.amount;
}

describe("Class level-3 damage replacement (CR 716.2a, CR 614.1a)", () => {
    it("adds 2 to noncombat damage to an opponent at level 3", () => {
        expect(damageAt(3)).toBe(5);
    });
    it("does nothing at level 1 and level 2", () => {
        expect(damageAt(undefined)).toBe(3);
        expect(damageAt(2)).toBe(3);
    });
    it("leaves combat damage and damage to its controller alone", () => {
        expect(damageAt(3, { isCombat: true })).toBe(3);
        expect(damageAt(3, { targetPlayer: "p1" })).toBe(3);
    });
});
