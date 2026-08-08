// Legends (LEG) — green per-card behaviour tests (ADR 0043 colour split;
// twin of arn/leb colour test files). Each non-trivial card gets a describe
// block citing the CR section it exercises; assertions check external
// behaviour only. Shared shims live in ./helpers; fixtures in
// convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import {
    END_STEP_C5,
    UPKEEP_C5,
    resolveActivated,
    resolveTrigger,
} from "./helpers";
import {
    amrouKithkin,
    arboria,
    barbaryApes,
    cocoon,
    concordantCrossroads,
    crawGiant,
    durkwoodBoars,
    elvenRiders,
    emeraldDragonfly,
    giantTurtle,
    gravitySphere,
    hundingGjornersen,
    killerBees,
    masterOfTheHunt,
    mossMonster,
    pixieQueen,
    pradeshGypsies,
    rabidWombat,
    shelkinBrownie,
    spiritLink,
    stormSeeker,
    sylvanParadise,
    typhoon,
    wallOfLight,
    whirlingDervish,
    wolverinePack,
} from "..";
import { projectPublicState } from "../../../../gameProjections";
import {
    isLegalBandComposition,
    recordBlockedAttackers,
} from "../../../../gre/banding";
import {
    arboriaForbidsAttack,
    validateAttackerEligibility,
    validateBlockerEligibility,
} from "../../../../gre/combat";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { enumerateMoves, type Move } from "../../../../gre/moves";
import {
    emitBlockersConfirmedEvents,
    finalizeCleanup,
    untapStep,
} from "../../../../gre/phases";
import { checkStateBasedActions } from "../../../../gre/sba";
import {
    applySourceStaticEffects,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { getDefinition } from "../../../index";
import { forest, grizzlyBears, island } from "../../lea";

// ───────────────────────────────────────────────────────────────────────────
// Green free tranche (#375)
// ───────────────────────────────────────────────────────────────────────────

describe("LEG green — vanilla / keyword definitions (CR 110.1 / 702)", () => {
    it("registers the green vanilla creatures with correct P/T", () => {
        expect(getDefinition(barbaryApes.id)).toBe(barbaryApes);
        expect(barbaryApes.power).toBe(2);
        expect(barbaryApes.toughness).toBe(2);
        expect(durkwoodBoars.power).toBe(4);
        expect(durkwoodBoars.toughness).toBe(4);
        expect(mossMonster.power).toBe(3);
        expect(mossMonster.toughness).toBe(6);
    });
});

describe("Elven Riders (can't be blocked except by Walls/flyers, CR 509.1b)", () => {
    function setup(blocker: CardInstanceState) {
        const attacker = makeInstance(elvenRiders.id, {
            id: "rider",
            controllerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        return { state, attacker, blocker };
    }
    it("a ground non-Wall creature may NOT block it", () => {
        const blocker = makeInstance(barbaryApes.id, {
            id: "ground",
            controllerId: "p2",
        });
        const { state, attacker } = setup(blocker);
        const res = validateBlockerEligibility(
            attacker,
            blocker,
            state.players[1].battlefield,
            state
        );
        expect(res.eligible).toBe(false);
    });
    it("a flyer may block it", () => {
        const blocker = makeInstance(emeraldDragonfly.id, {
            id: "flyer",
            controllerId: "p2",
        });
        const { state, attacker } = setup(blocker);
        const res = validateBlockerEligibility(
            attacker,
            blocker,
            state.players[1].battlefield,
            state
        );
        expect(res.eligible).toBe(true);
    });
    it("a Wall may block it", () => {
        // wallOfLight (LEG white) is a Wall; reuse it as a ground Wall blocker.
        const blocker = makeInstance(wallOfLight.id, {
            id: "wall",
            controllerId: "p2",
        });
        const { state, attacker } = setup(blocker);
        const res = validateBlockerEligibility(
            attacker,
            blocker,
            state.players[1].battlefield,
            state
        );
        expect(res.eligible).toBe(true);
    });
});

describe("Rabid Wombat (+2/+2 per attached Aura, CR 604.3 pt-cda + wire)", () => {
    function setup(auraCount: number) {
        const wombat = makeInstance(rabidWombat.id, {
            id: "wombat",
            controllerId: "p1",
        });
        const auras: CardInstanceState[] = [];
        for (let i = 0; i < auraCount; i++) {
            auras.push(
                makeInstance(spiritLink.id, {
                    id: `aura-${i}`,
                    controllerId: "p1",
                    attachedTo: "wombat",
                })
            );
        }
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wombat, ...auras] }),
                makePlayer("p2"),
            ],
        });
        return { state, wombat };
    }
    it("is base 0/1 with no Auras", () => {
        const { state, wombat } = setup(0);
        expect(getEffectivePower(state, wombat)).toBe(0);
        expect(getEffectiveToughness(state, wombat)).toBe(1);
    });
    it("gets +2/+2 per attached Aura (GRE + wire)", () => {
        const { state, wombat } = setup(2);
        // base 0/1 + 2 auras × (+2/+2) = 4 / 5
        expect(getEffectivePower(state, wombat)).toBe(4);
        expect(getEffectiveToughness(state, wombat)).toBe(5);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "wombat"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(getEffectiveToughness(projected, slim)).toBe(5);
    });
});

