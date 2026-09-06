// Bestow (CR 702.103) — the cast mode built in issue #2388, exercised end to
// end on its first (and so far only) card, Springheart Nantuko (MH3).
//
// The project has no convex-test harness for `game.ts` mutations (ADR 0001),
// so — mirroring `buyback.test.ts` / `escape.test.ts` / `flashback.test.ts` —
// the MUTATION layer is driven through the real exported
// `finalizeTargetSelection`, the same function `announceCast` hands a
// completed `pendingTarget` to. Everything downstream of it (the stack item,
// resolution, the SBA sweep, the wire projection, the DB round-trip) is the
// production code path unchanged.
//
// The four rules under test, each in its own describe:
//   702.103b — the spell becomes an Aura enchantment as it is put onto the
//              stack, and the permanent it becomes is a bestowed Aura.
//   702.103e — an illegal target does NOT fizzle it; it keeps resolving as a
//   / 608.3b   creature spell.
//   702.103f — a bestowed Aura that becomes unattached reverts to a creature
//              IN PLACE. Explicitly an exception to CR 704.5m, so the control
//              case (an ordinary Aura) must still be binned — and "in place"
//              is not "still applying": CR 611.3a ends every effect it was
//              applying through the attachment (keyword grant, control
//              change), while CR 613.1d layer-4 effects from sources that are
//              still there survive the printed-line restore.
//   400.7    — a bestowed object that changes zone sheds the Aura type line.
//
// Every boundary is driven through its REAL entry point — `removePermanentTo`
// for the departure, `removeFromZone` for the shared entry-side reset,
// `checkStateBasedActions` for the SBA, `resolveTopOfStack` for the two
// resolution roads — never by calling `revertBestow` by hand, which would
// prove the helper works and never that the boundary calls it.

import { describe, it, expect } from "vitest";
import { finalizeTargetSelection } from "../../game";
import {
    getPlayer,
    removeFromZone,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type PendingTarget,
} from "../state";
import { syncLayers2to5 } from "../layers2to5";
import { affordableAlternativeCosts } from "../alternativeCost";
import { checkStateBasedActions } from "../sba";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { springheartNantuko } from "../../cards/sets/mh3/green";
import { grizzlyBears } from "../../cards/sets/lea";
import { unstableMutation } from "../../cards/sets/arn/blue";
import { counterspell } from "../../cards/sets/lea/blue";
import {
    applyBestowCharacteristics,
    hasLegalBestowHost,
    revertBestow,
} from "../bestow";

const NANTUKO = springheartNantuko.id;
const BEARS = grizzlyBears.id;

/** p1 holds Springheart Nantuko in hand with enough floating mana to bestow
 *  it; `hostController` controls a Grizzly Bears to enchant. */
function boardWithHost(hostController: "p1" | "p2" = "p1"): {
    state: GameState;
    host: CardInstanceState;
} {
    const nantuko = makeInstance(NANTUKO, {
        id: "nantuko",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const host = makeInstance(BEARS, {
        id: "host",
        controllerId: hostController,
        ownerId: hostController,
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [nantuko],
                battlefield: hostController === "p1" ? [host] : [],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 3, C: 3 },
            }),
            makePlayer("p2", {
                battlefield: hostController === "p2" ? [host] : [],
            }),
        ],
    });
    return { state, host };
}

/** The `pendingTarget` `announceCast` builds for a BESTOWED cast: the bestow
 *  alternative cost plus the one creature target its gained "enchant creature"
 *  ability demands (CR 702.103b / 303.4a). */
function bestowPendingTarget(hostId: string): PendingTarget {
    return {
        playerId: "p1",
        cardInstanceId: "nantuko",
        targetType: "Creature",
        count: 1,
        selected: [{ type: "permanent", id: hostId }],
        alternativeCostId: "bestow",
    };
}

/** Casts Nantuko bestowed onto `hostId` and leaves it ON THE STACK. */
function castBestowed(state: GameState, hostId: string) {
    finalizeTargetSelection(state, bestowPendingTarget(hostId), "p1");
    return state.stack.find((s) => s.id === "nantuko")!;
}

