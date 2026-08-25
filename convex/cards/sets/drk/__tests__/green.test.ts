// Per-card behavior tests for green cards in `convex/cards/sets/drk/green.ts`
// (The Dark, split by colour per ADR 0043). Each non-trivial card gets a
// describe block citing the CR section it exercises; set-wide registry-parity
// checks live in colorless.test.ts. Shared stack/resolve shims live in
// ./helpers; fixtures stay in convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import {
    elvesOfDeepShadow,
    gaeasTouch,
    hiddenPath,
    lurker,
    marshViper,
    niallSilvain,
    peopleOfTheWoods,
    savaenElves,
    scarwoodBandits,
    scarwoodHag,
    scavengerFolk,
    spittingSlug,
    tracker,
    venom,
    whippoorwill,
    wormwoodTreefolk,
} from "..";
import {
    FOREST,
    ISLAND,
    answerChoice,
    resolveActivated,
    resolveTrigger,
} from "./helpers";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    advancePhase,
    applyAllCombatDamage,
    emitBlockersConfirmedEvents,
} from "../../../../gre/phases";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";
import { checkStateBasedActions } from "../../../../gre/sba";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    applySourceStaticEffects,
    resolveTopOfStack,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { getAllCards, getDefinition, getCardByName } from "../../../index";
import { lightningBolt } from "../../lea";

describe("Gaea's Touch (CR 400.7 — put a basic Forest from hand; CR 605 sacrifice for {G}{G})", () => {
    it("puts a basic Forest from hand onto the battlefield when chosen", () => {
        const gt = makeInstance(gaeasTouch.id, { controllerId: "p1" });
        const state = makeState();
        const forestInHand = makeInstance(FOREST, {
            controllerId: "p1",
            zone: "hand",
        });
        state.players[0].battlefield = [gt];
        state.players[0].hand = [forestInHand];

        // Resolve the ability; it suspends on the optional hand choice.
        resolveActivated(state, gt, "gaeas-touch-forest");
        const pending = state.pendingChoices?.[0];
        expect(pending?.kind).toBe("choose-hand-card");
        expect(pending?.candidateIds).toEqual([forestInHand.id]);

        // Pick the Forest → it moves to the battlefield.
        answerChoice(state, [forestInHand.id]);
        expect(
            state.players[0].battlefield.some((c) => c.id === forestInHand.id)
        ).toBe(true);
        expect(state.players[0].hand).toHaveLength(0);
    });

    it("offers no candidate when the hand has no basic Forest (nonbasic Forest excluded)", () => {
        const gt = makeInstance(gaeasTouch.id, { controllerId: "p1" });
        const state = makeState();
        // An Island is not a Forest; a hand with only it yields no candidate, so
        // the optional ability resolves with no choice prompt.
        state.players[0].battlefield = [gt];
        state.players[0].hand = [
            makeInstance(ISLAND, { controllerId: "p1", zone: "hand" }),
        ];
        resolveActivated(state, gt, "gaeas-touch-forest");
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].hand).toHaveLength(1);
    });

    it("declining the optional pick leaves the Forest in hand", () => {
        const gt = makeInstance(gaeasTouch.id, { controllerId: "p1" });
        const state = makeState();
        const forestInHand = makeInstance(FOREST, {
            controllerId: "p1",
            zone: "hand",
        });
        state.players[0].battlefield = [gt];
        state.players[0].hand = [forestInHand];
        resolveActivated(state, gt, "gaeas-touch-forest");
        // "You may" — decline by submitting an empty pick.
        answerChoice(state, []);
        expect(state.players[0].hand).toHaveLength(1);
        expect(
            state.players[0].battlefield.some((c) => c.id === forestInHand.id)
        ).toBe(false);
    });

    it("sacrifice ability adds {G}{G}", () => {
        const sac = gaeasTouch.activatedAbilities!.find(
            (a) => a.id === "gaeas-touch-sacrifice-mana"
        )!;
        expect(sac.useStack).toBe(false);
        expect(sac.cost.sacrifice).toBe(true);
        expect(sac.manaProduced).toEqual({ G: 2 });
        // The mana-ability effect adds {G}{G} via addMana.
        let added: Record<string, number> | undefined;
        sac.effect?.({ addMana: (m) => (added = m as Record<string, number>) });
        expect(added).toEqual({ G: 2 });
    });
});

