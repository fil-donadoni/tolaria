// Ice Age (ICE) — black card behavior tests (ADR 0043 colour split of the
// former convex/cards/sets/__tests__/ice.test.ts). Each card's describe block
// cites the CR section it exercises.

import { describe, it, expect } from "vitest";
import {
    balduvianBears,
    cloakOfConfusion,
    gazeOfPain,
    burntOffering,
    spoilsOfWar,
    kjeldoranWarrior,
    seaSpirit,
    abyssalSpecter,
    brineShaman,
    darkBanishing,
    darkRitualIce,
    demonicConsultation,
    fearIce,
    foulFamiliar,
    hoarShade,
    howlFromBeyondIce,
    hyalopterousLemure,
    kjeldoranDead,
    knightOfStromgald,
    krovikanVampire,
    leshracsRite,
    mindWarp,
    minionOfTeveshSzat,
    moleWorms,
    moorFiend,
    pestilenceRats,
    songsOfTheDamned,
    spoilsOfEvil,
    stromgaldCabal,
    callToArms,
    stenchOfEvil,
    limDLsCohort,
    limDLsHex,
    mindWhip,
    minionOfLeshrac,
    infernalDenizen,
    soulKiss,
    norritt,
    danceOfTheDead,
    krovikanElementalist,
    leshracsSigil,
    flowOfMaggots,
    gravebind,
    krovikanFetish,
    mindRavel,
    touchOfDeath,
    snowCoveredSwamp,
    snowCoveredForest,
    gangrenousZombies,
    icequake,
    legionsOfLimDL,
    rimeDryad,
    infernalDarkness,
    necropotence,
    oathOfLimDul,
    seizures,
    hecatomb,
    soulBurn,
    ashenGhoul,
} from "../../ice";
import { plains, island, swamp } from "../../lea";
import { applyLandManaReplacement, manaValue } from "../../../../gre/constants";
import {
    getDefinition,
    getCardByName,
    FACE_DOWN_CARD_ID,
} from "../../../index";
import {
    resolveTopOfStack,
    discardCardsAtRandom,
    loseLifeEmitting,
    tapPermanent,
    emitPermanentTapped,
    dealDamageFromPermanentToPlayer,
} from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { collectTriggers } from "../../../../gre/triggers";
import { projectPublicState } from "../../../../gameProjections";
import {
    fireDelayedTriggers,
    advancePhase,
    applyAllCombatDamage,
} from "../../../../gre/phases";
import {
    applyPendingChoiceSubmit,
    applyMayPaySubmit,
} from "../../../../gre/pendingChoiceSubmit";
import { validateBlockerEligibility } from "../../../../gre/combat";
import {
    tryAutoCommitPendingActivation,
    buildPendingActivation,
} from "../../../../game";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import type {
    CardInstanceState,
    GameState,
    PendingActivation,
} from "../../../../gre/state";
import type { StackItem } from "../../../../gre/state";
import type { CardType } from "../../../types";
import {
    resolveActivated,
    submitChoice,
    resolveTrigger,
    vanilla,
    answerMayPay,
    BLACK_UPKEEP,
    library,
    castCantrip,
    enterUpkeepAndFire,
    snowLand,
    makeTargetCreature,
    makeLand,
    BASIC_MANA,
    answerMayPayHead,
    collectAndStack,
    submitPick,
} from "./helpers";

// ═══════════════════════════════════════════════════════════════════════════
// Black free tranche (#632)
// ═══════════════════════════════════════════════════════════════════════════

describe("ICE Black reprints (CardPrint wiring, ADR 0014)", () => {
    it("Dark Ritual print resolves to the LEA definition", () => {
        expect(getDefinition(darkRitualIce.printId).name).toBe("Dark Ritual");
        expect(darkRitualIce.definitionId).toBe(
            "ebb6664d-23ca-456e-9916-afcd6f26aa7f"
        );
        expect(darkRitualIce.setCode).toBe("ice");
    });
    it("Fear print resolves to the LEA definition", () => {
        expect(getDefinition(fearIce.printId).name).toBe("Fear");
    });
    it("Howl from Beyond print resolves to the LEA definition", () => {
        expect(getDefinition(howlFromBeyondIce.printId).name).toBe(
            "Howl from Beyond"
        );
    });
});

describe("ICE Black keyword creatures (CR 702)", () => {
    it("Moor Fiend is a 3/3 with swampwalk", () => {
        expect(moorFiend.staticAbilities).toEqual(["swampwalk"]);
        expect(moorFiend.power).toBe(3);
        expect(moorFiend.toughness).toBe(3);
    });
    it("Knight of Stromgald has protection from white", () => {
        expect(knightOfStromgald.staticAbilities).toEqual([
            "protection from white",
        ]);
    });
    it("Abyssal Specter has flying", () => {
        expect(abyssalSpecter.staticAbilities).toEqual(["flying"]);
    });
});

describe("Abyssal Specter (damage → discard, CR 603.4 / 701.8)", () => {
    it("declares a damage-to-player trigger that forces a discard", () => {
        const trigger = abyssalSpecter.triggeredAbilities!.find(
            (t) => t.id === "abyssal-specter-discard"
        )!;
        expect(trigger).toBeDefined();
        expect(abyssalSpecter.oracleText).toContain("discards a card");
    });
});

describe("Brine Shaman (sacrifice engine, CR 602.1 / 118.5)", () => {
    it("declares a sacrifice-cost pump and a counter ability", () => {
        const pump = brineShaman.activatedAbilities!.find(
            (a) => a.id === "brine-shaman-pump"
        )!;
        expect(pump.cost).toMatchObject({
            tap: true,
            sacrificeFilter: { types: "Creature" },
        });
        const counter = brineShaman.activatedAbilities!.find(
            (a) => a.id === "brine-shaman-counter"
        )!;
        expect(counter.targetRequirement).toMatchObject({
            type: "spell",
            spellTypeFilter: "Creature",
        });
    });
    it("pumps the target +2/+2 until end of turn", () => {
        const shaman = makeInstance(brineShaman.id, {
            id: "bs",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = vanilla("v", 1, 1, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shaman, victim] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, shaman, "brine-shaman-pump", [
            { type: "permanent", id: "v" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "v")!;
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(3);
    });
});

describe("Dark Banishing (destroy nonblack creature, CR 701.7)", () => {
    it("restricts its target to nonblack creatures", () => {
        expect(darkBanishing.targetRequirement).toMatchObject({
            type: "Creature",
            excludeColors: "B",
        });
    });
    it("destroys the target creature", () => {
        const victim = vanilla("v", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        pushSpell(state, darkBanishing.id, "p1", [
            { type: "permanent", id: "v" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "v")
        ).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === "v")).toBe(true);
    });
});

describe("Demonic Consultation (name + exile loop, CR 202.3)", () => {
    it("exiles the top six, then digs to the named card", () => {
        const lib = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
            makeInstance(i === 7 ? moorFiend.id : hoarShade.id, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        const item = pushSpell(state, demonicConsultation.id, "p1");
        // First resolution suspends on the name choice.
        resolveTopOfStack(state);
        // Submit the chosen name and resume.
        const pending = state.pendingChoices?.[0];
        expect(pending?.kind).toBe("name-card");
        // The name-card answer is recorded under the choice; simulate the
        // resume by injecting the collected choice and re-resolving.
        item.collectedChoices = {
            "0:demonic-consultation-name": ["Moor Fiend"],
        };
        state.stack.push(item);
        resolveTopOfStack(state);
        // lib0..lib5 exiled; lib6 (Hoar Shade) exiled; lib7 (Moor Fiend) → hand.
        const me = state.players[0];
        expect(me.exile.length).toBe(7);
        expect(me.hand.some((c) => c.id === "lib7")).toBe(true);
    });
});

describe("Foul Familiar (can't block + bounce, CR 509.1b / 701.14)", () => {
    it("carries a block-restriction that forbids blocking (wire format)", () => {
        const fam = makeInstance(foulFamiliar.id, {
            id: "ff",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fam] }),
                makePlayer("p2"),
            ],
        });
        // The block-restriction predicate is always-false (can't block).
        const restriction = foulFamiliar.staticEffects!.find(
            (e) => e.kind === "block-restriction"
        )!;
        expect(restriction).toBeDefined();
        // Survives projection: the definition is recoverable by id.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "ff"
        )!;
        expect(getDefinition(slim.card.id).name).toBe("Foul Familiar");
    });
    it("returns itself to hand when the ability resolves", () => {
        const fam = makeInstance(foulFamiliar.id, {
            id: "ff",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fam] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, fam, "foul-familiar-bounce");
        expect(
            state.players[0].battlefield.find((c) => c.id === "ff")
        ).toBeUndefined();
        expect(state.players[0].hand.some((c) => c.id === "ff")).toBe(true);
    });
});

