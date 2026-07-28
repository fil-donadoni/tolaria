// backupTrigger — CR 702.165 Backup N, exercised through the REAL runtime
// path (issue #1692).
//
// Why this file exists on top of the per-card tests (`mom/__tests__/black.ts`,
// `moc/__tests__/{white,red}.ts`) and the construct test in
// `gre/effects/__tests__/interpreter.test.ts`: every one of those hand-BUILDS
// the trigger StackItem (spread the source, set `triggeredAbilityId` /
// `triggerSourceId` / `targets` by hand) and then calls `resolveTopOfStack`.
// That proves the Effect Script, but it jumps over every seam a real game
// crosses between "the Backup creature enters" and "the grant lands":
//
//   resolveTopOfStack (creature spell resolves → PERMANENT_ENTERED)
//     → collectTriggers / placeTriggersOnStack   (gre/triggers.ts)
//     → raiseTriggerTargetSelection              (gre/rules.ts, CR 603.3d)
//     → finalizeTargetSelection kind:"trigger"   (game.ts)
//     → compactState / expandState               (gre/serialize.ts — the DB
//                                                 round-trip taken between
//                                                 every pair of mutations)
//     → resolveTopOfStack (trigger resolves → counters + gated grant)
//     → projectPublicState                       (gameProjections.ts — the wire)
//
// A grant that is correct in the interpreter can still be dead in a real game
// if any of those drops the target slot, the trigger source id, or the
// mutated `staticAbilities` array. This file drives the whole chain for all
// three shipped Backup cards and pins the CR 702.165a/c behaviour end to end.
//
// Diagnosis outcome for #1692: the reported failure ("only the counter lands")
// does NOT reproduce anywhere on that chain — none of the three hypotheses in
// the report holds. (a) the `targetIsAnother` object-identity predicate reads
// `item.triggerSourceId`, which `buildTriggerItem` sets and `serialize.ts`
// persists; (b) `grantAbility` → `SpellContext.grantStaticAbility` finds its
// target with a battlefield-wide `findOnBattlefield`, so a creature the
// ability's controller does NOT control is granted identically (covered
// below); (c) there is no read-time ability layer to survive — layer 6 is
// materialised eagerly INTO `card.staticAbilities`, which every consumer
// (combat lifelink via `describeDamageSource`, the client inspector via
// `getDisplayAbilities`) already reads off the live instance, and which
// `compactState` persists as a diff against the printed definition. The one
// CR-correct behaviour that LOOKS like the report is the last case here: with
// no other creature in play the sole legal target is the Backup creature
// itself, the engine auto-selects it (CR 603.3d — no real choice, so no
// prompt), and CR 702.165a grants nothing on a self-target.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    resolveTriggerOrder,
} from "../../../__tests__/setup";
import { getCardByName } from "../../..";
import type { CardInstanceState, GameState } from "../../../../gre/state";
import type { GameEvent, Phase } from "../../../../gre/types";
import { resolveTopOfStack } from "../../../../gre/state";
import {
    collectTriggers,
    placeTriggersOnStack,
} from "../../../../gre/triggers";
import {
    advancePhase,
    applyAllCombatDamage,
    buildAutoDamageAssignments,
} from "../../../../gre/phases";
import { compactState, expandState } from "../../../../gre/serialize";
import { finalizeTargetSelection } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";
import { consumingAetherborn } from "../../../sets/mom/black";
import { guardianScalelord } from "../../../sets/moc/white";
import { deathGreetersChampion } from "../../../sets/moc/red";

const TARGET_ID = "backup-target";

/** Builds a board with `bearController`'s vanilla 2/2 already in play, casts
 *  `cardId` from `casterId`'s hand and resolves it, so the CR 702.165a ETB
 *  trigger is collected and placed by the ENGINE (not by hand). */
function castBackupCreature(
    cardId: string,
    opts: { bearController?: string } = {}
): GameState {
    const bearController = opts.bearController ?? "p1";
    const bear = makeInstance(getCardByName("Grizzly Bears").id, {
        id: TARGET_ID,
        controllerId: bearController,
        ownerId: bearController,
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: bearController === "p1" ? [bear] : [],
            }),
            makePlayer("p2", {
                battlefield: bearController === "p2" ? [bear] : [],
            }),
        ],
    });
    pushSpell(state, cardId, "p1");
    resolveTopOfStack(state);
    resolveTriggerOrder(state);
    return state;
}

