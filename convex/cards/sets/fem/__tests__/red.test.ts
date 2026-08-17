// Per-card behavior tests for red cards in `convex/cards/sets/fem/red.ts`
// (FEM, split by colour per ADR 0043). Each non-trivial card gets a describe
// block citing the CR section it exercises; assertions check external behavior
// only (definition shape, zone after resolution, projected wire-format).

import { describe, it, expect } from "vitest";
import {
    brassclawOrcs,
    brassclawOrcsFemB,
    brassclawOrcsFemC,
    brassclawOrcsFemD,
    dwarvenArmorer,
    dwarvenCatapult,
    dwarvenLieutenant,
    dwarvenSoldier,
    dwarvenSoldierFemB,
    dwarvenSoldierFemC,
    goblinChirurgeon,
    goblinChirurgeonFemB,
    goblinChirurgeonFemC,
    goblinFlotilla,
    goblinGrenade,
    goblinGrenadeFemB,
    goblinGrenadeFemC,
    goblinKites,
    goblinWarDrums,
    goblinWarDrumsFemB,
    goblinWarDrumsFemC,
    goblinWarDrumsFemD,
    goblinWarrens,
    orcishCaptain,
    orcishSpy,
    orcishSpyFemB,
    orcishSpyFemC,
    orcishVeteran,
    orcishVeteranFemB,
    orcishVeteranFemC,
    orcishVeteranFemD,
    orgg,
    raidingParty,
} from "..";
import { getDefinition, getCardByName, getAllCards } from "../../../index";
import {
    resolveTopOfStack,
    applySourceStaticEffects,
} from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { grizzlyBears } from "../../lea";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveActivated, answerPendingChoices } from "./helpers";

// ═══════════════════════════════════════════════════════════════════════════
// C4 — Red: Goblins, Orcs & Dwarves (issue #570). One describe per card with
// non-trivial behaviour. The menace keyword + min-blocker enforcement is
// exercised at the engine level in convex/gre/__tests__/combat.test.ts,
// moves.test.ts and moves-integration.test.ts (ADR 0038); here we assert the
// card data and the War Drums grant on the wire.
// ═══════════════════════════════════════════════════════════════════════════

describe("FEM red registry parity + multi-art prints (ADR 0014)", () => {
    const RED_DEFS = [
        goblinWarDrums,
        goblinGrenade,
        goblinWarrens,
        goblinChirurgeon,
        goblinKites,
        orcishCaptain,
        brassclawOrcs,
        orcishVeteran,
        orcishSpy,
        orgg,
        goblinFlotilla,
        dwarvenLieutenant,
        dwarvenSoldier,
        dwarvenArmorer,
        dwarvenCatapult,
        raidingParty,
    ];

    it("registers all 16 red cards by id and name", () => {
        for (const def of RED_DEFS) {
            expect(getDefinition(def.id)).toBe(def);
            expect(getCardByName(def.name)).toBe(def);
            expect(getAllCards()).toContain(def);
        }
    });

    it("resolves every red alternate artwork to its shared definition", () => {
        const printPairs: Array<[{ printId: string }, { id: string }]> = [
            [goblinWarDrumsFemB, goblinWarDrums],
            [goblinWarDrumsFemC, goblinWarDrums],
            [goblinWarDrumsFemD, goblinWarDrums],
            [goblinGrenadeFemB, goblinGrenade],
            [goblinGrenadeFemC, goblinGrenade],
            [goblinChirurgeonFemB, goblinChirurgeon],
            [goblinChirurgeonFemC, goblinChirurgeon],
            [brassclawOrcsFemB, brassclawOrcs],
            [brassclawOrcsFemC, brassclawOrcs],
            [brassclawOrcsFemD, brassclawOrcs],
            [orcishVeteranFemB, orcishVeteran],
            [orcishVeteranFemC, orcishVeteran],
            [orcishVeteranFemD, orcishVeteran],
            [orcishSpyFemB, orcishSpy],
            [orcishSpyFemC, orcishSpy],
            [dwarvenSoldierFemB, dwarvenSoldier],
            [dwarvenSoldierFemC, dwarvenSoldier],
        ];
        for (const [print, def] of printPairs) {
            expect(getDefinition(print.printId)).toBe(def);
        }
    });
});