describe("Bestow — cast-mode plumbing (CR 702.103a)", () => {
    it("is offered as an alternative cost only while some creature could host it (CR 601.2c)", () => {
        // Through the real cost-offer predicate, not the definition: this is
        // the same function `affordableAltCostsForCard` (and therefore the
        // cast-option picker) consults.
        const { state } = boardWithHost();
        const p1 = getPlayer(state, "p1");
        const inHand = p1.hand.find((c) => c.id === "nantuko")!;
        expect(
            affordableAlternativeCosts(state, p1, inHand).map((a) => a.id)
        ).toEqual(["bestow"]);
        expect(hasLegalBestowHost(state)).toBe(true);
        // Same card, same mana, board with no creature on it: no legal
        // target (CR 601.2c), so the mode is not offered at all.
        p1.battlefield = [];
        expect(hasLegalBestowHost(state)).toBe(false);
        expect(affordableAlternativeCosts(state, p1, inHand)).toEqual([]);
    });
});

describe("Bestow — the spell becomes an Aura (CR 702.103b / 205.1a)", () => {
    it("puts an Aura enchantment with no P/T onto the stack, not a creature spell", () => {
        const { state } = boardWithHost();
        const item = castBestowed(state, "host");
        expect(item.bestowed).toBe(true);
        // CR 205.1a — the new card type REPLACES the existing ones, and the
        // new subtypes replace the creature types.
        expect(item.types).toEqual(["Enchantment"]);
        expect(item.subtypes).toEqual(["Aura"]);
        expect(item.power).toBeUndefined();
        expect(item.toughness).toBeUndefined();
        // CR 702.103b — "and gains enchant creature".
        expect(item.grantedEnchantRestriction).toEqual({
            types: ["Creature"],
            players: false,
        });
    });

    it("resolves attached to its target and buffs it +1/+1", () => {
        const { state, host } = boardWithHost();
        castBestowed(state, "host");
        resolveTopOfStack(state);
        checkStateBasedActions(state);

        const p1 = getPlayer(state, "p1");
        const permanent = p1.battlefield.find((c) => c.id === "nantuko")!;
        expect(permanent.zone).toBe("battlefield");
        expect(permanent.attachedTo).toBe("host");
        expect(permanent.bestowed).toBe(true);
        // CR 613 layer 7c — "enchanted creature gets +1/+1".
        expect(getEffectivePower(state, host)).toBe(3);
        expect(getEffectiveToughness(state, host)).toBe(3);
    });

    it("survives the wire projection as an Aura, buff and all", () => {
        const { state, host } = boardWithHost();
        castBestowed(state, "host");
        resolveTopOfStack(state);
        checkStateBasedActions(state);

        const projected = projectPublicState(state, 1, "p1");
        const slimNantuko = projected.players[0].battlefield.find(
            (c) => c.id === "nantuko"
        )!;
        expect(slimNantuko.types).toEqual(["Enchantment"]);
        expect(slimNantuko.subtypes).toEqual(["Aura"]);
        expect(slimNantuko.attachedTo).toBe("host");
        expect(slimNantuko.bestowed).toBe(true);
        const slimHost = projected.players[0].battlefield.find(
            (c) => c.id === host.id
        )!;
        expect(getEffectivePower(projected, slimHost)).toBe(3);
        expect(getEffectiveToughness(projected, slimHost)).toBe(3);
    });

    it("round-trips through the DB compaction with no P/T restored", () => {
        const { state } = boardWithHost();
        castBestowed(state, "host");
        resolveTopOfStack(state);
        checkStateBasedActions(state);

        // Through JSON, not just the in-memory compaction: the DB round-trip
        // is what DROPS an explicit `power: undefined`, and an in-memory
        // `expandState(compactState(...))` keeps the key (so it would pass
        // even with the re-clear in `expandCard` deleted — verified).
        const restored = expandState(
            JSON.parse(JSON.stringify(compactState(state)))
        );
        const permanent = getPlayer(restored, "p1").battlefield.find(
            (c) => c.id === "nantuko"
        )!;
        expect(permanent.bestowed).toBe(true);
        expect(permanent.types).toEqual(["Enchantment"]);
        expect(permanent.subtypes).toEqual(["Aura"]);
        // The definition fallback in `expandCard` would otherwise hand back
        // the printed 1/1: an explicit `undefined` does not survive JSON.
        expect(permanent.power).toBeUndefined();
        expect(permanent.toughness).toBeUndefined();
        expect(permanent.attachedTo).toBe("host");
        // And the SBA sweep on the RESTORED state must not bin it.
        checkStateBasedActions(restored);
        expect(
            getPlayer(restored, "p1").battlefield.some(
                (c) => c.id === "nantuko"
            )
        ).toBe(true);
    });

    it("leaves an ORDINARY (non-bestowed) cast of the same card a 1/1 creature", () => {
        const { state } = boardWithHost();
        finalizeTargetSelection(
            state,
            {
                playerId: "p1",
                cardInstanceId: "nantuko",
                targetType: "any",
                count: 0,
                selected: [],
            },
            "p1"
        );
        const item = state.stack.find((s) => s.id === "nantuko")!;
        expect(item.bestowed).toBeUndefined();
        expect(item.types).toEqual(["Enchantment", "Creature"]);
        expect(item.subtypes).toEqual(["Insect", "Monk"]);
        expect(item.power).toBe(1);
        resolveTopOfStack(state);
        checkStateBasedActions(state);
        const permanent = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "nantuko"
        )!;
        expect(permanent.attachedTo).toBeUndefined();
        expect(permanent.zone).toBe("battlefield");
    });
});