describe("Emerald Dragonfly ({G}{G}: gains first strike EOT, CR 611.1b)", () => {
    it("grants first strike until end of turn", () => {
        const dragonfly = makeInstance(emeraldDragonfly.id, {
            id: "df",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dragonfly] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, dragonfly, "emerald-dragonfly-first-strike");
        const live = state.players[0].battlefield.find((c) => c.id === "df")!;
        expect(
            live.grantedStaticAbilities?.some(
                (g) => g.ability === "first strike"
            )
        ).toBe(true);
    });
});

describe("Killer Bees ({G}: +1/+1 EOT, CR 611.1)", () => {
    it("pumps itself when activated", () => {
        const bees = makeInstance(killerBees.id, {
            id: "bees",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bees] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, bees, "killer-bees-pump");
        const live = state.players[0].battlefield.find((c) => c.id === "bees")!;
        // base 0/1 + 1/+1
        expect(getEffectivePower(state, live)).toBe(1);
        expect(getEffectiveToughness(state, live)).toBe(2);
    });
});

describe("Pixie Queen ({G}{G}{G}, {T}: target gains flying EOT, CR 611.1b)", () => {
    it("grants flying to a chosen creature", () => {
        const queen = makeInstance(pixieQueen.id, {
            id: "queen",
            controllerId: "p1",
        });
        const grounded = makeInstance(barbaryApes.id, {
            id: "apes",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [queen, grounded] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, queen, "pixie-queen-grant-flying", [
            { type: "permanent", id: "apes" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "apes")!;
        expect(
            live.grantedStaticAbilities?.some((g) => g.ability === "flying")
        ).toBe(true);
    });
});

describe("Pradesh Gypsies ({1}{G}, {T}: target gets -2/-0 EOT, CR 611.1)", () => {
    it("debuffs the target's power", () => {
        const gypsies = makeInstance(pradeshGypsies.id, {
            id: "gyp",
            controllerId: "p1",
        });
        const victim = makeInstance(durkwoodBoars.id, {
            id: "boar",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gypsies] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveActivated(state, gypsies, "pradesh-gypsies-debuff", [
            { type: "permanent", id: "boar" },
        ]);
        const live = state.players[1].battlefield.find((c) => c.id === "boar")!;
        expect(getEffectivePower(state, live)).toBe(2); // 4 - 2
        expect(getEffectiveToughness(state, live)).toBe(4); // unchanged
    });
});

describe("Storm Seeker (damage = target's hand size, CR 120.1)", () => {
    it("deals damage equal to the target player's hand count", () => {
        const hand = [
            makeInstance(forest.id, { id: "g-h1", zone: "hand" }),
            makeInstance(forest.id, { id: "g-h2", zone: "hand" }),
            makeInstance(forest.id, { id: "g-h3", zone: "hand" }),
        ];
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { hand })],
        });
        pushSpell(state, stormSeeker.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17); // 20 - 3
    });
});

describe("Typhoon (damage to each opponent = their Islands, CR 120.1)", () => {
    it("deals damage equal to the opponent's Island count", () => {
        const islands = [
            makeInstance(island.id, { id: "i1", controllerId: "p2" }),
            makeInstance(island.id, { id: "i2", controllerId: "p2" }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: islands }),
            ],
        });
        pushSpell(state, typhoon.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18); // 20 - 2 islands
    });
});

