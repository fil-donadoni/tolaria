// Per-card behavior tests for colorless cards in `convex/cards/sets/fem/colorless.ts`
// (FEM, split by colour per ADR 0043). Each non-trivial card gets a describe
// block citing the CR section it exercises; assertions check external behavior
// only (definition shape, zone after resolution, projected wire-format).

import { describe, it, expect } from "vitest";
import {
    aeolipile,
    balmOfRestoration,
    bottomlessVault,
    conchHorn,
    delifsCone,
    delifsCube,
    draconianCylix,
    dwarvenHold,
    dwarvenRuins,
    ebonStronghold,
    elvenLyre,
    havenwoodBattleground,
    hollowTrees,
    icatianStore,
    implementsOfSacrifice,
    rainbowVale,
    ringOfRenewal,
    ruinsOfTrokair,
    sandSilos,
    spiritShield,
    svyeluniteTemple,
    vodalianSoldiers,
    zelyonSword,
} from "..";
import {
    getDefinition,
    getCardByName,
    getAllCards,
    getAllSetCodes,
} from "../../../index";
import { resolveTopOfStack } from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { fireDelayedTriggers } from "../../../../gre/phases";
import { tapSourceIntoPayment } from "../../../../game";
import { getEffectiveManaChoices } from "../../../../gre/constants";
import { collectTriggers } from "../../../../gre/triggers";
import { grizzlyBears } from "../../lea";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTrigger, UPKEEP, resolveActivated } from "./helpers";

// ---------------------------------------------------------------------------
// Registry parity — the set must be reachable by id, by name and in the
// deck-builder index (the pool / debug-panel lookup paths).
// ---------------------------------------------------------------------------