describe("Bestow — unattached reverts in place (CR 702.103f)", () => {
    it("stays on the battlefield as a creature when its host dies", () => {
        const { state } = boardWithHost();
        castBestowed(state, "host");
        resolveTopOfStack(state);
        checkStateBasedActions(state);

        // The host leaves — the ONLY thing that changes.
        const p1 = getPlayer(state, "p1");
        p1.battlefield = p1.battlefield.filter((c) => c.id !== "host");
        checkStateBasedActions(state);

        const after = getPlayer(state, "p1");
        const permanent = after.battlefield.find((c) => c.id === "nantuko");
        expect(permanent).toBeDefined();
        // CR 702.103f — "it becomes unattached and ceases to be bestowed",
        // and this is an EXCEPTION to CR 704.5m: it is NOT in the graveyard.
        expect(after.graveyard.some((c) => c.id === "nantuko")).toBe(false);
        expect(permanent!.bestowed).toBeUndefined();
        expect(permanent!.attachedTo).toBeUndefined();
        expect(permanent!.grantedEnchantRestriction).toBeUndefined();
        expect(permanent!.types).toEqual(["Enchantment", "Creature"]);
        expect(permanent!.subtypes).toEqual(["Insect", "Monk"]);
        expect(getEffectivePower(state, permanent!)).toBe(1);
        expect(getEffectiveToughness(state, permanent!)).toBe(1);
    });

    it("releases the keyword it granted its still-present host (CR 611.3a)", () => {
        // "Stays on the battlefield" is not "keeps applying". Springheart
        // Nantuko's own buff is a read-time layer effect, so the leak this
        // guards needs the OTHER bestow shape — the Theros creature whose
        // Aura half GRANTS the enchanted creature a keyword. Its footprint on
        // the host is `grantedStaticAbilities` keyed by the aura's instance
        // id, exactly as `applySourceStaticEffects` writes it; that is what
        // is stamped here, and the entry's own doc says it is "removed when
        // the aura unattaches".
        const { state, host } = boardWithHost();
        castBestowed(state, "host");
        resolveTopOfStack(state);
        checkStateBasedActions(state);
        // CR 702.16c — the host gains protection from the Aura's colour. It
        // does NOT leave the battlefield, so the only thing that can release
        // the grant is the CR 702.103f detach itself.
        //
        // PRD #2064 S3 — protection is an intrinsic characteristic BELOW layer
        // 6, so it belongs to the base; the Aura's flying is a layer-6 grant
        // stamped on top of it, exactly as `applySourceStaticEffects` used to
        // write it.
        host.baseStaticAbilities = [
            ...host.staticAbilities,
            "protection from green",
        ];
        host.staticAbilities = [...host.baseStaticAbilities, "flying"];
        host.grantedStaticAbilities = [
            { ability: "flying", auraId: "nantuko" },
        ];
        checkStateBasedActions(state);

        const p1 = getPlayer(state, "p1");
        const nantuko = p1.battlefield.find((c) => c.id === "nantuko");
        expect(nantuko).toBeDefined();
        expect(nantuko!.bestowed).toBeUndefined();
        const stillThere = p1.battlefield.find((c) => c.id === "host")!;
        expect(stillThere).toBeDefined();
        expect(stillThere.grantedStaticAbilities).toBeUndefined();
        expect(stillThere.staticAbilities).not.toContain("flying");
    });

    it("releases the control change it imposed on its still-present host (CR 611.3a)", () => {
        // The control-half of the same release, and the reason the unapply
        // must run BEFORE `revertBestow` clears `attachedTo`:
        // `unapplyAuraControlChange` is keyed on it.
        const { state, host } = boardWithHost();
        castBestowed(state, "host");
        resolveTopOfStack(state);
        checkStateBasedActions(state);
        // What a bestow Aura reading "You control enchanted creature" leaves
        // behind (`applyAuraControlChange`'s own record shape): the host is
        // p2's card, currently controlled by p1 because of this Aura.
        host.ownerId = "p2";
        host.controlChanges = [
            {
                auraId: "nantuko",
                previousControllerId: "p2",
                controllerId: "p1",
            },
        ];
        // PRD #2064 S4 — control is DERIVED from `baseControllerId` plus the
        // ledger, so a hand-built row has to say what the base was: the
        // derivation replays FORWARD, and a base already captured as "p1" (the
        // resolution above ran a sync while p1 held the host outright) would
        // make dropping the row a no-op.
        host.baseControllerId = "p2";
        // PRD #2064 S3 — protection is a characteristic BELOW layer 6, so the
        // base is where it goes; `staticAbilities` is derived output and the
        // next recompute would overwrite a bare assignment to it.
        host.baseStaticAbilities = [
            ...host.staticAbilities,
            "protection from green",
        ];
        host.staticAbilities = [...host.baseStaticAbilities];
        checkStateBasedActions(state);

        const returned = getPlayer(state, "p2").battlefield.find(
            (c) => c.id === "host"
        );
        expect(returned).toBeDefined();
        expect(returned!.controllerId).toBe("p2");
        expect(returned!.controlChanges).toBeUndefined();
    });

    it("replays a live layer-4 type grant over the restored printed line (CR 613.1d)", () => {
        // The revert restores the printed type line, which is the layer-1
        // BASE — not the answer. The object stays on the battlefield, so a
        // `type-add` from a source that is still there still applies and must
        // survive; a bare assignment would drop it while leaving its
        // `grantedTypes` origin entry behind, so the materialized line and
        // its own provenance record would disagree.
        const { state, host } = boardWithHost();
        castBestowed(state, "host");
        resolveTopOfStack(state);
        checkStateBasedActions(state);
        const bestowed = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "nantuko"
        )!;
        // PRD #2064 S4 — a Titania's Song-style layer-4 grant, expressed the
        // only way layer 4 is expressible now: a Continuous Effects Registry
        // entry. `types` and `grantedTypes` are the derivation's OUTPUT, so
        // hand-writing them would assert against a record the next recompute
        // overwrites — the effect has to be something the derivation can see.
        state.continuousEffects = [
            ...(state.continuousEffects ?? []),
            {
                id: "ce-song",
                layer: 4,
                timestamp: 1,
                expiry: { kind: "indefinite", controllerId: "p1" },
                affected: { kind: "instances", instanceIds: [bestowed.id] },
                payload: { kind: "type-change", add: ["Artifact"] },
                characteristicDefining: false,
            },
        ];
        syncLayers2to5(state);
        expect(bestowed.types).toContain("Artifact");

        // PRD #2064 S3 — protection is a characteristic BELOW layer 6, so the
        // base is where it goes; `staticAbilities` is derived output and the
        // next recompute would overwrite a bare assignment to it.
        host.baseStaticAbilities = [
            ...host.staticAbilities,
            "protection from green",
        ];
        host.staticAbilities = [...host.baseStaticAbilities];
        checkStateBasedActions(state);

        const after = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "nantuko"
        )!;
        expect(after.bestowed).toBeUndefined();
        expect(after.types).toEqual(["Enchantment", "Creature", "Artifact"]);
        expect(after.grantedTypes).toEqual([
            { type: "Artifact", auraId: "indefinite" },
        ]);
    });

    it("CONTROL — an ordinary Aura with no host is still put into its owner's graveyard (CR 704.5m)", () => {
        // Unstable Mutation is a printed Aura, not a bestowed one. If the
        // bestow exception ever widened to every Aura, this goes red.
        const aura = makeInstance(unstableMutation.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2"),
            ],
        });
        checkStateBasedActions(state);
        const p1 = getPlayer(state, "p1");
        expect(p1.battlefield.some((c) => c.id === "aura")).toBe(false);
        expect(p1.graveyard.some((c) => c.id === "aura")).toBe(true);
    });
});

