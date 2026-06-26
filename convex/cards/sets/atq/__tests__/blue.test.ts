// Antiquities (ATQ) — per-card behavior tests for blue cards in
// `convex/cards/sets/atq/blue.ts` (set split by colour, ADR 0043). Each
// non-trivial card gets a describe block citing the CR section it exercises;
// assertions check external behavior only. Shared test shims live in
// `./helpers`; fixtures in `convex/cards/__tests__/setup.ts`.

import { describe, it, expect } from "vitest";
import {
    ornithopter,
    transmuteArtifact,
    yotianSoldier,
    dragonEngine,
    clayStatue,
    stripMine,
    crumble,
    hurkylsRecall,
    reconstruction,
    drafnasRestoration,
    sageOfLatNam,
    ashnodsBattleGear,
    powerArtifact,
    energyFlux,
} from "..";
import { grizzlyBears, solRing } from "../../lea";
import { getCardById } from "../../..";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { collectTriggers } from "../../../../gre/triggers";
import { effectiveTriggeredAbilities } from "../../../../gre/copy";
import { projectPublicState } from "../../../../gameProjections";
import {
    resolveTopOfStack,
    applySourceStaticEffects,
    unapplySourceStaticEffects,
    applyExistingGrantsTo,
    isManaCostCovered,
    normalizeManaCost,
    getCostModifiers,
    applyCostModifiers,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import { getLegalTargets } from "../../../../gre/rules";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    UPKEEP_P1,
    resolveActivated,
    submitChoice,
    vanilla,
    withEnergyFlux,
} from "./helpers";

describe("Hurkyl's Recall (return all artifacts target player owns to hand, CR 701.10)", () => {
    it("bounces every artifact the target player owns, leaving non-artifacts", () => {
        const a1 = makeInstance(clayStatue.id, {
            id: "a1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const a2 = makeInstance(dragonEngine.id, {
            id: "a2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const creature = vanilla("creature", 2, 2);
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [a1, a2, creature] }),
            ],
        });
        pushSpell(state, hurkylsRecall.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        // Both artifacts left the battlefield and are in p2's hand.
        expect(
            state.players[1].battlefield.filter((c) => c.id !== "creature")
        ).toHaveLength(0);
        expect(state.players[1].hand.some((c) => c.id === "a1")).toBe(true);
        expect(state.players[1].hand.some((c) => c.id === "a2")).toBe(true);
        // Non-artifact creature stays on the battlefield.
        expect(
            state.players[1].battlefield.find((c) => c.id === "creature")
        ).toBeDefined();
    });

    it("only affects the targeted player's artifacts, not the caster's", () => {
        const mine = makeInstance(clayStatue.id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
        });
        const theirs = makeInstance(dragonEngine.id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mine] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        pushSpell(state, hurkylsRecall.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        // p1's own artifact is untouched.
        expect(
            state.players[0].battlefield.find((c) => c.id === "mine")
        ).toBeDefined();
        // p2's artifact bounced.
        expect(
            state.players[1].battlefield.find((c) => c.id === "theirs")
        ).toBeUndefined();
        expect(state.players[1].hand.some((c) => c.id === "theirs")).toBe(true);
    });

    it("returnToHand routes each card to its OWNER's hand", () => {
        // p2 controls and owns the artifact; it must land in p2's hand.
        const a1 = makeInstance(clayStatue.id, {
            id: "a1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [a1] }),
            ],
        });
        pushSpell(state, hurkylsRecall.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].hand.some((c) => c.id === "a1")).toBe(false);
        expect(state.players[1].hand.some((c) => c.id === "a1")).toBe(true);
    });

    it("targets a player", () => {
        expect(hurkylsRecall.targetRequirement).toEqual({
            type: "player",
            count: 1,
        });
    });
});