// ---------------------------------------------------------------------------
// Tracker — generic Fight primitive (CR 701.14 mutual damage; CR 120 / 510-
// style simultaneous damage through the normal damage path)
// ---------------------------------------------------------------------------

/** Builds a board with Tracker (p1) and one target creature (p2), then fights
 *  the target via Tracker's activated ability. `trackerPT` / `targetPT`
 *  override the printed stats so each branch (survive / die) is exercised. */
function fightTracker(
    trackerPT: { power: number; toughness: number },
    targetPT: { power: number; toughness: number },
    extra: Partial<GameState> = {}
): GameState {
    const trk = makeInstance(tracker.id, {
        id: "trk",
        controllerId: "p1",
        ownerId: "p1",
        power: trackerPT.power,
        toughness: trackerPT.toughness,
    });
    // Any vanilla creature stands in for the fight target; P/T is overridden.
    const foe = makeInstance(getCardByName("Goblin Hero").id, {
        id: "foe",
        controllerId: "p2",
        ownerId: "p2",
        power: targetPT.power,
        toughness: targetPT.toughness,
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [trk] }),
            makePlayer("p2", { battlefield: [foe] }),
        ],
        ...extra,
    });
    resolveActivated(state, trk, "tracker-fight", [
        { type: "permanent", id: "foe" },
    ]);
    checkStateBasedActions(state);
    return state;
}

const onField = (state: GameState, pIdx: number, id: string): boolean =>
    state.players[pIdx].battlefield.some((c) => c.id === id);
const inGrave = (state: GameState, pIdx: number, id: string): boolean =>
    state.players[pIdx].graveyard.some((c) => c.id === id);