describe("Sylvan Paradise (creatures become green EOT, CR 305.7 layer 5)", () => {
    it("makes the targets green (GRE + wire)", () => {
        const apes = makeInstance(barbaryApes.id, {
            id: "apes",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [apes] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, sylvanParadise.id, "p1", [
            { type: "permanent", id: "apes" },
        ]);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find((c) => c.id === "apes")!;
        expect(live.colorOverride).toEqual(["G"]);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "apes"
        )!;
        expect(slim.colorOverride).toEqual(["G"]);
    });

    // Issue #1834: the color change is "until end of turn" (CR 305.7) — a
    // permanent override is a rules violation for every color-matters
    // interaction (protection, devotion, "target black creature", …) for
    // the rest of the game.
    it("reverts to its original color at cleanup (CR 305.7, issue #1834)", () => {
        const apes = makeInstance(barbaryApes.id, {
            id: "apes",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [apes] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, sylvanParadise.id, "p1", [
            { type: "permanent", id: "apes" },
        ]);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find((c) => c.id === "apes")!;
        expect(live.colorOverride).toEqual(["G"]);

        state.phase = "CLEANUP";
        finalizeCleanup(state);

        expect(live.colorOverride ?? []).toEqual([]);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "apes"
        )!;
        expect(slim.colorOverride ?? []).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// C2 — World rule SBA (CR 704.5m, #379)
// ─────────────────────────────────────────────────────────────────────────────

describe("world rule SBA (CR 704.5m)", () => {
    /** Builds a World permanent instance. `worldSeq` lets a test pin the
     *  relative "time as a world permanent" (higher = newer = shorter time). */
    function world(
        id: string,
        opts: {
            cardId?: string;
            controllerId?: string;
            ownerId?: string;
            worldSeq?: number;
        } = {}
    ) {
        return makeInstance(opts.cardId ?? concordantCrossroads.id, {
            id,
            controllerId: opts.controllerId ?? "p1",
            ownerId: opts.ownerId ?? opts.controllerId ?? "p1",
            ...(opts.worldSeq !== undefined ? { worldSeq: opts.worldSeq } : {}),
        });
    }

    it("a single World permanent is unaffected (SBA no-op)", () => {
        const cc = world("cc");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cc] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);

        expect(state.players[0].battlefield.map((c) => c.id)).toEqual(["cc"]);
        expect(state.players[0].graveyard).toHaveLength(0);
        // Stamped with a timestamp so a later-arriving World can be compared.
        expect(state.players[0].battlefield[0].worldSeq).toBe(1);
    });

    it("a second, newer World permanent graveyards the older one (CR 704.5m)", () => {
        // `old` has been a world permanent longer (lower seq); `fresh` is
        // newer (higher seq) and survives.
        const older = world("older", { worldSeq: 1 });
        const newer = world("newer", {
            cardId: gravitySphere.id,
            worldSeq: 2,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [older, newer] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);

        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "newer",
        ]);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["older"]);
        // Fully automatic — no prompt.
        expect(state.pendingChoices).toBeUndefined();
    });

    it("a simultaneous tie (equal seq) puts ALL tied World permanents into graveyards (CR 704.5m)", () => {
        // Two World permanents first observed in the same arrival event share a
        // seq — the world rule destroys all of them.
        const a = world("a", { cardId: concordantCrossroads.id, worldSeq: 5 });
        const b = world("b", { cardId: gravitySphere.id, worldSeq: 5 });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a, b] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);

        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id).sort()).toEqual([
            "a",
            "b",
        ]);
    });

    it("stamps two unstamped World permanents with one shared seq → tie kills both", () => {
        // No worldSeq on either: this is the "single effect ETB-ed two World
        // permanents" case. The SBA stamps both with the SAME fresh seq in one
        // sweep, then resolves the tie by graveyarding both.
        const a = world("a", { cardId: concordantCrossroads.id });
        const b = world("b", { cardId: gravitySphere.id });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a, b] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);

        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard).toHaveLength(2);
    });

    it("applies GLOBALLY across both players, unlike the per-controller legend rule (CR 704.5m)", () => {
        // Each player controls one World permanent. The world rule is global,
        // so the older one dies even though no single player controls two.
        const mine = world("mine", { controllerId: "p1", worldSeq: 1 });
        const yours = world("yours", {
            cardId: gravitySphere.id,
            controllerId: "p2",
            worldSeq: 2,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mine] }),
                makePlayer("p2", { battlefield: [yours] }),
            ],
        });

        checkStateBasedActions(state);

        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["mine"]);
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "yours",
        ]);
    });

    it("puts a World permanent into its OWNER's graveyard, not the controller's (CR 704.5m)", () => {
        // p1 controls a World enchantment owned by p2 (e.g. via a control
        // effect); when it loses the world rule it goes to p2's graveyard.
        const borrowed = world("borrowed", {
            controllerId: "p1",
            ownerId: "p2",
            worldSeq: 1,
        });
        const ownNewer = world("own-newer", {
            cardId: gravitySphere.id,
            controllerId: "p1",
            ownerId: "p1",
            worldSeq: 2,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [borrowed, ownNewer] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);

        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "own-newer",
        ]);
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual([
            "borrowed",
        ]);
    });

    it("clears worldSeq when a World permanent leaves the battlefield", () => {
        // The doomed permanent is re-stampable as a fresh world permanent on
        // any re-entry (CR 400.7) — its stale seq must not carry over.
        const older = world("older", { worldSeq: 1 });
        const newer = world("newer", {
            cardId: gravitySphere.id,
            worldSeq: 2,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [older, newer] }),
                makePlayer("p2"),
            ],
        });

        checkStateBasedActions(state);

        const dead = state.players[0].graveyard.find((c) => c.id === "older")!;
        expect(dead.worldSeq).toBeUndefined();
    });
});