describe("Hoar Shade ({B}: +1/+1, CR 611.1b)", () => {
    it("pumps itself +1/+1 until end of turn (wire format)", () => {
        const shade = makeInstance(hoarShade.id, {
            id: "hs",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shade] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, shade, "hoar-shade-pump");
        const live = state.players[0].battlefield.find((c) => c.id === "hs")!;
        expect(getEffectivePower(state, live)).toBe(2);
        expect(getEffectiveToughness(state, live)).toBe(3);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "hs"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

describe("Hyalopterous Lemure ({0}: -1/-0 + flying, CR 611.1b)", () => {
    it("loses a power and gains flying until end of turn", () => {
        const lemure = makeInstance(hyalopterousLemure.id, {
            id: "hl",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lemure] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, lemure, "hyalopterous-lemure-fly");
        const live = state.players[0].battlefield.find((c) => c.id === "hl")!;
        expect(getEffectivePower(state, live)).toBe(3);
        expect(live.staticAbilities).toContain("flying");
    });
});

describe("Kjeldoran Dead (ETB sac + regenerate, CR 603.6 / 701.15)", () => {
    it("regenerates via a shield when the ability resolves", () => {
        const dead = makeInstance(kjeldoranDead.id, {
            id: "kd",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dead] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, dead, "kjeldoran-dead-regenerate");
        const live = state.players[0].battlefield.find((c) => c.id === "kd")!;
        expect(live.regenerationShields ?? 0).toBeGreaterThan(0);
    });
});

describe("Knight of Stromgald (grants + pump, CR 611.1b)", () => {
    it("grants itself first strike until end of turn", () => {
        const knight = makeInstance(knightOfStromgald.id, {
            id: "ks",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [knight] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, knight, "knight-of-stromgald-first-strike");
        const live = state.players[0].battlefield.find((c) => c.id === "ks")!;
        expect(live.staticAbilities).toContain("first strike");
    });
    it("pumps itself +1/+0 until end of turn", () => {
        const knight = makeInstance(knightOfStromgald.id, {
            id: "ks",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [knight] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, knight, "knight-of-stromgald-pump");
        const live = state.players[0].battlefield.find((c) => c.id === "ks")!;
        expect(getEffectivePower(state, live)).toBe(3);
    });
});

describe("Leshrac's Rite (Aura grants swampwalk, CR 611 / 702.13)", () => {
    it("declares a keyword-grant for swampwalk (Snow Devil pattern)", () => {
        expect(leshracsRite.staticEffects?.[0]).toMatchObject({
            kind: "keyword-grant",
            keyword: "swampwalk",
        });
        expect(leshracsRite.targetRequirement).toMatchObject({
            type: "Creature",
        });
    });
    it("grants swampwalk to the host when the Aura resolves onto it", () => {
        const host = vanilla("host", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, leshracsRite.id, "p1", [
            { type: "permanent", id: "host" },
        ]);
        resolveTopOfStack(state);
        const liveHost = state.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(liveHost.staticAbilities).toContain("swampwalk");
        const projected = projectPublicState(state, 1, "p1");
        const slimHost = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(slimHost.staticAbilities).toContain("swampwalk");
    });
});

describe("Mind Warp (look + discard X, CR 701.8)", () => {
    it("targets a player and is an X spell", () => {
        expect(mindWarp.manaCost).toMatchObject({ X: "X", B: 1 });
        expect(mindWarp.targetRequirement).toMatchObject({ type: "player" });
    });
});

describe("Minion of Tevesh Szat (upkeep pay-or-damage, CR 603.6a)", () => {
    it("pumps target +3/-2 until end of turn", () => {
        const minion = makeInstance(minionOfTeveshSzat.id, {
            id: "mts",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = vanilla("v", 4, 4, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [minion] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveActivated(state, minion, "minion-tevesh-szat-pump", [
            { type: "permanent", id: "v" },
        ]);
        const live = state.players[1].battlefield.find((c) => c.id === "v")!;
        expect(getEffectivePower(state, live)).toBe(7);
        expect(getEffectiveToughness(state, live)).toBe(2);
    });
});

describe("Mole Worms (tap-lock a land, CR 611.2)", () => {
    it("taps the target land", () => {
        const worms = makeInstance(moleWorms.id, {
            id: "mw",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(moorFiend.id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
            types: ["Land"] as CardType[],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [worms] }),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        resolveActivated(state, worms, "mole-worms-tap-lock", [
            { type: "permanent", id: "land" },
        ]);
        const live = state.players[1].battlefield.find((c) => c.id === "land")!;
        expect(live.isTapped).toBe(true);
    });
});

describe("Pestilence Rats (CDA power = other Rats, CR 604.3)", () => {
    function setup(extraRats: number) {
        const rats = makeInstance(pestilenceRats.id, {
            id: "pr",
            controllerId: "p1",
            ownerId: "p1",
        });
        const others = Array.from({ length: extraRats }, (_, i) =>
            makeInstance(pestilenceRats.id, {
                id: `rat${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [rats, ...others] }),
                makePlayer("p2"),
            ],
        });
    }
    it("power equals the number of OTHER Rats (wire format)", () => {
        const state = setup(2);
        const live = state.players[0].battlefield.find((c) => c.id === "pr")!;
        expect(getEffectivePower(state, live)).toBe(2);
        expect(getEffectiveToughness(state, live)).toBe(3);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "pr"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
    it("is 0/3 alone", () => {
        const state = setup(0);
        const live = state.players[0].battlefield.find((c) => c.id === "pr")!;
        expect(getEffectivePower(state, live)).toBe(0);
    });
});

describe("Songs of the Damned (add B per creature in graveyard, CR 606)", () => {
    it("adds {B} for each creature card in the graveyard", () => {
        const gy = [0, 1].map((i) =>
            makeInstance(moorFiend.id, {
                id: `gy${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            })
        );
        const state = makeState({
            players: [makePlayer("p1", { graveyard: gy }), makePlayer("p2")],
        });
        pushSpell(state, songsOfTheDamned.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].manaPool?.B ?? 0).toBe(2);
    });
});

describe("Spoils of Evil (mana + life per opp graveyard, CR 606)", () => {
    it("adds {C} and gains life per artifact/creature card", () => {
        const gy = [0, 1, 2].map((i) =>
            makeInstance(moorFiend.id, {
                id: `gy${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "graveyard",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { graveyard: gy }),
            ],
        });
        pushSpell(state, spoilsOfEvil.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[0].manaPool?.C ?? 0).toBe(3);
        expect(state.players[0].life).toBe(23);
    });
});

describe("Stromgald Cabal (counter white spell, CR 701.5)", () => {
    it("restricts its target to white spells", () => {
        const ability = stromgaldCabal.activatedAbilities!.find(
            (a) => a.id === "stromgald-cabal-counter"
        )!;
        expect(ability.targetRequirement).toMatchObject({
            type: "spell",
            colorFilter: "W",
        });
        expect(ability.cost).toMatchObject({ tap: true, life: 1 });
    });
});

describe("Krovikan Vampire (delayed reanimation, CR 603.2 / 603.7c)", () => {
    it("declares a died-trigger keyed on its own damage and a delayed reanimation", () => {
        const trigger = krovikanVampire.triggeredAbilities!.find(
            (t) => t.id === "krovikan-vampire-mark"
        )!;
        expect(trigger).toBeDefined();
        const delayed = krovikanVampire.delayedTriggers!.find(
            (d) => d.id === "krovikan-vampire-reanimate"
        )!;
        expect(delayed.timing).toBe("next-end-step");
    });
});

// --- Registry parity for the Black tranche ----------------------------------

describe("ICE Black tranche registry parity", () => {
    const expected = [
        "Abyssal Specter",
        "Brine Shaman",
        "Dark Banishing",
        "Demonic Consultation",
        "Foul Familiar",
        "Hoar Shade",
        "Hyalopterous Lemure",
        "Kjeldoran Dead",
        "Knight of Stromgald",
        "Krovikan Vampire",
        "Leshrac's Rite",
        "Mind Warp",
        "Minion of Tevesh Szat",
        "Mole Worms",
        "Moor Fiend",
        "Pestilence Rats",
        "Songs of the Damned",
        "Spoils of Evil",
        "Stromgald Cabal",
    ];
    it("registers every activated Black card by name", () => {
        for (const name of expected) {
            expect(getCardByName(name).name).toBe(name);
        }
    });
    it("registers the three Black reprints by print id", () => {
        expect(getDefinition(darkRitualIce.printId).name).toBe("Dark Ritual");
        expect(getDefinition(fearIce.printId).name).toBe("Fear");
        expect(getDefinition(howlFromBeyondIce.printId).name).toBe(
            "Howl from Beyond"
        );
    });
});

// ---------------------------------------------------------------------------
// Call to Arms (CR 611.2c conditional anthem on strict colour plurality +
// CR 603.8 state-triggered self-sacrifice). Jihad-style colour modal pick.
// ---------------------------------------------------------------------------

describe("Call to Arms (#653) — white anthem while chosen colour is opponent's strict plurality", () => {
    /** p1 controls a white creature (Balduvian Bears is green — use a real
     *  white creature: Kjeldoran Warrior is {W}) + Call to Arms (chosen colour =
     *  mode id); p2 is the opponent, seeded by `oppBattlefield`. */
    function withCall(
        modeColor: "W" | "U" | "B" | "R" | "G",
        oppBattlefield: CardInstanceState[]
    ) {
        const whiteCreature = makeInstance(kjeldoranWarrior.id, {
            id: "white-creature",
            controllerId: "p1",
        });
        const inst = makeInstance(callToArms.id, {
            id: "call",
            controllerId: "p1",
            chosenModeId: modeColor,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [whiteCreature, inst] }),
                makePlayer("p2", { battlefield: oppBattlefield }),
            ],
        });
        return { state, whiteCreature, inst };
    }

    it("buffs white creatures +1/+1 while the chosen colour is the opponent's strict plurality", () => {
        // Chosen colour black; opponent controls 2 black + 1 blue → black is the
        // strict plurality.
        const black1 = makeInstance(knightOfStromgald.id, {
            id: "b1",
            controllerId: "p2",
        });
        const black2 = makeInstance(knightOfStromgald.id, {
            id: "b2",
            controllerId: "p2",
        });
        const blue1 = makeInstance(seaSpirit.id, {
            id: "u1",
            controllerId: "p2",
        });
        const { state, whiteCreature } = withCall("B", [black1, black2, blue1]);
        // Kjeldoran Warrior base 1/1 → +1/+1 = 2/2.
        expect(getEffectivePower(state, whiteCreature)).toBe(2);
        expect(getEffectiveToughness(state, whiteCreature)).toBe(2);
    });

    it("no buff when the chosen colour is TIED for most common (not strict)", () => {
        const black1 = makeInstance(knightOfStromgald.id, {
            id: "b1",
            controllerId: "p2",
        });
        const blue1 = makeInstance(seaSpirit.id, {
            id: "u1",
            controllerId: "p2",
        });
        // 1 black + 1 blue → black is tied, not strict plurality.
        const { state, whiteCreature } = withCall("B", [black1, blue1]);
        expect(getEffectivePower(state, whiteCreature)).toBe(1);
    });

    it("tokens of the chosen colour do NOT count toward plurality (CR 111 nontoken)", () => {
        const blackToken = makeInstance(knightOfStromgald.id, {
            id: "b-token",
            controllerId: "p2",
            isToken: true,
        });
        const { state, whiteCreature } = withCall("B", [blackToken]);
        expect(getEffectivePower(state, whiteCreature)).toBe(1);
    });

    it("wire format: the conditional anthem survives projectPublicState (mandatory)", () => {
        const black1 = makeInstance(knightOfStromgald.id, {
            id: "b1",
            controllerId: "p2",
        });
        const black2 = makeInstance(knightOfStromgald.id, {
            id: "b2",
            controllerId: "p2",
        });
        const { state } = withCall("B", [black1, black2]);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "white-creature"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
    });

    it("sacrifices itself when the chosen colour is no longer the strict plurality (CR 603.8)", () => {
        const { state, inst } = withCall("B", []); // opponent has no permanents
        resolveTrigger(state, inst, "call-to-arms-sacrifice", {
            type: "STATE_CHECK",
        } as StackItem["triggerEvent"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "call")
        ).toBeUndefined();
    });

    it("survives the state-trigger while the chosen colour stays the strict plurality (intervening-if)", () => {
        const black1 = makeInstance(knightOfStromgald.id, {
            id: "b1",
            controllerId: "p2",
        });
        const { state, inst } = withCall("B", [black1]);
        resolveTrigger(state, inst, "call-to-arms-sacrifice", {
            type: "STATE_CHECK",
        } as StackItem["triggerEvent"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "call")
        ).toBeDefined();
    });
});

describe("Lim-Dûl's Cohort (blocks/becomes-blocked → can't be regenerated, CR 509.1h / 701.15c)", () => {
    function setup() {
        const cohort = makeInstance(limDLsCohort.id, {
            id: "cohort",
            controllerId: "p1",
            ownerId: "p1",
        });
        const blocker = vanilla("blk", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cohort] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        return { state, cohort };
    }

    it("declares the BLOCKERS_CONFIRMED trigger", () => {
        expect(limDLsCohort.triggeredAbilities?.[0]?.event).toBe(
            "BLOCKERS_CONFIRMED"
        );
    });

    it("marks the other creature as can't-be-regenerated this turn", () => {
        const { state, cohort } = setup();
        resolveTrigger(state, cohort, "lim-duls-cohort-no-regen", {
            type: "BLOCKERS_CONFIRMED",
            attackerId: "cohort",
            attackerControllerId: "p1",
            attackerTypes: ["Creature"],
            attackerSubtypes: ["Zombie"],
            blockerId: "blk",
            blockerControllerId: "p2",
            blockerTypes: ["Creature"],
            blockerSubtypes: [],
        } as StackItem["triggerEvent"]);
        const blk = state.players[1].battlefield.find((c) => c.id === "blk")!;
        expect(blk.cantBeRegeneratedThisTurn).toBe(true);
    });
});

describe("Lim-Dûl's Hex (each player pays {B} or {3} or takes 1, CR 603.6a / 117.3a)", () => {
    function setup() {
        const hex = makeInstance(limDLsHex.id, {
            id: "hex",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hex], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        state.activePlayerId = "p1";
        return { state, hex };
    }

    it("declining both costs deals 1 to each player (APNAP order)", () => {
        const { state, hex } = setup();
        resolveTrigger(state, hex, "lim-duls-hex-upkeep", BLACK_UPKEEP("p1"));
        // p1 (active) first: decline {B}, then decline {3} → 1 damage.
        answerMayPay(state, false); // p1 {B}
        answerMayPay(state, false); // p1 {3}
        answerMayPay(state, false); // p2 {B}
        answerMayPay(state, false); // p2 {3}
        expect(state.players[0].life).toBe(19);
        expect(state.players[1].life).toBe(19);
    });

    it("accepting the {B} leg skips the {3} prompt and avoids damage", () => {
        const { state, hex } = setup();
        // Give p1 a black mana so the {B} leg is affordable.
        state.players[0].manaPool = { B: 1 };
        resolveTrigger(state, hex, "lim-duls-hex-upkeep", BLACK_UPKEEP("p1"));
        answerMayPay(state, true); // p1 pays {B}
        // p2 has no mana → decline both.
        answerMayPay(state, false); // p2 {B}
        answerMayPay(state, false); // p2 {3}
        expect(state.players[0].life).toBe(20); // p1 paid, no damage
        expect(state.players[1].life).toBe(19); // p2 took 1
    });
});

describe("Mind Whip (host-controller upkeep pay {3} or 2 dmg + tap, CR 603.6a)", () => {
    function setup() {
        const host = vanilla("host", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const whip = makeInstance(mindWhip.id, {
            id: "whip",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [whip] }),
                makePlayer("p2", { battlefield: [host], life: 20 }),
            ],
        });
        state.activePlayerId = "p2";
        return { state, whip };
    }

    it("declining deals 2 to the host's controller and taps the host", () => {
        const { state, whip } = setup();
        resolveTrigger(state, whip, "mind-whip-upkeep", BLACK_UPKEEP("p2"));
        answerMayPay(state, false);
        expect(state.players[1].life).toBe(18);
        const host = state.players[1].battlefield.find((c) => c.id === "host")!;
        expect(host.isTapped).toBe(true);
    });
});

describe("Minion of Leshrac (protection, sac-or-5, {T} destroy, CR 702.16 / 603.6a / 701.7)", () => {
    it("carries protection from black", () => {
        expect(minionOfLeshrac.staticAbilities).toContain(
            "protection from black"
        );
    });

    it("declining the sacrifice deals 5 to controller and taps Minion", () => {
        const minion = makeInstance(minionOfLeshrac.id, {
            id: "minion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [minion], life: 20 }),
                makePlayer("p2"),
            ],
        });
        state.activePlayerId = "p1";
        resolveTrigger(
            state,
            minion,
            "minion-of-leshrac-upkeep",
            BLACK_UPKEEP("p1")
        );
        answerMayPay(state, false);
        expect(state.players[0].life).toBe(15);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "minion"
        )!;
        expect(live.isTapped).toBe(true);
    });

    it("{T} destroys a target land", () => {
        const minion = makeInstance(minionOfLeshrac.id, {
            id: "minion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = vanilla("land", 0, 0, {
            controllerId: "p2",
            ownerId: "p2",
            types: ["Land"] as CardType[],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [minion] }),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        resolveActivated(state, minion, "minion-of-leshrac-destroy", [
            { type: "permanent", id: "land" },
        ]);
        expect(state.players[1].battlefield.some((c) => c.id === "land")).toBe(
            false
        );
    });
});

describe("Infernal Denizen (sac-two-Swamps-or-steal, {T} gain control, CR 603.6a / 613.1b)", () => {
    it("{T} gains control of a target creature for as long as Denizen remains", () => {
        const denizen = makeInstance(infernalDenizen.id, {
            id: "denizen",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = vanilla("victim", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [denizen] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveActivated(state, denizen, "infernal-denizen-steal", [
            { type: "permanent", id: "victim" },
        ]);
        const stolen = state.players[0].battlefield.find(
            (c) => c.id === "victim"
        );
        expect(stolen?.controllerId).toBe("p1");
    });

    it("declining the sacrifice taps Denizen and the opponent steals a creature", () => {
        const denizen = makeInstance(infernalDenizen.id, {
            id: "denizen",
            controllerId: "p1",
            ownerId: "p1",
        });
        const myCreature = vanilla("mine", 1, 1, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [denizen, myCreature] }),
                makePlayer("p2"),
            ],
        });
        state.activePlayerId = "p1";
        resolveTrigger(
            state,
            denizen,
            "infernal-denizen-upkeep",
            BLACK_UPKEEP("p1")
        );
        answerMayPay(state, false); // can't sacrifice two Swamps → decline
        // The opponent (p2) now picks one of p1's creatures to steal.
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["mine"],
        });
        const den = state.players[0].battlefield.find(
            (c) => c.id === "denizen"
        )!;
        expect(den.isTapped).toBe(true);
        const stolen = state.players[1].battlefield.find(
            (c) => c.id === "mine"
        );
        expect(stolen?.controllerId).toBe("p2");
    });
});

describe("Soul Kiss (Aura +2/+2, hard cap 3/turn, CR 611.1b / 602.5)", () => {
    function setup() {
        const host = vanilla("host", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(soulKiss.id, {
            id: "kiss",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura], life: 20 }),
                makePlayer("p2"),
            ],
        });
        return { state, aura, host };
    }

    it("pumps the enchanted creature +2/+2 until end of turn", () => {
        const { state, aura, host } = setup();
        resolveActivated(state, aura, "soul-kiss-pump");
        expect(getEffectivePower(state, host)).toBe(4);
        expect(getEffectiveToughness(state, host)).toBe(4);
    });

    it("canActivate caps activations at three per turn (CR 602.5)", () => {
        const ability = soulKiss.activatedAbilities![0];
        const source = { activationsThisTurn: { "soul-kiss-pump": 2 } };
        const source3 = { activationsThisTurn: { "soul-kiss-pump": 3 } };
        // 3rd activation (count 2 so far) is legal; 4th (count 3) is not.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(ability.canActivate!(source as any, {} as any)).toBe(true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(ability.canActivate!(source3 as any, {} as any)).toBe(false);
    });

    it("wire format: the +2/+2 survives projectPublicState", () => {
        const { state, host } = setup();
        const aura = state.players[0].battlefield.find((c) => c.id === "kiss")!;
        resolveActivated(state, aura, "soul-kiss-pump");
        expect(getEffectivePower(state, host)).toBe(4);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
});

describe("Norritt (untap blue / force-attack, CR 701.20b / 508.1d)", () => {
    it("{T} untaps a target blue creature", () => {
        const norr = makeInstance(norritt.id, {
            id: "norr",
            controllerId: "p1",
            ownerId: "p1",
        });
        const blue = makeInstance(getCardByName("Balduvian Bears").id, {
            id: "blue",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
            // Balduvian Bears is green; fake the colour via a blue instance is
            // out of scope — we only assert the untap effect on the target.
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [norr, blue] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, norr, "norritt-untap-blue", [
            { type: "permanent", id: "blue" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "blue")!;
        expect(live.isTapped).toBe(false);
    });

    it("force-attack marks the target must-attack and schedules the destroy", () => {
        const norr = makeInstance(norritt.id, {
            id: "norr",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = vanilla("t", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [norr, target] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, norr, "norritt-force-attack", [
            { type: "permanent", id: "t" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "t")!;
        expect(live.mustAttackThisTurn).toBe(true);
    });
});

describe("Dance of the Dead (graveyard-reanimation aura, CR 303.4i / 611)", () => {
    it("declares the graveyard target and the +1/+1 / does-not-untap statics", () => {
        expect(danceOfTheDead.targetRequirement).toMatchObject({
            zone: "graveyard",
        });
        const kinds = danceOfTheDead.staticEffects!.map((e) => e.kind);
        expect(kinds).toContain("pt-buff");
        expect(kinds).toContain("keyword-grant");
    });

    it("reanimates the enchanted card and applies +1/+1 (it enters tapped)", () => {
        const deadId = getCardByName("Grizzly Bears").id;
        const dead = makeInstance(deadId, {
            id: "dead",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { graveyard: [dead] }),
            ],
        });
        // Cast Dance of the Dead from p1, targeting the creature card in p2's
        // graveyard — the aura branch reanimates it under p1 and attaches.
        pushSpell(state, danceOfTheDead.id, "p1", [
            { type: "graveyard-card", id: "dead", playerId: "p2" },
        ]);
        resolveTopOfStack(state);
        const reanimated = state.players[0].battlefield.find(
            (c) => c.id === "dead"
        );
        expect(reanimated?.controllerId).toBe("p1");
        // +1/+1 layer 7c on the reanimated 2/2 host → 3/3.
        expect(getEffectivePower(state, reanimated!)).toBe(3);
        expect(getEffectiveToughness(state, reanimated!)).toBe(3);
    });
});

describe("Krovikan Elementalist (pump / fly+sac, CR 611.1b / 603.7a)", () => {
    it("{2}{R} pumps a target creature +1/+0", () => {
        const elem = makeInstance(krovikanElementalist.id, {
            id: "elem",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = vanilla("t", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elem, target] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, elem, "krovikan-elementalist-pump", [
            { type: "permanent", id: "t" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "t")!;
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(2);
    });

    it("{U}{U} grants flying and schedules the end-step sacrifice", () => {
        const elem = makeInstance(krovikanElementalist.id, {
            id: "elem",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = vanilla("t", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elem, target] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, elem, "krovikan-elementalist-fly", [
            { type: "permanent", id: "t" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "t")!;
        expect(live.staticAbilities).toContain("flying");
        expect(
            (state.delayedTriggers ?? []).some(
                (d) => d.triggerId === "krovikan-elementalist-sacrifice"
            )
        ).toBe(true);
    });
});

describe("Leshrac's Sigil (green-cast discard / return, CR 603.2 / 701.8)", () => {
    it("declares an opponents-green-spell cast trigger and the return ability", () => {
        expect(leshracsSigil.triggeredAbilities?.[0]?.event).toBe("SPELL_CAST");
        expect(leshracsSigil.activatedAbilities?.[0]?.id).toBe(
            "leshracs-sigil-return"
        );
    });

    it("{B}{B} returns the enchantment to its owner's hand", () => {
        const sigil = makeInstance(leshracsSigil.id, {
            id: "sigil",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sigil] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, sigil, "leshracs-sigil-return");
        expect(state.players[0].battlefield.some((c) => c.id === "sigil")).toBe(
            false
        );
        expect(state.players[0].hand.some((c) => c.id === "sigil")).toBe(true);
    });
});

describe("Flow of Maggots (cumulative upkeep {1} + Walls-only block, CR 702.24 / 509.1b)", () => {
    it("declares a cumulative-upkeep trigger and a block-restriction static", () => {
        expect(flowOfMaggots.triggeredAbilities?.[0]?.id).toBe(
            "flow-of-maggots-cumulative-upkeep"
        );
        expect(flowOfMaggots.staticEffects?.[0]?.kind).toBe(
            "block-restriction"
        );
    });

    it("can be blocked by a Wall but not by a non-Wall creature (CR 509.1b)", () => {
        const flow = makeInstance(flowOfMaggots.id, {
            id: "flow",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const wall = vanilla("wall", 0, 4, {
            controllerId: "p2",
            ownerId: "p2",
            subtypes: ["Wall"],
        });
        const grizzly = vanilla("grz", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [flow] }),
                makePlayer("p2", { battlefield: [wall, grizzly] }),
            ],
        });
        state.activePlayerId = "p1";
        expect(
            validateBlockerEligibility(
                flow,
                wall,
                state.players[1].battlefield,
                state
            ).eligible
        ).toBe(true);
        expect(
            validateBlockerEligibility(
                flow,
                grizzly,
                state.players[1].battlefield,
                state
            ).eligible
        ).toBe(false);
    });
});

describe("Gravebind (can't be regenerated, CR 701.15c)", () => {
    it("flags the target and schedules the cantrip", () => {
        const dummy = vanilla("d", 1, 1, {
            id: "d",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: library("p1", ["a"]) }),
                makePlayer("p2", { battlefield: [dummy] }),
            ],
        });
        castCantrip(state, gravebind.id, "p1", [
            { type: "permanent", id: "d" },
        ]);
        const live = state.players[1].battlefield.find((c) => c.id === "d")!;
        expect(live.cantBeRegeneratedThisTurn).toBe(true);
        enterUpkeepAndFire(state, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
    });
});

describe("Krovikan Fetish (Aura +1/+1 + ETB cantrip, CR 603.6a)", () => {
    it("buffs the host (+1/+1) — wire format survives projection", () => {
        const host = vanilla("h", 2, 2, {
            id: "h",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(krovikanFetish.id, {
            id: "fetish",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "h",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        const live = state.players[0].battlefield.find((c) => c.id === "h")!;
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(3);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "h"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
    it("ETB trigger schedules the next-upkeep cantrip", () => {
        const aura = makeInstance(krovikanFetish.id, {
            id: "fetish",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: library("p1", ["a"]) }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, aura, "krovikan-fetish-etb", {
            type: "PERMANENT_ENTERED",
            instanceId: "fetish",
            controllerId: "p1",
            types: ["Enchantment"],
        } as StackItem["triggerEvent"]);
        expect(state.delayedTriggers?.[0]?.timing).toBe("next-upkeep");
        enterUpkeepAndFire(state, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
    });
});

describe("Mind Ravel (target player discards a card, CR 701.8)", () => {
    it("discards the chosen card then cantrips", () => {
        const handCard = vanilla("h", 1, 1, {
            id: "h",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: library("p1", ["a"]) }),
                makePlayer("p2", { hand: [handCard] }),
            ],
        });
        castCantrip(state, mindRavel.id, "p1", [{ type: "player", id: "p2" }]);
        // Suspended on p2's discard choice.
        submitChoice(state, ["h"]);
        expect(state.players[1].hand).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("h");
        enterUpkeepAndFire(state, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
    });
});

describe("Touch of Death (1 damage + gain 1 life + cantrip, CR 120.1)", () => {
    it("deals 1 damage to the target player, gains 1 life, cantrips", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, library: library("p1", ["a"]) }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        castCantrip(state, touchOfDeath.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].life).toBe(19);
        expect(state.players[0].life).toBe(21);
        enterUpkeepAndFire(state, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
    });
});

describe("Gangrenous Zombies (CR 205.4a conditional damage)", () => {
    it("deals 1 to each creature and player without a snow Swamp", () => {
        const gz = makeInstance(gangrenousZombies.id, {
            id: "gz",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gz] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, gz, "gangrenous-zombies-blast");
        expect(state.players[0].life).toBe(19);
        expect(state.players[1].life).toBe(19);
    });

    it("deals 2 instead when the controller has a snow Swamp", () => {
        const gz = makeInstance(gangrenousZombies.id, {
            id: "gz",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        gz,
                        snowLand(snowCoveredSwamp.id, "ss", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, gz, "gangrenous-zombies-blast");
        expect(state.players[0].life).toBe(18);
        expect(state.players[1].life).toBe(18);
    });
});

describe("Icequake (CR 205.4a snow-land destroy rider)", () => {
    it("destroys the land and deals 1 to its controller when it was snow", () => {
        const snowF = snowLand(snowCoveredForest.id, "sf", "p2");
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [snowF] }),
            ],
        });
        pushSpell(state, icequake.id, "p1", [{ type: "permanent", id: "sf" }]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "sf")
        ).toBeUndefined();
        expect(state.players[1].life).toBe(19);
    });

    it("destroys a non-snow land with no damage", () => {
        const plain = makeInstance("6f1c8cb0-38eb-408b-94e8-16db83999b3b", {
            id: "pf",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [plain] }),
            ],
        });
        pushSpell(state, icequake.id, "p1", [{ type: "permanent", id: "pf" }]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "pf")
        ).toBeUndefined();
        expect(state.players[1].life).toBe(20);
    });
});

describe("snow landwalk (CR 702.13 / 205.4a)", () => {
    it("Legions of Lim-Dûl has snow swampwalk and is unblockable vs a snow Swamp", () => {
        expect(legionsOfLimDL.staticAbilities).toContain("snow swampwalk");
        const attacker = makeInstance(legionsOfLimDL.id, {
            id: "atk",
            controllerId: "p1",
        });
        const blocker = vanilla("blk", 2, 2);
        blocker.controllerId = "p2";
        const snowSwamp = snowLand(snowCoveredSwamp.id, "ss", "p2");
        const res = validateBlockerEligibility(attacker, blocker, [
            snowSwamp,
            blocker,
        ]);
        expect(res.eligible).toBe(false);
    });

    it("snow swampwalk does NOT evade when the defender's Swamp is non-snow", () => {
        const attacker = makeInstance(legionsOfLimDL.id, {
            id: "atk",
            controllerId: "p1",
        });
        const blocker = vanilla("blk", 2, 2);
        blocker.controllerId = "p2";
        const plainSwamp = makeInstance(
            "6176936d-72e2-4205-8871-4c5a4f1cb2d8",
            { id: "ps", controllerId: "p2", ownerId: "p2" }
        );
        const res = validateBlockerEligibility(attacker, blocker, [
            plainSwamp,
            blocker,
        ]);
        expect(res.eligible).toBe(true);
    });

    it("Rime Dryad has snow forestwalk", () => {
        expect(rimeDryad.staticAbilities).toContain("snow forestwalk");
    });
});

describe("Soul Burn ({X}{2}{B} — X damage, lifegain capped by {B} spent on X, CR 119)", () => {
    function setup(targetToughness = 9): GameState {
        return makeState({
            players: [
                makePlayer("p1", { life: 10 }),
                makePlayer("p2", {
                    battlefield: [
                        makeTargetCreature("victim", targetToughness),
                    ],
                }),
            ],
        });
    }

    it("has the {X}{2}{B} cost (generic field), any-target requirement, and noteManaSpent", () => {
        expect(soulBurn.manaCost).toEqual({ X: "X", generic: 2, B: 1 });
        expect(soulBurn.targetRequirement).toEqual({ type: "any", count: 1 });
        expect(soulBurn.noteManaSpent).toBe(true);
        // {X}{2}{B} printed mana value = 3 (variable X counts as 0).
        expect(manaValue(soulBurn.manaCost)).toBe(3);
    });

    it("deals X damage and gains life = {B} spent on X (all-black payment)", () => {
        const state = setup();
        const item = pushSpell(state, soulBurn.id, "p1", [
            { type: "permanent", id: "victim" },
        ]);
        item.chosenX = 3;
        // Paid {3}{2}{B} all in black: 6 black total, 1 is the fixed pip → 5
        // black, but only 3 went to X (X=3). Cap = min(X, blackOnX) = 3.
        item.notedManaSpent = { B: 6 };
        resolveTopOfStack(state);
        const victim = state.players[1].battlefield.find(
            (c) => c.id === "victim"
        )!;
        expect(victim.damageMarked).toBe(3);
        expect(state.players[0].life).toBe(13); // 10 + 3
    });

    it("caps lifegain by the {B} spent on X when X is paid mostly with red", () => {
        const state = setup();
        const item = pushSpell(state, soulBurn.id, "p1", [
            { type: "permanent", id: "victim" },
        ]);
        item.chosenX = 4;
        // X=4 paid with {2}{R}{R} + the fixed {2}{B}: only 1 black spent total,
        // which is the fixed pip → 0 black on X → NO lifegain.
        item.notedManaSpent = { B: 1, R: 2, C: 0 };
        resolveTopOfStack(state);
        const victim = state.players[1].battlefield.find(
            (c) => c.id === "victim"
        )!;
        expect(victim.damageMarked).toBe(4);
        expect(state.players[0].life).toBe(10); // damage dealt, no life gained
    });

    it("gains only the black-on-X portion when X is paid with a black/red mix", () => {
        const state = setup();
        const item = pushSpell(state, soulBurn.id, "p1", [
            { type: "permanent", id: "victim" },
        ]);
        item.chosenX = 3;
        // X=3 paid {B}{B}{R}; fixed {2}{B} paid {2}{B}. Total black = 3: 1 fixed
        // pip + 2 on X → lifegain capped at 2.
        item.notedManaSpent = { B: 3, R: 1, C: 0 };
        resolveTopOfStack(state);
        const victim = state.players[1].battlefield.find(
            (c) => c.id === "victim"
        )!;
        expect(victim.damageMarked).toBe(3);
        expect(state.players[0].life).toBe(12); // 10 + 2
    });
});

describe("Spoils of War ({X}{B} — distribute X +1/+1 counters as you choose; X from opponent graveyard, CR 107.3 / 601.2d)", () => {
    function setup(
        targetIds: string[],
        opponentGraveyardTypes: CardType[][] = []
    ): GameState {
        const p2Graveyard = opponentGraveyardTypes.map((types, i) =>
            makeInstance(balduvianBears.id, {
                id: `gy-${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "graveyard",
                types,
            })
        );
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: targetIds.map((id) =>
                        makeInstance(balduvianBears.id, {
                            id,
                            controllerId: "p1",
                            ownerId: "p1",
                            power: 2,
                            toughness: 2,
                        })
                    ),
                }),
                makePlayer("p2", { graveyard: p2Graveyard }),
            ],
        });
    }

    it("declares cast-time graveyard-derived X (artifact and/or creature) and counter distribution", () => {
        expect(spoilsOfWar.manaCost).toEqual({ X: "X", B: 1 });
        expect(spoilsOfWar.additionalCosts?.xFromOpponentGraveyard).toEqual({
            cardTypes: ["Artifact", "Creature"],
        });
        expect(spoilsOfWar.targetRequirement?.divideAsChosen).toEqual({
            total: "X",
        });
    });

    it("distributes X +1/+1 counters unevenly across target creatures", () => {
        const state = setup(["a", "b"]);
        const item = pushSpell(state, spoilsOfWar.id, "p1", [
            { type: "permanent", id: "a" },
            { type: "permanent", id: "b" },
        ]);
        item.chosenX = 4;
        item.targetAmounts = { "permanent:a": 3, "permanent:b": 1 };
        resolveTopOfStack(state);
        const a = state.players[0].battlefield.find((c) => c.id === "a")!;
        const b = state.players[0].battlefield.find((c) => c.id === "b")!;
        expect(a.counters?.["+1/+1"]).toBe(3);
        expect(b.counters?.["+1/+1"]).toBe(1);
        // 2/2 base + counters → effective P/T grows (layer 7d).
        expect(getEffectivePower(state, a)).toBe(5);
        expect(getEffectiveToughness(state, b)).toBe(3);
    });

    it("wire format: +1/+1 counter buff survives projectPublicState", () => {
        const state = setup(["a", "b"]);
        const item = pushSpell(state, spoilsOfWar.id, "p1", [
            { type: "permanent", id: "a" },
            { type: "permanent", id: "b" },
        ]);
        item.chosenX = 3;
        item.targetAmounts = { "permanent:a": 2, "permanent:b": 1 };
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const a = projected.players[0].battlefield.find((c) => c.id === "a")!;
        expect(getEffectivePower(projected, a)).toBe(4);
    });
});

describe("Infernal Darkness — lands produce {B} (CR 614, #665)", () => {
    it("shape: cumulative-upkeep {B} and 1 life + single-colour land substitution", () => {
        expect(infernalDarkness.types).toContain("Enchantment");
        expect(infernalDarkness.manaCost).toEqual({ X: 2, B: 2 });
        expect(infernalDarkness.landManaSubstitution).toEqual({ color: "B" });
        const cu = infernalDarkness.triggeredAbilities?.find((t) =>
            t.id?.includes("cumulative-upkeep")
        );
        expect(cu).toBeTruthy();
    });

    it("every basic land tapped for mana produces {B} instead", () => {
        const enchant = makeInstance(infernalDarkness.id, {
            id: "id",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        for (const landId of Object.keys(BASIC_MANA)) {
            const land = makeLand(landId, "p2");
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [enchant] }),
                    makePlayer("p2", { battlefield: [land] }),
                ],
            });
            const out = applyLandManaReplacement(
                state,
                "p2",
                land,
                BASIC_MANA[landId]
            );
            // Same total (1), type rewritten to {B}.
            expect(out).toEqual({ B: 1 });
        }
    });

    it("no effect once Infernal Darkness leaves the battlefield", () => {
        const land = makeLand(plains.id, "p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        const out = applyLandManaReplacement(state, "p1", land, { W: 1 });
        expect(out).toEqual({ W: 1 });
    });
});

// ---------------------------------------------------------------------------
// Necropotence (#667) — CR 504/614 skip-draw + CR 701.8/603 discard→exile
// trigger + CR 118.4 pay-life face-down exile + CR 603.7a next-end-step return.
// ---------------------------------------------------------------------------

describe("Necropotence (CR 504/614 skip-draw + CR 701.8 discard→exile)", () => {
    // A distinct vanilla filler in the named zone (library/hand/graveyard).
    const filler = (id: string, zone: CardInstanceState["zone"]) =>
        makeInstance(balduvianBears.id, { id, controllerId: "p1", zone });

    it("is a {B}{B}{B} Enchantment with the modern oracle wording (#667)", () => {
        expect(necropotence.manaCost).toEqual({ B: 3 });
        expect(necropotence.types).toEqual(["Enchantment"]);
        expect(necropotence.rarity).toBe("rare");
        expect(necropotence.oracleText).toBe(
            "Skip your draw step.\nWhenever you discard a card, exile that card from your graveyard.\nPay 1 life: Exile the top card of your library face down. Put that card into your hand at the beginning of your next end step."
        );
        // CR 504/614 — skip-draw via the shipped flag.
        expect(necropotence.drawStepReplacement).toBe(true);
        // CR 701.8/603 — the discard→exile trigger subscribes to CARD_DISCARDED.
        const trig = necropotence.triggeredAbilities?.[0];
        expect(trig?.event).toBe("CARD_DISCARDED");
    });

    it("registers by id and name (#667)", () => {
        expect(getDefinition(necropotence.id)).toBe(necropotence);
        expect(getCardByName("Necropotence")).toBe(necropotence);
    });

    // --- Skip-draw replacement (CR 504/614) --------------------------------
    it("skips the controller's draw step while in play (CR 504.1/614)", () => {
        const necro = makeInstance(necropotence.id, {
            id: "necro",
            controllerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            turn: 2,
            phase: "UPKEEP",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    battlefield: [necro],
                    library: [filler("top", "library")],
                }),
                makePlayer("p2"),
            ],
        });
        advancePhase(state); // UPKEEP → DRAW
        expect(state.phase).toBe("DRAW");
        // No draw happened — the card stays on top of the library.
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].library.map((c) => c.id)).toEqual(["top"]);
    });

    // --- Discard → exile trigger (CR 701.8/603) ----------------------------
    it("emits CARD_DISCARDED on a discard and exiles it from the graveyard", () => {
        const necro = makeInstance(necropotence.id, {
            id: "necro",
            controllerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [necro],
                    hand: [filler("discarded", "hand")],
                }),
                makePlayer("p2"),
            ],
        });
        // CR 701.8 — discard the card (any discard path; random is the simplest
        // engine driver and flows through the same discardToGraveyard choke).
        discardCardsAtRandom(state, "p1", 1);

        // The card landed in the graveyard and a CARD_DISCARDED event fired.
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
            "discarded",
        ]);
        const events = state.pendingEvents ?? [];
        const discardEv = events.find((e) => e.type === "CARD_DISCARDED");
        expect(discardEv).toMatchObject({
            type: "CARD_DISCARDED",
            playerId: "p1",
            cardInstanceId: "discarded",
        });

        // CR 603 — collectTriggers surfaces Necropotence's discard trigger.
        const triggers = collectTriggers(state, events);
        const necroTrigger = triggers.find(
            (t) => t.triggeredAbilityId === "necropotence-discard-exile"
        );
        expect(necroTrigger).toBeDefined();

        // Resolve it: the card moves graveyard → exile.
        state.stack.push(necroTrigger!);
        resolveTopOfStack(state);
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[0].exile.map((c) => c.id)).toEqual(["discarded"]);
    });

    it("does NOT fire its discard trigger for an opponent's discard (scope: your)", () => {
        const necro = makeInstance(necropotence.id, {
            id: "necro",
            controllerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [necro] }),
                makePlayer("p2", {
                    hand: [
                        makeInstance(balduvianBears.id, {
                            id: "p2card",
                            controllerId: "p2",
                            zone: "hand",
                        }),
                    ],
                }),
            ],
        });
        discardCardsAtRandom(state, "p2", 1);
        const events = state.pendingEvents ?? [];
        const triggers = collectTriggers(state, events);
        expect(
            triggers.find(
                (t) => t.triggeredAbilityId === "necropotence-discard-exile"
            )
        ).toBeUndefined();
    });

    // --- Full engine loop: pay life → face-down exile → next-end-step hand --
    it("pay 1 life exiles top face down, returns it to hand at next end step", () => {
        const necro = makeInstance(necropotence.id, {
            id: "necro",
            controllerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            turn: 2,
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    life: 20,
                    battlefield: [necro],
                    library: [
                        filler("top", "library"),
                        filler("next", "library"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });

        // Activate "Pay 1 life: exile the top card face down" (cost paid here).
        state.players[0].life -= 1; // CR 118.4 — pay 1 life.
        resolveActivated(state, necro, "necropotence-pay-life");

        // CR 406.3 — the top card is exiled face down, library shrinks.
        expect(state.players[0].life).toBe(19);
        expect(state.players[0].library.map((c) => c.id)).toEqual(["next"]);
        expect(state.players[0].exile.map((c) => c.id)).toEqual(["top"]);
        expect(state.players[0].hand).toHaveLength(0);
        // It is hidden to the opponent (known only to its controller).
        const exiled = state.players[0].exile[0];
        expect(exiled.knownTo).toEqual(["p1"]);
        // A next-end-step delayed trigger was scheduled (CR 603.7a).
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers![0].triggerId).toBe(
            "necropotence-return-to-hand"
        );

        // CR 603.7a — fire the delayed trigger at the next end step and resolve.
        fireDelayedTriggers(state, "next-end-step");
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);

        // The exiled card is now in the controller's hand; exile is empty.
        expect(state.players[0].exile).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["top"]);
        expect(state.delayedTriggers).toBeUndefined();
    });

    it("multiple pay-life activations all return at the same next end step", () => {
        const necro = makeInstance(necropotence.id, {
            id: "necro",
            controllerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            turn: 2,
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    life: 20,
                    battlefield: [necro],
                    library: [
                        filler("a", "library"),
                        filler("b", "library"),
                        filler("c", "library"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });

        // Two activations exile the top two cards (a, then b).
        resolveActivated(state, necro, "necropotence-pay-life");
        resolveActivated(state, necro, "necropotence-pay-life");
        expect(state.players[0].exile.map((c) => c.id).sort()).toEqual([
            "a",
            "b",
        ]);
        expect(state.delayedTriggers).toHaveLength(2);

        // Both delayed triggers fire at the next end step and resolve.
        fireDelayedTriggers(state, "next-end-step");
        expect(state.stack).toHaveLength(2);
        resolveTopOfStack(state);
        resolveTopOfStack(state);
        expect(state.players[0].exile).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "a",
            "b",
        ]);
    });

    // --- Wire-format guard (visible exile/hand state) ----------------------
    it("wire format: the exiled card survives projection face down to opponents", () => {
        const necro = makeInstance(necropotence.id, {
            id: "necro",
            controllerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            turn: 2,
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    life: 20,
                    battlefield: [necro],
                    library: [filler("top", "library")],
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, necro, "necropotence-pay-life");

        // Controller sees the exiled card's real identity survive the wire.
        const forP1 = projectPublicState(state, 1, "p1");
        const p1Exiled = forP1.players[0].exile.find((c) => c?.id === "top");
        expect(p1Exiled).toBeDefined();
        expect(p1Exiled!.card.id).toBe(balduvianBears.id);

        // Opponent sees a face-down exile (CR 406.3 — identity hidden behind the
        // face-down sentinel; the real def id never crosses the wire).
        const forP2 = projectPublicState(state, 1, "p2");
        const p2Exiled = forP2.players[0].exile.find((c) => c?.id === "top");
        expect(p2Exiled).toBeDefined();
        expect(p2Exiled!.card.id).toBe(FACE_DOWN_CARD_ID);
        expect(p2Exiled!.card.id).not.toBe(balduvianBears.id);
    });
});