describe("Tracker — Fight primitive (CR 701.14 mutual damage)", () => {
    it("both survive: 2/2 Tracker vs 1/3 — damage marked, neither destroyed", () => {
        const state = fightTracker(
            { power: 2, toughness: 2 },
            { power: 1, toughness: 3 }
        );
        // Tracker (2 power) marks 2 on the 1/3 foe (survives, tough 3).
        const foe = state.players[1].battlefield.find((c) => c.id === "foe")!;
        expect(foe.damageMarked).toBe(2);
        // The foe (1 power) marks 1 on Tracker (survives, tough 2).
        const trk = state.players[0].battlefield.find((c) => c.id === "trk")!;
        expect(trk.damageMarked).toBe(1);
        expect(onField(state, 0, "trk")).toBe(true);
        expect(onField(state, 1, "foe")).toBe(true);
    });

    it("both die: 2/2 Tracker vs 2/2 — both take lethal and go to the graveyard", () => {
        const state = fightTracker(
            { power: 2, toughness: 2 },
            { power: 2, toughness: 2 }
        );
        expect(onField(state, 0, "trk")).toBe(false);
        expect(onField(state, 1, "foe")).toBe(false);
        expect(inGrave(state, 0, "trk")).toBe(true);
        expect(inGrave(state, 1, "foe")).toBe(true);
    });

    it("one dies: 3/3 Tracker vs 2/2 — foe dies, Tracker survives with 2 marked", () => {
        const state = fightTracker(
            { power: 3, toughness: 3 },
            { power: 2, toughness: 2 }
        );
        expect(onField(state, 1, "foe")).toBe(false);
        expect(inGrave(state, 1, "foe")).toBe(true);
        const trk = state.players[0].battlefield.find((c) => c.id === "trk")!;
        expect(trk.damageMarked).toBe(2);
    });

    it("simultaneity (CR 701.12): a creature that dies still deals its full damage", () => {
        // 5/2 Tracker vs 4/4 foe: Tracker dies to the foe's 4, but its 5 must
        // still be dealt — the foe (toughness 4) must also die. If damage were
        // sequential and the dead creature stopped dealing, the foe would live.
        const state = fightTracker(
            { power: 5, toughness: 2 },
            { power: 4, toughness: 4 }
        );
        expect(onField(state, 0, "trk")).toBe(false);
        expect(onField(state, 1, "foe")).toBe(false);
    });

    it("normal damage path: a target-prevention shield on the foe absorbs the fight damage", () => {
        // CR 615 prevention applies because fight routes through the same
        // damage pipeline. Shield the foe for 3; Tracker's 2 is fully absorbed.
        const state = fightTracker(
            { power: 2, toughness: 2 },
            { power: 1, toughness: 5 },
            {
                targetPreventionShields: [
                    {
                        targetType: "permanent",
                        targetId: "foe",
                        remaining: 3,
                        duration: { phase: "end-of-turn" },
                    },
                ],
            }
        );
        const foe = state.players[1].battlefield.find((c) => c.id === "foe")!;
        // All 2 of Tracker's damage prevented → 0 marked on the foe.
        expect(foe.damageMarked ?? 0).toBe(0);
        // Tracker still takes the foe's 1 (no shield on Tracker).
        const trk = state.players[0].battlefield.find((c) => c.id === "trk")!;
        expect(trk.damageMarked).toBe(1);
    });

    it("normal damage path: protection from green prevents Tracker's damage to the foe", () => {
        // CR 702.16e — a foe with protection from green takes no damage from
        // Tracker (a green source), proving fight respects protection.
        const state = fightTracker(
            { power: 2, toughness: 2 },
            { power: 1, toughness: 5 }
        );
        // Re-run with protection: rebuild manually to inject the keyword.
        const trk = makeInstance(tracker.id, {
            id: "trk",
            controllerId: "p1",
            ownerId: "p1",
        });
        const foe = makeInstance(getCardByName("Goblin Hero").id, {
            id: "foe",
            controllerId: "p2",
            ownerId: "p2",
            toughness: 5,
            staticAbilities: ["protection from green"],
        });
        const s2 = makeState({
            players: [
                makePlayer("p1", { battlefield: [trk] }),
                makePlayer("p2", { battlefield: [foe] }),
            ],
        });
        resolveActivated(s2, trk, "tracker-fight", [
            { type: "permanent", id: "foe" },
        ]);
        const foeAfter = s2.players[1].battlefield.find((c) => c.id === "foe")!;
        expect(foeAfter.damageMarked ?? 0).toBe(0);
        // baseline (no protection) did mark damage — sanity that the helper works
        const foeBaseline = state.players[1].battlefield.find(
            (c) => c.id === "foe"
        )!;
        expect(foeBaseline.damageMarked).toBe(2);
    });

    it("self-target (DRK ruling): Tracker deals 2× its power to itself and dies", () => {
        // 2009-10-01 ruling — Tracker may target itself; it deals its power to
        // itself, then immediately again (2 + 2 = 4 marked on a 2-toughness
        // body → lethal).
        const trk = makeInstance(tracker.id, {
            id: "trk",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [trk] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, trk, "tracker-fight", [
            { type: "permanent", id: "trk" },
        ]);
        checkStateBasedActions(state);
        expect(onField(state, 0, "trk")).toBe(false);
        expect(inGrave(state, 0, "trk")).toBe(true);
    });

    it("wire format: fight result (marked damage / destruction) survives projectPublicState", () => {
        const state = fightTracker(
            { power: 2, toughness: 2 },
            { power: 1, toughness: 3 }
        );
        const projected = projectPublicState(state, 1, "p1");
        // Foe survived with 2 marked; the marked total crosses the wire so the
        // client renders the damage and any subsequent lethal check is correct.
        const foe = projected.players[1].battlefield.find(
            (c) => c.id === "foe"
        )!;
        expect(foe.damageMarked).toBe(2);
        const trk = projected.players[0].battlefield.find(
            (c) => c.id === "trk"
        )!;
        expect(trk.damageMarked).toBe(1);
    });

    it("only creatures are legal fight targets (CR 701.14)", () => {
        const foe = makeInstance(getCardByName("Goblin Hero").id, {
            id: "foe",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [foe] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            tracker.activatedAbilities![0].targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        );
        expect(legal.map((t) => t.id)).toContain("foe");
    });
});

describe("Elves of Deep Shadow — {T}: Add {B} + 1 self-damage (CR 605.1a / 603.6)", () => {
    it("the mana ability adds {B} (mana ability, useStack false) (CR 605.1a)", () => {
        const mana = elvesOfDeepShadow.activatedAbilities!.find(
            (a) => a.id === "elves-of-deep-shadow-mana"
        )!;
        expect(mana.useStack).toBe(false);
        expect(mana.cost).toEqual({ tap: true });
        expect(mana.manaProduced).toEqual({ B: 1 });
        let added: Record<string, number> | undefined;
        mana.effect?.({
            addMana: (m) => (added = m as Record<string, number>),
        });
        expect(added).toEqual({ B: 1 });
    });

    it("the for-mana tap trigger deals 1 damage to its controller (CR 603.6)", () => {
        const elf = makeInstance(elvesOfDeepShadow.id, {
            id: "elf",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elf] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, elf, "elves-of-deep-shadow-pain", {
            type: "PERMANENT_TAPPED",
            permanentId: "elf",
            controllerId: "p1",
            forMana: true,
        } as StackItem["triggerEvent"]);
        expect(state.players[0].life).toBe(19);
    });
});

describe("Wormwood Treefolk — temp landwalk grants + self-damage (CR 611.2a / 702.14)", () => {
    it("the {G}{G} ability grants forestwalk until EOT and self-damages 2 (CR 611.2a)", () => {
        const tf = makeInstance(wormwoodTreefolk.id, {
            id: "tf",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tf] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, tf, "wormwood-treefolk-forestwalk", []);
        const inPlay = state.players[0].battlefield.find((c) => c.id === "tf")!;
        expect(inPlay.staticAbilities).toContain("forestwalk");
        expect(state.players[0].life).toBe(18); // 20 - 2
    });

    it("the {B}{B} ability grants swampwalk until EOT and self-damages 2 (CR 611.2a)", () => {
        const tf = makeInstance(wormwoodTreefolk.id, {
            id: "tf",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tf] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, tf, "wormwood-treefolk-swampwalk", []);
        const inPlay = state.players[0].battlefield.find((c) => c.id === "tf")!;
        expect(inPlay.staticAbilities).toContain("swampwalk");
        expect(state.players[0].life).toBe(18);
    });
});

describe("Hidden Path — green creatures have forestwalk (CR 611 / 702.13c)", () => {
    function setup() {
        const path = makeInstance(hiddenPath.id, {
            id: "path",
            controllerId: "p1",
        });
        // A green creature (Grizzly Bears is green) and a non-green one.
        const greenCreature = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "green",
            controllerId: "p1",
            ownerId: "p1",
        });
        const whiteCreature = makeInstance(getCardByName("Savannah Lions").id, {
            id: "white",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [path, greenCreature] }),
                makePlayer("p2", { battlefield: [whiteCreature] }),
            ],
        });
        return { state };
    }

    it("grants forestwalk to green creatures (both players') but not others", () => {
        const { state } = setup();
        applySourceStaticEffects(state, state.players[0].battlefield[0]);
        const green = state.players[0].battlefield.find(
            (c) => c.id === "green"
        )!;
        const white = state.players[1].battlefield.find(
            (c) => c.id === "white"
        )!;
        expect(green.staticAbilities).toContain("forestwalk");
        expect(white.staticAbilities ?? []).not.toContain("forestwalk");
    });

    it("wire format: forestwalk survives projectPublicState", () => {
        const { state } = setup();
        applySourceStaticEffects(state, state.players[0].battlefield[0]);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "green"
        )!;
        expect(slim.staticAbilities).toContain("forestwalk");
    });
});

