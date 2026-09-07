// Per-card behavior tests for black cards in `convex/cards/sets/drk/black.ts`
// (The Dark, split by colour per ADR 0043). Each non-trivial card gets a
// describe block citing the CR section it exercises; set-wide registry-parity
// checks live in colorless.test.ts. Shared stack/resolve shims live in
// ./helpers; fixtures stay in convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import {
    UPKEEP,
    answerChoice,
    resolveActivated,
    resolveTrigger,
} from "./helpers";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { emitBlockersConfirmedEvents } from "../../../../gre/phases";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { applyDamageReplacements } from "../../../../gre/replacements";
import {
    assertLegalAction,
    getLegalActions,
    getLegalTargets,
    NO_TARGETING_SOURCE,
} from "../../../../gre/rules";
import { checkStateBasedActions } from "../../../../gre/sba";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    canLandEnterBattlefield,
    landPlayLockActive,
    putReanimatedSetOnBattlefield,
    resolveTopOfStack,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { getDefinition } from "../../../index";

const ashesToAshes = getDefinition("825496e5-19c7-4f50-8070-0265a58608dc");
const banshee = getDefinition("66eaa7d6-48b2-4b35-a834-790edd679e0e");
const bogRats = getDefinition("d64c9153-bc6d-4a64-885f-c039a5487a31");
const curseArtifact = getDefinition("9fc0d070-8a42-4d5e-8f2b-ceb59147de6f");
const eaterOfTheDead = getDefinition("d89fe2be-bb7e-4bae-9b1f-9f0d58f20ceb");
const graveRobbers = getDefinition("a131605a-f646-4745-a1e4-48d155a3d94f");
const inquisition = getDefinition("5f133f06-6398-4db1-8577-66c16fd3e00d");
const marshGas = getDefinition("b80ecb15-258b-4fc9-86e4-c2bf01891606");
const murkDwellers = getDefinition("a213450f-02f4-4c08-8da8-891ebfa8e237");
const namelessRace = getDefinition("348a467a-4661-4fdb-af1d-9171a1a930d9");
const ragMan = getDefinition("f4c133b8-8383-433f-be96-c47a937287b7");
const seasonOfTheWitch = getDefinition("06900a71-34ca-48c6-94ac-fca744356829");
const theFallen = getDefinition("f4a176e1-b22b-4f36-ba7b-c506cb4e1bed");
const uncleIstvan = getDefinition("848ad6d5-3a7e-4d6b-9929-36465796871f");
const wordOfBinding = getDefinition("ee30efdb-f1f1-497f-80a6-ec961db67c1d");
const wormsOfTheEarth = getDefinition("65a97821-ca5b-46fb-af08-86de81d0daac");
const mountain = getDefinition("eace2c85-976c-425e-9800-5a6ccbd91b56");

// ═══════════════════════════════════════════════════════════════════════════
// BLACK free tranche (#413)
// ═══════════════════════════════════════════════════════════════════════════

describe("Ashes to Ashes — exile two nonartifact creatures, 5 to you (CR 701.13 / 119)", () => {
    it("exiles both targets and deals 5 to the caster", () => {
        const a = makeInstance(
            getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870").id,
            {
                id: "a",
                controllerId: "p2",
                ownerId: "p2",
            }
        );
        const b = makeInstance(
            getDefinition("0ddb98e8-13fe-4786-83f7-b72c56db135a").id,
            {
                id: "b",
                controllerId: "p2",
                ownerId: "p2",
            }
        );
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { battlefield: [a, b] }),
            ],
        });
        pushSpell(state, ashesToAshes.id, "p1", [
            { type: "permanent", id: "a" },
            { type: "permanent", id: "b" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].exile).toHaveLength(2);
        expect(state.players[0].life).toBe(15);
    });

    it("artifact creatures are not legal targets (excludeTypes)", () => {
        const robot = makeInstance(
            getDefinition("59cc9bdb-7cf2-4795-bac7-ffff605c9eb0").id,
            {
                id: "robot",
                controllerId: "p2",
                ownerId: "p2",
            }
        );
        const bear = makeInstance(
            getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870").id,
            {
                id: "bear",
                controllerId: "p2",
                ownerId: "p2",
            }
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [robot, bear] }),
            ],
        });
        pushSpell(state, ashesToAshes.id, "p1");
        const legal = getLegalTargets(
            state,
            ashesToAshes.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        );
        const ids = legal.map((t) => t.id);
        expect(ids).toContain("bear");
        expect(ids).not.toContain("robot");
    });
});