describe("LIFE_LOST seam + Oath of Lim-Dûl (CR 119.3 / 603)", () => {
    it("is a {3}{B} Enchantment with a LIFE_LOST trigger and a {B}{B} draw (modern oracle)", () => {
        expect(oathOfLimDul.manaCost).toEqual({ X: 3, B: 1 });
        expect(oathOfLimDul.types).toEqual(["Enchantment"]);
        expect(oathOfLimDul.rarity).toBe("rare");
        expect(oathOfLimDul.oracleText).toBe(
            "Whenever you lose life, for each 1 life you lost, sacrifice a permanent other than this enchantment unless you discard a card. (Damage dealt to you causes you to lose life.)\n{B}{B}: Draw a card."
        );
        expect(oathOfLimDul.triggeredAbilities?.[0].event).toBe("LIFE_LOST");
        expect(oathOfLimDul.activatedAbilities?.[0].cost).toEqual({
            mana: { B: 2 },
        });
    });

    it("registers by id and name", () => {
        expect(getDefinition(oathOfLimDul.id)).toBe(oathOfLimDul);
        expect(getCardByName("Oath of Lim-Dûl")).toBe(oathOfLimDul);
    });

    // --- The seam: LIFE_LOST emitted on every life-loss path ----------------
    it("emits LIFE_LOST from the loseLife primitive (CR 119.3)", () => {
        const state = makeState({
            players: [makePlayer("p1", { life: 20 }), makePlayer("p2")],
        });
        loseLifeEmitting(state, "p1", 3);
        expect(state.players[0].life).toBe(17);
        const ev = (state.pendingEvents ?? []).find(
            (e) => e.type === "LIFE_LOST"
        );
        expect(ev).toMatchObject({
            type: "LIFE_LOST",
            playerId: "p1",
            amount: 3,
            fromDamage: false,
        });
    });

    it("emits LIFE_LOST (fromDamage) when damage hits a player (CR 119.3)", () => {
        const source = makeInstance(moorFiend.id, {
            id: "src",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        dealDamageFromPermanentToPlayer(state, source, "p1", "p2", 4);
        expect(state.players[1].life).toBe(16);
        const ev = (state.pendingEvents ?? []).find(
            (e) => e.type === "LIFE_LOST"
        );
        expect(ev).toMatchObject({
            type: "LIFE_LOST",
            playerId: "p2",
            amount: 4,
            fromDamage: true,
        });
    });

    it("does NOT emit LIFE_LOST for a zero-amount loss", () => {
        const state = makeState({
            players: [makePlayer("p1", { life: 20 }), makePlayer("p2")],
        });
        loseLifeEmitting(state, "p1", 0);
        expect(state.players[0].life).toBe(20);
        expect(
            (state.pendingEvents ?? []).some((e) => e.type === "LIFE_LOST")
        ).toBe(false);
    });

    // --- Oath fires off a life loss ----------------------------------------
    it("fires from the controller's life loss and sacrifices one permanent per point", () => {
        const oath = makeInstance(oathOfLimDul.id, {
            id: "oath",
            controllerId: "p1",
            ownerId: "p1",
        });
        const v1 = vanilla("v1", 1, 1, { controllerId: "p1", ownerId: "p1" });
        const v2 = vanilla("v2", 1, 1, { controllerId: "p1", ownerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    life: 20,
                    battlefield: [oath, v1, v2],
                    hand: [], // no cards → no discard opt-out is offered
                }),
                makePlayer("p2"),
            ],
        });
        // Lose 2 life → the trigger fires once carrying amount: 2.
        loseLifeEmitting(state, "p1", 2);
        const trig = collectAndStack(state, "oath-of-lim-dul-life-loss");
        expect(trig).toBeDefined();
        // With an empty hand the punisher has no discard branch — it loops
        // twice, sacrificing a permanent (auto-resolved, single candidate each
        // time once Oath is excluded) per point.
        resolveTopOfStack(state);
        // No more pending choices (each sacrifice auto-resolved to its sole
        // candidate after Oath is excluded — but the engine raises a pick; if a
        // choice is pending, resolve it to its candidate).
        while (state.pendingChoices && state.pendingChoices.length > 0) {
            const head = state.pendingChoices[0];
            applyPendingChoiceSubmit(state, {
                playerId: head.playerId,
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: [head.candidateIds?.[0] ?? "v1"],
            });
        }
        // Both v1 and v2 are gone; Oath itself survives (excluded).
        const bf = state.players[0].battlefield.map((c) => c.id);
        expect(bf).toContain("oath");
        expect(bf).not.toContain("v1");
        expect(bf).not.toContain("v2");
    });

    it("does NOT fire from an opponent's life loss (scope: your)", () => {
        const oath = makeInstance(oathOfLimDul.id, {
            id: "oath",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [oath] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        loseLifeEmitting(state, "p2", 2);
        const events = state.pendingEvents ?? [];
        const trig = collectTriggers(state, events).find(
            (t) => t.triggeredAbilityId === "oath-of-lim-dul-life-loss"
        );
        expect(trig).toBeUndefined();
    });
});

describe("Seizures (host-scoped becomes-tapped, CR 303.4b / 701.20a)", () => {
    it("is a {1}{B} Aura enchanting a creature with a host-tapped trigger", () => {
        expect(seizures.manaCost).toEqual({ X: 1, B: 1 });
        expect(seizures.types).toEqual(["Enchantment"]);
        expect(seizures.subtypes).toEqual(["Aura"]);
        expect(seizures.targetRequirement).toMatchObject({ type: "Creature" });
        const trig = seizures.triggeredAbilities?.[0];
        expect(trig?.event).toBe("PERMANENT_TAPPED");
    });

    it("registers by id and name", () => {
        expect(getDefinition(seizures.id)).toBe(seizures);
        expect(getCardByName("Seizures")).toBe(seizures);
    });

    function setup() {
        // Host (the enchanted creature) is controlled by p2; the Aura by p1.
        // A registered card id keeps the mana-payment battlefield scan happy.
        const host = makeInstance(balduvianBears.id, {
            id: "host",
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(seizures.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { life: 20, battlefield: [host] }),
            ],
        });
        return { state };
    }

    it("fires when the ENCHANTED creature becomes tapped, dealing 3 unless paid", () => {
        const { state } = setup();
        const host = state.players[1].battlefield.find((c) => c.id === "host")!;
        tapPermanent(state, host);
        emitPermanentTapped(state, host, false);
        const trig = collectAndStack(state, "seizures-tapped");
        expect(trig).toBeDefined();
        resolveTopOfStack(state); // suspends at the host controller's may-pay
        answerMayPayHead(state, false); // decline → take 3
        expect(state.players[1].life).toBe(17);
    });

    it("paying {3} avoids the damage", () => {
        const { state } = setup();
        state.players[1].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 3 };
        const host = state.players[1].battlefield.find((c) => c.id === "host")!;
        tapPermanent(state, host);
        emitPermanentTapped(state, host, false);
        const trig = collectAndStack(state, "seizures-tapped");
        expect(trig).toBeDefined();
        resolveTopOfStack(state);
        answerMayPayHead(state, true); // pay {3}
        expect(state.players[1].life).toBe(20);
    });

    it("does NOT fire when a DIFFERENT permanent becomes tapped (host scope)", () => {
        const { state } = setup();
        const other = vanilla("other", 1, 1, {
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(other);
        tapPermanent(state, other);
        emitPermanentTapped(state, other, false);
        const events = state.pendingEvents ?? [];
        const trig = collectTriggers(state, events).find(
            (t) => t.triggeredAbilityId === "seizures-tapped"
        );
        expect(trig).toBeUndefined();
    });
});

describe("Stench of Evil (destroy all Plains + pay-{2}-or-1 rider, CR 701.7 / 118)", () => {
    function answerMayPay(state: GameState, accept: boolean): void {
        const head = state.pendingChoices![0];
        applyMayPaySubmit(state, { playerId: head.playerId, accept });
    }
    function setup() {
        const p1Plains = makeInstance(plains.id, {
            id: "p1-plains",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p2Plains = makeInstance(plains.id, {
            id: "p2-plains",
            controllerId: "p2",
            ownerId: "p2",
        });
        const survivor = makeInstance(island.id, {
            id: "p2-island",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p1Plains], life: 20 }),
                makePlayer("p2", {
                    battlefield: [p2Plains, survivor],
                    life: 20,
                }),
            ],
            activePlayerId: "p1",
        });
        return state;
    }

    it("destroys every Plains and leaves non-Plains lands alone", () => {
        const state = setup();
        pushSpell(state, stenchOfEvil.id, "p1");
        resolveTopOfStack(state); // step 0 destroys, suspends at first may-pay
        // Both Plains gone; the Island survives.
        expect(
            state.players[0].battlefield.find((c) => c.id === "p1-plains")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "p2-plains")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "p2-island")
        ).toBeDefined();
    });

    it("paying {2} skips the damage; declining takes 1 per destroyed Plains", () => {
        const state = setup();
        // p1 can afford the {2}; p2 has no mana and will decline.
        state.players[0].manaPool = { C: 2 } as never;
        pushSpell(state, stenchOfEvil.id, "p1");
        resolveTopOfStack(state); // suspends at the first may-pay
        // Two destroyed Plains → two may-pay prompts (one per controller).
        answerMayPay(state, true); // p1 pays {2} → no damage
        answerMayPay(state, false); // p2 declines → takes 1
        expect(state.players[0].life).toBe(20); // p1 paid
        expect(state.players[1].life).toBe(19); // p2 took 1
        expect(state.stack).toHaveLength(0);
    });

    it("declining both bills each land's controller 1 damage", () => {
        const state = setup();
        pushSpell(state, stenchOfEvil.id, "p1");
        resolveTopOfStack(state);
        answerMayPay(state, false); // p1 declines → 1
        answerMayPay(state, false); // p2 declines → 1
        expect(state.players[0].life).toBe(19);
        expect(state.players[1].life).toBe(19);
    });
});