describe("Concordant Crossroads (World — all creatures have haste, CR 702.10)", () => {
    it("grants haste to every creature, regardless of controller (wire format)", () => {
        const cc = makeInstance(concordantCrossroads.id, {
            id: "cc",
            controllerId: "p1",
        });
        const mine = makeInstance(grizzlyBears.id, {
            id: "mine",
            controllerId: "p1",
        });
        const theirs = makeInstance(grizzlyBears.id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cc, mine] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        applySourceStaticEffects(state, cc);

        expect(
            state.players[0].battlefield.find((c) => c.id === "mine")!
                .staticAbilities
        ).toContain("haste");
        expect(
            state.players[1].battlefield.find((c) => c.id === "theirs")!
                .staticAbilities
        ).toContain("haste");

        // Survives projection (the grant is materialized on staticAbilities).
        const projected = projectPublicState(state, 1, "p1");
        const slimTheirs = projected.players[1].battlefield.find(
            (c) => c.id === "theirs"
        )!;
        expect(slimTheirs.staticAbilities).toContain("haste");
    });
});

describe("Master of the Hunt (Wolves-of-the-Hunt token band, CR 702.22j)", () => {
    it("mints a 1/1 green Wolf with the name-quality keyword that bands with its kin", () => {
        const master = makeInstance(masterOfTheHunt.id, {
            id: "master",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [master] }),
                makePlayer("p2"),
            ],
        });
        // Make two Wolf tokens.
        resolveActivated(state, master, "master-of-the-hunt-wolves");
        resolveActivated(state, master, "master-of-the-hunt-wolves");

        const wolves = state.players[0].battlefield.filter(
            (c) =>
                getDefinition(c.card.id as string).name === "Wolves of the Hunt"
        );
        expect(wolves).toHaveLength(2);
        for (const w of wolves) {
            expect(w.power).toBe(1);
            expect(w.toughness).toBe(1);
            expect(w.subtypes).toContain("Wolf");
            expect(w.staticAbilities).toContain(
                "bands with other:name=Wolves of the Hunt"
            );
        }
        // Two same-named Wolves, at least one with the keyword → legal band.
        expect(isLegalBandComposition(wolves)).toBe(true);
    });
});