describe("Banshee — {X},{T}: half X down to any target, half X up to you (CR 605 / 119)", () => {
    function setup() {
        const bansheeInst = makeInstance(banshee.id, {
            id: "banshee",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [bansheeInst] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        return { state, bansheeInst };
    }

    it("X=5 → 2 to the target, 3 to you (floor/ceil split)", () => {
        const { state, bansheeInst } = setup();
        state.stack.push({
            ...bansheeInst,
            zone: "stack",
            castById: "p1",
            abilityId: "banshee-half-x",
            chosenX: 5,
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18); // 20 - floor(5/2)=2
        expect(state.players[0].life).toBe(17); // 20 - ceil(5/2)=3
    });

    it("X=0 → no damage either way", () => {
        const { state, bansheeInst } = setup();
        state.stack.push({
            ...bansheeInst,
            zone: "stack",
            castById: "p1",
            abilityId: "banshee-half-x",
            chosenX: 0,
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(20);
        expect(state.players[0].life).toBe(20);
    });
});

describe("Bog Rats — can't be blocked by Walls (CR 509.1b / 205.3)", () => {
    function setup(blockerSubtypes: string[]) {
        const rats = makeInstance(bogRats.id, {
            id: "rats",
            controllerId: "p1",
            isAttacking: true,
        });
        const blocker = makeInstance(
            getDefinition("8df80424-3bd9-4982-ad79-e55d9ba3b43d").id,
            {
                id: "blocker",
                controllerId: "p2",
                ownerId: "p2",
                subtypes: blockerSubtypes,
            }
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [rats] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        return { state, rats };
    }

    it("the static restriction rejects a Wall blocker", () => {
        const { state, rats } = setup(["Wall"]);
        const restriction = rats.card
            ? bogRats.staticEffects!.find((e) => e.kind === "block-restriction")
            : undefined;
        expect(restriction).toBeDefined();
        // Predicate: legal block only if the blocker is NOT a Wall.
        const blocker = state.players[1].battlefield[0];
        const predicate = (
            restriction as { predicate: (s: unknown, o: unknown) => boolean }
        ).predicate;
        expect(predicate(rats, blocker)).toBe(false);
    });

    it("a non-Wall blocker is allowed", () => {
        const { state, rats } = setup(["Bear"]);
        const restriction = bogRats.staticEffects!.find(
            (e) => e.kind === "block-restriction"
        ) as { predicate: (s: unknown, o: unknown) => boolean };
        const blocker = state.players[1].battlefield[0];
        expect(restriction.predicate(rats, blocker)).toBe(true);
    });
});

describe("Curse Artifact — upkeep 2 damage unless sacrifice the artifact (CR 603.6a / 117.3a)", () => {
    function setup() {
        const artifact = makeInstance(
            getDefinition("59cc9bdb-7cf2-4795-bac7-ffff605c9eb0").id,
            {
                id: "art",
                controllerId: "p2",
                ownerId: "p2",
            }
        );
        const aura = makeInstance(curseArtifact.id, {
            id: "curse",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "art",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { life: 20, battlefield: [artifact] }),
            ],
        });
        return { state, aura };
    }

    it("fires at the enchanted artifact's controller upkeep (host-controller)", () => {
        const { state } = setup();
        const fires = (p: string) =>
            collectTriggers(state, [UPKEEP(p) as never]).some(
                (t) => t.triggeredAbilityId === "curse-artifact-upkeep"
            );
        expect(fires("p2")).toBe(true);
        expect(fires("p1")).toBe(false);
    });

    it("declining the sacrifice deals 2 damage", () => {
        const { state, aura } = setup();
        resolveTrigger(state, aura, "curse-artifact-upkeep", UPKEEP("p2"));
        answerChoice(state, ["decline"]);
        expect(state.players[1].life).toBe(18);
        expect(state.players[1].battlefield.some((c) => c.id === "art")).toBe(
            true
        );
    });

    it("sacrificing the artifact avoids the damage", () => {
        const { state, aura } = setup();
        resolveTrigger(state, aura, "curse-artifact-upkeep", UPKEEP("p2"));
        answerChoice(state, ["yes"]);
        expect(state.players[1].life).toBe(20);
        expect(
            state.players[1].battlefield.find((c) => c.id === "art")
        ).toBeUndefined();
    });
});

describe("Eater of the Dead — {0}: if tapped, exile a graveyard creature + untap (CR 605 / 701.13)", () => {
    function setup(tapped: boolean) {
        const eater = makeInstance(eaterOfTheDead.id, {
            id: "eater",
            controllerId: "p1",
            isTapped: tapped,
        });
        const corpse = makeInstance(
            getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870").id,
            {
                id: "corpse",
                controllerId: "p2",
                ownerId: "p2",
                zone: "graveyard",
            }
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [eater] }),
                makePlayer("p2", { graveyard: [corpse] }),
            ],
        });
        return { state, eater };
    }

    it("exiles the targeted graveyard creature and untaps itself", () => {
        const { state, eater } = setup(true);
        state.stack.push({
            ...eater,
            zone: "stack",
            castById: "p1",
            abilityId: "eater-of-the-dead-exile-untap",
            targets: [{ type: "graveyard-card", id: "corpse", playerId: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[1].exile.some((c) => c.id === "corpse")).toBe(
            true
        );
        const e = state.players[0].battlefield.find((c) => c.id === "eater")!;
        expect(e.isTapped).toBe(false);
    });

    it("can only be activated while tapped (canActivate gate)", () => {
        const ability = eaterOfTheDead.activatedAbilities![0];
        const tapped = makeInstance(eaterOfTheDead.id, { isTapped: true });
        const untapped = makeInstance(eaterOfTheDead.id, { isTapped: false });
        expect(ability.canActivate!(tapped as never, {} as never)).toBe(true);
        expect(ability.canActivate!(untapped as never, {} as never)).toBe(
            false
        );
    });
});

describe("Grave Robbers — {B},{T}: exile a graveyard artifact, gain 2 life (CR 605 / 701.13)", () => {
    it("exiles the artifact card and gains 2 life", () => {
        const robber = makeInstance(graveRobbers.id, {
            id: "robber",
            controllerId: "p1",
        });
        const art = makeInstance(
            getDefinition("59cc9bdb-7cf2-4795-bac7-ffff605c9eb0").id,
            {
                id: "art",
                controllerId: "p2",
                ownerId: "p2",
                zone: "graveyard",
            }
        );
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [robber] }),
                makePlayer("p2", { graveyard: [art] }),
            ],
        });
        resolveActivated(state, robber, "grave-robbers-exile-artifact", [
            { type: "graveyard-card", id: "art", playerId: "p2" },
        ]);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[1].exile.some((c) => c.id === "art")).toBe(true);
        expect(state.players[0].life).toBe(22);
    });
});