describe("Hecatomb (tap-a-Swamp activation cost + ETB sac-4, CR 602.1 / 118.8)", () => {
    it("the ping ability requires tapping an untapped Swamp (definition shape)", () => {
        const ability = hecatomb.activatedAbilities![0];
        expect(ability.cost.tapOtherFilter).toEqual({
            filter: { subtypes: "Swamp", controllerRelation: "you" },
            count: 1,
        });
        expect(ability.cost.tap ?? false).toBe(false); // not the source's own {T}
        expect(ability.targetRequirement).toEqual({ type: "any", count: 1 });
    });

    it("commit taps the chosen Swamp and the ability deals 1 damage", () => {
        const hec = makeInstance(hecatomb.id, {
            id: "hec",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const swampInst = makeInstance(swamp.id, {
            id: "sw",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hec, swampInst] }),
                makePlayer("p2", { life: 20 }),
            ],
            priorityPlayerId: "p1",
        });
        const pa: PendingActivation = {
            playerId: "p1",
            cardInstanceId: "hec",
            abilityId: "hecatomb-ping",
            manaCost: {},
            tappedLandIds: [],
            tapSource: false,
            sacrificeSource: false,
            tapOtherChoice: {
                filter: { subtypes: "Swamp", controllerRelation: "you" },
                count: 1,
                pickedIds: ["sw"],
            },
            targets: [{ type: "player", id: "p2" }],
        };
        state.pendingActivation = pa;
        const committed = tryAutoCommitPendingActivation(state, "p1");
        expect(committed).not.toBeNull();
        // The Swamp was tapped to pay the cost; Hecatomb itself stays untapped.
        expect(
            state.players[0].battlefield.find((c) => c.id === "sw")?.isTapped
        ).toBe(true);
        expect(
            state.players[0].battlefield.find((c) => c.id === "hec")
                ?.isTapped ?? false
        ).toBe(false);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(19);
    });

    it("ETB sacrifices Hecatomb when fewer than four creatures are controlled", () => {
        const hec = makeInstance(hecatomb.id, {
            id: "hec",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hec] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, hec, "hecatomb-etb", {
            type: "PERMANENT_ENTERED",
            instanceId: "hec",
            controllerId: "p1",
            types: ["Enchantment"],
        } as StackItem["triggerEvent"]);
        // No creatures → unpayable "unless" cost → Hecatomb is sacrificed.
        expect(
            state.players[0].battlefield.find((c) => c.id === "hec")
        ).toBeUndefined();
        expect(state.players[0].graveyard.some((c) => c.id === "hec")).toBe(
            true
        );
    });
});

