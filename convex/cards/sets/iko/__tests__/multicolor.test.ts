// IKO — multicolor: Lutri, the Spellchaser (issue #1391, ADR 0064's Companion
// framework tracer). Flash + a targeted ETB copy trigger gated on "if you
// cast it" (CR 603.4, `PermanentEnteredEvent.wasCast`) + the Companion
// keyword (its Singleton deck-construction condition is exercised end-to-end
// in convex/gre/__tests__/companion.test.ts via the real `lutri` definition;
// this file owns the card's own resolve() behavior).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    processPendingActionTriggers,
} from "../../../../gre/state";
import { lutri, lurrus } from "../multicolor";
import { lightningBolt, savannahLions, stoneRain } from "../../lea";
import { projectPublicState } from "../../../../gameProjections";
import type { GameState } from "../../../../gre/state";
import {
    canCastPermanentFromGraveyardByPermission,
    getLegalActions,
} from "../../../../gre/rules";

describe("Lutri, the Spellchaser (Companion, Flash, CR 603.6a copy-on-cast ETB)", () => {
    it("pins the definition (companion + flash keywords, targeted spell-you-control ETB)", () => {
        expect(lutri.staticAbilities).toEqual(["companion", "flash"]);
        expect(lutri.types).toEqual(["Creature"]);
        // CR 205.4a — type line is "Legendary Creature — Elemental Otter"
        // (Scryfall); regression pin for the missing-supertype bug (legend
        // rule, CR 704.5j, never applied without this).
        expect(lutri.supertypes).toEqual(["Legendary"]);
        expect(lutri.subtypes).toEqual(["Elemental", "Otter"]);
        expect(lutri.power).toBe(3);
        expect(lutri.toughness).toBe(2);
        // Printed cost is the hybrid {1}{U/R}{U/R} — declared via
        // `manaCost.hybrid` (issue #1338), payable with mana off either
        // colour of land (#1738/#1739, landed #1755).
        expect(lutri.manaCost).toEqual({
            generic: 1,
            hybrid: [
                ["U", "R"],
                ["U", "R"],
            ],
        });
        const etb = lutri.triggeredAbilities?.find((a) => a.id === "lutri-etb");
        expect(etb?.targetRequirement).toEqual({
            type: "spell",
            count: 1,
            spellTypeFilter: ["Instant", "Sorcery"],
            controller: "you",
        });
    });

    it("when CAST, copies a target instant/sorcery spell it controls (CR 707.10)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // p1 already has an instant on the stack under their own control.
        const bolt = pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        // p1 casts Lutri above it.
        pushSpell(state, lutri.id, "p1");
        // Resolve Lutri's cast — CR 601.2i: `wasCast: true` on the resulting
        // PERMANENT_ENTERED event, so the ETB trigger's `condition` (CR 603.4)
        // fires and CR 603.3d locks its target as it's placed on the stack.
        // With exactly one legal target (the Bolt), the sole mandatory target
        // auto-selects — no real choice, no `pendingTarget` (CR 603.3d).
        resolveTopOfStack(state);
        expect(state.pendingTarget).toBeUndefined();
        const trigger = state.stack.find(
            (s) => s.triggeredAbilityId === "lutri-etb"
        );
        expect(trigger?.targets).toEqual([{ type: "spell", id: bolt.id }]);

        // Resolve the trigger — copies the Bolt onto the stack above it.
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(2);
        expect(state.stack[0].id).toBe(bolt.id);
        const copy = state.stack[state.stack.length - 1];
        expect(copy.isCopy).toBe(true);
        expect((copy.card as { id: string }).id).toBe(lightningBolt.id);
        expect(copy.id).not.toBe(bolt.id);
        // Lutri itself resolved onto the battlefield.
        expect(
            state.players[0].battlefield.some(
                (c) => c.id !== copy.id && c.id !== bolt.id
            )
        ).toBe(true);
    });

    it("does NOT copy when Lutri enters WITHOUT being cast (CR 603.4 'if you cast it')", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        // A reanimation-shaped entry: Lutri lands on the battlefield via a
        // direct zone move, never resolving as a cast spell — no `wasCast`.
        const entered = makeInstance(lutri.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(entered);
        state.pendingEvents = [
            ...(state.pendingEvents ?? []),
            {
                type: "PERMANENT_ENTERED",
                instanceId: entered.id,
                controllerId: "p1",
                cardId: lutri.id,
                types: ["Creature"],
                // wasCast omitted — this is the point of the test.
            },
        ];
        // Manually drain events the way `resolveTopOfStack` would.
        const before = state.stack.length;
        processPendingActionTriggers(state);
        // No trigger landed — the stack is unchanged and there's no pending
        // target for a copy.
        expect(state.stack.length).toBe(before);
        expect(state.pendingTarget).toBeUndefined();
    });

    it("cannot target an opponent's spell (CR 109.3 / 114.1 — controller: you)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        // p2 controls the only instant/sorcery on the stack; p1 casts Lutri.
        pushSpell(state, stoneRain.id, "p2");
        pushSpell(state, lutri.id, "p1");
        resolveTopOfStack(state);

        // CR 603.3c — with no legal target (the only instant/sorcery is the
        // opponent's), the trigger never goes on the stack at all.
        expect(state.pendingTarget).toBeUndefined();
        expect(
            state.stack.some((s) => s.triggeredAbilityId === "lutri-etb")
        ).toBe(false);
    });

    it("the copy is visible through the wire projection to both players", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        pushSpell(state, lutri.id, "p1");
        resolveTopOfStack(state);
        resolveTopOfStack(state);

        const copy = state.stack[state.stack.length - 1];
        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(
                state as GameState,
                1,
                viewerId
            );
            expect(
                projected.stack.some((s) => s.id === copy.id && s.isCopy)
            ).toBe(true);
        }
    });
});