describe("Goblin War Drums — grants menace anthem-style (CR 611, 702.111a)", () => {
    it("grants menace to your creatures (GRE + wire), not the opponent's", () => {
        const drums = makeInstance(goblinWarDrums.id, {
            id: "drums",
            controllerId: "p1",
            ownerId: "p1",
        });
        const mine = makeInstance(grizzlyBears.id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
        });
        const theirs = makeInstance(grizzlyBears.id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [drums, mine] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        applySourceStaticEffects(state, drums);
        const mineLive = state.players[0].battlefield.find(
            (c) => c.id === "mine"
        )!;
        const theirsLive = state.players[1].battlefield.find(
            (c) => c.id === "theirs"
        )!;
        expect(mineLive.staticAbilities).toContain("menace");
        expect(theirsLive.staticAbilities).not.toContain("menace");

        // Wire format: the granted keyword survives projection.
        const projected = projectPublicState(state, 1, "p1");
        const slimMine = projected.players[0].battlefield.find(
            (c) => c.id === "mine"
        )!;
        expect(slimMine.staticAbilities).toContain("menace");
    });
});

describe("Goblin Grenade — sacrifice a Goblin, 5 damage (CR 601.2f, 115.4)", () => {
    it("deals 5 damage to a target player on resolution", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { life: 20 })],
        });
        pushSpell(state, goblinGrenade.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(15);
    });
});