describe("Shelkin Brownie (strip 'bands with other' until EOT, CR 611.1b)", () => {
    it("removes the bands-with-other keyword and restores it at cleanup", () => {
        const brownie = makeInstance(shelkinBrownie.id, {
            id: "brownie",
            controllerId: "p1",
        });
        const target = makeInstance(hundingGjornersen.id, {
            id: "legend",
            controllerId: "p2",
            staticAbilities: ["bands with other:legendary"],
        });
        const state = makeState({
            phase: "DECLARE_BLOCKERS",
            players: [
                makePlayer("p1", { battlefield: [brownie] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        resolveActivated(state, brownie, "shelkin-brownie-strip", [
            { type: "permanent", id: "legend" },
        ]);
        expect(target.staticAbilities).not.toContain(
            "bands with other:legendary"
        );

        // CR 514.2 — the strip ends at cleanup; the keyword comes back.
        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(target.staticAbilities).toContain("bands with other:legendary");
    });

    it("leaves plain banding alone (only strips bands-with-other)", () => {
        const brownie = makeInstance(shelkinBrownie.id, {
            id: "brownie",
            controllerId: "p1",
        });
        const target = makeInstance(hundingGjornersen.id, {
            id: "legend",
            controllerId: "p2",
            staticAbilities: ["banding", "bands with other:legendary"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [brownie] }),
                makePlayer("p2", { battlefield: [target] }),
            ],
        });
        resolveActivated(state, brownie, "shelkin-brownie-strip", [
            { type: "permanent", id: "legend" },
        ]);
        expect(target.staticAbilities).toContain("banding"); // untouched
        expect(target.staticAbilities).not.toContain(
            "bands with other:legendary"
        );
    });
});

describe("Cocoon (pupa counters on the Aura + hatch into +1/+1 and flying, CR 122 / 611.2c)", () => {
    function setup(pupa = 3) {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p1",
        });
        const aura = makeInstance(cocoon.id, {
            id: "cocoon",
            controllerId: "p1",
            attachedTo: "host",
            counters: pupa > 0 ? { pupa } : undefined,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        return { state, host, aura };
    }

    it("the host doesn't untap while the Aura carries a pupa counter", () => {
        const { state, host, aura } = setup(3);
        applySourceStaticEffects(state, aura);
        expect(host.staticAbilities).toContain("does-not-untap");
    });

    it("upkeep removes a pupa counter while any remain", () => {
        const { state, aura } = setup(3);
        resolveTrigger(state, aura, "cocoon-upkeep", UPKEEP_C5("p1"));
        const live = state.players[0].battlefield.find(
            (c) => c.id === "cocoon"
        );
        expect(live?.counters?.pupa).toBe(2);
    });

    it("upkeep with no pupa counters left hatches: sacrifices the Aura, +1/+1 counter and flying on the host", () => {
        const { state, aura } = setup(0);
        resolveTrigger(state, aura, "cocoon-upkeep", UPKEEP_C5("p1"));
        // Aura sacrificed.
        expect(
            state.players[0].battlefield.some((c) => c.id === "cocoon")
        ).toBe(false);
        const host = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(host.counters?.["+1/+1"]).toBe(1);
        expect(host.staticAbilities).toContain("flying");
        // Flying persists permanently (no aura link, no duration).
        expect(
            host.grantedStaticAbilities?.some(
                (g) => g.ability === "flying" && !g.duration && !g.auraId
            )
        ).toBe(true);
    });

    // REAL SEQUENCE (issue #1711). Cocoon's lock reads the counters on the
    // SOURCE (the Aura), not the target, and is a MATERIALIZED `keyword-grant`:
    // applied once when the Aura enters and never recomputed. Hand-seeding the
    // pupa counters and THEN calling `applySourceStaticEffects` (the test
    // above) hides that — in play the host stayed locked after the last pupa
    // counter came off. These drive the assertion from the upkeep trigger.
    it("the upkeep trigger lifts the lock when the last pupa counter goes (CR 502.1 / 613.5)", () => {
        const { state, host, aura } = setup(1);
        applySourceStaticEffects(state, aura);
        expect(host.staticAbilities).toContain("does-not-untap");

        resolveTrigger(state, aura, "cocoon-upkeep", UPKEEP_C5("p1"));

        // No manual re-apply: `SpellContext.removeCounter` re-materializes.
        expect(
            state.players[0].battlefield.find((c) => c.id === "cocoon")!
                .counters?.pupa ?? 0
        ).toBe(0);
        expect(host.staticAbilities).not.toContain("does-not-untap");
    });

    it("a tapped host untaps once the Aura's last pupa counter is removed", () => {
        const { state, host, aura } = setup(1);
        host.isTapped = true;
        applySourceStaticEffects(state, aura);

        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        untapStep(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "host")!.isTapped
        ).toBe(true);

        resolveTrigger(state, aura, "cocoon-upkeep", UPKEEP_C5("p1"));
        untapStep(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "host")!.isTapped
        ).toBe(false);
    });
});

describe("Whirling Dervish (end-step +1/+1 if it dealt damage to an opponent this turn, CR 120.3 / 603.4d)", () => {
    function setup(dealt: boolean) {
        const dervish = makeInstance(whirlingDervish.id, {
            id: "dervish",
            controllerId: "p1",
            dealtDamageToOpponentThisTurn: dealt ? true : undefined,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dervish] }),
                makePlayer("p2"),
            ],
        });
        return { state, dervish };
    }

    it("the end-step trigger fires (and grows) only when it dealt damage to an opponent", () => {
        const yes = setup(true);
        const fired = collectTriggers(yes.state, [
            END_STEP_C5("p1") as never,
        ]).some((t) => t.triggeredAbilityId === "whirling-dervish-end-step");
        expect(fired).toBe(true);
        resolveTrigger(
            yes.state,
            yes.dervish,
            "whirling-dervish-end-step",
            END_STEP_C5("p1")
        );
        expect(yes.dervish.counters?.["+1/+1"]).toBe(1);
        expect(getEffectivePower(yes.state, yes.dervish)).toBe(2);
    });

    it("does NOT grow when it dealt no damage to an opponent (intervening-if fizzle)", () => {
        const no = setup(false);
        resolveTrigger(
            no.state,
            no.dervish,
            "whirling-dervish-end-step",
            END_STEP_C5("p1")
        );
        expect(no.dervish.counters?.["+1/+1"]).toBeUndefined();
    });
});