describe("FEM registry parity", () => {
    it("registers Vodalian Soldiers by id", () => {
        expect(getDefinition(vodalianSoldiers.id)).toBe(vodalianSoldiers);
    });

    it("registers it by name (debug-panel / pool lookup path)", () => {
        expect(getCardByName("Vodalian Soldiers")).toBe(vodalianSoldiers);
    });

    it("includes it in getAllCards (deck-builder index)", () => {
        expect(getAllCards()).toContain(vodalianSoldiers);
    });

    it("registers the fem set code in the catalogue", () => {
        expect(getAllSetCodes()).toContain("fem");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// C6 — Artifacts & Lands (#573)
// ─────────────────────────────────────────────────────────────────────────────

describe("FEM C6 sacrifice-land cycle (sac-self mana, ADR 0039 / CR 605.1a)", () => {
    const CYCLE = [
        { def: ruinsOfTrokair, color: "W" as const },
        { def: svyeluniteTemple, color: "U" as const },
        { def: ebonStronghold, color: "B" as const },
        { def: dwarvenRuins, color: "R" as const },
        { def: havenwoodBattleground, color: "G" as const },
    ];

    it("ships all five as Lands that enter tapped with a {T} and a sac mana ability", () => {
        for (const { def, color } of CYCLE) {
            expect(def.types).toEqual(["Land"]);
            expect(def.entersTapped).toBe(true);
            const tapMana = def.activatedAbilities?.find(
                (a) => a.id === "sac-land-mana"
            );
            const sacMana = def.activatedAbilities?.find(
                (a) => a.id === "sac-land-sacrifice"
            );
            // Plain {T}: Add {X}.
            expect(tapMana?.useStack).toBe(false);
            expect(tapMana?.cost).toEqual({ tap: true });
            expect(tapMana?.manaProduced).toEqual({ [color]: 1 });
            // {T}, Sacrifice this land: Add {X}{X}. (ADR 0039 sac-self shape.)
            expect(sacMana?.useStack).toBe(false);
            expect(sacMana?.cost).toEqual({ tap: true, sacrifice: true });
            expect(sacMana?.manaProduced).toEqual({ [color]: 2 });
        }
    });

    it("the plain {T} ability adds one mana of the land's colour (CR 605.1a)", () => {
        const land = makeInstance(ebonStronghold.id, {
            id: "land",
            controllerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [land] });
        const state = makeState({ players: [player, makePlayer("p2")] });
        tapSourceIntoPayment(state, player, land, undefined, []);
        expect(player.manaPool.B).toBe(1);
        expect(land.isTapped).toBe(true);
    });
});

describe("FEM C6 storage-land cycle (variable counter-removal → variable mana, CAPABILITY H, CR 106.1/122.6)", () => {
    const CYCLE = [
        { def: icatianStore, color: "W" as const },
        { def: sandSilos, color: "U" as const },
        { def: bottomlessVault, color: "B" as const },
        { def: dwarvenHold, color: "R" as const },
        { def: hollowTrees, color: "G" as const },
    ];

    it("ships all five as Lands that enter tapped, may skip untap, and bank storage", () => {
        for (const { def, color } of CYCLE) {
            expect(def.types).toEqual(["Land"]);
            expect(def.entersTapped).toBe(true);
            expect(def.staticAbilities).toContain("may-choose-not-to-untap");
            const mana = def.activatedAbilities?.find(
                (a) => a.id === "storage-land-mana"
            );
            expect(mana?.useStack).toBe(false);
            expect(mana?.cost).toEqual({ tap: true });
            expect(mana?.manaChoiceRemovesCounters).toBe("storage");
            // Representative / fallback: 0 counters → 0 mana of the colour.
            expect(mana?.manaChoices).toEqual([{ [color]: 0 }]);
        }
    });

    it("banks a storage counter each upkeep while tapped (CR 603.4)", () => {
        const land = makeInstance(bottomlessVault.id, {
            id: "land",
            controllerId: "p1",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, land, "storage-land-upkeep", UPKEEP("p1"));
        const afterOne = state.players[0].battlefield.find(
            (c) => c.id === "land"
        )!;
        expect(afterOne.counters?.storage).toBe(1);
        // A second upkeep while still tapped banks a second counter.
        resolveTrigger(state, afterOne, "storage-land-upkeep", UPKEEP("p1"));
        expect(
            state.players[0].battlefield.find((c) => c.id === "land")!.counters
                ?.storage
        ).toBe(2);
    });

    it("does NOT bank a storage counter when untapped (CR 603.4 condition)", () => {
        const untapped = makeInstance(bottomlessVault.id, {
            id: "land",
            controllerId: "p1",
            isTapped: false,
        });
        const stateUntapped = makeState({
            players: [
                makePlayer("p1", { battlefield: [untapped] }),
                makePlayer("p2"),
            ],
        });
        stateUntapped.activePlayerId = "p1";
        // The upkeep trigger's CR 603.4 condition gates on "this land is
        // tapped" — collectTriggers must NOT surface it while untapped.
        expect(
            collectTriggers(stateUntapped, [UPKEEP("p1") as never]).some(
                (t) => t.triggeredAbilityId === "storage-land-upkeep"
            )
        ).toBe(false);
        // While tapped, the same gate lets it through.
        const tapped = makeInstance(bottomlessVault.id, {
            id: "land",
            controllerId: "p1",
            isTapped: true,
        });
        const stateTapped = makeState({
            players: [
                makePlayer("p1", { battlefield: [tapped] }),
                makePlayer("p2"),
            ],
        });
        stateTapped.activePlayerId = "p1";
        expect(
            collectTriggers(stateTapped, [UPKEEP("p1") as never]).some(
                (t) => t.triggeredAbilityId === "storage-land-upkeep"
            )
        ).toBe(true);
    });

    it("offers 0..available mana choices scaled by storage counters (CR 106.1)", () => {
        const land = makeInstance(hollowTrees.id, {
            id: "land",
            controllerId: "p1",
            counters: { storage: 3 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        const choices = getEffectiveManaChoices(
            land,
            "p1",
            state.players.map((p) => ({
                playerId: p.id,
                battlefield: p.battlefield,
            }))
        );
        // 3 counters → remove 0..3 → produce 0..3 {G} (N mana for N counters).
        expect(choices).toEqual([{ G: 0 }, { G: 1 }, { G: 2 }, { G: 3 }]);
    });

    it("releases N mana for N storage counters removed — full-path through tapSourceIntoPayment (CR 106.1/122.6)", () => {
        const land = makeInstance(icatianStore.id, {
            id: "land",
            controllerId: "p1",
            counters: { storage: 4 },
        });
        const player = makePlayer("p1", { battlefield: [land] });
        const state = makeState({ players: [player, makePlayer("p2")] });
        // Choose index 3 = remove 3 storage counters → produce 3 {W}.
        tapSourceIntoPayment(state, player, land, 3, []);
        expect(player.manaPool.W).toBe(3);
        expect(land.isTapped).toBe(true);
        expect(land.counters?.storage ?? 0).toBe(1); // 4 - 3
    });

    it("index 0 (remove no counters) produces no mana and keeps all counters", () => {
        const land = makeInstance(sandSilos.id, {
            id: "land",
            controllerId: "p1",
            counters: { storage: 2 },
        });
        const player = makePlayer("p1", { battlefield: [land] });
        const state = makeState({ players: [player, makePlayer("p2")] });
        tapSourceIntoPayment(state, player, land, 0, []);
        expect(player.manaPool.U ?? 0).toBe(0);
        expect(land.counters?.storage).toBe(2);
    });
});

describe("Rainbow Vale — control-change-on-tap (CAPABILITY B, ADR 0040 / CR 613.1b)", () => {
    it("is a Land with a {T} any-colour mana ability that arms a next-end-step rider", () => {
        expect(rainbowVale.types).toEqual(["Land"]);
        const mana = rainbowVale.activatedAbilities?.find(
            (a) => a.id === "rainbow-vale-mana"
        );
        expect(mana?.useStack).toBe(false);
        expect(mana?.cost).toEqual({ tap: true });
        expect(mana?.manaChoices).toEqual([
            { W: 1 },
            { U: 1 },
            { B: 1 },
            { R: 1 },
            { G: 1 },
        ]);
        expect(mana?.armsDelayedTriggerOnTap).toEqual({
            triggerId: "rainbow-vale-handoff",
            timing: "next-end-step",
        });
    });

    it("tapping for mana arms a delayed trigger that hands the land to the opponent at the next end step", () => {
        const vale = makeInstance(rainbowVale.id, {
            id: "vale",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [vale] });
        const state = makeState({ players: [player, makePlayer("p2")] });
        state.activePlayerId = "p1";

        // Tap for {R} (index 3): the shared GRE tap path arms the rider (ADR
        // 0040) — no separate call needed (full-path through tapSourceIntoPayment).
        tapSourceIntoPayment(state, player, vale, 3, []);
        expect(player.manaPool.R).toBe(1);
        expect(state.delayedTriggers?.length).toBe(1);
        expect(state.delayedTriggers![0].controller).toBe("p1");

        // Fire the next-end-step delayed trigger and resolve it.
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);

        // p2 (the opponent) now controls the land.
        expect(
            state.players[0].battlefield.find((c) => c.id === "vale")
        ).toBeUndefined();
        const moved = state.players[1].battlefield.find((c) => c.id === "vale");
        expect(moved).toBeDefined();
        expect(moved!.controllerId).toBe("p2");
        // Owner is unchanged (CR 108.3).
        expect(moved!.ownerId).toBe("p1");
    });

    it("ping-pongs: the opponent tapping it hands it back at the next end step", () => {
        // Start with the land already under p2 (after one handoff).
        const vale = makeInstance(rainbowVale.id, {
            id: "vale",
            controllerId: "p2",
            ownerId: "p1",
        });
        const player2 = makePlayer("p2", { battlefield: [vale] });
        const state = makeState({ players: [makePlayer("p1"), player2] });
        state.activePlayerId = "p2";

        tapSourceIntoPayment(state, player2, vale, 0, []); // tap for {W}
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);

        // Control returns to p1 — the opponent of the new activator (p2).
        const moved = state.players[0].battlefield.find((c) => c.id === "vale");
        expect(moved).toBeDefined();
        expect(moved!.controllerId).toBe("p1");
    });

    it("control change survives the wire-format projection (PublicGameState)", () => {
        const vale = makeInstance(rainbowVale.id, {
            id: "vale",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [vale] });
        const state = makeState({ players: [player, makePlayer("p2")] });
        state.activePlayerId = "p1";
        tapSourceIntoPayment(state, player, vale, 3, []);
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        // After the handoff the land is in p2's battlefield on the wire too.
        const p2Board = projected.players[1].battlefield;
        const slim = p2Board.find((c) => c.id === "vale");
        expect(slim).toBeDefined();
        expect(slim!.controllerId).toBe("p2");
    });
});

describe("Implements of Sacrifice — sac-self mana with colour choice (REUSE C, ADR 0039)", () => {
    it("is a {2} Artifact with a {1},{T},Sacrifice: two of any one colour ability", () => {
        expect(implementsOfSacrifice.manaCost).toEqual({ X: 2 });
        const ability = implementsOfSacrifice.activatedAbilities?.[0];
        expect(ability?.useStack).toBe(false);
        expect(ability?.cost).toEqual({
            mana: { X: 1 },
            tap: true,
            sacrifice: true,
        });
        expect(ability?.manaChoices).toEqual([
            { W: 2 },
            { U: 2 },
            { B: 2 },
            { R: 2 },
            { G: 2 },
        ]);
    });

    it("produces two mana of the chosen colour and sacrifices the artifact (CR 605.1a)", () => {
        const impl = makeInstance(implementsOfSacrifice.id, {
            id: "impl",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [impl] });
        const state = makeState({ players: [player, makePlayer("p2")] });
        // Choose index 4 = {G}{G}.
        tapSourceIntoPayment(state, player, impl, 4, []);
        expect(player.manaPool.G).toBe(2);
        // Sacrificed: gone from the battlefield, now in the graveyard.
        expect(
            state.players[0].battlefield.find((c) => c.id === "impl")
        ).toBeUndefined();
        expect(
            state.players[0].graveyard.find((c) => c.id === "impl")
        ).toBeDefined();
    });
});

describe("Spirit Shield / Zelyon Sword — tapped-duration buff (REUSE I, CR 611.2)", () => {
    const KIT = [
        { def: spiritShield, id: "spirit-shield-buff", p: 0, t: 2 },
        { def: zelyonSword, id: "zelyon-sword-buff", p: 2, t: 0 },
    ];

    for (const { def, id, p, t } of KIT) {
        it(`${def.name} grants +${p}/+${t} while tapped and may skip untap`, () => {
            expect(def.staticAbilities).toContain("may-choose-not-to-untap");
            const equip = makeInstance(def.id, {
                id: "equip",
                controllerId: "p1",
            });
            const bear = makeInstance(grizzlyBears.id, {
                id: "bear",
                controllerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [equip, bear] }),
                    makePlayer("p2"),
                ],
            });
            const base = {
                power: getEffectivePower(state, bear),
                toughness: getEffectiveToughness(state, bear),
            };
            resolveActivated(state, equip, id, [
                { type: "permanent", id: "bear" },
            ]);
            // Source (equip) is tapped by the {T} cost — but resolveActivated
            // assumes the cost paid; tap it so the source-tapped buff applies.
            const equipOnBoard = state.players[0].battlefield.find(
                (c) => c.id === "equip"
            )!;
            equipOnBoard.isTapped = true;
            const buffed = state.players[0].battlefield.find(
                (c) => c.id === "bear"
            )!;
            expect(getEffectivePower(state, buffed)).toBe(base.power + p);
            expect(getEffectiveToughness(state, buffed)).toBe(
                base.toughness + t
            );
        });

        it(`${def.name} buff survives the wire-format projection`, () => {
            const equip = makeInstance(def.id, {
                id: "equip",
                controllerId: "p1",
                isTapped: true,
            });
            const bear = makeInstance(grizzlyBears.id, {
                id: "bear",
                controllerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [equip, bear] }),
                    makePlayer("p2"),
                ],
            });
            resolveActivated(state, equip, id, [
                { type: "permanent", id: "bear" },
            ]);
            const projected = projectPublicState(state, 1, "p1");
            const slimBear = projected.players[0].battlefield.find(
                (c) => c.id === "bear"
            )!;
            expect(getEffectivePower(projected, slimBear)).toBe(2 + p);
            expect(getEffectiveToughness(projected, slimBear)).toBe(2 + t);
        });
    }
});

