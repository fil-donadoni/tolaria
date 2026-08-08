// Per-card test for tmp/black.ts. Reanimate's `moveZone` target-shape
// (graveyard-card source, `controller` override, `bind` + `ref.manaValue`)
// changes zones on an object whose source zone the canned smoke generator
// does not model — `effectScriptSmoke.test.ts` explicitly SKIPS it ("covered
// by the card's own per-card test"), so per
// `.claude/rules/gre-development.md` § DSL-first authoring this card earns a
// hand-written test, including the mandatory wire-format re-assertion (the
// reanimated creature and the life-loss are both client-visible).
import { describe, it, expect } from "vitest";
import { corpseDance, reanimate, recklessSpite } from "..";
import { griselbrand } from "../../avr";
import { resolveTopOfStack } from "../../../../gre/state";
import { fireDelayedTriggers } from "../../../../gre/phases";
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

// Corpse Dance (issue #1967) — the FIRST shipped Buyback card (CR 702.27,
// plumbing from issue #1200) and one of the two consumers of the
// deterministic top-of-graveyard selector (`moveZone`'s positional shape, CR
// 404.3). The smoke sweep SKIPS it ("Op moveZone changes zones on an
// object/zone the canned generator does not model"), so it earns a
// hand-written test: the ORDERING contract (the top = most recently added
// creature card comes back, and a non-creature on top is scanned past), the
// haste grant, the next-end-step exile, the buyback redirect, and the
// mandatory wire-format re-assertion (the reanimated creature is
// board-visible).
describe("Corpse Dance (CR 404.3 ordered graveyard, CR 702.27 buyback, CR 702.10 haste, CR 603.7 delayed exile)", () => {
    /** Graveyard ids MINUS Corpse Dance itself — an instant puts itself into
     *  its owner's graveyard as it resolves (CR 608.2m) unless buyback was
     *  paid, which is noise for the ordering assertions. */
    const gyIds = (zone: { id: string }[], spellId: string) =>
        zone.map((c) => c.id).filter((cid) => cid !== spellId);

    const inGraveyard = (id: string, cardId: string) =>
        makeInstance(cardId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });

    it("returns the TOP creature card (most recently added), grants haste, and exiles it at the next end step", () => {
        // Pile bottom → top: a NON-creature (Reckless Spite), then the older
        // creature, then the newer one. "The top creature card" is the newer
        // creature, NOT the literal top card.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        inGraveyard("cd-spite", recklessSpite.id),
                        inGraveyard("cd-older", griselbrand.id),
                        inGraveyard("cd-newer", griselbrand.id),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const spell = pushSpell(state, corpseDance.id, "p1");
        resolveTopOfStack(state);

        const entered = state.players[0].battlefield.find(
            (c) => c.id === "cd-newer"
        );
        expect(entered).toBeDefined();
        expect(entered!.staticAbilities).toContain("haste");
        // The older creature and the non-creature stay put.
        expect(gyIds(state.players[0].graveyard, spell.id).sort()).toEqual([
            "cd-older",
            "cd-spite",
        ]);

        // Wire format — the reanimated creature crosses projectPublicState.
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[0].battlefield.some((c) => c.id === "cd-newer")
        ).toBe(true);

        // CR 603.7 — the captured creature (not a fresh pick) is exiled at
        // the beginning of the next end step.
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers![0].payload).toEqual({
            captured: "cd-newer",
        });
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.some((c) => c.id === "cd-newer")
        ).toBe(false);
        expect(state.players[0].exile.map((c) => c.id)).toContain("cd-newer");
    });

    it("is a clean no-op on a graveyard with no creature card (CR 608.2b)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [inGraveyard("cd-only-spite", recklessSpite.id)],
                }),
                makePlayer("p2"),
            ],
        });
        const spell = pushSpell(state, corpseDance.id, "p1");
        resolveTopOfStack(state);

        expect(state.players[0].battlefield).toHaveLength(0);
        expect(gyIds(state.players[0].graveyard, spell.id)).toEqual([
            "cd-only-spite",
        ]);
        expect(state.stack).toHaveLength(0);
        // CR 608.2b — the delayed trigger IS still created (the Op runs; its
        // `capture` simply resolves to nothing, exactly as Sneak Attack's
        // does when the player declines the optional put), and firing it is
        // harmless: there is no captured creature to exile.
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].exile).toHaveLength(0);
    });

    it("with buyback paid, Corpse Dance returns to its owner's HAND while the reanimation still happens (CR 702.27a)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [inGraveyard("cd-bb-creature", griselbrand.id)],
                }),
                makePlayer("p2"),
            ],
        });
        const spell = pushSpell(state, corpseDance.id, "p1");
        spell.buybackPaid = true;
        resolveTopOfStack(state);

        expect(
            state.players[0].battlefield.some((c) => c.id === "cd-bb-creature")
        ).toBe(true);
        expect(state.players[0].hand.map((c) => c.id)).toContain(spell.id);
        expect(state.players[0].graveyard.map((c) => c.id)).not.toContain(
            spell.id
        );
    });
});