describe("Arboria (CR 508.1c — defender-history attack restriction)", () => {
    it("does not restrict attacks when not on the battlefield", () => {
        const state = makeState();
        expect(arboriaForbidsAttack(state, "p2")).toBe(false);
    });

    it("forbids attacking a defender who took no qualifying action last turn", () => {
        const arb = makeInstance(arboria.id, { controllerId: "p1" });
        const attacker = makeInstance(amrouKithkin.id, {
            controllerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [arb, attacker] }),
                // p2 took no qualifying action last turn.
                makePlayer("p2", { qualifyingActionLastTurn: false }),
            ],
        });
        expect(arboriaForbidsAttack(state, "p2")).toBe(true);
        const v = validateAttackerEligibility(attacker, [], state);
        expect(v.eligible).toBe(false);
    });

    it("allows attacking a defender who cast a spell / played a permanent last turn", () => {
        const arb = makeInstance(arboria.id, { controllerId: "p1" });
        const attacker = makeInstance(amrouKithkin.id, {
            controllerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [arb, attacker] }),
                makePlayer("p2", { qualifyingActionLastTurn: true }),
            ],
        });
        expect(arboriaForbidsAttack(state, "p2")).toBe(false);
        expect(validateAttackerEligibility(attacker, [], state).eligible).toBe(
            true
        );
    });

    it("qualifying-action history survives projection (wire format)", () => {
        const arb = makeInstance(arboria.id, { controllerId: "p1" });
        const attacker = makeInstance(amrouKithkin.id, {
            controllerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [arb, attacker] }),
                makePlayer("p2", { qualifyingActionLastTurn: false }),
            ],
        });
        const projected = projectPublicState(
            state,
            1,
            "p1"
        ) as unknown as typeof state;
        expect(arboriaForbidsAttack(projected, "p2")).toBe(true);
    });
});