describe("Inquisition — reveal hand, damage = white cards in hand (CR 202.2 / 119)", () => {
    it("deals damage equal to the number of white cards", () => {
        const whiteA = makeInstance(
            getDefinition("d05b92bd-797e-413f-a8b0-32e0937a1ee0").id,
            {
                id: "wA",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            }
        );
        const whiteB = makeInstance(
            getDefinition("f8ac5006-91bd-4803-93da-f87cf196dd2f").id,
            {
                id: "wB",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            }
        );
        const black = makeInstance(
            getDefinition("e3bb7271-634a-4612-9073-7a5438e8c2b8").id,
            {
                id: "bl",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            }
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { life: 20, hand: [whiteA, whiteB, black] }),
            ],
        });
        pushSpell(state, inquisition.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(18); // two white cards
    });
});

describe("Marsh Gas — all creatures get -2/-0 until end of turn (CR 611.2)", () => {
    it("reduces power of every creature", () => {
        const a = makeInstance(
            getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870").id,
            {
                id: "a",
                controllerId: "p1",
            }
        );
        const b = makeInstance(
            getDefinition("0ddb98e8-13fe-4786-83f7-b72c56db135a").id,
            {
                id: "b",
                controllerId: "p2",
                ownerId: "p2",
            }
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a] }),
                makePlayer("p2", { battlefield: [b] }),
            ],
        });
        pushSpell(state, marshGas.id, "p1");
        resolveTopOfStack(state);
        expect(getEffectivePower(state, a)).toBe(0); // 2 - 2
        expect(getEffectivePower(state, b)).toBe(1); // 3 - 2
    });
});

describe("Murk Dwellers — attacks unblocked → +2/+0 (CR 509.1h ATTACKER_UNBLOCKED)", () => {
    it("emits ATTACKER_UNBLOCKED for an attacker with no blocker", () => {
        const dweller = makeInstance(murkDwellers.id, {
            id: "dweller",
            controllerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dweller] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["dweller"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });
        emitBlockersConfirmedEvents(state);
        // The unblocked-pump trigger is now on the stack.
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "murk-dwellers-unblocked-pump"
        );
        expect(trig).toBeDefined();
    });

    it("the pump trigger adds +2/+0 until end of combat", () => {
        const dweller = makeInstance(murkDwellers.id, {
            id: "dweller",
            controllerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dweller] }),
                makePlayer("p2"),
            ],
        });
        const base = getEffectivePower(state, dweller);
        const event = {
            type: "ATTACKER_UNBLOCKED" as const,
            attackerId: "dweller",
            attackerControllerId: "p1",
            attackerTypes: ["Creature"],
            attackerSubtypes: ["Zombie"],
        } as StackItem["triggerEvent"];
        resolveTrigger(state, dweller, "murk-dwellers-unblocked-pump", event);
        const pumped = state.players[0].battlefield.find(
            (c) => c.id === "dweller"
        )!;
        expect(getEffectivePower(state, pumped)).toBe(base + 2);
    });
});