/** Answers the `kind:"trigger"` PendingTarget the engine raised, exactly the
 *  way the `selectTarget` mutation does, then takes the DB round-trip that
 *  separates that mutation from the priority pass which resolves the trigger. */
function chooseTargetAndResolve(state: GameState, targetId: string): GameState {
    const pt = state.pendingTarget;
    if (!pt) throw new Error("engine raised no trigger PendingTarget");
    pt.selected = [{ type: "permanent", id: targetId }];
    finalizeTargetSelection(state, pt, pt.playerId);
    const reloaded = expandState(compactState(state));
    resolveTopOfStack(reloaded);
    return reloaded;
}

function findOnBoard(state: GameState, id: string): CardInstanceState {
    for (const p of state.players) {
        const found = p.battlefield.find((c) => c.id === id);
        if (found) return found;
    }
    throw new Error(`no permanent ${id}`);
}

describe("Backup N — real trigger path (CR 702.165, issue #1692)", () => {
    // CR 702.165a/c — one row per shipped Backup card: the granted ability is
    // the card's OWN printed keyword below the Backup line.
    const CARDS: ReadonlyArray<[string, string, string]> = [
        ["Consuming Aetherborn", consumingAetherborn.id, "lifelink"],
        ["Guardian Scalelord", guardianScalelord.id, "flying"],
        ["Death-Greeter's Champion", deathGreetersChampion.id, "double strike"],
    ];

    for (const [name, cardId, keyword] of CARDS) {
        it(`${name}: another creature gets the counter AND ${keyword} until end of turn`, () => {
            const state = chooseTargetAndResolve(
                castBackupCreature(cardId),
                TARGET_ID
            );
            const target = findOnBoard(state, TARGET_ID);
            expect(target.counters?.["+1/+1"]).toBe(1);
            expect(target.staticAbilities).toContain(keyword);
            // CR 611.2 — the grant is duration-scoped, tracked for the
            // phase-boundary purge.
            expect(target.grantedStaticAbilities).toEqual([
                { ability: keyword, duration: { phase: "end-of-turn" } },
            ]);
        });
    }

    it("survives the wire projection — the client sees the granted keyword", () => {
        const state = chooseTargetAndResolve(
            castBackupCreature(consumingAetherborn.id),
            TARGET_ID
        );
        // Both seats: a granted keyword is public information (CR 613.1f).
        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            const slim = projected.players
                .flatMap((p) => p.battlefield)
                .find((c) => c.id === TARGET_ID)!;
            expect(slim.staticAbilities).toContain("lifelink");
            expect(slim.counters?.["+1/+1"]).toBe(1);
        }
    });

    it("grants to a creature its controller does NOT control", () => {
        const state = chooseTargetAndResolve(
            castBackupCreature(consumingAetherborn.id, {
                bearController: "p2",
            }),
            TARGET_ID
        );
        const target = findOnBoard(state, TARGET_ID);
        expect(target.controllerId).toBe("p2");
        expect(target.staticAbilities).toContain("lifelink");
        expect(target.counters?.["+1/+1"]).toBe(1);
    });

    it("granted lifelink is live in combat — damage gains its controller life", () => {
        const state = chooseTargetAndResolve(
            castBackupCreature(consumingAetherborn.id),
            TARGET_ID
        );
        // The backed-up bear (now 3/3 with a +1/+1 counter) attacks unblocked.
        state.phase = "COMBAT_DAMAGE";
        state.combat = {
            attackerIds: [TARGET_ID],
            confirmed: true,
            blockerAssignments: {},
        } as GameState["combat"];
        const lifeBefore = state.players[0].life;
        applyAllCombatDamage(
            state,
            buildAutoDamageAssignments(state, "regular"),
            "regular"
        );
        // CR 702.15b — 3 combat damage to the defending player, 3 life gained.
        expect(state.players[1].life).toBe(20 - 3);
        expect(state.players[0].life).toBe(lifeBefore + 3);
    });

    it("expires at CLEANUP and does not persist into the next turn", () => {
        let state = chooseTargetAndResolve(
            castBackupCreature(consumingAetherborn.id),
            TARGET_ID
        );
        const runTo = (phase: Phase) => {
            for (let i = 0; i < 32 && state.phase !== phase; i++) {
                advancePhase(state);
            }
            expect(state.phase).toBe(phase);
        };
        // CR 611.2 — the grant lives for the REST of this turn: still present
        // once combat is reached.
        runTo("DECLARE_ATTACKERS");
        expect(findOnBoard(state, TARGET_ID).staticAbilities).toContain(
            "lifelink"
        );
        // CR 514.2 — "until end of turn" effects end at the cleanup step; by
        // the next turn's upkeep the keyword is gone (the +1/+1 counter stays).
        runTo("UPKEEP");
        state = expandState(compactState(state));
        const target = findOnBoard(state, TARGET_ID);
        expect(target.staticAbilities).not.toContain("lifelink");
        expect(target.grantedStaticAbilities).toBeUndefined();
        expect(target.counters?.["+1/+1"]).toBe(1);
    });

    it("self-target (sole legal target auto-selects): counter only, no grant", () => {
        // CR 702.165a — "If that's ANOTHER creature": a self-target places the
        // counters and grants nothing extra. With no other creature on either
        // battlefield the engine auto-selects the sole legal target (the
        // source itself, CR 603.3d) — no PendingTarget is raised at all.
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, consumingAetherborn.id, "p1");
        resolveTopOfStack(state);
        resolveTriggerOrder(state);
        expect(state.pendingTarget).toBeUndefined();
        resolveTopOfStack(state);
        const source = state.players[0].battlefield[0];
        expect(source.counters?.["+1/+1"]).toBe(1);
        expect(source.grantedStaticAbilities).toBeUndefined();
        // The printed lifelink is still there exactly once — never re-granted.
        expect(
            source.staticAbilities.filter((a) => a === "lifelink")
        ).toHaveLength(1);
    });

    it("self-target CHOSEN over another legal creature: counter only, no grant", () => {
        const pending = castBackupCreature(consumingAetherborn.id);
        // The Backup creature itself — the only non-bear permanent in play.
        const sourceId = pending.players[0].battlefield.find(
            (c) => c.id !== TARGET_ID
        )!.id;
        const state = chooseTargetAndResolve(pending, sourceId);
        const bear = findOnBoard(state, TARGET_ID);
        expect(bear.counters).toBeUndefined();
        expect(bear.staticAbilities).not.toContain("lifelink");
        const source = state.players[0].battlefield.find(
            (c) => c.id !== TARGET_ID
        )!;
        expect(source.counters?.["+1/+1"]).toBe(1);
        expect(source.grantedStaticAbilities).toBeUndefined();
    });

    // CR 702.165c (issue #1665) — Backup grants EVERY non-backup ability
    // printed below the line, not just the keywords. Guardian Scalelord is the
    // only shipped Backup card with a printed TRIGGERED ability below its
    // Backup line, so it is the one that exercises `grantedTriggeredId`.
    describe("Guardian Scalelord: the printed attack TRIGGER is granted too (CR 702.165c, issue #1665)", () => {
        const WURM_ID = "backup-wurm";
        const GY_WURM_ID = "gy-craw-wurm";

        /** Same real path as `castBackupCreature`, but the backup target is a
         *  6/4 Craw Wurm (so the recipient's post-counter power, 7, differs
         *  from Guardian Scalelord's own 3) and p1's graveyard holds an mv-6
         *  Craw Wurm card — legal for the granted trigger ONLY if the
         *  `mvFilter: { max: "sourcePower" }` cap reads the RECIPIENT's power. */
        function castScalelordOnAWurm(): GameState {
            const crawWurmId = getCardByName("Craw Wurm").id; // {4}{G}{G}, mv 6
            const wurm = makeInstance(crawWurmId, {
                id: WURM_ID,
                controllerId: "p1",
                ownerId: "p1",
            });
            const gyWurm = makeInstance(crawWurmId, {
                id: GY_WURM_ID,
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [wurm],
                        graveyard: [gyWurm],
                    }),
                    makePlayer("p2"),
                ],
            });
            pushSpell(state, guardianScalelord.id, "p1");
            resolveTopOfStack(state);
            resolveTriggerOrder(state);
            return chooseTargetAndResolve(state, WURM_ID);
        }

        /** Declares `attackerId` as an attacker through the REAL trigger seam
         *  (collect → place → CR 603.3d target lock), then resolves whatever
         *  landed on the stack. */
        function attackAndResolve(
            state: GameState,
            attackerId: string
        ): GameState {
            const triggers = collectTriggers(state, [
                {
                    type: "ATTACKERS_DECLARED",
                    attackingPlayerId: "p1",
                    attackerIds: [attackerId],
                } as GameEvent,
            ]);
            placeTriggersOnStack(state, triggers);
            const reloaded = expandState(compactState(state));
            // A trigger with no legal target was already removed from the
            // stack by CR 603.3c, so there may be nothing to resolve.
            if (reloaded.stack.length > 0) resolveTopOfStack(reloaded);
            return reloaded;
        }

        it("records the grant on the recipient and it survives the wire", () => {
            const state = castScalelordOnAWurm();
            const wurm = findOnBoard(state, WURM_ID);
            // Both halves of CR 702.165c: the keyword AND the trigger.
            expect(wurm.staticAbilities).toContain("flying");
            expect(wurm.grantedTriggeredAbilities).toEqual([
                {
                    sourceCardId: guardianScalelord.id,
                    abilityId: "guardian-scalelord-attack",
                    duration: { phase: "end-of-turn" },
                },
            ]);
            // The client reads granted triggers off the instance
            // (`src/lib/card-utils.ts`), so the projection must keep them.
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players
                .flatMap((p) => p.battlefield)
                .find((c) => c.id === WURM_ID)!;
            expect(slim.grantedTriggeredAbilities).toEqual(
                wurm.grantedTriggeredAbilities
            );
        });

        it("the granted trigger fires when the RECIPIENT attacks, and its power caps the reanimation", () => {
            // The 6/4 Craw Wurm is 7/5 after Backup's counter, so the mv-6
            // graveyard card clears the cap — it would NOT under Guardian
            // Scalelord's own power of 3, which pins that "this creature" in
            // the granted copy means the RECIPIENT (CR 702.165a).
            const state = attackAndResolve(castScalelordOnAWurm(), WURM_ID);
            const p1 = state.players[0];
            expect(p1.graveyard.some((c) => c.id === GY_WURM_ID)).toBe(false);
            const reanimated = p1.battlefield.find((c) => c.id === GY_WURM_ID);
            expect(reanimated).toBeDefined();
            expect(reanimated!.controllerId).toBe("p1");
        });

        it("the SOURCE attacking still fires only its own printed copy — capped by ITS power (3 < mv 6)", () => {
            // CR 603.3c — the granted copy lives on the Wurm, not on Guardian
            // Scalelord, so a Scalelord attack raises exactly one trigger; with
            // no graveyard card at mana value ≤ 3 it has no legal target and is
            // removed from the stack (the mv-6 Wurm stays in the graveyard).
            const state = castScalelordOnAWurm();
            const sourceId = state.players[0].battlefield.find(
                (c) => c.id !== WURM_ID
            )!.id;
            const after = attackAndResolve(state, sourceId);
            expect(after.stack).toHaveLength(0);
            expect(after.players[0].graveyard.some((c) => c.id === GY_WURM_ID))
                .toBe(true);
        });

        it("expires at CLEANUP — the recipient stops firing the granted trigger next turn", () => {
            let state = castScalelordOnAWurm();
            for (let i = 0; i < 32 && state.phase !== "UPKEEP"; i++) {
                advancePhase(state);
            }
            expect(state.phase).toBe("UPKEEP");
            state = expandState(compactState(state));
            const wurm = findOnBoard(state, WURM_ID);
            expect(wurm.grantedTriggeredAbilities).toBeUndefined();
            expect(wurm.staticAbilities).not.toContain("flying");
            // CR 611.2 — nothing left to fire: attacking raises no trigger.
            const after = attackAndResolve(state, WURM_ID);
            expect(after.stack).toHaveLength(0);
            expect(after.players[0].graveyard.some((c) => c.id === GY_WURM_ID))
                .toBe(true);
        });
    });

    it("grants even when the Backup source left the battlefield in response", () => {
        // CR 702.165a is a one-shot effect: it does not depend on its source
        // still being on the battlefield when the trigger resolves (CR 611.2c).
        const state = castBackupCreature(consumingAetherborn.id);
        const pt = state.pendingTarget!;
        pt.selected = [{ type: "permanent", id: TARGET_ID }];
        finalizeTargetSelection(state, pt, pt.playerId);
        const srcIdx = state.players[0].battlefield.findIndex(
            (c) => c.id !== TARGET_ID
        );
        const [src] = state.players[0].battlefield.splice(srcIdx, 1);
        state.players[0].graveyard.push(src);
        resolveTopOfStack(state);
        const target = findOnBoard(state, TARGET_ID);
        expect(target.counters?.["+1/+1"]).toBe(1);
        expect(target.staticAbilities).toContain("lifelink");
    });
});