describe("Bestow — an illegal target resolves as a creature spell (CR 702.103e / 608.3b)", () => {
    it("enters the battlefield unattached instead of fizzling", () => {
        const { state } = boardWithHost();
        castBestowed(state, "host");
        // The host leaves in response — CR 608.2b would counter an ordinary
        // Aura spell here.
        const p1 = getPlayer(state, "p1");
        p1.battlefield = p1.battlefield.filter((c) => c.id !== "host");

        resolveTopOfStack(state);
        checkStateBasedActions(state);

        const after = getPlayer(state, "p1");
        const permanent = after.battlefield.find((c) => c.id === "nantuko");
        expect(permanent).toBeDefined();
        expect(after.graveyard.some((c) => c.id === "nantuko")).toBe(false);
        expect(permanent!.bestowed).toBeUndefined();
        expect(permanent!.attachedTo).toBeUndefined();
        expect(permanent!.types).toEqual(["Enchantment", "Creature"]);
        expect(getEffectivePower(state, permanent!)).toBe(1);
    });

    it("enters as a creature when its target is still TARGETABLE but is no longer a legal HOST", () => {
        // The half `targetLegalityGate` cannot see (its permanent branch asks
        // zone existence only): the host is still on the battlefield, so the
        // gate says "resolve", and only `isFullyLegalAuraHost` inside
        // `finalizeSpellResolution` knows it acquired protection from the
        // Aura's colour in response (CR 702.16b). Both roads must reach the
        // creature or the CR 702.103e exception holds for one half of
        // 608.2b's legality and not the other.
        const { state, host } = boardWithHost();
        castBestowed(state, "host");
        host.staticAbilities = [
            ...host.staticAbilities,
            "protection from green",
        ];

        resolveTopOfStack(state);
        checkStateBasedActions(state);

        const after = getPlayer(state, "p1");
        const permanent = after.battlefield.find((c) => c.id === "nantuko");
        expect(permanent).toBeDefined();
        expect(after.graveyard.some((c) => c.id === "nantuko")).toBe(false);
        expect(permanent!.bestowed).toBeUndefined();
        expect(permanent!.attachedTo).toBeUndefined();
        // The Aura-ness took the target with it (a creature spell has none) —
        // the permanent carries no stale host pointer.
        expect(
            (permanent as unknown as { targets?: unknown }).targets
        ).toBeUndefined();
        expect(permanent!.types).toEqual(["Enchantment", "Creature"]);
        expect(permanent!.subtypes).toEqual(["Insect", "Monk"]);
        expect(getEffectivePower(state, permanent!)).toBe(1);
        // The protected host is untouched — no +1/+1 from an Aura that never
        // attached (CR 613 layer 7c reads `attachedTo`).
        expect(getEffectivePower(state, host)).toBe(2);
    });

    it("CONTROL — an ordinary Aura spell whose target left IS countered (CR 608.2b)", () => {
        const bear = makeInstance(BEARS, { id: "bear", controllerId: "p1" });
        const aura = makeInstance(unstableMutation.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [aura],
                    battlefield: [bear],
                    manaPool: { W: 0, U: 3, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
        finalizeTargetSelection(
            state,
            {
                playerId: "p1",
                cardInstanceId: "aura",
                targetType: "Creature",
                count: 1,
                selected: [{ type: "permanent", id: "bear" }],
            },
            "p1"
        );
        const p1 = getPlayer(state, "p1");
        p1.battlefield = p1.battlefield.filter((c) => c.id !== "bear");
        resolveTopOfStack(state);
        const after = getPlayer(state, "p1");
        expect(after.battlefield.some((c) => c.id === "aura")).toBe(false);
        expect(after.graveyard.some((c) => c.id === "aura")).toBe(true);
    });
});

describe("Bestow — CR 400.7 zone-change reverts", () => {
    it("a bestowed permanent DESTROYED lands in the graveyard as its printed self", () => {
        const { state } = boardWithHost();
        castBestowed(state, "host");
        resolveTopOfStack(state);
        checkStateBasedActions(state);

        // Through `removePermanentTo`, the ONE battlefield-departure funnel
        // every destroy / sacrifice / bounce / tuck path in the engine ends
        // at — not through `revertBestow` by hand, which would prove only
        // that the helper works and never that the boundary calls it.
        removePermanentTo(state, "nantuko", "graveyard");

        const p1 = getPlayer(state, "p1");
        expect(p1.battlefield.some((c) => c.id === "nantuko")).toBe(false);
        const inYard = p1.graveyard.find((c) => c.id === "nantuko")!;
        expect(inYard).toBeDefined();
        // CR 400.7 — a new object with its printed characteristics. A leaked
        // Aura type line here hides it from every "return target CREATURE
        // card from your graveyard" effect, and from `isCreature` at ~20
        // hidden-zone call sites.
        expect(inYard.bestowed).toBeUndefined();
        expect(inYard.types).toEqual(["Enchantment", "Creature"]);
        expect(inYard.subtypes).toEqual(["Insect", "Monk"]);
        expect(inYard.power).toBe(1);
        expect(inYard.toughness).toBe(1);
        expect(inYard.attachedTo).toBeUndefined();
        expect(inYard.grantedEnchantRestriction).toBeUndefined();
    });

    it("the shared entry-side reset scrubs a bestow marker that reached a non-battlefield zone", () => {
        // Defense in depth, and deliberately so: today the departure funnel
        // above reverts first, so nothing can hand this helper a still-
        // bestowed object. `resetBattlefieldTransientState` is the shared
        // reset EVERY re-entry and every recast-from-a-zone runs, and it must
        // not be the one CR 400.7 field that trusts an upstream caller — a
        // marker surviving here carries an `Enchantment — Aura` type line
        // onto a reanimated / blinked / recast creature. Driven through the
        // real chokepoint (`removeFromZone`, the cast-from-graveyard road),
        // with only the leaked marker itself set by hand — the same shape
        // `typeProvenanceReset.test.ts` uses for `grantedTypes`.
        const { state } = boardWithHost();
        const p1 = getPlayer(state, "p1");
        const leaked = makeInstance(NANTUKO, {
            id: "leaked",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        applyBestowCharacteristics(leaked);
        p1.graveyard.push(leaked);

        removeFromZone(state, p1, "leaked", "graveyard");

        expect(leaked.bestowed).toBeUndefined();
        expect(leaked.types).toEqual(["Enchantment", "Creature"]);
        expect(leaked.subtypes).toEqual(["Insect", "Monk"]);
        expect(leaked.power).toBe(1);
        expect(leaked.grantedEnchantRestriction).toBeUndefined();
    });

    it("a COUNTERED bestowed spell lands in the graveyard as its printed self", () => {
        const { state } = boardWithHost();
        castBestowed(state, "host");
        // CR 701.5a — counter it while it is an Aura spell on the stack.
        const bolt = makeInstance(counterspell.id, {
            id: "cs",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        state.stack.push({
            ...bolt,
            castById: "p2",
            targets: [{ type: "spell", id: "nantuko" }],
        });
        resolveTopOfStack(state);

        const p1 = getPlayer(state, "p1");
        const inYard = p1.graveyard.find((c) => c.id === "nantuko")!;
        expect(inYard).toBeDefined();
        // CR 400.7 — the object in the graveyard is a new one with its
        // printed characteristics; a leaked Aura type line would hide it from
        // every "creature card in your graveyard" effect.
        expect(inYard.bestowed).toBeUndefined();
        expect(inYard.types).toEqual(["Enchantment", "Creature"]);
        expect(inYard.subtypes).toEqual(["Insect", "Monk"]);
        expect(inYard.power).toBe(1);
        expect(inYard.grantedEnchantRestriction).toBeUndefined();
    });

    it("applyBestowCharacteristics is idempotent", () => {
        const card = makeInstance(NANTUKO, { id: "n", controllerId: "p1" });
        applyBestowCharacteristics(card);
        applyBestowCharacteristics(card);
        expect(card.types).toEqual(["Enchantment"]);
        expect(card.subtypes).toEqual(["Aura"]);
    });

    it("revertBestow is a no-op on an object that was never bestowed", () => {
        const card = makeInstance(BEARS, { id: "b", controllerId: "p1" });
        const before = structuredClone(card);
        revertBestow(card);
        expect(card).toEqual(before);
    });
});