describe("Nameless Race — CDA P/T from life paid as it enters (CR 604.3 / 614.12)", () => {
    function setup(opponentWhitePermanents: number, life = 20) {
        const oppBattlefield = Array.from(
            { length: opponentWhitePermanents },
            (_, i) =>
                makeInstance(
                    getDefinition("d05b92bd-797e-413f-a8b0-32e0937a1ee0").id,
                    {
                        id: `w${i}`,
                        controllerId: "p2",
                        ownerId: "p2",
                    }
                )
        );
        const state = makeState({
            players: [
                makePlayer("p1", { life }),
                makePlayer("p2", { battlefield: oppBattlefield }),
            ],
        });
        const item = pushSpell(state, namelessRace.id, "p1");
        item.chosenX = 1;
        return { state, item };
    }

    it("caps the life payment by opponent white permanents + graveyard cards", () => {
        const { state } = setup(2);
        resolveTopOfStack(state); // suspends on the pay-life option choice
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("option-pick");
        // Options are Pay 0..2 life (cap = 2 white permanents).
        expect(head?.options?.map((o) => o.id)).toEqual(["0", "1", "2"]);
    });

    // Both halves of `asEntersOpponentBoardCount` (`convex/gre/state.ts`) —
    // the graveyard leg and the OPPONENTS-only scoping — under one fixture.
    // The case above exercises neither: it has no graveyard cards at all, and
    // no white permanent under the chooser's own control, so deleting either
    // half of the counter leaves it green.
    it("counts white cards in opponents' graveyards and never the chooser's own white permanents", () => {
        const white = (id: string, owner: string, zone?: "graveyard") =>
            makeInstance(
                getDefinition("d05b92bd-797e-413f-a8b0-32e0937a1ee0").id,
                {
                    id,
                    controllerId: owner,
                    ownerId: owner,
                    ...(zone ? { zone } : {}),
                }
            );
        const state = makeState({
            players: [
                // The CHOOSER's own white permanents and white graveyard cards
                // are outside the count — "white nontoken permanents your
                // OPPONENTS control plus white cards in THEIR graveyards".
                makePlayer("p1", {
                    life: 20,
                    battlefield: [white("own-w0", "p1"), white("own-w1", "p1")],
                    graveyard: [white("own-grave-w", "p1", "graveyard")],
                }),
                makePlayer("p2", {
                    battlefield: [white("opp-w0", "p2")],
                    graveyard: [white("opp-grave-w", "p2", "graveyard")],
                }),
            ],
        });
        const item = pushSpell(state, namelessRace.id, "p1");
        item.chosenX = 1;
        resolveTopOfStack(state);

        // cap = 1 opponent permanent + 1 opponent graveyard card = 2.
        // Drop the graveyard leg → ["0", "1"]; count the chooser's own three
        // white objects too → ["0" … "5"].
        expect(state.pendingChoices?.[0]?.options?.map((o) => o.id)).toEqual([
            "0",
            "1",
            "2",
        ]);
    });

    // CR 614.1c / 614.12a (ADR 0100 D3, #2467) — the choice is now the
    // stackless as-enters `payLife` route (`stackItemId: ""`), never the
    // resolveSteps-era stack-item suspend `answerChoice` drives. `payLife`'s
    // answer COMPOSES with the following `body` leg (`applyAsEntersAnswer`,
    // `convex/gre/state.ts`): the queued `body` is narrowed to the single
    // option matching the life paid and auto-answered, so ONE submission
    // (the life amount) is the whole interaction — no second prompt.
    function payLife(state: GameState, amount: number): void {
        const head = state.pendingChoices![0];
        expect(head.stackItemId).toBe("");
        expect(head.asEntersKind).toBe("payLife");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [String(amount)],
        });
    }

    it("pays the chosen life and sets P/T to the amount paid", () => {
        const { state } = setup(3);
        resolveTopOfStack(state);
        payLife(state, 2);
        const race = state.players[0].battlefield.find(
            (c) => c.card.id === namelessRace.id
        )!;
        expect(state.players[0].life).toBe(18);
        expect(getEffectivePower(state, race)).toBe(2);
        expect(getEffectiveToughness(state, race)).toBe(2);
    });

    // CR 119.4 — "If a player pays life, the payment is subtracted from their
    // life total; in other words, the player loses that much life." The
    // as-enters `payLife` arm must therefore route through the shared
    // `loseLifeEmitting` choke point, not subtract from `player.life` raw:
    // Oath of Lim-Dûl (`ice/black.ts`) is a shipped "whenever you lose life"
    // listener and stops seeing the payment otherwise. `main`'s pre-#2467
    // `resolveSteps` shape called `ctx.loseLife`, so a raw subtraction here is
    // a live regression of a shipped card, not a new gap.
    it("the life payment is life LOSS: it emits LIFE_LOST and fires a 'whenever you lose life' trigger (CR 119.4)", () => {
        const oath = makeInstance(
            getDefinition("f16df768-06de-43a0-b548-44fb0887490b").id,
            {
                id: "oath",
                controllerId: "p1",
                ownerId: "p1",
            }
        );
        const oppBattlefield = Array.from({ length: 3 }, (_, i) =>
            makeInstance(
                getDefinition("d05b92bd-797e-413f-a8b0-32e0937a1ee0").id,
                {
                    id: `w${i}`,
                    controllerId: "p2",
                    ownerId: "p2",
                }
            )
        );
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [oath] }),
                makePlayer("p2", { battlefield: oppBattlefield }),
            ],
        });
        const item = pushSpell(state, namelessRace.id, "p1");
        item.chosenX = 1;
        resolveTopOfStack(state);
        payLife(state, 2);

        expect(state.players[0].life).toBe(18);
        // The seam the event exists for, asserted END-TO-END: the entry tail
        // (`finalizeSpellResolution`) drains `pendingEvents` through the
        // trigger scan in the same call, so the proof that LIFE_LOST was
        // emitted is Oath's ability sitting on the stack carrying amount 2.
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "oath-of-lim-dul-life-loss"
        );
        expect(trig).toBeDefined();
        expect(trig!.triggerEvent).toMatchObject({
            type: "LIFE_LOST",
            playerId: "p1",
            amount: 2,
            fromDamage: false,
        });
    });

    it("the CDA P/T survives the wire projection (mandatory)", () => {
        const { state } = setup(3);
        resolveTopOfStack(state);
        payLife(state, 2);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.card.id === namelessRace.id
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });

    // CR 614.12a — the choice is raised on EVERY entry path, not only a cast
    // (#2467's regression target: three of the five as-enters cards died to
    // SBA on a non-cast entry before this issue, Nameless Race among them).
    it("reanimation (non-cast entry) raises the SAME payLife choice and sizes the body from what's paid", () => {
        const oppBattlefield = [
            makeInstance(
                getDefinition("d05b92bd-797e-413f-a8b0-32e0937a1ee0").id,
                {
                    id: "w0",
                    controllerId: "p2",
                    ownerId: "p2",
                }
            ),
        ];
        const grave = makeInstance(namelessRace.id, {
            id: "graveyard-race",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, graveyard: [grave] }),
                makePlayer("p2", { battlefield: oppBattlefield }),
            ],
        });

        // `putReanimatedSetOnBattlefield` expects the caller to have already
        // pulled the card out of its origin zone (the `reanimateAll` pattern,
        // `convex/gre/__tests__/asEnters.test.ts`).
        state.players[0].graveyard = [];
        putReanimatedSetOnBattlefield(state, [
            { card: grave, controllerId: "p1" },
        ]);

        // Held off every zone until the life payment is answered — CR
        // 614.12a, not a vanilla 0/0 that dies to SBA before anyone chooses.
        expect(state.stagedEntries).toHaveLength(1);
        expect(
            state.players[0].battlefield.some((c) => c.id === "graveyard-race")
        ).toBe(false);
        payLife(state, 1); // cap is 1 (one white nontoken permanent)

        const race = state.players[0].battlefield.find(
            (c) => c.id === "graveyard-race"
        )!;
        expect(state.players[0].life).toBe(19);
        expect(getEffectivePower(state, race)).toBe(1);
        expect(getEffectiveToughness(state, race)).toBe(1);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "graveyard-race"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(1);
        expect(getEffectiveToughness(projected, slim)).toBe(1);
    });

    // Auto-resolve (ADR 0003, #2467 review F5): a cap of 0 leaves "pay 0 life"
    // as the ONLY submittable answer (CR 119.4b — players can always pay 0),
    // so no prompt is offered at all — `forcedAsEntersAnswer` answers it, the
    // derived one-option `body` is auto-answered behind it, and the 0/0 enters
    // in the same call. `main`'s `resolveSteps` short-circuited identically
    // (`if (maxPayable <= 0) { setSelfBody(0, 0); return; }`); offering a
    // one-button "Pay 0 life" dialog would be a UX regression, not a tactical
    // zero-branch.
    it("reanimation — a cap of 0 needs no prompt: it enters as a 0/0 and dies to the lethal-toughness SBA (CR 704.5f)", () => {
        const grave = makeInstance(namelessRace.id, {
            id: "graveyard-race",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, graveyard: [grave] }),
                makePlayer("p2"), // no white permanents/graveyard cards — cap 0
            ],
        });

        state.players[0].graveyard = [];
        putReanimatedSetOnBattlefield(state, [
            { card: grave, controllerId: "p1" },
        ]);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stagedEntries).toBeUndefined();
        expect(state.players[0].life).toBe(20);
        // Nothing answered the choice, so nothing ran the finalize's SBA pass
        // (`finalizeAsEnters`) — the caller's own SBA round is what kills it.
        checkStateBasedActions(state);

        expect(
            state.players[0].battlefield.some((c) => c.id === "graveyard-race")
        ).toBe(false);
        expect(
            state.players[0].graveyard.some((c) => c.id === "graveyard-race")
        ).toBe(true);
    });
});

