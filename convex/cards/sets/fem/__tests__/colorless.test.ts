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
    ebonStronghold,
    elvenLyre,
    hollowTrees,
    icatianStore,
    implementsOfSacrifice,
    rainbowVale,
    sandSilos,
    spiritShield,
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
import type { CardInstanceState, GameState } from "../../../../gre/state";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import {
    emitBlockersConfirmedEvents,
    finalizeCleanup,
    fireDelayedTriggers,
} from "../../../../gre/phases";
import { tapSourceIntoPayment } from "../../../../game";
import { getEffectiveManaChoices } from "../../../../gre/constants";
import { collectTriggers } from "../../../../gre/triggers";
import { grizzlyBears } from "../../lea";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTrigger,
    UPKEEP,
    resolveActivated,
    answerPendingChoices,
} from "./helpers";

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
    it("produces two mana of the chosen colour and sacrifices the artifact (CR 605.1a)", () => {
        const impl = makeInstance(implementsOfSacrifice.id, {
            id: "impl",
            controllerId: "p1",
            ownerId: "p1",
        });
        // CR 605.1a / 601.2f — the ability costs {1}; float one generic (a
        // red) so the activation is payable. Net output is +1 (pay 1, add 2).
        const player = makePlayer("p1", {
            battlefield: [impl],
            manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
        });
        const state = makeState({ players: [player, makePlayer("p2")] });
        // Choose index 4 = {G}{G}.
        tapSourceIntoPayment(state, player, impl, 4, []);
        expect(player.manaPool.G).toBe(2);
        // The {1} was spent from the floated red.
        expect(player.manaPool.R).toBe(0);
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

    it("Conch Horn draws two cards, then puts one back on top of the library (CR 121.1, 401.4)", () => {
        const horn = makeInstance(conchHorn.id, {
            id: "horn",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(grizzlyBears.id, {
                            id: "h1",
                            controllerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    library: [
                        makeInstance(grizzlyBears.id, {
                            id: "a",
                            controllerId: "p1",
                            zone: "library",
                        }),
                        makeInstance(grizzlyBears.id, {
                            id: "b",
                            controllerId: "p1",
                            zone: "library",
                        }),
                    ],
                    battlefield: [horn],
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, horn, "conch-horn");
        answerPendingChoices(state);
        const p1 = state.players[0];
        expect(p1.hand.map((c) => c.id)).toEqual(
            expect.arrayContaining(["a", "b"])
        );
        expect(p1.hand.map((c) => c.id)).not.toContain("h1");
        expect(p1.library[0]?.id).toBe("h1");
    });
});

// ---------------------------------------------------------------------------
// Delif's Cone / Delif's Cube — the armed unblocked-attack rider: a
// `delayedTrigger` with the `attacks-unblocked` timing (CR 603.7a delayed
// trigger, CR 509.1h "attacks and isn't blocked", CR 514.2 "this turn" bound).
// ---------------------------------------------------------------------------
describe("Delif's Cone / Cube — armed unblocked-attack rider (CR 603.7a / 509.1h)", () => {
    /** A p1 board with the given artifact plus a 2/2 Grizzly Bears ("bear"). */
    function armed(artifact: CardInstanceState) {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [artifact, bear] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        return { state, bear };
    }

    /** Puts `attackerId` into an unblocked attack and confirms blockers, which
     *  is what emits ATTACKER_UNBLOCKED (CR 509.1h). */
    function attackUnblocked(state: GameState, attackerId: string): void {
        const attacker = state.players[0].battlefield.find(
            (c) => c.id === attackerId
        )!;
        attacker.isAttacking = true;
        state.activePlayerId = "p1";
        state.phase = "DECLARE_BLOCKERS";
        state.combat = {
            attackerIds: [attackerId],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: true,
        };
        emitBlockersConfirmedEvents(state);
    }

    function shieldFor(state: GameState, id: string) {
        return (state.sourcePreventionShields ?? []).find(
            (s) => s.sourceIds?.includes(id) && s.combatOnly
        );
    }

    it("arms an instance-scoped attacks-unblocked watch on the targeted creature", () => {
        const cone = makeInstance(delifsCone.id, {
            id: "cone",
            controllerId: "p1",
        });
        const { state } = armed(cone);
        resolveActivated(state, cone, "delifs-cone", [
            { type: "permanent", id: "bear" },
        ]);
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers![0].timing).toBe("attacks-unblocked");
        expect(state.delayedTriggers![0].watchInstanceId).toBe("bear");
        // Nothing has happened to the board yet — the whole ability is the rider.
        expect(state.players[0].life).toBe(20);
        expect(shieldFor(state, "bear")).toBeUndefined();
    });

    it("fires when that creature attacks unblocked; paying gains life equal to its EFFECTIVE power and suppresses its combat damage", () => {
        const cone = makeInstance(delifsCone.id, {
            id: "cone",
            controllerId: "p1",
        });
        const { state, bear } = armed(cone);
        resolveActivated(state, cone, "delifs-cone", [
            { type: "permanent", id: "bear" },
        ]);
        // Counter added AFTER arming: the body must read the power LIVE at
        // resolution (CR 613), not a value frozen at scheduling time.
        state.players[0].battlefield.find((c) => c.id === "bear")!.counters = {
            "+1/+1": 1,
        };
        expect(getEffectivePower(state, bear)).toBe(3);

        attackUnblocked(state, "bear");
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state); // suspends at the cost-free may-pay
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: true });

        expect(state.players[0].life).toBe(23);
        expect(shieldFor(state, "bear")).toBeDefined();
        // "when", not "whenever" — the watch is dequeued by firing.
        expect(state.delayedTriggers ?? []).toHaveLength(0);
    });

    it("declining the may-pay leaves BOTH halves undone (no life, no suppression)", () => {
        const cone = makeInstance(delifsCone.id, {
            id: "cone",
            controllerId: "p1",
        });
        const { state } = armed(cone);
        resolveActivated(state, cone, "delifs-cone", [
            { type: "permanent", id: "bear" },
        ]);
        attackUnblocked(state, "bear");
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });

        expect(state.players[0].life).toBe(20);
        expect(shieldFor(state, "bear")).toBeUndefined();
    });

    it("a DIFFERENT creature attacking unblocked does not fire the watch", () => {
        const cone = makeInstance(delifsCone.id, {
            id: "cone",
            controllerId: "p1",
        });
        const { state } = armed(cone);
        const other = makeInstance(grizzlyBears.id, {
            id: "other",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(other);
        resolveActivated(state, cone, "delifs-cone", [
            { type: "permanent", id: "bear" },
        ]);
        attackUnblocked(state, "other");

        expect(state.stack).toHaveLength(0);
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.players[0].life).toBe(20);
    });

    it("an unfired watch expires at CLEANUP (the 'this turn' bound, CR 514.2)", () => {
        const cone = makeInstance(delifsCone.id, {
            id: "cone",
            controllerId: "p1",
        });
        const { state } = armed(cone);
        resolveActivated(state, cone, "delifs-cone", [
            { type: "permanent", id: "bear" },
        ]);
        expect(state.delayedTriggers).toHaveLength(1);
        finalizeCleanup(state);
        expect(state.delayedTriggers ?? []).toHaveLength(0);
    });

    it("Delif's Cube suppresses the damage and puts a cube counter on the artifact — through the wire projection", () => {
        const cube = makeInstance(delifsCube.id, {
            id: "cube",
            controllerId: "p1",
        });
        const { state } = armed(cube);
        resolveActivated(state, cube, "delifs-cube-arm", [
            { type: "permanent", id: "bear" },
        ]);
        attackUnblocked(state, "bear");
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);

        expect(shieldFor(state, "bear")).toBeDefined();
        const armedCube = state.players[0].battlefield.find(
            (c) => c.id === "cube"
        )!;
        expect(armedCube.counters?.cube).toBe(1);

        // Wire format — the counter the regenerate ability spends must survive
        // `projectPublicState` or the client can never offer that ability.
        const projected = projectPublicState(state, 1, "p1");
        const slimCube = projected.players[0].battlefield.find(
            (c) => c.id === "cube"
        )!;
        expect(slimCube.counters?.cube).toBe(1);
    });
});