describe("Lurrus of the Dream-Den (Companion, Lifelink, static graveyard-permanent-cast permission, issue #1392)", () => {
    it("pins the definition (companion + lifelink keywords, castsPermanentsFromGraveyard cap)", () => {
        expect(lurrus.staticAbilities).toEqual(["companion", "lifelink"]);
        expect(lurrus.types).toEqual(["Creature"]);
        // CR 205.4a — type line is "Legendary Creature — Cat Nightmare"
        // (Scryfall); regression pin for the missing-supertype bug (legend
        // rule, CR 704.5j, never applied without this).
        expect(lurrus.supertypes).toEqual(["Legendary"]);
        expect(lurrus.subtypes).toEqual(["Cat", "Nightmare"]);
        expect(lurrus.power).toBe(3);
        expect(lurrus.toughness).toBe(2);
        // Printed cost is the hybrid {1}{W/B}{W/B} — declared via
        // `manaCost.hybrid` (issue #1338), payable with mana off either
        // colour of land (#1738/#1739, landed #1755).
        expect(lurrus.manaCost).toEqual({
            generic: 1,
            hybrid: [
                ["W", "B"],
                ["W", "B"],
            ],
        });
        expect(lurrus.castsPermanentsFromGraveyard).toEqual({
            maxManaValue: 2,
        });
    });

    it("while on the battlefield, grants the once-per-turn graveyard-permanent-cast permission (CR 702.139) — full GRE + wire coverage lives in gre/__tests__/graveyardPermanentCastPermission.test.ts", () => {
        const lurrusOnBattlefield = makeInstance(lurrus.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        // Savannah Lions is MV 1, at or under Lurrus's cap of 2.
        const gyLions = makeInstance(savannahLions.id, {
            id: "gy-lions",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [lurrusOnBattlefield],
                    graveyard: [gyLions],
                    manaPool: { W: 1 },
                }),
                makePlayer("p2"),
            ],
        });
        const p1 = state.players[0];
        expect(
            canCastPermanentFromGraveyardByPermission(state, p1, gyLions)
        ).toBe(true);
        expect(getLegalActions(state, p1, gyLions)).toContain("cast");
    });
});
