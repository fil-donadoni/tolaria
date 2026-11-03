// CR 609.4b / CR 118.14 (issue #7228) — `grantCastFromExile.manaSubstitution`:
// Black Widow, Super Spy's "you may cast the exiled nonland card until end of
// turn and mana of any type can be spent to cast that spell". The Op field is
// the SpellContext opt exposed to the DSL; this proves it THROUGH the Op (not a
// hand-built grant), that it is scoped to the ONE exiled card, that the two
// breadths differ on a `{C}` pip, and that it survives the serialize round-trip.
import { describe, it, expect } from "vitest";
import { registerTokenDefinition } from "../../cards";
import type { EffectOp } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { substitutionsForBreadth } from "../manaColors";
import { getManaSubstitutions, resolveTopOfStack } from "../state";
import type { GameState } from "../state";
import { validateEffectScript } from "../effects/validate";
import { compactState, expandState } from "../serialize";

const HIT_ID = "test-exile-subst-hit";
const OTHER_ID = "test-exile-subst-other";

registerTokenDefinition({
    id: HIT_ID,
    name: HIT_ID,
    rarity: "common",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    power: 2,
    toughness: 2,
});
registerTokenDefinition({
    id: OTHER_ID,
    name: OTHER_ID,
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
});

function scriptFor(breadth?: "any-type" | "any-color"): string {
    const id = `test-exile-subst-script-${breadth ?? "none"}`;
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { B: 1 },
        types: ["Sorcery"],
        effects: [
            // The defending player's walk: first nonland card to exile.
            {
                op: "revealUntilMatch",
                player: "opponent",
                filter: { excludeType: "Land" },
                match: "exile",
                rest: "exile",
                bind: "$hit",
            },
            {
                op: "grantCastFromExile",
                card: { ref: "$hit" },
                player: "controller",
                window: "this-turn",
                ...(breadth ? { manaSubstitution: breadth } : {}),
            },
        ] as EffectOp[],
    });
    return id;
}

function resolved(breadth?: "any-type" | "any-color"): GameState {
    const mk = (cardId: string, id: string) =>
        makeInstance(cardId, {
            id,
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
    const state = makeState({
        players: [
            makePlayer("p1"),
            makePlayer("p2", {
                library: [mk(HIT_ID, "hit"), mk(OTHER_ID, "other")],
            }),
        ],
    });
    pushSpell(state, scriptFor(breadth), "p1");
    resolveTopOfStack(state);
    return state;
}

describe("grantCastFromExile manaSubstitution (CR 609.4b / 118.14, issue #7228)", () => {
    it("any-type: the granted exiled card — and only it — is payable with any mana", () => {
        const s = resolved("any-type");
        const card = s.players[1].exile.find((c) => c.id === "hit")!;
        expect(card.castFromExileManaSubstitution).toBe("any-type");
        const subs = getManaSubstitutions(s, "p1", "hit");
        expect(subs).toEqual(substitutionsForBreadth("any-type"));
        // CR 118.14 — colorless is a target too: a `{C}` pip takes coloured mana.
        expect(subs).toContainEqual({ from: "G", to: "C" });
        // Scoped to ONE spell: any other cast sees nothing.
        expect(getManaSubstitutions(s, "p1", "other")).toEqual([]);
        expect(getManaSubstitutions(s, "p1")).toEqual([]);
    });

    it("any-color differs from any-type on the {C} target (CR 105.1)", () => {
        const s = resolved("any-color");
        const subs = getManaSubstitutions(s, "p1", "hit");
        expect(subs).toEqual(substitutionsForBreadth("any-color"));
        expect(subs.some((p) => p.to === "C")).toBe(false);
    });

    it("omitted: the plain grant carries no substitution", () => {
        const s = resolved();
        const card = s.players[1].exile.find((c) => c.id === "hit")!;
        expect(card.castFromExileManaSubstitution).toBeUndefined();
        expect(getManaSubstitutions(s, "p1", "hit")).toEqual([]);
    });

    it("survives the serialize round-trip", () => {
        const back = expandState(compactState(resolved("any-type")));
        expect(
            back.players[1].exile.find((c) => c.id === "hit")!
                .castFromExileManaSubstitution
        ).toBe("any-type");
        expect(getManaSubstitutions(back, "p1", "hit")).toEqual(
            substitutionsForBreadth("any-type")
        );
    });

    it("validator admits the two breadths and rejects anything else", () => {
        const op = (v: unknown) =>
            validateEffectScript({
                id: "validate-probe",
                name: "validate-probe",
                effects: [
                    {
                        op: "revealUntilMatch",
                        player: "opponent",
                        filter: { excludeType: "Land" },
                        match: "exile",
                        rest: "exile",
                        bind: "$hit",
                    },
                    {
                        op: "grantCastFromExile",
                        card: { ref: "$hit" },
                        player: "controller",
                        manaSubstitution: v,
                    },
                ] as unknown as EffectOp[],
            });
        expect(op("any-type")).toEqual([]);
        expect(op("any-color")).toEqual([]);
        expect(op("any-mana").length).toBeGreaterThan(0);
    });
});