describe("Burnt Offering ({B} — sac creature, add X {B}/{R}, X = sac MV, CR 202.3)", () => {
    it("declares the sacrifice-a-creature additional cost", () => {
        expect(burntOffering.additionalCosts?.sacrificeFilter).toEqual({
            types: "Creature",
        });
    });

    it("adds mana split black/red per the choice, total = sacrificed MV", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, burntOffering.id, "p1");
        item.additionalSacrificeSnapshot = { cardInstanceId: "fake", mv: 3 };
        // Resolution suspends on the black/red split choice.
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("option-pick");
        // Pick "2 black, 1 red".
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["split-2"],
        });
        expect(state.players[0].manaPool.B).toBe(2);
        expect(state.players[0].manaPool.R).toBe(1);
    });

    it("produces the mana in the wire-projected pool (client-visible)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, burntOffering.id, "p1");
        item.additionalSacrificeSnapshot = { cardInstanceId: "fake", mv: 2 };
        resolveTopOfStack(state);
        const head = state.pendingChoices![0];
        // Pick "0 black, 2 red" (all red).
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["split-0"],
        });
        expect(state.players[0].manaPool.R).toBe(2);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].manaPool.R).toBe(2);
        expect(projected.players[0].manaPool.B).toBe(0);
    });

    it("does nothing when the sacrificed creature's MV is 0", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, burntOffering.id, "p1");
        item.additionalSacrificeSnapshot = { cardInstanceId: "fake", mv: 0 };
        resolveTopOfStack(state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].manaPool.B).toBe(0);
        expect(state.players[0].manaPool.R).toBe(0);
    });
});

