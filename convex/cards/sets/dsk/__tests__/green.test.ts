// Per-card behaviour tests for green cards in `convex/cards/sets/dsk/green.ts`
// (Duskmourn: House of Horror, split by colour per ADR 0043). Fixtures from
// convex/cards/__tests__/setup.ts.
//
// Enduring Vitality (issue #2085) is the catalogue's FIRST GROUP
// `activated-grant` (CR 611.2a / 613.1f): every shipped one before it is an
// aura granting its single `attachedTo` host, so nothing yet proved the layer-6
// walk carries a `grantTemplates[]` ability onto a whole board slice — nor that
// a granted MANA ability reaches `getActivatedManaAbility`, the single gate the
// auto-tap solver, the castability probe and the client's tap affordance all
// read through. That, plus the wire projection the client actually sees, is
// what earns tests here; the cycle's shared dies-trigger is covered once on
// Enduring Innocence (`white.test.ts`).

import { describe, it, expect } from "vitest";
import { enduringVitality } from "..";
import { grizzlyBears } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getActivatedManaAbility } from "../../../../gre/constants";
import { getEffectiveActivatedAbilities } from "../../../../gre/activatedAbilities";
import {
    applySourceStaticEffects,
    removePermanentTo,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import type { CardInstanceState, GameState } from "../../../../gre/state";

/** p1 controls Enduring Vitality and a Grizzly Bears; p2 controls a Bears of
 *  their own (the "creatures you control" negative half).
 *
 *  The board is brought up through `applySourceStaticEffects` — the production
 *  entry path — rather than a bare `syncLayer6`: CR 613.7a says a continuous
 *  effect from a static ability takes the timestamp of the object it is on,
 *  and layer 6 SKIPS an unstamped source outright, so a hand-planted instance
 *  with no `staticSeq` would silently grant nothing. Everything asserted below
 *  is therefore the engine's own DERIVED output, never a planted row. */
function board(): { state: GameState } {
    const vitality = makeInstance(enduringVitality.id, {
        id: "vitality",
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
    });
    const mine = makeInstance(grizzlyBears.id, {
        id: "mine",
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
    });
    const theirs = makeInstance(grizzlyBears.id, {
        id: "theirs",
        controllerId: "p2",
        ownerId: "p2",
        isSummoningSick: false,
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [vitality, mine] }),
            makePlayer("p2", { battlefield: [theirs] }),
        ],
    });
    applySourceStaticEffects(state, vitality);
    return { state };
}

function find(state: GameState, id: string): CardInstanceState | undefined {
    for (const p of state.players) {
        const found = p.battlefield.find((c) => c.id === id);
        if (found) return found;
    }
    return undefined;
}

describe("Enduring Vitality — group activated-grant (CR 611.2a / 613.1f, issue #2085)", () => {
    it("grants '{T}: Add one mana of any color' to every creature its controller controls", () => {
        const { state } = board();

        const granted = getEffectiveActivatedAbilities(find(state, "mine")!);
        const mana = granted.find(
            (g) => g.ability.id === "enduring-vitality-any-color"
        );
        expect(mana).toBeDefined();
        expect(mana!.grantedSourceCardId).toBe(enduringVitality.id);
        // CR 605.3a — a mana ability never uses the stack.
        expect(mana!.ability.useStack).toBe(false);
        expect(mana!.ability.manaChoices).toEqual([
            { W: 1 },
            { U: 1 },
            { B: 1 },
            { R: 1 },
            { G: 1 },
        ]);
    });

    it("the granted ability is a real mana ability at the single tap gate (CR 605.1a)", () => {
        const { state } = board();

        // `getActivatedManaAbility` is what the auto-tap solver, the
        // castability probe and the client's tap affordance all read (issue
        // #1880). A grant invisible here is clickable and produces nothing.
        const ability = getActivatedManaAbility(find(state, "mine")!, state);
        expect(ability?.id).toBe("enduring-vitality-any-color");
        expect(ability?.cost).toEqual({ tap: true });
    });

    it("grants it to Enduring Vitality itself — the Oracle says 'creatures', not 'other creatures'", () => {
        const { state } = board();

        expect(
            getActivatedManaAbility(find(state, "vitality")!, state)?.id
        ).toBe("enduring-vitality-any-color");
    });

    it("does NOT grant it to an opponent's creature (CR 109.4 — 'you control')", () => {
        const { state } = board();

        expect(getActivatedManaAbility(find(state, "theirs")!, state)).toBe(
            null
        );
    });

    it("the grant is continuous — it disappears the moment Enduring Vitality leaves (CR 611.2b)", () => {
        const { state } = board();
        expect(getActivatedManaAbility(find(state, "mine")!, state)).not.toBe(
            null
        );

        // Exiled rather than destroyed: the dies trigger would return it as an
        // enchantment and keep granting, which is a different assertion.
        // The departure funnel re-derives layer 6 itself (CR 611.2b) — no
        // hand-driven resync, so this is the production behaviour.
        removePermanentTo(state, "vitality", "exile");

        expect(getActivatedManaAbility(find(state, "mine")!, state)).toBe(null);
    });

    it("wire format — the projection carries the grant, so the client sees the mana ability too", () => {
        const { state } = board();

        // The projection strips fat fields; a GRE-only assertion passes while
        // the client silently loses the affordance
        // (`.claude/rules/gre-development.md` § Card testing convention).
        const view = projectPublicState(state, 1, "p1");
        const mine = view.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "mine")!;
        expect(mine.grantedActivatedAbilities).toEqual([
            expect.objectContaining({
                sourceCardId: enduringVitality.id,
                abilityId: "enduring-vitality-any-color",
            }),
        ]);
    });
});
