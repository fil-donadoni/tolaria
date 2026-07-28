// Per-card behavior tests for colorless cards in `convex/cards/sets/mh2/colorless.ts`
// (Modern Horizons 2, split by colour per ADR 0043). Yavimaya, Cradle of
// Growth is the "Forest" mirror of Urborg, Tomb of Yawgmoth
// (`convex/cards/sets/plc/colorless.ts`) — same `subtype-add` static-effect
// shape (CR 305.7, 611). Urborg's test file carries the exhaustive coverage
// (apply/existing-grants/unapply/wire-format); this file only re-confirms the
// additive behavior and the self-mana-ability inference for Yavimaya, per the
// project's per-Op / lighter-mirror testing convention.

import { describe, it, expect } from "vitest";
import { yavimayaCradleOfGrowth } from "..";
import { kaldraCompleat, nettlecyst } from "../colorless";
import { swamp } from "../../lea";
import { grizzlyBears } from "../../lea/green";
import { blackLotus } from "../../lea/colorless";
import { crusade } from "../../lea/white";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getBasicLandMana } from "../../../../gre/constants";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    applySourceStaticEffects,
    resolveTopOfStack,
} from "../../../../gre/state";
import { effectiveTriggeredAbilities } from "../../../../gre/copy";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { tokenPrintIdFor } from "../../../tokenPrintLookup";