describe("Lurker — can't be the target of spells unless it fought (CR 115 / 113.3)", () => {
    function setup(combatFlags: Partial<CardInstanceState> = {}) {
        const lurk = makeInstance(lurker.id, {
            id: "lurk",
            controllerId: "p2",
            ownerId: "p2",
            ...combatFlags,
        });
        // A targeted spell controlled by p1 (Lightning Bolt) on the stack.
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [lurk] }),
            ],
        });
        return { state };
    }

    it("is NOT a legal spell target before it attacked or blocked", () => {
        const { state } = setup();
        const targets = getLegalTargets(
            state,
            lightningBolt.targetRequirement!,
            {
                ...NO_TARGETING_SOURCE,
                isSpell: true, // sourceIsSpell,
            },
            "p1",
            undefined
        );
        expect(targets.some((t) => t.id === "lurk")).toBe(false);
    });

    it("IS a legal spell target once it attacked this turn", () => {
        const { state } = setup({ hasAttackedThisTurn: true });
        const targets = getLegalTargets(
            state,
            lightningBolt.targetRequirement!,
            {
                ...NO_TARGETING_SOURCE,
                isSpell: true,
            },
            "p1",
            undefined
        );
        expect(targets.some((t) => t.id === "lurk")).toBe(true);
    });
});