describe("Reconstruction (return artifact card from your graveyard to hand, CR 400.7)", () => {
    it("moves the targeted artifact card from graveyard to hand", () => {
        const art = makeInstance(clayStatue.id, {
            id: "art",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [makePlayer("p1", { graveyard: [art] }), makePlayer("p2")],
        });
        pushSpell(state, reconstruction.id, "p1", [
            { type: "graveyard-card", id: "art", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].graveyard.some((c) => c.id === "art")).toBe(
            false
        );
        expect(state.players[0].hand.some((c) => c.id === "art")).toBe(true);
    });

    it("getLegalTargets offers only artifact cards in the caster's graveyard", () => {
        const art = makeInstance(clayStatue.id, {
            id: "art",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        // A non-artifact card in the same graveyard must NOT be a legal target.
        const spell = makeInstance(crumble.id, {
            id: "spell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        // An artifact in the OPPONENT's graveyard must NOT be legal (controller: you).
        const oppArt = makeInstance(dragonEngine.id, {
            id: "oppArt",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [art, spell] }),
                makePlayer("p2", { graveyard: [oppArt] }),
            ],
        });
        const ids = getLegalTargets(
            state,
            reconstruction.targetRequirement!,
            [],
            "p1"
        ).map((t) => t.id);
        expect(ids).toContain("art");
        expect(ids).not.toContain("spell");
        expect(ids).not.toContain("oppArt");
    });

    it("wire format — the recovered card is in hand after projection", () => {
        const art = makeInstance(clayStatue.id, {
            id: "art",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [makePlayer("p1", { graveyard: [art] }), makePlayer("p2")],
        });
        pushSpell(state, reconstruction.id, "p1", [
            { type: "graveyard-card", id: "art", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 0, "p1");
        expect(projected.players[0].hand.some((c) => c?.id === "art")).toBe(
            true
        );
    });
});

describe("Drafna's Restoration (artifact cards from graveyard to top of library, CR 401)", () => {
    it("puts the chosen artifacts on top of the owner's library in the chosen order", () => {
        const g1 = makeInstance(clayStatue.id, {
            id: "g1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const g2 = makeInstance(dragonEngine.id, {
            id: "g2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const top = makeInstance(yotianSoldier.id, {
            id: "top",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [g1, g2],
                    library: [top],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, drafnasRestoration.id, "p1", [
            { type: "graveyard-card", id: "g1", playerId: "p1" },
            { type: "graveyard-card", id: "g2", playerId: "p1" },
        ]);
        // Suspends on the reorder choice.
        resolveTopOfStack(state);
        expect(state.pendingChoices?.length ?? 0).toBe(1);
        // Order them g2 (top) then g1.
        submitChoice(state, ["g2", "g1"]);
        // Library top-to-bottom: g2, g1, then the pre-existing card.
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "g2",
            "g1",
            "top",
        ]);
        // The recurred cards left the graveyard (the resolved sorcery itself
        // lands in the graveyard, so it isn't empty).
        expect(state.players[0].graveyard.some((c) => c.id === "g1")).toBe(
            false
        );
        expect(state.players[0].graveyard.some((c) => c.id === "g2")).toBe(
            false
        );
    });

    it("takes a variable number of graveyard artifact targets (min 1)", () => {
        expect(drafnasRestoration.targetRequirement?.count).toEqual({ min: 1 });
        expect(drafnasRestoration.targetRequirement?.zone).toBe("graveyard");
    });

    it("getLegalTargets offers artifact cards from any player's graveyard", () => {
        const g1 = makeInstance(clayStatue.id, {
            id: "g1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const oppArt = makeInstance(dragonEngine.id, {
            id: "oppArt",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const oppSpell = makeInstance(crumble.id, {
            id: "oppSpell",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [g1] }),
                makePlayer("p2", { graveyard: [oppArt, oppSpell] }),
            ],
        });
        const ids = getLegalTargets(
            state,
            drafnasRestoration.targetRequirement!,
            [],
            "p1"
        ).map((t) => t.id);
        expect(ids).toContain("g1");
        expect(ids).toContain("oppArt");
        expect(ids).not.toContain("oppSpell");
    });
});

describe("Sage of Lat-Nam (CR 602.1 — {T}, sac artifact: draw)", () => {
    it("draws a card on resolution", () => {
        const sage = makeInstance(sageOfLatNam.id, { id: "sage-1" });
        const libCard = makeInstance(ornithopter.id, {
            id: "lib-1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [sage],
                    library: [libCard],
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, sage, "sage-of-lat-nam-draw");
        expect(state.players[0].hand.map((c) => c.id)).toContain("lib-1");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cluster J (#290) — Power Artifact: activated-ability cost reduction.
// CR 601.2f (cost modification) + 118.7 (floor). The aura's `cost-modifier`
// effect reduces the generic portion of the enchanted artifact's activated
// abilities by {2}, clamped so the post-reduction TOTAL mana never drops below
// one. The reduction is scoped to the host via the effect-source `attachedTo`
// check, applies only while attached, and is computed at the activation/payment
// site by `getCostModifiers` + `applyCostModifiers` — the exact functions
// game.ts calls in `activateAbility`.
// ─────────────────────────────────────────────────────────────────────────────

describe("Power Artifact (enchanted artifact's abilities cost {2} less, min 1 mana, CR 601.2f / 118.7)", () => {
    /** Mirror game.ts's `activateAbility` cost calculation: normalize the
     *  ability's printed mana cost, then fold in the battlefield cost
     *  modifiers. Returns the effective normalized cost the player must pay. */
    function effectiveAbilityCost(
        state: GameState,
        host: CardInstanceState,
        abilityId: string
    ): Record<string, number> {
        const def = getCardById((host.card as { id: string }).id);
        const ability = def.activatedAbilities!.find(
            (a) => a.id === abilityId
        )!;
        const cost = ability.cost.mana
            ? normalizeManaCost(ability.cost.mana)
            : {};
        applyCostModifiers(cost, getCostModifiers(state, host, "ability"));
        return cost;
    }

    /** Dragon Engine ({2}: +1/+0) enchanted by Power Artifact, on one board. */
    function enchantedDragonEngine(attached = true) {
        const engine = makeInstance(dragonEngine.id, { id: "engine" });
        const aura = makeInstance(powerArtifact.id, {
            id: "aura",
            ...(attached ? { attachedTo: "engine" } : {}),
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [engine, aura] }),
                makePlayer("p2"),
            ],
        });
        return { state, engine, aura };
    }

    it("definition: {U}{U} Aura that enchants an artifact", () => {
        expect(powerArtifact.manaCost).toEqual({ U: 2 });
        expect(powerArtifact.types).toEqual(["Enchantment"]);
        expect(powerArtifact.subtypes).toEqual(["Aura"]);
        expect(powerArtifact.targetRequirement).toEqual({
            type: "Artifact",
            count: 1,
        });
        const mod = powerArtifact.staticEffects!.find(
            (e) => e.kind === "cost-modifier"
        );
        expect(mod).toBeDefined();
    });

    it("reduces the host's {2} ability to the {1} floor (CR 118.7)", () => {
        const { state, engine } = enchantedDragonEngine();
        // {2} - {2} = {0}, clamped up to the one-mana floor → {1}.
        expect(
            effectiveAbilityCost(state, engine, "dragon-engine-pump")
        ).toEqual({ X: 1 });
    });

    it("does not affect an unenchanted artifact's ability cost", () => {
        const { state, engine } = enchantedDragonEngine(false);
        expect(
            effectiveAbilityCost(state, engine, "dragon-engine-pump")
        ).toEqual({ X: 2 });
    });

    it("reverts the moment the aura detaches (CR 704.5n)", () => {
        const { state, engine, aura } = enchantedDragonEngine();
        expect(
            effectiveAbilityCost(state, engine, "dragon-engine-pump")
        ).toEqual({ X: 1 });
        // SBA-style detach: clear the link; the reduction is read live, so the
        // very next calculation reverts to the printed {2}.
        const liveAura = state.players[0].battlefield.find(
            (c) => c.id === aura.id
        )!;
        delete liveAura.attachedTo;
        expect(
            effectiveAbilityCost(state, engine, "dragon-engine-pump")
        ).toEqual({ X: 2 });
    });

    it("scopes the reduction to its own host, not every artifact", () => {
        const { state, aura } = enchantedDragonEngine();
        // A second, unenchanted Dragon Engine on the same board is untouched.
        const other = makeInstance(dragonEngine.id, { id: "other" });
        state.players[0].battlefield.push(other);
        expect(aura.attachedTo).toBe("engine");
        expect(
            effectiveAbilityCost(state, other, "dragon-engine-pump")
        ).toEqual({ X: 2 });
    });

    it("reduces a {2},{T} ability to {1} and leaves the tap intact", () => {
        const gear = makeInstance(ashnodsBattleGear.id, { id: "gear" });
        const aura = makeInstance(powerArtifact.id, {
            id: "aura",
            attachedTo: "gear",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gear, aura] }),
                makePlayer("p2"),
            ],
        });
        // Mana portion {2} → {1}; the {T} portion is not a mana cost and is
        // untouched by a generic reduction.
        expect(
            effectiveAbilityCost(state, gear, "ashnods-battle-gear-pump")
        ).toEqual({ X: 1 });
    });

    it("does not touch a {T}-only mana ability (no mana in the cost)", () => {
        const strip = makeInstance(stripMine.id, { id: "strip" });
        const aura = makeInstance(powerArtifact.id, {
            id: "aura",
            attachedTo: "strip",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [strip, aura] }),
                makePlayer("p2"),
            ],
        });
        // No mana in the cost → empty normalized cost, nothing to reduce.
        expect(effectiveAbilityCost(state, strip, "strip-mine-mana")).toEqual(
            {}
        );
    });

    it("a reduction well above the floor is applied in full (arithmetic)", () => {
        // applyCostModifiers semantics on a synthetic {3}{U} cost: generic
        // 3 - 2 = 1 (above the one-mana floor once the {U} pip is counted),
        // colored pip preserved → {1}{U}.
        const cost = normalizeManaCost({ X: 3, U: 1 });
        applyCostModifiers(cost, {
            increase: {},
            reductionGeneric: 2,
            minTotalMana: 1,
        });
        expect(cost).toEqual({ X: 1, U: 1 });
    });

    it("the floor protects total mana, dropping generic to 0 when colored pips already meet it", () => {
        // {2}{U}: generic 2 - 2 = 0; the {U} pip alone already meets the
        // one-mana floor, so generic is allowed to drop all the way to 0.
        const cost = normalizeManaCost({ X: 2, U: 1 });
        applyCostModifiers(cost, {
            increase: {},
            reductionGeneric: 2,
            minTotalMana: 1,
        });
        expect(cost).toEqual({ U: 1 });
    });

    it("an enchanted artifact's {2} ability becomes payable with a single mana", () => {
        const { state, engine } = enchantedDragonEngine();
        const cost = effectiveAbilityCost(state, engine, "dragon-engine-pump");
        // One generic mana now covers it (it did not before the aura).
        expect(isManaCostCovered({ C: 1 }, cost)).toBe(true);
        expect(isManaCostCovered({}, cost)).toBe(false);
    });

    it("wire format: attachment + reduction survive projectPublicState", () => {
        const { state } = enchantedDragonEngine();
        const projected = projectPublicState(state, 1, "p1");
        const slimEngine = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "engine")!;
        const slimAura = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "aura")!;
        // The aura's host link survives the projection…
        expect(slimAura.attachedTo).toBe("engine");
        // …and the reduction re-computes against the projected state.
        expect(
            effectiveAbilityCost(
                projected as unknown as GameState,
                slimEngine as unknown as CardInstanceState,
                "dragon-engine-pump"
            )
        ).toEqual({ X: 1 });
    });
});