describe("Yavimaya, Cradle of Growth ({T}: Add {G} via basic-land inference — CR 305.7, 611)", () => {
    it("declares exactly one subtype-add static effect matching every land", () => {
        const kinds = (yavimayaCradleOfGrowth.staticEffects ?? []).map(
            (e) => e.kind
        );
        expect(kinds).toEqual(["subtype-add"]);
    });

    it("adds Forest additively to another land already on the battlefield (original subtype NOT replaced)", () => {
        const state = makeState();
        const yavimaya = makeInstance(yavimayaCradleOfGrowth.id, {
            id: "yavimaya-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const otherSwamp = makeInstance(swamp.id, {
            id: "swamp-1",
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(yavimaya);
        state.players[1].battlefield.push(otherSwamp);

        applySourceStaticEffects(state, yavimaya);

        expect(otherSwamp.subtypes).toContain("Swamp");
        expect(otherSwamp.subtypes).toContain("Forest");
        expect(otherSwamp.subtypes).toHaveLength(2);
    });

    it("Yavimaya itself can tap for {G} via the free basic-land-type inference", () => {
        const state = makeState();
        const yavimaya = makeInstance(yavimayaCradleOfGrowth.id, {
            id: "yavimaya-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(yavimaya);

        applySourceStaticEffects(state, yavimaya);

        expect(yavimaya.subtypes).toContain("Forest");
        expect(getBasicLandMana(yavimaya)).toBe("G");
    });
});

// ---------------------------------------------------------------------------
// Living Weapon Equipment (issue #1340, CR 702.92). Kaldra Compleat and
// Nettlecyst share Batterskull's ETB shape (covered end-to-end in
// `sets/nph/__tests__/colorless.test.ts`), so these blocks assert only what is
// specific to each: Kaldra's GRANTED triggered ability (a `triggered-grant`
// template that must reach the Germ and fire off ITS combat damage), and
// Nettlecyst's board-counting `pt-cda` (CR 604.3) — both mandatory wire-format
// assertions per the card testing convention.
// ---------------------------------------------------------------------------

/** Puts an Equipment's Living Weapon ETB trigger on the stack (CR 603.6a) and
 *  resolves it, returning the created Germ. */
function fireLivingWeapon(
    state: GameState,
    equipment: CardInstanceState,
    abilityId: string
): CardInstanceState {
    state.stack.push({
        ...equipment,
        zone: "stack",
        castById: equipment.controllerId,
        triggeredAbilityId: abilityId,
        triggerSourceId: equipment.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: equipment.id,
            controllerId: equipment.controllerId,
            types: ["Artifact"],
        },
        targets: undefined,
    } as StackItem);
    resolveTopOfStack(state);
    return state.players[0].battlefield.find(
        (c) => c.isToken && c.subtypes?.includes("Germ")
    )!;
}

describe("Kaldra Compleat (MH2 #232, Living Weapon — issue #1340)", () => {
    function setup(): { state: GameState; kaldra: CardInstanceState } {
        const kaldra = makeInstance(kaldraCompleat.id, {
            id: "kaldra1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kaldra] }),
                makePlayer("p2"),
            ],
        });
        return { state, kaldra: state.players[0].battlefield[0] };
    }

    it("definition sanity — legendary, own indestructible, Equip {7}, DSL-only", () => {
        expect(kaldraCompleat.manaCost).toEqual({ generic: 7 });
        expect(kaldraCompleat.supertypes).toEqual(["Legendary"]);
        expect(kaldraCompleat.subtypes).toEqual(["Equipment"]);
        // The bare "Indestructible" line is the EQUIPMENT's own keyword
        // (CR 702.12), distinct from the indestructible it GRANTS its host.
        expect(kaldraCompleat.staticAbilities).toContain("indestructible");
        const equip = kaldraCompleat.activatedAbilities!.find(
            (a) => a.id === "kaldra-compleat-equip"
        )!;
        expect(equip.cost).toEqual({ mana: { generic: 7 } });
        expect(equip.sorcerySpeedOnly).toBe(true);
        expect(kaldraCompleat.triggeredAbilities).toHaveLength(1);
        expect(kaldraCompleat.triggeredAbilities![0].resolve).toBeUndefined();
        // The quoted ability is a GRANT template, never Kaldra's own trigger —
        // the Equipment is not a creature and can't deal combat damage.
        expect(kaldraCompleat.triggeredGrantTemplates).toHaveLength(1);
        expect(kaldraCompleat.triggeredGrantTemplates![0].id).toBe(
            "kaldra-compleat-granted-exile"
        );
        expect(tokenPrintIdFor(kaldraCompleat.id, "Phyrexian Germ")).toBe(
            "b53e0681-603e-4180-bc86-3dadf214e61a"
        );
    });

    it("living weapon makes a 5/5 first-striking Germ with every granted keyword (GRE and wire format)", () => {
        const { state, kaldra } = setup();
        const germ = fireLivingWeapon(
            state,
            kaldra,
            "kaldra-compleat-living-weapon"
        );
        expect(
            state.players[0].battlefield.find((c) => c.id === "kaldra1")!
                .attachedTo
        ).toBe(germ.id);
        expect(getEffectivePower(state, germ)).toBe(5);
        expect(getEffectiveToughness(state, germ)).toBe(5);
        for (const kw of ["first strike", "trample", "indestructible", "haste"])
            expect(germ.staticAbilities).toContain(kw);

        const projected = projectPublicState(state, 1, "p1");
        const slimGerm = projected.players[0].battlefield.find(
            (c) => c.id === germ.id
        )!;
        expect(getEffectivePower(projected, slimGerm)).toBe(5);
        expect(getEffectiveToughness(projected, slimGerm)).toBe(5);
    });

    // CR 611/613 layer 6 — the quoted ability is granted to the HOST, so its
    // `self` is the Germ and the damage source it watches is the Germ itself.
    it("grants the exile-on-combat-damage trigger to the equipped creature", () => {
        const { state, kaldra } = setup();
        const germ = fireLivingWeapon(
            state,
            kaldra,
            "kaldra-compleat-living-weapon"
        );
        const granted = effectiveTriggeredAbilities(germ).find(
            (a) => a.id === "kaldra-compleat-granted-exile"
        );
        expect(granted).toBeDefined();
        // Kaldra Compleat itself never carries the ability.
        expect(
            effectiveTriggeredAbilities(
                state.players[0].battlefield.find((c) => c.id === "kaldra1")!
            ).some((a) => a.id === "kaldra-compleat-granted-exile")
        ).toBe(false);

        const victim = makeInstance(grizzlyBears.id, {
            id: "victim1",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(victim);

        const combatDamage = {
            type: "DAMAGE_DEALT" as const,
            sourceInstanceId: germ.id,
            sourceControllerId: "p1",
            target: { type: "permanent" as const, id: "victim1" },
            amount: 5,
            isCombat: true,
        };
        expect(granted!.matches(combatDamage, germ, state)).toBe(true);
        // Non-combat damage from the same creature does not qualify (CR 510).
        expect(
            granted!.matches({ ...combatDamage, isCombat: false }, germ, state)
        ).toBe(false);
        // Damage to a PLAYER does not qualify ("to a creature").
        expect(
            granted!.matches(
                { ...combatDamage, target: { type: "player", id: "p2" } },
                germ,
                state
            )
        ).toBe(false);

        // Resolving the granted trigger exiles the damaged creature.
        state.stack.push({
            ...germ,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "kaldra-compleat-granted-exile",
            triggerSourceId: germ.id,
            triggerEvent: combatDamage,
            targets: undefined,
        } as StackItem);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.some((c) => c.id === "victim1")
        ).toBe(false);
        expect(state.players[1].exile.some((c) => c.id === "victim1")).toBe(
            true
        );
    });
});

describe("Nettlecyst (MH2 #231, Living Weapon — issue #1340)", () => {
    it("definition sanity — {3}, Equip {2}, single pt-cda", () => {
        expect(nettlecyst.manaCost).toEqual({ generic: 3 });
        expect(nettlecyst.subtypes).toEqual(["Equipment"]);
        const equip = nettlecyst.activatedAbilities!.find(
            (a) => a.id === "nettlecyst-equip"
        )!;
        expect(equip.cost).toEqual({ mana: { generic: 2 } });
        expect((nettlecyst.staticEffects ?? []).map((e) => e.kind)).toEqual([
            "pt-cda",
        ]);
        expect(tokenPrintIdFor(nettlecyst.id, "Phyrexian Germ")).toBe(
            "b53e0681-603e-4180-bc86-3dadf214e61a"
        );
    });

    // CR 604.3 — a live board count, re-read at stat-read time. Nettlecyst
    // counts ITSELF (it is an artifact you control).
    it("buffs by artifacts + enchantments you control, ignoring the opponent's (GRE and wire format)", () => {
        const cyst = makeInstance(nettlecyst.id, {
            id: "cyst1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cyst] }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(blackLotus.id, {
                            id: "theirs1",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        const germ = fireLivingWeapon(
            state,
            state.players[0].battlefield[0],
            "nettlecyst-living-weapon"
        );
        // Only Nettlecyst itself so far → +1/+1 (the opponent's Lotus is not
        // "you control").
        expect(getEffectivePower(state, germ)).toBe(1);
        expect(getEffectiveToughness(state, germ)).toBe(1);

        // Add an artifact and an enchantment under our control → +3/+3.
        state.players[0].battlefield.push(
            makeInstance(blackLotus.id, {
                id: "lotus1",
                controllerId: "p1",
                ownerId: "p1",
            }),
            makeInstance(crusade.id, {
                id: "crusade1",
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        expect(getEffectivePower(state, germ)).toBe(3);
        expect(getEffectiveToughness(state, germ)).toBe(3);

        const projected = projectPublicState(state, 1, "p1");
        const slimGerm = projected.players[0].battlefield.find(
            (c) => c.id === germ.id
        )!;
        expect(getEffectivePower(projected, slimGerm)).toBe(3);
        expect(getEffectiveToughness(projected, slimGerm)).toBe(3);
    });
});