describe("Rag Man — {B}{B}{B},{T}: opponent discards a creature at random (CR 701.9a)", () => {
    it("discards a creature card, leaving noncreature cards", () => {
        const creature = makeInstance(
            getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870").id,
            {
                id: "cre",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            }
        );
        const land = makeInstance(
            getDefinition("6176936d-72e2-4205-8871-4c5a4f1cb2d8").id,
            {
                id: "land",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            }
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: [creature, land] }),
            ],
        });
        resolveActivated(
            state,
            makeInstance(ragMan.id, {
                id: "ragman",
                controllerId: "p1",
            }),
            "rag-man-discard",
            [{ type: "player", id: "p2" }]
        );
        // The only creature card is discarded; the land stays in hand.
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["land"]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["cre"]);
    });
});

describe("Season of the Witch — upkeep pay-2-life-or-sac + end-step mass destroy (CR 603.6a)", () => {
    it("declining the 2-life payment sacrifices the enchantment", () => {
        const witch = makeInstance(seasonOfTheWitch.id, {
            id: "witch",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [witch] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(
            state,
            witch,
            "season-of-the-witch-upkeep",
            UPKEEP("p1")
        );
        answerChoice(state, ["decline"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "witch")
        ).toBeUndefined();
        expect(state.players[0].life).toBe(20);
    });

    it("paying 2 life keeps it", () => {
        const witch = makeInstance(seasonOfTheWitch.id, {
            id: "witch",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [witch] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(
            state,
            witch,
            "season-of-the-witch-upkeep",
            UPKEEP("p1")
        );
        answerChoice(state, ["yes"]);
        expect(state.players[0].battlefield.some((c) => c.id === "witch")).toBe(
            true
        );
        expect(state.players[0].life).toBe(18);
    });

    it("end step destroys untapped non-attackers but spares attackers, tapped, defenders, and sick", () => {
        const idler = makeInstance(
            getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870").id,
            {
                id: "idler", // untapped, didn't attack → destroyed
                controllerId: "p1",
            }
        );
        const attacker = makeInstance(
            getDefinition("0ddb98e8-13fe-4786-83f7-b72c56db135a").id,
            {
                id: "attacker",
                controllerId: "p1",
                hasAttackedThisTurn: true, // attacked → spared
            }
        );
        const tapped = makeInstance(
            getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870").id,
            {
                id: "tapped",
                controllerId: "p1",
                isTapped: true, // tapped → spared (filter)
            }
        );
        const wall = makeInstance(
            getDefinition("8df80424-3bd9-4982-ad79-e55d9ba3b43d").id,
            {
                id: "wall",
                controllerId: "p2",
                ownerId: "p2", // defender → couldn't attack → spared
            }
        );
        const fresh = makeInstance(
            getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870").id,
            {
                id: "fresh",
                controllerId: "p2",
                ownerId: "p2",
                isSummoningSick: true, // couldn't attack → spared
            }
        );
        const witch = makeInstance(seasonOfTheWitch.id, {
            id: "witch",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [idler, attacker, tapped, witch],
                }),
                makePlayer("p2", { battlefield: [wall, fresh] }),
            ],
        });
        resolveTrigger(state, witch, "season-of-the-witch-end-step", {
            type: "PHASE_BEGIN",
            phase: "END_STEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        const alive = (id: string) =>
            [
                ...state.players[0].battlefield,
                ...state.players[1].battlefield,
            ].some((c) => c.id === id);
        expect(alive("idler")).toBe(false);
        expect(alive("attacker")).toBe(true);
        expect(alive("tapped")).toBe(true);
        expect(alive("wall")).toBe(true);
        expect(alive("fresh")).toBe(true);
    });
});

describe("The Fallen — upkeep 1 to each opponent it damaged this game (CR 603.6a)", () => {
    function setup() {
        const fallen = makeInstance(theFallen.id, {
            id: "fallen",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [fallen] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        return { state, fallen };
    }

    it("does nothing at upkeep before The Fallen has dealt damage", () => {
        const { state, fallen } = setup();
        resolveTrigger(state, fallen, "the-fallen-upkeep", UPKEEP("p1"));
        expect(state.players[1].life).toBe(20);
    });

    it("after marking an opponent, the upkeep deals 1 to that opponent", () => {
        const { state, fallen } = setup();
        // Stamp the mark via the damage-dealt trigger.
        resolveTrigger(state, fallen, "the-fallen-mark", {
            type: "DAMAGE_DEALT",
            sourceInstanceId: "fallen",
            sourceControllerId: "p1",
            target: { type: "player", id: "p2" },
            amount: 2,
            isCombat: true,
        } as StackItem["triggerEvent"]);
        resolveTrigger(state, fallen, "the-fallen-upkeep", UPKEEP("p1"));
        expect(state.players[1].life).toBe(19);
    });
});

describe("Uncle Istvan — prevent all damage from creatures (CR 615)", () => {
    function makeIstvanState() {
        const istvan = makeInstance(uncleIstvan.id, {
            id: "istvan",
            controllerId: "p1",
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [istvan] }),
                makePlayer("p2"),
            ],
        });
    }

    it("consumes damage whose source is a creature", () => {
        const state = makeIstvanState();
        const ev = applyDamageReplacements(state, {
            kind: "damage",
            sourceInstanceId: "atk",
            sourceControllerId: "p2",
            sourceColors: [],
            sourceTypes: ["Creature"],
            sourceStaticAbilities: [],
            target: { type: "permanent", id: "istvan" },
            amount: 5,
            isCombat: true,
        });
        expect(ev).toBeNull(); // fully prevented
    });

    it("does NOT prevent damage from a noncreature source", () => {
        const state = makeIstvanState();
        const ev = applyDamageReplacements(state, {
            kind: "damage",
            sourceInstanceId: "bolt",
            sourceControllerId: "p2",
            sourceColors: ["R"],
            sourceTypes: ["Instant"],
            sourceStaticAbilities: [],
            target: { type: "permanent", id: "istvan" },
            amount: 3,
            isCombat: false,
        });
        expect(ev?.amount).toBe(3);
    });

    it("the prevention fires through the wire projection (mandatory)", () => {
        const state = makeIstvanState();
        const projected = projectPublicState(state, 1, "p1");
        const ev = applyDamageReplacements(projected as unknown as GameState, {
            kind: "damage",
            sourceInstanceId: "atk",
            sourceControllerId: "p2",
            sourceColors: [],
            sourceTypes: ["Creature"],
            sourceStaticAbilities: [],
            target: { type: "permanent", id: "istvan" },
            amount: 4,
            isCombat: true,
        });
        expect(ev).toBeNull();
    });
});

describe("Word of Binding — tap X target creatures (CR 601.2c / 701.20a)", () => {
    it("taps every targeted creature", () => {
        const a = makeInstance(
            getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870").id,
            {
                id: "a",
                controllerId: "p2",
                ownerId: "p2",
            }
        );
        const b = makeInstance(
            getDefinition("0ddb98e8-13fe-4786-83f7-b72c56db135a").id,
            {
                id: "b",
                controllerId: "p2",
                ownerId: "p2",
            }
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [a, b] }),
            ],
        });
        const item = pushSpell(state, wordOfBinding.id, "p1", [
            { type: "permanent", id: "a" },
            { type: "permanent", id: "b" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "a")!.isTapped
        ).toBe(true);
        expect(
            state.players[1].battlefield.find((c) => c.id === "b")!.isTapped
        ).toBe(true);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Worms of the Earth — {2}{B}{B}{B} Enchantment (#423)
// "Players can't play lands. Lands can't enter the battlefield. At the
//  beginning of each upkeep, any player may sacrifice two lands or take 5
//  damage; if they do either, destroy this." CR 305.1 land-play special action
//  + CR 614 land-ETB prohibition; CR 603.6a "each" upkeep + CR 117.3a optional.
// ───────────────────────────────────────────────────────────────────────────

/** Puts Worms of the Earth on p1's battlefield. */
function withWorms(): { state: GameState; worms: CardInstanceState } {
    const worms = makeInstance(wormsOfTheEarth.id, {
        id: "worms-1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    const state = makeState({
        players: [makePlayer("p1", { battlefield: [worms] }), makePlayer("p2")],
    });
    return { state, worms };
}

describe("Worms of the Earth ({2}{B}{B}{B} Enchantment — land-play/ETB lock)", () => {
    describe("land-play prohibition (CR 305.1) — path 1", () => {
        it('a land in hand has NO "play" action while Worms is in play', () => {
            const { state } = withWorms();
            const land = makeInstance(mountain.id, {
                id: "mtn-hand",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
            state.players[0].hand.push(land);
            const actions = getLegalActions(state, state.players[0], land);
            expect(actions).not.toContain("play");
        });

        it('the same land DOES have "play" once Worms leaves play (lock lifted)', () => {
            const { state, worms } = withWorms();
            const land = makeInstance(mountain.id, {
                id: "mtn-hand",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
            state.players[0].hand.push(land);
            // Remove Worms → lock lifts immediately (live-derived).
            state.players[0].battlefield = state.players[0].battlefield.filter(
                (c) => c.id !== worms.id
            );
            const actions = getLegalActions(state, state.players[0], land);
            expect(actions).toContain("play");
        });

        it("assertLegalAction throws for play (game.ts playCard mutation boundary)", () => {
            const { state } = withWorms();
            const land = makeInstance(mountain.id, {
                id: "mtn-hand",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
            state.players[0].hand.push(land);
            expect(() =>
                assertLegalAction(state, state.players[0], land, "play")
            ).toThrow(/Illegal action "play"/);
        });
    });

    describe("land-ETB prohibition (CR 614) — path 2", () => {
        it("landPlayLockActive is true with Worms in play, false without", () => {
            const { state, worms } = withWorms();
            expect(landPlayLockActive(state)).toBe(true);
            state.players[0].battlefield = state.players[0].battlefield.filter(
                (c) => c.id !== worms.id
            );
            expect(landPlayLockActive(state)).toBe(false);
        });

        it("canLandEnterBattlefield PREVENTS a land while locked, allows non-lands", () => {
            const { state } = withWorms();
            expect(canLandEnterBattlefield(state, ["Land"])).toBe(false);
            expect(canLandEnterBattlefield(state, ["Creature"])).toBe(true);
            expect(canLandEnterBattlefield(state, ["Artifact"])).toBe(true);
        });

        it("canLandEnterBattlefield allows a land once Worms leaves", () => {
            const { state, worms } = withWorms();
            state.players[0].battlefield = state.players[0].battlefield.filter(
                (c) => c.id !== worms.id
            );
            expect(canLandEnterBattlefield(state, ["Land"])).toBe(true);
        });
    });

    describe("serialization cache (refreshLandPlayLock via SBA)", () => {
        it("checkStateBasedActions sets state.landPlayLocked while Worms is in play", () => {
            const { state } = withWorms();
            expect(state.landPlayLocked).toBeUndefined();
            checkStateBasedActions(state);
            expect(state.landPlayLocked).toBe(true);
        });

        it("checkStateBasedActions clears state.landPlayLocked when Worms leaves", () => {
            const { state, worms } = withWorms();
            checkStateBasedActions(state);
            expect(state.landPlayLocked).toBe(true);
            state.players[0].battlefield = state.players[0].battlefield.filter(
                (c) => c.id !== worms.id
            );
            checkStateBasedActions(state);
            expect(state.landPlayLocked).toBeUndefined();
        });
    });

    describe("upkeep clause (CR 603.6a 'each' + CR 117.3a optional)", () => {
        it("sacrificing two lands destroys Worms of the Earth", () => {
            const { state, worms } = withWorms();
            const l1 = makeInstance(mountain.id, {
                id: "l1",
                controllerId: "p1",
                ownerId: "p1",
            });
            const l2 = makeInstance(mountain.id, {
                id: "l2",
                controllerId: "p1",
                ownerId: "p1",
            });
            state.players[0].battlefield.push(l1, l2);
            state.phase = "UPKEEP";
            // Fire on p1's upkeep; choose "sacrifice", then pick the two lands.
            resolveTrigger(
                state,
                worms,
                "worms-of-the-earth-upkeep",
                UPKEEP("p1")
            );
            answerChoice(state, ["sacrifice"]);
            answerChoice(state, ["l1", "l2"]);
            checkStateBasedActions(state);
            // Worms destroyed; two lands sacrificed.
            expect(
                state.players[0].battlefield.some((c) => c.id === worms.id)
            ).toBe(false);
            expect(
                state.players[0].battlefield.filter((c) =>
                    c.types.includes("Land")
                )
            ).toHaveLength(0);
        });

        it("taking 5 damage destroys Worms and lowers life by 5", () => {
            const { state, worms } = withWorms();
            state.phase = "UPKEEP";
            resolveTrigger(
                state,
                worms,
                "worms-of-the-earth-upkeep",
                UPKEEP("p1")
            );
            answerChoice(state, ["damage"]);
            checkStateBasedActions(state);
            expect(state.players[0].life).toBe(15);
            expect(
                state.players[0].battlefield.some((c) => c.id === worms.id)
            ).toBe(false);
        });

        it("declining keeps Worms in play (no sacrifice, no damage)", () => {
            const { state, worms } = withWorms();
            const land = makeInstance(mountain.id, {
                id: "keep",
                controllerId: "p1",
                ownerId: "p1",
            });
            state.players[0].battlefield.push(land);
            state.phase = "UPKEEP";
            resolveTrigger(
                state,
                worms,
                "worms-of-the-earth-upkeep",
                UPKEEP("p1")
            );
            answerChoice(state, ["decline"]);
            checkStateBasedActions(state);
            expect(
                state.players[0].battlefield.some((c) => c.id === worms.id)
            ).toBe(true);
            expect(state.players[0].life).toBe(20);
            expect(
                state.players[0].battlefield.some((c) => c.id === "keep")
            ).toBe(true);
        });

        it("fires on EACH player's upkeep — p2 may pay too (scope: each)", () => {
            const { state, worms } = withWorms();
            // p2's upkeep: scoped player is p2 (active player), not Worms'
            // controller p1. p2 takes 5; Worms is destroyed.
            state.phase = "UPKEEP";
            state.activePlayerId = "p2";
            resolveTrigger(
                state,
                worms,
                "worms-of-the-earth-upkeep",
                UPKEEP("p2")
            );
            answerChoice(state, ["damage"]);
            checkStateBasedActions(state);
            expect(state.players[1].life).toBe(15);
            expect(state.players[0].life).toBe(20);
            expect(
                state.players[0].battlefield.some((c) => c.id === worms.id)
            ).toBe(false);
        });
    });

    describe("wire format (projection survives)", () => {
        it("landPlayLocked + lock derivation survive projectPublicState", () => {
            const { state } = withWorms();
            checkStateBasedActions(state);
            expect(landPlayLockActive(state)).toBe(true);
            const projected = projectPublicState(state, 1, "p1");
            // The serialized cache crosses the wire.
            expect(projected.landPlayLocked).toBe(true);
            // And the live derivation still reads Worms off the projected board.
            expect(landPlayLockActive(projected as unknown as GameState)).toBe(
                true
            );
        });
    });
});
