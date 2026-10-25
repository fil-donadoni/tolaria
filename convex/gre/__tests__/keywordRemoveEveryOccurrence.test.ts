// CR 613.1f — a layer-6 keyword removal ("all creatures lose flying") applies
// to the OBJECT, not to one grant of it (issue #2198).
//
// `staticAbilities` is a multiset of anonymous strings and every rules
// consumer reads it with `.includes(kw)`, so a removal that takes ONE
// occurrence leaves a permanent holding the keyword from two sources still
// flying: "loses flying" degrades to "loses one flying". The assertions here
// are on `.includes`, never on a count, while the removal applies; a count is
// asserted only for the restore, where "exactly what it took" is the claim.
//
// CR 613.7 ordering is untouched: a grant whose timestamp is strictly LATER
// than the removal's is applied after it and survives.
import { describe, it, expect } from "vitest";
import {
    applyExistingGrantsTo,
    beginApplyingStaticEffects,
    buildSpellContext,
    recomputeContinuousEffects,
    stopApplyingStaticEffects,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    removedKeywordRows,
} from "../../cards/__tests__/setup.helper";
import { projectPublicState } from "../../gameProjections";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import { airElemental, flight } from "../../cards/sets/lea/blue.cards";
import { gravitySphere } from "../../cards/sets/leg/red.cards";

const UNTIL_EOT = { phase: "end-of-turn" } as const;

function makeBoard(cards: CardInstanceState[]): GameState {
    return makeState({
        players: [makePlayer("p1", { battlefield: cards }), makePlayer("p2")],
    });
}

function ctxFor(state: GameState) {
    const item: StackItem = pushSpell(state, grizzlyBears().id, "p1");
    return buildSpellContext(state, item);
}

function count(card: CardInstanceState, keyword: string): number {
    return card.staticAbilities.filter((a) => a === keyword).length;
}

/** CR 400.7 — the stripper stops applying by LEAVING the battlefield. */
function leaveBattlefield(state: GameState, card: CardInstanceState): void {
    stopApplyingStaticEffects(state, card);
    for (const player of state.players) {
        player.battlefield = player.battlefield.filter((c) => c.id !== card.id);
    }
    recomputeContinuousEffects(state);
}

/** The surface read: what the client sees after the projection. */
function wireFlies(state: GameState, id: string): boolean {
    const projected = projectPublicState(state, 1, "p1");
    const slim = projected.players[0].battlefield.find((c) => c.id === id)!;
    return slim.staticAbilities.includes("flying");
}

describe("layer-6 keyword removal takes every occurrence (CR 613.1f)", () => {
    it("printed + counter: a doubled flier does not fly under Gravity Sphere, and both come back", () => {
        const elemental = makeInstance(airElemental().id, { id: "ae-1" });
        const sphere = makeInstance(gravitySphere().id, { id: "sphere-1" });
        const state = makeBoard([elemental, sphere]);

        ctxFor(state).addCounter(
            { type: "permanent", id: "ae-1" },
            "flying",
            1
        );
        expect(count(elemental, "flying")).toBe(2);

        beginApplyingStaticEffects(state, sphere);
        expect(elemental.staticAbilities.includes("flying")).toBe(false);
        expect(wireFlies(state, "ae-1")).toBe(false);
        expect(removedKeywordRows(state, elemental)).toHaveLength(2);

        leaveBattlefield(state, sphere);
        expect(count(elemental, "flying")).toBe(2);
        expect(wireFlies(state, "ae-1")).toBe(true);
    });

    it("printed + until-EOT grant: the grant's occurrence goes too, and both come back", () => {
        const elemental = makeInstance(airElemental().id, { id: "ae-2" });
        const sphere = makeInstance(gravitySphere().id, { id: "sphere-2" });
        const state = makeBoard([elemental, sphere]);

        ctxFor(state).grantStaticAbility(
            { type: "permanent", id: "ae-2" },
            "flying",
            UNTIL_EOT
        );
        expect(count(elemental, "flying")).toBe(2);

        beginApplyingStaticEffects(state, sphere);
        expect(elemental.staticAbilities.includes("flying")).toBe(false);
        expect(wireFlies(state, "ae-2")).toBe(false);

        leaveBattlefield(state, sphere);
        expect(count(elemental, "flying")).toBe(2);
    });

    it("counter + aura: neither grant survives, and both come back", () => {
        const bear = makeInstance(grizzlyBears().id, { id: "bear-1" });
        const aura = makeInstance(flight().id, {
            id: "flight-1",
            attachedTo: "bear-1",
        });
        const sphere = makeInstance(gravitySphere().id, { id: "sphere-3" });
        const state = makeBoard([bear, aura, sphere]);

        ctxFor(state).addCounter(
            { type: "permanent", id: "bear-1" },
            "flying",
            1
        );
        beginApplyingStaticEffects(state, aura);
        expect(count(bear, "flying")).toBe(2);

        beginApplyingStaticEffects(state, sphere);
        expect(bear.staticAbilities.includes("flying")).toBe(false);
        expect(wireFlies(state, "bear-1")).toBe(false);
        expect(removedKeywordRows(state, bear)).toHaveLength(2);

        leaveBattlefield(state, sphere);
        expect(count(bear, "flying")).toBe(2);
    });

    it("a flier ENTERING under a live Gravity Sphere does not fly, and carries the hold to restore", () => {
        const sphere = makeInstance(gravitySphere().id, { id: "sphere-4" });
        const state = makeBoard([sphere]);
        beginApplyingStaticEffects(state, sphere);

        // The ETB funnel every battlefield arrival runs.
        const elemental = makeInstance(airElemental().id, { id: "ae-3" });
        state.players[0].battlefield.push(elemental);
        applyExistingGrantsTo(state, elemental);

        expect(elemental.staticAbilities.includes("flying")).toBe(false);
        expect(wireFlies(state, "ae-3")).toBe(false);
        expect(removedKeywordRows(state, elemental)).toHaveLength(1);

        // Back to its printed set — no phantom, no loss.
        leaveBattlefield(state, sphere);
        expect(count(elemental, "flying")).toBe(1);
    });

    it("a grant strictly LATER than the stripper is not stripped (CR 613.7) — only the earlier printed one is", () => {
        const elemental = makeInstance(airElemental().id, { id: "ae-4" });
        const sphere = makeInstance(gravitySphere().id, { id: "sphere-5" });
        const state = makeBoard([elemental, sphere]);
        beginApplyingStaticEffects(state, sphere);
        expect(elemental.staticAbilities.includes("flying")).toBe(false);

        ctxFor(state).addCounter(
            { type: "permanent", id: "ae-4" },
            "flying",
            1
        );
        expect(count(elemental, "flying")).toBe(1);
        expect(wireFlies(state, "ae-4")).toBe(true);
        expect(removedKeywordRows(state, elemental)).toHaveLength(1);

        leaveBattlefield(state, sphere);
        expect(count(elemental, "flying")).toBe(2);
    });
});
