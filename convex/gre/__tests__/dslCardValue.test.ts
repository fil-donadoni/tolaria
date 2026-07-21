// cardValue DSL-precedence + wire-format tests (PRD #1423, issue #1426). The
// semantic layer wires the per-Op value model into `cardValue`:
//
//     explicit `aiValue`  >  DSL-derived (Effect Script)  >  `base + MV`
//
// so a burn / removal spell — whose Effect Script the value model reads — now
// scores far above a do-nothing spell of the same mana value. The valuation is
// read CLIENT-SIDE (`src/lib/ai/bot-view.ts` → `cardValueById(card.card.id)`),
// so the change must survive the wire projection: the DSL value is derived from
// the REGISTRY definition keyed by the id that survives `projectPublicState`,
// never off the fat `card.card` blob the projection strips.

import { describe, it, expect } from "vitest";
import {
    makePlayer,
    makeState,
    makeInstance,
} from "../../cards/__tests__/setup";
import { cardValueById, latentValue } from "../cardValue";
import { projectPublicState } from "../../gameProjections";

// Real, registered cards of equal mana value (probed from the catalogue):
//   Lightning Bolt — DSL `dealDamage 3` burn, MV 1.
//   Black Ward      — a do-nothing-for-the-evaluator aura shell, MV 1.
const LIGHTNING_BOLT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
const BLACK_WARD = "15967a39-303f-457d-bcde-51837c8d63e1";
// Ashes to Ashes — DSL exile-two-creatures removal, MV 3.
const ASHES_TO_ASHES = "825496e5-19c7-4f50-8070-0265a58608dc";

describe("cardValue DSL precedence (PRD #1423, issue #1426)", () => {
    it("a burn spell scores far above a do-nothing spell of equal mana value", () => {
        const burn = cardValueById(LIGHTNING_BOLT);
        const doNothing = cardValueById(BLACK_WARD);
        expect(burn).toBeGreaterThan(doNothing * 3);
    });

    it("a removal spell scores far above a do-nothing spell", () => {
        expect(cardValueById(ASHES_TO_ASHES)).toBeGreaterThan(
            cardValueById(BLACK_WARD) * 3
        );
    });

    describe("latentValue precedence order", () => {
        const base = {
            isCreature: false,
            power: 0,
            toughness: 0,
            manaValue: 3,
            staticAbilities: [] as string[],
        };

        it("explicit aiValue wins over a DSL-derived value", () => {
            expect(
                latentValue({ ...base, aiValue: 7, dslSpellValue: 500 })
            ).toBe(7);
        });

        it("DSL-derived value beats the base+MV fallback when higher", () => {
            // base+MV fallback for MV3 = 8 + 3×10 = 38.
            expect(latentValue({ ...base, dslSpellValue: 200 })).toBe(200);
        });

        it("DSL value is FLOORED at base+MV — it never lowers a card below its MV worth", () => {
            // A script the current Op vocabulary can't value fully (a backfilled
            // Op, #1430) must not drop the card below its mana-value floor.
            expect(latentValue({ ...base, dslSpellValue: 5 })).toBe(38);
        });

        it("no DSL script → the base+MV fallback (unchanged behavior)", () => {
            expect(latentValue(base)).toBe(38);
        });

        it("a creature adds its ability-script value on top of its body", () => {
            const body = latentValue({
                isCreature: true,
                power: 2,
                toughness: 2,
                manaValue: 2,
                staticAbilities: [],
            });
            const withAbility = latentValue({
                isCreature: true,
                power: 2,
                toughness: 2,
                manaValue: 2,
                staticAbilities: [],
                dslAbilityValue: 50,
            });
            expect(withAbility).toBe(body + 50);
        });
    });
});

describe("cardValue wire-format (issue #1426, client-read via bot-view)", () => {
    it("the DSL-derived value survives projectPublicState (id-keyed, projection-safe)", () => {
        const bolt = makeInstance(LIGHTNING_BOLT, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [bolt] }), makePlayer("p2")],
        });

        // Server-side (fat state): the burn is worth its DSL value.
        const fatId = String(state.players[0].hand[0].card.id);
        const fatValue = cardValueById(fatId);
        expect(fatValue).toBeGreaterThan(cardValueById(BLACK_WARD) * 3);

        // The same assertion after the wire projection — the client reads
        // `cardValueById(card.card.id)`, and `card.card` is stripped to `{ id }`.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].hand[0];
        const slimId = String((slim as { card: { id: string } }).card.id);
        expect(slimId).toBe(fatId); // the id survives the wire
        expect(cardValueById(slimId)).toBe(fatValue); // identical valuation
    });
});