describe("People of the Woods — toughness = Forests you control (CR 613.4c CDA)", () => {
    function setup(forestCount: number) {
        const ppl = makeInstance(peopleOfTheWoods.id, {
            id: "ppl",
            controllerId: "p1",
            ownerId: "p1",
        });
        const forests = Array.from({ length: forestCount }, (_, i) =>
            makeInstance(getCardByName("Forest").id, {
                id: `forest-${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ppl, ...forests] }),
                makePlayer("p2"),
            ],
        });
        return { state, ppl };
    }

    it("toughness scales with controller's Forests; power stays 1", () => {
        const { state, ppl } = setup(3);
        expect(getEffectivePower(state, ppl)).toBe(1);
        expect(getEffectiveToughness(state, ppl)).toBe(3);
    });

    it("toughness is 0 with no Forests (dies to SBA)", () => {
        const { state, ppl } = setup(0);
        expect(getEffectiveToughness(state, ppl)).toBe(0);
    });

    it("wire format: derived toughness survives projectPublicState", () => {
        const { state } = setup(2);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "ppl"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(2);
        expect(getEffectivePower(projected, slim)).toBe(1);
    });
});

describe("Savaen Elves — destroy target Aura on a land (CR 605 / 701.8)", () => {
    function setup(hostIsLand: boolean) {
        const elves = makeInstance(savaenElves.id, {
            id: "elves",
            controllerId: "p1",
        });
        const host = hostIsLand
            ? makeInstance(getCardByName("Forest").id, {
                  id: "host",
                  controllerId: "p2",
                  ownerId: "p2",
              })
            : makeInstance(getCardByName("Grizzly Bears").id, {
                  id: "host",
                  controllerId: "p2",
                  ownerId: "p2",
              });
        // Use Fishliver Oil (an Aura) as the enchantment to destroy.
        const aura = makeInstance(getCardByName("Fishliver Oil").id, {
            id: "aura",
            controllerId: "p2",
            ownerId: "p2",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elves] }),
                makePlayer("p2", { battlefield: [host, aura] }),
            ],
        });
        return { state, elves };
    }

    it("destroys an Aura attached to a land", () => {
        const { state, elves } = setup(true);
        resolveActivated(state, elves, "savaen-elves-destroy-aura", [
            { type: "permanent", id: "aura" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "aura")
        ).toBeUndefined();
    });

    // CR 303.4b — the oracle text restricts the target to an Aura attached
    // to a LAND. `attachedToFilter` (issue #1853) enforces this at target
    // SELECTION (getLegalTargets / selectTarget), not resolution — CR
    // 608.2b's resolution-time re-check is deliberately zone-existence-only
    // for permanent targets (`isTargetStillLegal`, gre/state.ts), so an Aura
    // on a creature is illegal because it was never offered in the first
    // place, not because resolve() refuses it after the fact.
    it("does NOT offer an Aura attached to a creature as a legal target", () => {
        const { state } = setup(false);
        const req = savaenElves.activatedAbilities!.find(
            (a) => a.id === "savaen-elves-destroy-aura"
        )!.targetRequirement!;
        const ids = getLegalTargets(state, req, NO_TARGETING_SOURCE, "p1").map(
            (t) => t.id
        );
        expect(ids).not.toContain("aura");
    });
});

describe("Scavenger Folk — sacrifice to destroy an artifact (CR 118.5 / 701.8)", () => {
    it("destroys the target artifact (sacrifice-self cost paid by the engine)", () => {
        const folk = makeInstance(scavengerFolk.id, {
            id: "folk",
            controllerId: "p1",
            ownerId: "p1",
        });
        const artifact = makeInstance(getCardByName("Ornithopter").id, {
            id: "art",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [folk] }),
                makePlayer("p2", { battlefield: [artifact] }),
            ],
        });
        resolveActivated(state, folk, "scavenger-folk-destroy-artifact", [
            { type: "permanent", id: "art" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "art")
        ).toBeUndefined();
    });
});

describe("Niall Silvain — regenerate target creature (CR 605 / 701.19)", () => {
    it("shields the target so the next destroy is replaced by regeneration", () => {
        const niall = makeInstance(niallSilvain.id, {
            id: "niall",
            controllerId: "p1",
        });
        const friend = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "friend",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [niall, friend] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, niall, "niall-silvain-regenerate", [
            { type: "permanent", id: "friend" },
        ]);
        const shielded = state.players[0].battlefield.find(
            (c) => c.id === "friend"
        )!;
        expect(shielded.regenerationShields ?? 0).toBeGreaterThan(0);
    });
});

describe("Scarwood Hag — grant / strip forestwalk until EOT (CR 605 / 611)", () => {
    function setup() {
        const hag = makeInstance(scarwoodHag.id, {
            id: "hag",
            controllerId: "p1",
        });
        const target = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "tgt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hag, target] }),
                makePlayer("p2"),
            ],
        });
        return { state, hag };
    }

    it("grants forestwalk to the target", () => {
        const { state, hag } = setup();
        resolveActivated(state, hag, "scarwood-hag-grant-forestwalk", [
            { type: "permanent", id: "tgt" },
        ]);
        const tgt = state.players[0].battlefield.find((c) => c.id === "tgt")!;
        expect(tgt.staticAbilities).toContain("forestwalk");
    });

    it("strips forestwalk from a target that has it", () => {
        const { state, hag } = setup();
        // Pre-grant via the first ability, then strip via the second.
        resolveActivated(state, hag, "scarwood-hag-grant-forestwalk", [
            { type: "permanent", id: "tgt" },
        ]);
        // Reset the hag's tap so the second activation can pay {T}.
        state.players[0].battlefield.find((c) => c.id === "hag")!.isTapped =
            false;
        resolveActivated(state, hag, "scarwood-hag-strip-forestwalk", [
            { type: "permanent", id: "tgt" },
        ]);
        const tgt = state.players[0].battlefield.find((c) => c.id === "tgt")!;
        expect(tgt.staticAbilities ?? []).not.toContain("forestwalk");
    });
});

describe("Scarwood Bandits — steal an artifact unless opponent pays {2} (CR 118.8 / 613.1b)", () => {
    function setup() {
        const bandits = makeInstance(scarwoodBandits.id, {
            id: "bandits",
            controllerId: "p1",
        });
        const artifact = makeInstance(getCardByName("Ornithopter").id, {
            id: "art",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bandits] }),
                makePlayer("p2", { battlefield: [artifact] }),
            ],
        });
        return { state, bandits };
    }

    it("gains control of the artifact when the opponent declines to pay {2}", () => {
        const { state, bandits } = setup();
        state.stack.push({
            ...bandits,
            zone: "stack",
            castById: "p1",
            abilityId: "scarwood-bandits-steal",
            targets: [{ type: "permanent", id: "art" }],
        });
        expect(resolveTopOfStack(state)).toBeNull(); // suspends at may-pay
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        // Control change: the artifact now sits in p1's battlefield.
        expect(
            state.players[0].battlefield.find((c) => c.id === "art")
        ).toBeDefined();
    });

    it("does NOT gain control when the opponent pays {2}", () => {
        const { state, bandits } = setup();
        state.players[1].manaPool = { C: 2 };
        state.stack.push({
            ...bandits,
            zone: "stack",
            castById: "p1",
            abilityId: "scarwood-bandits-steal",
            targets: [{ type: "permanent", id: "art" }],
        });
        expect(resolveTopOfStack(state)).toBeNull(); // suspends at may-pay
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        expect(
            state.players[1].battlefield.find((c) => c.id === "art")
        ).toBeDefined();
    });
});

describe("Spitting Slug — combat first-strike trigger (CR 509.1h / 118.4)", () => {
    function setupCombat() {
        const slug = makeInstance(spittingSlug.id, {
            id: "slug",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const blocker = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "blocker",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [slug] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["slug"],
                confirmed: true,
                blockerAssignments: { slug: ["blocker"] },
                blockersConfirmed: true,
            },
        });
        return { state, slug };
    }

    it("triggers when the slug becomes blocked", () => {
        const { state } = setupCombat();
        emitBlockersConfirmedEvents(state);
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "spitting-slug-first-strike"
            )
        ).toBe(true);
    });

    it("the slug gains first strike when the controller pays {1}{G}", () => {
        const { state } = setupCombat();
        state.players[0].manaPool = { G: 2 };
        emitBlockersConfirmedEvents(state);
        expect(resolveTopOfStack(state)).toBeNull(); // suspends at may-pay
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        const slug = state.players[0].battlefield.find((c) => c.id === "slug")!;
        expect(slug.staticAbilities).toContain("first strike");
    });

    it("the paired creature gains first strike when {1}{G} is declined", () => {
        const { state } = setupCombat();
        emitBlockersConfirmedEvents(state);
        expect(resolveTopOfStack(state)).toBeNull(); // suspends at may-pay
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        const blocker = state.players[1].battlefield.find(
            (c) => c.id === "blocker"
        )!;
        expect(blocker.staticAbilities).toContain("first strike");
    });
});

describe("Venom — Aura: combat kill at end of combat (CR 509.1h / 511.3 / 701.8)", () => {
    function setupCombat(otherSubtypes: string[] = ["Bear"]) {
        const otherName = otherSubtypes.includes("Wall")
            ? "Wall of Swords"
            : "Grizzly Bears";
        // Host (p1 attacker) carries Venom; "other" creature is p2's blocker.
        const host = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const aura = makeInstance(venom.id, {
            id: "venom",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const other = makeInstance(getCardByName(otherName).id, {
            id: "other",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2", { battlefield: [other] }),
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["host"],
                confirmed: true,
                blockerAssignments: { host: ["other"] },
                blockersConfirmed: true,
            },
        });
        return { state };
    }

    it("triggers on the enchanted creature being blocked by a non-Wall", () => {
        const { state } = setupCombat();
        emitBlockersConfirmedEvents(state);
        expect(
            state.stack.some(
                (s) =>
                    s.triggeredAbilityId?.startsWith("venom-combat-kill") ??
                    false
            )
        ).toBe(true);
    });

    it("does NOT trigger against a Wall", () => {
        const { state } = setupCombat(["Wall"]);
        emitBlockersConfirmedEvents(state);
        expect(
            state.stack.some(
                (s) =>
                    s.triggeredAbilityId?.startsWith("venom-combat-kill") ??
                    false
            )
        ).toBe(false);
    });

    it("destroys the other creature at END_OF_COMBAT", () => {
        const { state } = setupCombat();
        emitBlockersConfirmedEvents(state);
        resolveTopOfStack(state);
        expect(state.delayedTriggers).toHaveLength(1);
        // The inline delayedTrigger Op (ADR 0048/0049) captures the "other"
        // creature under the binding name `$other`, where the legacy resolve()
        // used the payload key `targetId`.
        expect(state.delayedTriggers![0].payload["other"]).toBe("other");
        state.phase = "COMBAT_DAMAGE";
        advancePhase(state);
        expect(state.phase).toBe("END_OF_COMBAT");
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "other")
        ).toBeUndefined();
        expect(
            state.players[1].graveyard.find((c) => c.id === "other")
        ).toBeDefined();
    });
});

describe("Whippoorwill — exile-on-death + no regeneration (CR 605 / 614.1a)", () => {
    it("marks the target so it is exiled instead of dying", () => {
        const whip = makeInstance(whippoorwill.id, {
            id: "whip",
            controllerId: "p1",
        });
        const victim = makeInstance(getCardByName("Grizzly Bears").id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [whip] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveActivated(state, whip, "whippoorwill-doom", [
            { type: "permanent", id: "victim" },
        ]);
        const marked = state.players[1].battlefield.find(
            (c) => c.id === "victim"
        )!;
        expect(marked.exileOnDeath).toBe(true);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Marsh Viper — {3}{G} Creature — Snake 1/2 (#453, parent #418). "Whenever
// this creature deals damage to a player, that player gets two poison
// counters." (modern Oracle, ADR 0004). Reuses `damageDealtTrigger` (Nafs Asp
// precedent, ARN) + the poison seam (ADR 0032). The trigger fires on ANY
// damage to a player (CR 120.3) — NOT combat-gated.
// ───────────────────────────────────────────────────────────────────────────

/** Build a DAMAGE_DEALT event for Marsh Viper hitting a player. */
const VIPER_DAMAGE = (
    targetId: string,
    isCombat: boolean,
    amount = 1
): StackItem["triggerEvent"] =>
    ({
        type: "DAMAGE_DEALT",
        sourceInstanceId: "viper",
        sourceControllerId: "p1",
        target: { type: "player", id: targetId },
        amount,
        isCombat,
    }) as StackItem["triggerEvent"];

describe("Marsh Viper ({3}{G} Snake 1/2 — poison on damage to a player, CR 120.3 / ADR 0032)", () => {
    function viperOnBattlefield(): {
        state: GameState;
        viper: CardInstanceState;
    } {
        const viper = makeInstance(marshViper.id, {
            id: "viper",
            controllerId: "p1",
            ownerId: "p1",
            power: 1,
            toughness: 2,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [viper] }),
                makePlayer("p2"),
            ],
        });
        return { state, viper };
    }

    it("trigger fires on COMBAT damage to a player and adds 2 poison", () => {
        const { state, viper } = viperOnBattlefield();
        resolveTrigger(
            state,
            viper,
            "marsh-viper-poison",
            VIPER_DAMAGE("p2", /* isCombat */ true)
        );
        expect(state.players[1].poisonCounters).toBe(2);
        expect(state.players[0].poisonCounters).toBeUndefined();
    });

    it("trigger ALSO fires on NON-combat damage to a player (not combat-gated)", () => {
        const { state, viper } = viperOnBattlefield();
        // collectTriggers must MATCH a non-combat DAMAGE_DEALT event — proving
        // the factory carries no `isCombat` constraint (CR 120.3).
        const matched = collectTriggers(state, [
            VIPER_DAMAGE("p2", /* isCombat */ false) as never,
        ]).some((t) => t.triggeredAbilityId === "marsh-viper-poison");
        expect(matched).toBe(true);
        // ...and resolving it adds the 2 poison.
        resolveTrigger(
            state,
            viper,
            "marsh-viper-poison",
            VIPER_DAMAGE("p2", /* isCombat */ false)
        );
        expect(state.players[1].poisonCounters).toBe(2);
    });

    it("does NOT fire on damage dealt to a creature (player target only)", () => {
        const { state } = viperOnBattlefield();
        const matched = collectTriggers(state, [
            {
                type: "DAMAGE_DEALT",
                sourceInstanceId: "viper",
                sourceControllerId: "p1",
                target: { type: "permanent", id: "someCreature" },
                amount: 1,
                isCombat: true,
            } as never,
        ]).some((t) => t.triggeredAbilityId === "marsh-viper-poison");
        expect(matched).toBe(false);
    });

    it("end-to-end: opponent at 8 poison + combat hit crosses ten and loses (CR 704.5c)", () => {
        const viper = makeInstance(marshViper.id, {
            id: "viper",
            controllerId: "p1",
            ownerId: "p1",
            power: 1,
            toughness: 2,
            isAttacking: true,
        });
        const state = makeState({
            activePlayerId: "p1",
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [viper] }),
                makePlayer("p2", { poisonCounters: 8 }),
            ],
            combat: {
                attackerIds: ["viper"],
                confirmed: true,
                blockerAssignments: {},
                blockedAttackerIds: [],
                blockersConfirmed: true,
            },
        });
        // Damage step: the unblocked viper deals 1 to p2. The DAMAGE_DEALT
        // trigger is queued on the stack by applyAllCombatDamage (CR 603.2).
        applyAllCombatDamage(state, { viper: { p2: 1 } });
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "marsh-viper-poison"
        );
        expect(trig).toBeDefined();
        // Resolve the trigger → +2 poison → 8 + 2 = 10.
        resolveTopOfStack(state);
        expect(state.players[1].poisonCounters).toBe(10);
        // The >=10 loss SBA fires (CR 704.5c).
        checkStateBasedActions(state);
        expect(state.gameOver).toBeDefined();
        expect(state.gameOver?.reason).toBe("poison");
        expect(state.gameOver?.loserId).toBe("p2");
        expect(state.gameOver?.winnerId).toBe("p1");
    });

    it("wire format: the poison the viper inflicts survives projectPublicState", () => {
        const { state, viper } = viperOnBattlefield();
        resolveTrigger(
            state,
            viper,
            "marsh-viper-poison",
            VIPER_DAMAGE("p2", true)
        );
        expect(state.players[1].poisonCounters).toBe(2);
        const projected = projectPublicState(state, 1, "p1");
        const slimP2 = projected.players.find((p) => p.id === "p2")!;
        expect(slimP2.poisonCounters).toBe(2);
    });

    it("registry parity: reachable by id and by name (debug-panel / pool path)", () => {
        expect(getDefinition(marshViper.id)).toBe(marshViper);
        expect(getCardByName("Marsh Viper")).toBe(marshViper);
        expect(getAllCards()).toContain(marshViper);
    });
});