describe("Giant Turtle (#490 — self attack restriction, CR 508.1)", () => {
    it("can attack on a turn it did not attack last turn (CR 508.1)", () => {
        // First turn it sees combat: attackedDuringLastTurn is unset → legal.
        const turtle = makeInstance(giantTurtle.id, {
            controllerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [turtle] }),
                makePlayer("p2"),
            ],
        });
        expect(validateAttackerEligibility(turtle, [], state).eligible).toBe(
            true
        );
    });

    it("can't be declared as attacker the turn after it attacked (CR 508.1)", () => {
        const turtle = makeInstance(giantTurtle.id, {
            controllerId: "p1",
            isSummoningSick: false,
            attackedDuringLastTurn: true,
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [turtle] }),
                makePlayer("p2"),
            ],
        });
        const v = validateAttackerEligibility(turtle, [], state);
        expect(v.eligible).toBe(false);
        if (!v.eligible) {
            expect(v.reason).toBe(
                "This creature can't attack if it attacked during your last turn."
            );
        }
    });

    it("can attack again the following turn if it sat out (CR 508.1)", () => {
        // It attacked turn N (attackedDuringLastTurn=true → barred turn N+2),
        // but sat out turn N+2; at cleanup of N+2 the snapshot rolls to false,
        // so on turn N+4 it is legal again.
        const turtle = makeInstance(giantTurtle.id, {
            controllerId: "p1",
            isSummoningSick: false,
            attackedDuringLastTurn: true,
            // It did NOT attack this turn.
        });
        const state = makeState({
            phase: "CLEANUP",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [turtle] }),
                makePlayer("p2"),
            ],
        });
        finalizeCleanup(state);
        // History rolled over: it didn't attack this turn → flag clears.
        expect(turtle.attackedDuringLastTurn).toBeUndefined();
        const declareState = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [turtle] }),
                makePlayer("p2"),
            ],
        });
        expect(
            validateAttackerEligibility(turtle, [], declareState).eligible
        ).toBe(true);
    });

    it("cleanup snapshots hasAttackedThisTurn into attackedDuringLastTurn before clearing it (CR 514.2)", () => {
        const turtle = makeInstance(giantTurtle.id, {
            controllerId: "p1",
            isSummoningSick: false,
            hasAttackedThisTurn: true,
        });
        const state = makeState({
            phase: "CLEANUP",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [turtle] }),
                makePlayer("p2"),
            ],
        });
        finalizeCleanup(state);
        expect(turtle.hasAttackedThisTurn).toBeUndefined();
        expect(turtle.attackedDuringLastTurn).toBe(true);
    });

    it("only the active player's creatures roll over their history at cleanup", () => {
        // p2 (non-active) attacked on its own previous turn; p1's cleanup must
        // NOT touch p2's flag.
        const opponentTurtle = makeInstance(giantTurtle.id, {
            controllerId: "p2",
            isSummoningSick: false,
            attackedDuringLastTurn: true,
            hasAttackedThisTurn: undefined,
        });
        const state = makeState({
            phase: "CLEANUP",
            activePlayerId: "p1",
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [opponentTurtle] }),
            ],
        });
        finalizeCleanup(state);
        // Untouched at p1's cleanup.
        expect(opponentTurtle.attackedDuringLastTurn).toBe(true);
    });

    it("the bot's attacker enumeration (moves.ts) omits a turtle that attacked last turn", () => {
        const turtle = makeInstance(giantTurtle.id, {
            controllerId: "p1",
            isSummoningSick: false,
            attackedDuringLastTurn: true,
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            combat: { attackers: [], confirmed: false } as never,
            players: [
                makePlayer("p1", { battlefield: [turtle] }),
                makePlayer("p2"),
            ],
        });
        const moves = enumerateMoves(state, "p1");
        const declare = moves.filter(
            (m): m is Extract<Move, { kind: "declare-attackers" }> =>
                m.kind === "declare-attackers"
        );
        // The only legal declaration is the empty attack — the turtle is never
        // offered as an attacker.
        expect(declare.length).toBeGreaterThan(0);
        for (const m of declare) {
            expect(m.attackerIds).not.toContain(turtle.id);
        }
    });

    it("the bot's enumeration offers the turtle when it did NOT attack last turn", () => {
        const turtle = makeInstance(giantTurtle.id, {
            controllerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            combat: { attackers: [], confirmed: false } as never,
            players: [
                makePlayer("p1", { battlefield: [turtle] }),
                makePlayer("p2"),
            ],
        });
        const moves = enumerateMoves(state, "p1");
        const offered = moves.some(
            (m) =>
                m.kind === "declare-attackers" &&
                m.attackerIds.includes(turtle.id)
        );
        expect(offered).toBe(true);
    });

    it("attackedDuringLastTurn survives projection (wire format)", () => {
        const turtle = makeInstance(giantTurtle.id, {
            controllerId: "p1",
            isSummoningSick: false,
            attackedDuringLastTurn: true,
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [turtle] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === turtle.id
        )!;
        expect(slim.attackedDuringLastTurn).toBe(true);
        // The same self attack-restriction predicate (used client-side to gray
        // out the attacker) still rejects it after projection.
        const restriction = giantTurtle.staticEffects?.find(
            (e) => e.kind === "attack-restriction"
        );
        expect(
            restriction?.kind === "attack-restriction" &&
                restriction.predicate(slim as never, [])
        ).toBe(false);
    });
});