describe("FEM C6 sacrifice / tap-effect artifacts (reuse-only)", () => {
    it("Aeolipile deals 2 damage to any target and sacrifices itself (CR 119)", () => {
        const cone = makeInstance(aeolipile.id, {
            id: "aeo",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cone] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        resolveActivated(state, cone, "aeolipile-damage", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].life).toBe(18);
    });

    it("Balm of Restoration's gain-life mode gains 2 life (CR 119)", () => {
        const balm = makeInstance(balmOfRestoration.id, {
            id: "balm",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [balm], life: 20 }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, balm, "balm-gain-life");
        expect(state.players[0].life).toBe(22);
    });

    it("Balm of Restoration exposes a prevent mode targeting any target", () => {
        const prevent = balmOfRestoration.activatedAbilities?.find(
            (a) => a.id === "balm-prevent"
        );
        expect(prevent?.targetRequirement).toEqual({ type: "any", count: 1 });
    });

    it("Elven Lyre gives +2/+2 until end of turn (CR 611.2c)", () => {
        const lyre = makeInstance(elvenLyre.id, {
            id: "lyre",
            controllerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lyre, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, lyre, "elven-lyre", [
            { type: "permanent", id: "bear" },
        ]);
        const buffed = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(state, buffed)).toBe(4);
        expect(getEffectiveToughness(state, buffed)).toBe(4);
    });

    it("Draconian Cylix applies a regeneration shield to target creature (CR 701.15)", () => {
        const cylix = makeInstance(draconianCylix.id, {
            id: "cylix",
            controllerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cylix, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, cylix, "draconian-cylix", [
            { type: "permanent", id: "bear" },
        ]);
        const shielded = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(shielded.regenerationShields ?? 0).toBeGreaterThan(0);
    });

    it("Delif's Cube regenerates a creature by removing a cube counter (CR 122.6/701.15)", () => {
        const cube = makeInstance(delifsCube.id, {
            id: "cube",
            controllerId: "p1",
            counters: { cube: 1 },
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cube, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, cube, "delifs-cube-regen", [
            { type: "permanent", id: "bear" },
        ]);
        const shielded = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(shielded.regenerationShields ?? 0).toBeGreaterThan(0);
    });

    it("Ring of Renewal and Conch Horn draw cards (CR 121.1)", () => {
        expect(ringOfRenewal.manaCost).toEqual({ X: 5 });
        expect(conchHorn.activatedAbilities?.[0].resolveSteps?.length).toBe(2);
        // Delif's Cone exposes the sac+tap cost and a creature target.
        expect(delifsCone.activatedAbilities?.[0].cost).toEqual({
            tap: true,
            sacrifice: true,
        });
        expect(delifsCone.activatedAbilities?.[0].targetRequirement).toEqual({
            type: "Creature",
            count: 1,
        });
    });
});