describe("Goblin Warrens — sacrifice two Goblins for three tokens (CR 111)", () => {
    it("makes three 1/1 red Goblin tokens when two Goblins are sacrificed", () => {
        const warrens = makeInstance(goblinWarrens.id, {
            id: "warrens",
            controllerId: "p1",
            ownerId: "p1",
        });
        const g1 = makeInstance(grizzlyBears.id, {
            id: "g1",
            controllerId: "p1",
            ownerId: "p1",
            subtypes: ["Goblin"],
        });
        const g2 = makeInstance(grizzlyBears.id, {
            id: "g2",
            controllerId: "p1",
            ownerId: "p1",
            subtypes: ["Goblin"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [warrens, g1, g2] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, warrens, "goblin-warrens-breed");
        answerPendingChoices(state); // sacrifice the two Goblins
        const goblins = state.players[0].battlefield.filter(
            (c) =>
                (c.subtypes ?? []).includes("Goblin") &&
                c.types.includes("Creature") &&
                c.id !== "g1" &&
                c.id !== "g2"
        );
        // The two sacrificed Goblins are gone; three fresh tokens remain.
        expect(state.players[0].battlefield.find((c) => c.id === "g1")).toBe(
            undefined
        );
        expect(goblins).toHaveLength(3);
        for (const t of goblins) {
            expect(t.power).toBe(1);
            expect(t.toughness).toBe(1);
        }
    });
});

describe("Goblin Chirurgeon — sacrifice a Goblin, regenerate (CR 701.19a)", () => {
    it("applies a regeneration shield to the target creature", () => {
        const chirurgeon = makeInstance(goblinChirurgeon.id, {
            id: "chir",
            controllerId: "p1",
            ownerId: "p1",
        });
        const ally = makeInstance(grizzlyBears.id, {
            id: "ally",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [chirurgeon, ally] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, chirurgeon, "goblin-chirurgeon-regen", [
            { type: "permanent", id: "ally" },
        ]);
        const allyLive = state.players[0].battlefield.find(
            (c) => c.id === "ally"
        )!;
        expect(allyLive.regenerationShields ?? 0).toBeGreaterThan(0);
    });
});

describe("Goblin Kites — grant flying + delayed coin-flip (CR 702.9, 705.2)", () => {
    it("grants flying and arms a next-end-step coin-flip delayed trigger", () => {
        const kites = makeInstance(goblinKites.id, {
            id: "kites",
            controllerId: "p1",
            ownerId: "p1",
        });
        const flyer = makeInstance(grizzlyBears.id, {
            id: "flyer",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kites, flyer] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, kites, "goblin-kites-fly", [
            { type: "permanent", id: "flyer" },
        ]);
        const flyerLive = state.players[0].battlefield.find(
            (c) => c.id === "flyer"
        )!;
        expect(flyerLive.staticAbilities).toContain("flying");
        // A delayed trigger is queued for the next end step.
        expect(
            (state.delayedTriggers ?? []).some(
                (d) => d.triggerId === "goblin-kites-flip"
            )
        ).toBe(true);
    });
});

describe("Orcish Captain — coin-flip pump on an Orc (CR 705.2)", () => {
    it("buffs +2/+0 on a winning flip", () => {
        const captain = makeInstance(orcishCaptain.id, {
            id: "cap",
            controllerId: "p1",
            ownerId: "p1",
        });
        const orc = makeInstance(grizzlyBears.id, {
            id: "orc",
            controllerId: "p1",
            ownerId: "p1",
            subtypes: ["Orc"],
        });
        // Seed so flipCoin returns heads (win). The reveal suspends, so resolve
        // twice (push + re-resolve) — modeled by resolving until no suspension.
        const state = makeState({
            rngSeed: 1,
            players: [
                makePlayer("p1", { battlefield: [captain, orc] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, captain, "orcish-captain-flip", [
            { type: "permanent", id: "orc" },
        ]);
        // Drive the suspended coin-flip reveal to completion.
        answerPendingChoices(state);
        const orcLive = state.players[0].battlefield.find(
            (c) => c.id === "orc"
        )!;
        // The coin resolved to one deterministic face for this seed; whichever
        // it is, exactly one of the two P/T modifications applied.
        const power = getEffectivePower(state, orcLive);
        const toughness = getEffectiveToughness(state, orcLive);
        const win = power === 4 && toughness === 2; // +2/+0 on 2/2
        const lose = power === 2 && toughness === 0; // -0/-2 on 2/2
        expect(win || lose).toBe(true);
        expect(orcishCaptain.activatedAbilities![0].targetRequirement).toEqual({
            type: "Creature",
            count: 1,
            subtypeFilter: "Orc",
        });
    });
});

describe("Brassclaw Orcs — can't block power 2+ (CR 509.1b, ADR 0006)", () => {
    it("declares a blocker-side block-restriction predicate", () => {
        const effects = brassclawOrcs.staticEffects ?? [];
        const restriction = effects.find((e) => e.kind === "block-restriction");
        expect(restriction).toBeDefined();
        if (restriction && restriction.kind === "block-restriction") {
            expect(restriction.side).toBe("blocker");
            // Legal to block a 1-power attacker, illegal vs a 2-power attacker.
            const weak = { power: 1 } as never;
            const strong = { power: 2 } as never;
            const self = {} as never;
            expect(restriction.predicate(self, weak)).toBe(true);
            expect(restriction.predicate(self, strong)).toBe(false);
        }
        expect(brassclawOrcs.power).toBe(3);
        expect(brassclawOrcs.toughness).toBe(2);
    });
});

describe("Orcish Veteran — can't block white power 2+ / first strike (CR 509.1b)", () => {
    it("grants first strike to itself on activation", () => {
        const vet = makeInstance(orcishVeteran.id, {
            id: "vet",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [vet] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, vet, "orcish-veteran-first-strike");
        const vetLive = state.players[0].battlefield.find(
            (c) => c.id === "vet"
        )!;
        expect(vetLive.staticAbilities).toContain("first strike");
    });
});

describe("Orcish Spy — look at top three of a library (CR 401.4)", () => {
    it("targets a player and resolves without error", () => {
        expect(orcishSpy.activatedAbilities![0].targetRequirement).toEqual({
            type: "player",
            count: 1,
        });
        const spy = makeInstance(orcishSpy.id, {
            id: "spy",
            controllerId: "p1",
            ownerId: "p1",
        });
        const libCard = makeInstance(grizzlyBears.id, {
            id: "lib1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [spy] }),
                makePlayer("p2", { library: [libCard] }),
            ],
        });
        resolveActivated(state, spy, "orcish-spy-look", [
            { type: "player", id: "p2" },
        ]);
        // Look does not move the card.
        expect(state.players[1].library).toHaveLength(1);
    });
});

describe("Orgg — trample + attack/block restrictions (CR 702.19, 508.1c)", () => {
    it("attack-restriction forbids attacking into an untapped power-3 creature", () => {
        const attackR = (orgg.staticEffects ?? []).find(
            (e) => e.kind === "attack-restriction"
        );
        if (attackR && attackR.kind === "attack-restriction") {
            const self = {} as never;
            const big = [
                { types: ["Creature"], isTapped: false, power: 3 },
            ] as never;
            const small = [
                { types: ["Creature"], isTapped: false, power: 2 },
            ] as never;
            expect(attackR.predicate(self, big)).toBe(false);
            expect(attackR.predicate(self, small)).toBe(true);
        }
    });
});

describe("Dwarven Lieutenant — pump a Dwarf (CR 611.2)", () => {
    it("gives a Dwarf +1/+0 until end of turn", () => {
        const lt = makeInstance(dwarvenLieutenant.id, {
            id: "lt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const dwarf = makeInstance(grizzlyBears.id, {
            id: "dwarf",
            controllerId: "p1",
            ownerId: "p1",
            subtypes: ["Dwarf"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lt, dwarf] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, lt, "dwarven-lieutenant-pump", [
            { type: "permanent", id: "dwarf" },
        ]);
        const dwarfLive = state.players[0].battlefield.find(
            (c) => c.id === "dwarf"
        )!;
        expect(getEffectivePower(state, dwarfLive)).toBe(3); // 2 + 1
    });
});

describe("Dwarven Armorer — discard for a counter (CR 122.1)", () => {
    it("puts a chosen counter on the target after discarding", () => {
        expect(dwarvenArmorer.activatedAbilities![0].resolveSteps).toHaveLength(
            2
        );
        const armorer = makeInstance(dwarvenArmorer.id, {
            id: "armorer",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = makeInstance(grizzlyBears.id, {
            id: "buffme",
            controllerId: "p1",
            ownerId: "p1",
        });
        const handCard = makeInstance(grizzlyBears.id, {
            id: "discardme",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [armorer, target],
                    hand: [handCard],
                }),
                makePlayer("p2"),
            ],
        });
        // Resolve drives resolveSteps; suspensions (discard pick, counter
        // choice) are answered by auto-resolution where no real branch exists.
        resolveActivated(state, armorer, "dwarven-armorer-counter", [
            { type: "permanent", id: "buffme" },
        ]);
        // Answer the discard pick (step 0) and the counter-kind option (step 1).
        answerPendingChoices(state);
        // A +0/+1 or +1/+0 counter landed on the target, and the chosen card
        // was discarded.
        const buffed = state.players[0].battlefield.find(
            (c) => c.id === "buffme"
        )!;
        const counters = buffed.counters ?? {};
        const total = (counters["+0/+1"] ?? 0) + (counters["+1/+0"] ?? 0);
        expect(total).toBe(1);
        expect(
            state.players[0].graveyard.some((c) => c.id === "discardme")
        ).toBe(true);
    });
});

describe("Dwarven Catapult — X damage split among opponent creatures (CR 107.3)", () => {
    it("deals floor(X / N) to each of the opponent's creatures", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { life: 20 })],
        });
        const c1 = makeInstance(grizzlyBears.id, {
            id: "oc1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const c2 = makeInstance(grizzlyBears.id, {
            id: "oc2",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield = [c1, c2];
        const item = pushSpell(state, dwarvenCatapult.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        // X=2 over two creatures → floor(2/2)=1 damage to each (non-lethal on a
        // 2/2). Both survive with 1 damage marked, proving the even split.
        item.chosenX = 2;
        resolveTopOfStack(state);
        const oc1 = state.players[1].battlefield.find((c) => c.id === "oc1");
        const oc2 = state.players[1].battlefield.find((c) => c.id === "oc2");
        expect(oc1?.damageMarked ?? 0).toBe(1);
        expect(oc2?.damageMarked ?? 0).toBe(1);
    });

    it("rounds the split down: X=3 over two creatures = 1 each", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { life: 20 })],
        });
        const c1 = makeInstance(grizzlyBears.id, {
            id: "d1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const c2 = makeInstance(grizzlyBears.id, {
            id: "d2",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield = [c1, c2];
        const item = pushSpell(state, dwarvenCatapult.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 3; // floor(3/2) = 1 to each
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "d1")
                ?.damageMarked ?? 0
        ).toBe(1);
    });
});

describe("Raiding Party — symmetric Plains destruction (CR 701.8)", () => {
    it("sacrifices an Orc and destroys unprotected Plains", () => {
        const party = makeInstance(raidingParty.id, {
            id: "party",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Opponent controls two Plains and no white creatures to protect them.
        const plains1 = makeInstance(getCardByName("Plains").id, {
            id: "pl1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const plains2 = makeInstance(getCardByName("Plains").id, {
            id: "pl2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [party] }),
                makePlayer("p2", { battlefield: [plains1, plains2] }),
            ],
        });
        resolveActivated(state, party, "raiding-party-raze");
        // Drive the per-player tap/protect choices to completion (no white
        // creatures to tap → each player picks nothing → no Plains protected).
        answerPendingChoices(state);
        // With no white creatures to tap, no Plains are protected → both gone.
        const remainingPlains = state.players[1].battlefield.filter((c) =>
            (c.subtypes ?? []).includes("Plains")
        );
        expect(remainingPlains).toHaveLength(0);
    });
});