// ──────────────────────────────────────────────────────────────────────────
// Rampage N (CR 702.23) on Craw Giant / Wolverine Pack — the generic
// mechanism is exercised catalogue-wide in leg/red.test.ts (frostGiant,
// aerathiBerserker); these two prove the SPECIFIC cards actually carry the
// matching `rampageTrigger(2)` and fire it through the real combat path
// (`emitBlockersConfirmedEvents` → `resolveTopOfStack`), not just declare
// the keyword.
// ──────────────────────────────────────────────────────────────────────────

/** Attacker (from `def`) blocked by `blockerCount` Grizzly Bears, all
 *  assigned to it at DECLARE_BLOCKERS. */
function setupRampageCombat(
    def: { id: string },
    blockerCount: number
): { state: GameState; attackerId: string } {
    const attacker = makeInstance(def.id, {
        id: "rampager",
        controllerId: "p1",
        ownerId: "p1",
        isAttacking: true,
    });
    const blockerIds = Array.from(
        { length: blockerCount },
        (_, i) => `blk${i}`
    );
    const blockers = blockerIds.map((id) =>
        makeInstance(grizzlyBears.id, {
            id,
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        })
    );
    const blockerAssignments: Record<string, string[]> = {};
    for (const id of blockerIds) blockerAssignments[id] = ["rampager"];
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [attacker] }),
            makePlayer("p2", { battlefield: blockers }),
        ],
        phase: "DECLARE_BLOCKERS",
        combat: {
            attackerIds: ["rampager"],
            confirmed: true,
            blockerAssignments,
            blockersConfirmed: true,
        },
    });
    recordBlockedAttackers(state);
    return { state, attackerId: attacker.id };
}

describe("Craw Giant (CR 702.19 trample + CR 702.23 rampage 2)", () => {
    it("blocked by two creatures: rampage fires once for +2/+2 (base 6/4 → 8/6)", () => {
        const { state, attackerId } = setupRampageCombat(crawGiant, 2);
        emitBlockersConfirmedEvents(state);
        expect(
            state.stack.filter((s) => s.triggeredAbilityId === "rampage-2")
        ).toHaveLength(1);
        resolveTopOfStack(state);
        const atk = state.players[0].battlefield.find(
            (c) => c.id === attackerId
        )!;
        expect(getEffectivePower(state, atk)).toBe(8);
        expect(getEffectiveToughness(state, atk)).toBe(6);
    });

    it("wire format: pumped P/T survives projectPublicState", () => {
        const { state, attackerId } = setupRampageCombat(crawGiant, 2);
        emitBlockersConfirmedEvents(state);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === attackerId
        )!;
        expect(getEffectivePower(projected, slim)).toBe(8);
        expect(getEffectiveToughness(projected, slim)).toBe(6);
    });
});

describe("Wolverine Pack (CR 702.23 rampage 2)", () => {
    it("blocked by two creatures: rampage fires once for +2/+2 (base 2/4 → 4/6)", () => {
        const { state, attackerId } = setupRampageCombat(wolverinePack, 2);
        emitBlockersConfirmedEvents(state);
        expect(
            state.stack.filter((s) => s.triggeredAbilityId === "rampage-2")
        ).toHaveLength(1);
        resolveTopOfStack(state);
        const atk = state.players[0].battlefield.find(
            (c) => c.id === attackerId
        )!;
        expect(getEffectivePower(state, atk)).toBe(4);
        expect(getEffectiveToughness(state, atk)).toBe(6);
    });
});