describe("Ashen Ghoul (graveyard-source activated ability, CR 113.6 / 602.5b / 603.6e — issue #737)", () => {
    // p1 graveyard, bottom→top: [Ashen Ghoul, bear, bear, bear] — three
    // creature cards ABOVE the Ghoul (index 0 = bottom, last = top).
    function setup(creaturesAbove: number): GameState {
        const ghoul = makeInstance(ashenGhoul.id, {
            id: "ag",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const above = Array.from({ length: creaturesAbove }, (_, i) =>
            makeInstance(balduvianBears.id, {
                id: `bear-${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            })
        );
        return makeState({
            phase: "UPKEEP",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    graveyard: [ghoul, ...above],
                    manaPool: { W: 0, U: 0, B: 1, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });
    }

    const ability = ashenGhoul.activatedAbilities![0];

    it("declares haste and the graveyard-activation seam", () => {
        expect(ashenGhoul.staticAbilities).toContain("haste");
        expect(ability.activateFromGraveyard).toBe(true);
        expect(ability.controllerTurnOnly).toBe(true);
        expect(ability.activationPhaseRestriction).toEqual(["UPKEEP"]);
    });

    it("canActivate requires three or more creature cards above it (CR 603.6e)", () => {
        const state3 = setup(3);
        const ghoul3 = state3.players[0].graveyard[0];
        expect(ability.canActivate!(ghoul3, state3)).toBe(true);

        const state2 = setup(2);
        const ghoul2 = state2.players[0].graveyard[0];
        expect(ability.canActivate!(ghoul2, state2)).toBe(false);
    });

    it("reanimates the Ghoul from the graveyard through the real activation commit + resolution", () => {
        const state = setup(3);
        // Precondition the predicate would gate on (checked by activateAbility).
        expect(ability.canActivate!(state.players[0].graveyard[0], state)).toBe(
            true
        );
        // Drive the real deferred-commit path with the graveyard source.
        const pa = buildPendingActivation({
            playerId: "p1",
            cardInstanceId: "ag",
            abilityId: ability.id,
            ability,
            manaCost: { B: 1 },
            fromGraveyard: true,
        });
        state.pendingActivation = pa;
        state.priorityPlayerId = "p1";
        const committed = tryAutoCommitPendingActivation(state, "p1");
        expect(committed).not.toBeNull();
        // The ability (a clone of the graveyard card) is on the stack; the real
        // Ghoul is still in the graveyard until the ability resolves.
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].abilityId).toBe(ability.id);
        expect(state.players[0].graveyard.some((c) => c.id === "ag")).toBe(
            true
        );
        // {B} was paid.
        expect(state.players[0].manaPool.B).toBe(0);

        resolveTopOfStack(state);
        // Reanimated: on the battlefield, gone from the graveyard.
        expect(state.players[0].battlefield.some((c) => c.id === "ag")).toBe(
            true
        );
        expect(state.players[0].graveyard.some((c) => c.id === "ag")).toBe(
            false
        );
    });

    it("wire format: the reanimated Ghoul is visible on the projected battlefield", () => {
        const state = setup(3);
        const pa = buildPendingActivation({
            playerId: "p1",
            cardInstanceId: "ag",
            abilityId: ability.id,
            ability,
            manaCost: { B: 1 },
            fromGraveyard: true,
        });
        state.pendingActivation = pa;
        state.priorityPlayerId = "p1";
        tryAutoCommitPendingActivation(state, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[0].battlefield.some((c) => c.id === "ag")
        ).toBe(true);
    });
});

// ===========================================================================
// Cloak of Confusion — assign-no-combat-damage + random discard rider
// (CR 510.1c "assigns no combat damage"; CR 701.8 discard at random)
// ===========================================================================
describe("Cloak of Confusion — unblocked-attacker rider (CR 510.1c)", () => {
    function cloakScenario() {
        const attacker = makeInstance(balduvianBears.id, {
            id: "atk",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const cloak = makeInstance(cloakOfConfusion.id, {
            id: "cloak",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "atk",
        });
        // Defending player (p2) has two cards in hand to discard from.
        const h1 = makeInstance(balduvianBears.id, {
            id: "h1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const h2 = makeInstance(balduvianBears.id, {
            id: "h2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker, cloak] }),
                makePlayer("p2", { hand: [h1, h2] }),
            ],
        });
        return state;
    }

    const unblockedEvent = {
        type: "ATTACKER_UNBLOCKED" as const,
        attackerId: "atk",
        attackerControllerId: "p1",
        attackerTypes: ["Creature" as const],
        attackerSubtypes: [] as string[],
    };

    it("choosing 'yes' marks assign-no-damage and defender discards at random", () => {
        const state = cloakScenario();
        const cloak = state.players[0].battlefield.find(
            (c) => c.id === "cloak"
        )!;
        resolveTrigger(
            state,
            cloak,
            "cloak-of-confusion-unblocked",
            unblockedEvent
        );
        // Suspends on the yes/no option choice.
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("option-pick");
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["yes"],
        });
        expect(state.assignsNoCombatDamageThisTurn).toContain("atk");
        // Defending player discarded exactly one card at random.
        expect(state.players[1].hand.length).toBe(1);
        expect(state.players[1].graveyard.length).toBe(1);
    });

    it("choosing 'no' leaves combat damage normal and no discard", () => {
        const state = cloakScenario();
        const cloak = state.players[0].battlefield.find(
            (c) => c.id === "cloak"
        )!;
        resolveTrigger(
            state,
            cloak,
            "cloak-of-confusion-unblocked",
            unblockedEvent
        );
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["no"],
        });
        expect(state.assignsNoCombatDamageThisTurn ?? []).not.toContain("atk");
        expect(state.players[1].hand.length).toBe(2);
    });

    it("end-to-end: a marked attacker deals no combat damage, and the discard is wire-visible", () => {
        const state = cloakScenario();
        const cloak = state.players[0].battlefield.find(
            (c) => c.id === "cloak"
        )!;
        resolveTrigger(
            state,
            cloak,
            "cloak-of-confusion-unblocked",
            unblockedEvent
        );
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["yes"],
        });
        // Now run combat: the unblocked 2/2 assigns no combat damage.
        state.combat = {
            attackerIds: ["atk"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: true,
        };
        const before = state.players[1].life;
        applyAllCombatDamage(state, {});
        expect(state.players[1].life).toBe(before); // no damage dealt
        // Wire format: the defender's reduced hand survives projection.
        const projected = projectPublicState(state, 1, "p1");
        const p2 = projected.players.find((p) => p.id === "p2");
        expect(p2?.hand.length).toBe(1);
    });
});

// ===========================================================================
// Gaze of Pain — turn-scoped floating "unblocked → deal power, assign none"
// rider (CR 603.7a turn-scoped trigger; CR 510.1c assigns no combat damage)
// ===========================================================================
describe("Gaze of Pain — turn-scoped unblocked rider (CR 603.7a)", () => {
    it("resolving the sorcery arms the rider for its controller this turn", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, gazeOfPain.id, "p1");
        resolveTopOfStack(state);
        expect(state.gazeOfPainActiveThisTurn).toContain("p1");
        // Sorcery went to the graveyard (source for the graveyard-zone trigger).
        expect(state.players[0].graveyard.some((c) => c.id !== undefined)).toBe(
            true
        );
    });

    const unblockedEvent = {
        type: "ATTACKER_UNBLOCKED" as const,
        attackerId: "atk",
        attackerControllerId: "p1",
        attackerTypes: ["Creature" as const],
        attackerSubtypes: [] as string[],
    };

    it("fires on an unblocked creature you control while armed; deals power and marks assign-none", () => {
        const gaze = makeInstance(gazeOfPain.id, {
            id: "gaze",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const attacker = makeInstance(balduvianBears.id, {
            id: "atk",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const victim = makeInstance(balduvianBears.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [attacker],
                    graveyard: [gaze],
                }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
            gazeOfPainActiveThisTurn: ["p1"],
        });
        const triggers = collectTriggers(state, [unblockedEvent]);
        const trig = triggers.find(
            (t) => t.triggeredAbilityId === "gaze-of-pain-unblocked"
        );
        expect(trig).toBeDefined();
        state.stack.push(trig!);
        resolveTopOfStack(state);
        // Suspends on the target-creature choice; pick the victim.
        submitPick(state, ["victim"]);
        // 2 damage (attacker power) is lethal to the 2/2 victim (CR 704.5g),
        // which is destroyed — proving the power-based damage landed.
        expect(
            state.players[1].battlefield.some((c) => c.id === "victim")
        ).toBe(false);
        expect(state.players[1].graveyard.some((c) => c.id === "victim")).toBe(
            true
        );
        expect(state.assignsNoCombatDamageThisTurn).toContain("atk");
    });

    it("does NOT fire when the rider is not armed this turn", () => {
        const gaze = makeInstance(gazeOfPain.id, {
            id: "gaze",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [gaze] }),
                makePlayer("p2"),
            ],
            // no gazeOfPainActiveThisTurn
        });
        const triggers = collectTriggers(state, [unblockedEvent]);
        expect(
            triggers.some(
                (t) => t.triggeredAbilityId === "gaze-of-pain-unblocked"
            )
        ).toBe(false);
    });

    it("does NOT fire for a creature an opponent controls", () => {
        const gaze = makeInstance(gazeOfPain.id, {
            id: "gaze",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [gaze] }),
                makePlayer("p2"),
            ],
            gazeOfPainActiveThisTurn: ["p1"],
        });
        const opponentAttack = {
            ...unblockedEvent,
            attackerControllerId: "p2",
        };
        const triggers = collectTriggers(state, [opponentAttack]);
        expect(
            triggers.some(
                (t) => t.triggeredAbilityId === "gaze-of-pain-unblocked"
            )
        ).toBe(false);
    });
});