describe("Energy Flux ({2}{U} Enchantment — CR 113.1 triggered-grant + CR 611 filtered set + CR 603.6a upkeep)", () => {
    it("declares a triggered-grant static effect and the granted template", () => {
        const kinds = (energyFlux.staticEffects ?? []).map((e) => e.kind);
        expect(kinds).toContain("triggered-grant");
        // The granted template lives on triggeredGrantTemplates, NOT on
        // triggeredAbilities (Energy Flux itself must not fire it).
        expect(energyFlux.triggeredAbilities ?? []).toHaveLength(0);
        expect(
            energyFlux.triggeredGrantTemplates?.some(
                (t) => t.id === "energy-flux-upkeep"
            )
        ).toBe(true);
    });

    it("grants the upkeep trigger to every artifact in play", () => {
        const { ring } = withEnergyFlux();
        expect(
            ring.grantedTriggeredAbilities?.some(
                (g) =>
                    g.sourceCardId === energyFlux.id &&
                    g.abilityId === "energy-flux-upkeep"
            )
        ).toBe(true);
        // effectiveTriggeredAbilities unions the granted template in.
        expect(
            effectiveTriggeredAbilities(ring).some(
                (a) => a.id === "energy-flux-upkeep"
            )
        ).toBe(true);
    });

    it("does NOT grant the trigger to a non-artifact (CR 611 filter)", () => {
        const state = makeState();
        const flux = makeInstance(energyFlux.id, {
            id: "flux-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(flux, bear);
        applySourceStaticEffects(state, flux);
        expect(bear.grantedTriggeredAbilities).toBeUndefined();
        expect(
            effectiveTriggeredAbilities(bear).some(
                (a) => a.id === "energy-flux-upkeep"
            )
        ).toBe(false);
    });

    it("fires the granted trigger at the artifact controller's own upkeep (CR 603.6a)", () => {
        const { state, ring } = withEnergyFlux("p1");
        const triggers = collectTriggers(state, [UPKEEP_P1]);
        expect(
            triggers.some(
                (t) =>
                    t.triggeredAbilityId === "energy-flux-upkeep" &&
                    t.triggerSourceId === ring.id
            )
        ).toBe(true);
    });

    it("does NOT fire on the OTHER player's upkeep (scope: your)", () => {
        // Ring controlled by p2; p1's upkeep must not fire its granted trigger.
        const { state } = withEnergyFlux("p2");
        const triggers = collectTriggers(state, [UPKEEP_P1]);
        expect(
            triggers.some((t) => t.triggeredAbilityId === "energy-flux-upkeep")
        ).toBe(false);
    });

    it("paying {2} keeps the artifact (CR 118)", () => {
        const { state } = withEnergyFlux("p1");
        state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 };
        state.stack.push(...collectTriggers(state, [UPKEEP_P1]));
        // Resolution suspends at the may-pay.
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.playerId).toBe("p1");
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        // Artifact survives; {2} was spent.
        expect(
            state.players[0].battlefield.some((c) => c.id === "ring-1")
        ).toBe(true);
        expect(state.players[0].manaPool.C).toBe(0);
    });

    it("declining (or being unable to pay) sacrifices the artifact (CR 701.16)", () => {
        const { state } = withEnergyFlux("p1");
        state.stack.push(...collectTriggers(state, [UPKEEP_P1]));
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(
            state.players[0].battlefield.some((c) => c.id === "ring-1")
        ).toBe(false);
        expect(state.players[0].graveyard.some((c) => c.id === "ring-1")).toBe(
            true
        );
    });

    it("grants the trigger to an artifact that ENTERS after Energy Flux (applyExistingGrantsTo)", () => {
        const { state } = withEnergyFlux("p1");
        const newRing = makeInstance(solRing.id, {
            id: "ring-2",
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[1].battlefield.push(newRing);
        applyExistingGrantsTo(state, newRing);
        expect(
            effectiveTriggeredAbilities(newRing).some(
                (a) => a.id === "energy-flux-upkeep"
            )
        ).toBe(true);
    });

    it("removes the grant when Energy Flux leaves play (unapplySourceStaticEffects)", () => {
        const { state, flux, ring } = withEnergyFlux("p1");
        unapplySourceStaticEffects(state, flux);
        expect(ring.grantedTriggeredAbilities).toBeUndefined();
        expect(
            effectiveTriggeredAbilities(ring).some(
                (a) => a.id === "energy-flux-upkeep"
            )
        ).toBe(false);
    });

    it("wire format: the granted trigger survives projectPublicState and still fires", () => {
        const { state, ring } = withEnergyFlux("p1");
        // Fat-state assertion.
        expect(
            effectiveTriggeredAbilities(ring).some(
                (a) => a.id === "energy-flux-upkeep"
            )
        ).toBe(true);
        // Same assertion after projection (viewer p1).
        const projected = projectPublicState(state, 1, "p1");
        const projRing = projected.players[0].battlefield.find(
            (c) => c.id === "ring-1"
        )!;
        expect(
            projRing.grantedTriggeredAbilities?.some(
                (g) => g.abilityId === "energy-flux-upkeep"
            )
        ).toBe(true);
        // The oracle text resolves through the granting source on the wire
        // (frontend getTriggeredAbilityOracleText path) — non-null.
        const tmpl = energyFlux.triggeredGrantTemplates?.find(
            (t) => t.id === "energy-flux-upkeep"
        );
        expect(tmpl?.oracleText).toContain("sacrifice this artifact");
    });
});

describe("Transmute Artifact (ATQ cluster H — library tutor → battlefield, CR 701.16 / 701.19 / 202.3)", () => {
    /** p1 holds Sol Ring (artifact, mv 1) on the battlefield and a library of
     *  the given cards. Casts Transmute Artifact, sacrifices Sol Ring, then
     *  searches for `foundId`. Returns the resolved state mid-flow (after the
     *  search submit), so callers can assert the ≤ branch outright or feed the
     *  may-pay branch. */
    function castAndSearch(
        library: CardInstanceState[],
        foundId: string | null,
        manaPool?: { C?: number }
    ): GameState {
        const solRingInst = makeInstance(solRing.id, {
            id: "sac-artifact",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [solRingInst],
                    library,
                    manaPool: {
                        W: 0,
                        U: 0,
                        B: 0,
                        R: 0,
                        G: 0,
                        C: manaPool?.C ?? 0,
                    },
                }),
                makePlayer("p2"),
            ],
            rngSeed: 1,
        });
        pushSpell(state, transmuteArtifact.id, "p1");
        resolveTopOfStack(state); // suspends on the sacrifice pick
        expect(state.pendingChoices?.[0]).toMatchObject({
            kind: "sacrifice-permanents",
        });
        submitChoice(state, ["sac-artifact"]); // resumes → suspends on search
        expect(state.pendingChoices?.[0]).toMatchObject({
            kind: "search-library",
        });
        submitChoice(state, foundId ? [foundId] : []); // resumes
        return state;
    }

    it("puts a found artifact of mana value ≤ the sacrificed one straight onto the battlefield", () => {
        const orn = makeInstance(ornithopter.id, {
            id: "found-orn",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        }); // mv 0 ≤ Sol Ring mv 1
        const state = castAndSearch([orn], "found-orn");

        const p1 = state.players[0];
        expect(p1.battlefield.map((c) => c.id)).toContain("found-orn");
        expect(p1.battlefield.map((c) => c.id)).not.toContain("sac-artifact");
        expect(p1.graveyard.map((c) => c.id)).toContain("sac-artifact");
        expect(p1.library).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("offers a pay-the-difference may-pay when the found artifact's mana value is greater, and puts it onto the battlefield when paid", () => {
        const yotian = makeInstance(yotianSoldier.id, {
            id: "found-yotian",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        }); // mv 3 > Sol Ring mv 1 → difference 2
        const state = castAndSearch([yotian], "found-yotian", { C: 2 });

        expect(state.pendingChoices?.[0]).toMatchObject({
            kind: "may-pay",
            cost: { X: 2 },
        });
        applyMayPaySubmit(state, { playerId: "p1", accept: true });

        const p1 = state.players[0];
        expect(p1.battlefield.map((c) => c.id)).toContain("found-yotian");
        expect(p1.manaPool.C).toBe(0); // {2} paid
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("puts the found artifact into its owner's graveyard when the difference is not paid", () => {
        const yotian = makeInstance(yotianSoldier.id, {
            id: "found-yotian",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = castAndSearch([yotian], "found-yotian");

        expect(state.pendingChoices?.[0]).toMatchObject({ kind: "may-pay" });
        applyMayPaySubmit(state, { playerId: "p1", accept: false });

        const p1 = state.players[0];
        expect(p1.battlefield.map((c) => c.id)).not.toContain("found-yotian");
        expect(p1.graveyard.map((c) => c.id)).toContain("found-yotian");
        expect(p1.library).toHaveLength(0);
    });

    it("restricts the search to artifact cards via candidateIds (CR 701.19)", () => {
        const orn = makeInstance(ornithopter.id, {
            id: "lib-artifact",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const bears = makeInstance(grizzlyBears.id, {
            id: "lib-creature",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        }); // not an artifact
        const solRingInst = makeInstance(solRing.id, {
            id: "sac-artifact",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [solRingInst],
                    library: [orn, bears],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, transmuteArtifact.id, "p1");
        resolveTopOfStack(state);
        submitChoice(state, ["sac-artifact"]);

        const search = state.pendingChoices![0];
        expect(search.kind).toBe("search-library");
        expect(search.candidateIds).toEqual(["lib-artifact"]);
    });

    it("sacrifices and shuffles but finds nothing when the library holds no artifact card (fail-to-find, CR 701.19c)", () => {
        const bears = makeInstance(grizzlyBears.id, {
            id: "lib-creature",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = castAndSearch([bears], null);

        const p1 = state.players[0];
        expect(p1.graveyard.map((c) => c.id)).toContain("sac-artifact");
        expect(p1.battlefield.map((c) => c.id)).not.toContain("sac-artifact");
        expect(p1.library.map((c) => c.id)).toEqual(["lib-creature"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("wire format: the tutored artifact is on the caster's projected battlefield (putFromLibraryOntoBattlefield survives projection)", () => {
        const orn = makeInstance(ornithopter.id, {
            id: "found-orn",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = castAndSearch([orn], "found-orn");

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].battlefield.map((c) => c.id)).toContain(
            "found-orn"
        );
    });
});
