// Per-card test for tmp/black.ts. Reanimate's `moveZone` target-shape
// (graveyard-card source, `controller` override, `bind` + `ref.manaValue`)
// changes zones on an object whose source zone the canned smoke generator
// does not model — `effectScriptSmoke.test.ts` explicitly SKIPS it ("covered
// by the card's own per-card test"), so per
// `.claude/rules/gre-development.md` § DSL-first authoring this card earns a
// hand-written test, including the mandatory wire-format re-assertion (the
// reanimated creature and the life-loss are both client-visible).
import { describe, it, expect } from "vitest";
import { reanimate } from "..";
import { griselbrand } from "../../avr";
import { resolveTopOfStack } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";

describe("Reanimate (CR 400.7 reanimation under caster's control, CR 608.2h last-known mana value)", () => {
    it("returns a creature card from ANY graveyard under the caster's control; the caster loses life equal to its mana value", () => {
        const corpse = makeInstance(griselbrand.id, {
            id: "corpse",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { life: 20, graveyard: [corpse] }),
            ],
        });
        pushSpell(state, reanimate.id, "p1", [
            { type: "graveyard-card", id: "corpse", playerId: "p2" },
        ]);
        resolveTopOfStack(state);

        const reanimated = state.players[0].battlefield.find(
            (c) => c.id === "corpse"
        );
        expect(reanimated).toBeDefined();
        expect(reanimated!.controllerId).toBe("p1");
        expect(state.players[1].graveyard.some((c) => c.id === "corpse")).toBe(
            false
        );
        // Griselbrand is {4}{B}{B}{B}{B} — mana value 8 (CR 202.3).
        expect(state.players[0].life).toBe(12);

        // Wire format: the reanimated creature and the caster's life total
        // both cross projectPublicState unchanged (gameProjections.ts).
        const projected = projectPublicState(state, 1, "p1");
        const slimBattlefield = projected.players[0].battlefield;
        expect(slimBattlefield.some((c) => c.id === "corpse")).toBe(true);
        expect(projected.players[0].life).toBe(12);
    });
});
