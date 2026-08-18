// neo (Kamigawa: Neon Dynasty) — red behavior tests (ADR 0043 colour split).
//
// Fable of the Mirror-Breaker // Reflection of Kiki-Jiki (issue #2399) is a DSL
// card, but it earns hand-written tests three times over under the per-Op
// regime:
//
//   * chapter I introduces a NEW `TokenTriggeredEventKind`
//     (`ATTACKERS_DECLARED`) and the `attacksTrigger` factory behind it — the
//     self-scope (CR 109.2) is the whole fidelity claim and nothing else in the
//     catalogue exercises it;
//   * the back face introduces a new `except` key on `createTokenCopy`
//     (`additionalStaticAbilities`, CR 707.2) and is the first ACTIVATED
//     ability whose `excludeSource` is honoured (issue #2399);
//   * chapter III is the first `exileAndReturnTransformed` with a `controller`
//     override, and the first Saga in the catalogue that transforms at all.
//
// Every assertion here runs through a real engine entry point: the CR 714.3c
// turn-based action for chapters, `emitAttackersDeclaredEvents` (CR 508.1) for
// the token's attack trigger, `activateAbilityOnState` /
// `applyOneTargetSelection` / `finalizeTargetSelection` for the back face, and
// `projectPublicState` for every SURFACE claim.

import { describe, it, expect } from "vitest";
import { fableOfTheMirrorBreaker } from "../red";
import { elvishArchers } from "../../lea/green";
import { jasmineBoreal } from "../../leg/multicolor";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type { CardInstanceState, GameState } from "../../../../gre/state";
import {
    getPlayer,
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../../../gre/state";
import { advanceSagasAtPrecombatMain } from "../../../../gre/sagas";
import {
    emitAttackersDeclaredEvents,
    fireDelayedTriggers,
} from "../../../../gre/phases";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    activateAbilityOnState,
    applyOneTargetSelection,
    finalizeTargetSelection,
} from "../../../../game";
import { getDefinition } from "../../../index";
import { projectPublicState } from "../../../../gameProjections";
import { LORE_COUNTER } from "../../../abilities/sagas";

const SHAMAN_TRIGGER_ID = "goblin-shaman-attacks-treasure";
const KIKI_ABILITY_ID = "reflection-of-kiki-jiki-copy";

/** One CR 714.3c turn-based lore counter on the active player's Sagas, the
 *  chapter trigger it raises put on the stack (CR 603.2), and that chapter
 *  resolved — the exact pair `performPhaseEntry`'s PRECOMBAT_MAIN case runs.
 *  Returns null when the chapter SUSPENDED on a pending choice (chapter II). */
function tickChapter(state: GameState): void {
    advanceSagasAtPrecombatMain(state);
    processPendingActionTriggers(state);
    resolveTopOfStack(state);
}

/** Declares `attackerIds` as attackers through the REAL production entry point
 *  (`emitAttackersDeclaredEvents`, CR 508.1) rather than hand-building the
 *  trigger stack item. A hand-built item never runs `collectTriggers`, so the
 *  synthesized ability's `matches` — the entire self-scope claim — would never
 *  execute and a trigger that wrongly fired on ANY attacker would pass. */
function declareAttackers(state: GameState, attackerIds: string[]): void {
    state.phase = "DECLARE_ATTACKERS";
    state.combat = {
        attackerIds,
        confirmed: true,
        blockerAssignments: {},
        blockersConfirmed: false,
    };
    emitAttackersDeclaredEvents(state);
}

/** Fable on p1's battlefield with `lore` counters already on it, so the next
 *  `tickChapter` crosses chapter `lore + 1` (CR 714.2b). */
function fableBoard(
    lore: number,
    opts: { hand?: string[]; ownerId?: string } = {}
): { state: GameState; saga: CardInstanceState } {
    const saga = makeInstance(fableOfTheMirrorBreaker.id, {
        id: "fable1",
        controllerId: "p1",
        ownerId: opts.ownerId ?? "p1",
        counters: { [LORE_COUNTER]: lore },
    });
    const hand = (opts.hand ?? []).map((id) =>
        makeInstance(elvishArchers.id, {
            id,
            controllerId: "p1",
            zone: "hand",
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [saga], hand }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
    });
    return { state, saga };
}

const goblinShaman = (state: GameState): CardInstanceState | undefined =>
    state.players[0].battlefield.find(
        (c) => c.isToken && c.subtypes.includes("Shaman")
    );

const treasures = (state: GameState): CardInstanceState[] =>
    state.players[0].battlefield.filter((c) => c.subtypes.includes("Treasure"));

describe("Fable of the Mirror-Breaker — chapter I (CR 714.2b / 707.2 / 508.1m)", () => {
    it("creates a 2/2 red Goblin Shaman token carrying its OWN attack trigger", () => {
        const { state } = fableBoard(0);
        tickChapter(state);

        const token = goblinShaman(state);
        expect(token).toBeDefined();
        expect(token!.power).toBe(2);
        expect(token!.toughness).toBe(2);
        expect(token!.subtypes).toEqual(
            expect.arrayContaining(["Goblin", "Shaman"])
        );
        // The carried trigger is a REAL synthesized `TriggeredAbility` on the
        // token's own definition, not a display stub.
        const def = getDefinition((token!.card as { id: string }).id);
        expect(def.triggeredAbilities?.map((a) => a.id)).toEqual([
            SHAMAN_TRIGGER_ID,
        ]);
        expect(def.triggeredAbilities![0].event).toBe("ATTACKERS_DECLARED");
    });

    it("the token attacking creates a Treasure (CR 508.1m)", () => {
        const { state } = fableBoard(0);
        tickChapter(state);
        const token = goblinShaman(state)!;
        expect(treasures(state)).toHaveLength(0);

        declareAttackers(state, [token.id]);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(SHAMAN_TRIGGER_ID);
        resolveTopOfStack(state);

        expect(treasures(state)).toHaveLength(1);
    });

    it("SELF SCOPE (CR 109.2) — another creature attacking makes no Treasure", () => {
        const { state } = fableBoard(0);
        tickChapter(state);
        const other = makeInstance(elvishArchers.id, {
            id: "archer1",
            controllerId: "p1",
        });
        state.players[0].battlefield.push(other);

        declareAttackers(state, [other.id]);
        expect(state.stack).toHaveLength(0);
        expect(treasures(state)).toHaveLength(0);
    });

    it("SELF SCOPE — two attackers, only one of them the token: exactly ONE Treasure", () => {
        const { state } = fableBoard(0);
        tickChapter(state);
        const token = goblinShaman(state)!;
        const other = makeInstance(elvishArchers.id, {
            id: "archer1",
            controllerId: "p1",
        });
        state.players[0].battlefield.push(other);

        // One batch event carries BOTH attackers (CR 508.1 emits a single
        // ATTACKERS_DECLARED), so a scope check that merely asked "did anything
        // attack" would fire once here too — what distinguishes it is the
        // previous test, where the token is NOT among the attackers.
        declareAttackers(state, [other.id, token.id]);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(treasures(state)).toHaveLength(1);
    });

    it("CR 508.4 — a token that ENTERS attacking was never declared, so no Treasure", () => {
        const { state } = fableBoard(0);
        tickChapter(state);
        const token = goblinShaman(state)!;
        // `finishTokenEntry` deliberately calls `markAttacking` WITHOUT
        // emitting ATTACKERS_DECLARED, so a token put onto the battlefield
        // attacking is "attacking" but never "attacked" for trigger purposes.
        // Modelled here by the combat state existing with the token in it and
        // NO event emitted.
        state.phase = "DECLARE_ATTACKERS";
        state.combat = {
            attackerIds: [token.id],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        };
        processPendingActionTriggers(state);

        expect(state.stack).toHaveLength(0);
        expect(treasures(state)).toHaveLength(0);
    });

    it("SURFACE — the token and its Treasure project to both viewers", () => {
        const { state } = fableBoard(0);
        tickChapter(state);
        const token = goblinShaman(state)!;
        declareAttackers(state, [token.id]);
        resolveTopOfStack(state);

        for (const [viewerIdx, viewerId] of [
            [0, "p1"],
            [1, "p2"],
        ] as const) {
            const projected = projectPublicState(state, 1, viewerId);
            const slimToken = projected.players[0].battlefield.find(
                (c) => c.id === token.id
            )!;
            expect(slimToken.subtypes).toContain("Shaman");
            // `card.card` strips to `{ id }` on the wire; the carried trigger
            // round-trips through the registry keyed by that id.
            const def = getDefinition((slimToken.card as { id: string }).id);
            expect(def.triggeredAbilities?.[0]?.id).toBe(SHAMAN_TRIGGER_ID);
            expect(
                projected.players[0].battlefield.filter((c) =>
                    c.subtypes.includes("Treasure")
                )
            ).toHaveLength(1);
            expect(viewerIdx).toBeGreaterThanOrEqual(0);
        }
    });
});

describe("Fable of the Mirror-Breaker — chapter II (CR 714.2b / 121.2)", () => {
    /** Advances to chapter II with `hand` in hand, answers the discard choice
     *  with `picks`, and returns the resulting state. */
    function chapterTwo(hand: string[], picks: string[]): GameState {
        const { state } = fableBoard(1, { hand });
        // Library cards to draw from — `draw` with an empty library is a
        // no-op/loss condition, which would mask the count under test.
        state.players[0].library = ["lib1", "lib2", "lib3"].map((id) =>
            makeInstance(elvishArchers.id, {
                id,
                controllerId: "p1",
                zone: "library",
            })
        );
        tickChapter(state);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("discard-hand");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: picks,
        });
        return state;
    }

    it("discarding two draws two", () => {
        const state = chapterTwo(["h1", "h2"], ["h1", "h2"]);
        expect(state.players[0].graveyard.map((c) => c.id).sort()).toEqual([
            "h1",
            "h2",
        ]);
        // Two discarded, two drawn: the hand is the two library cards.
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "lib1",
            "lib2",
        ]);
        expect(state.players[0].library).toHaveLength(1);
    });

    it("discarding one draws exactly one", () => {
        const state = chapterTwo(["h1", "h2"], ["h1"]);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["h1"]);
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "h2",
            "lib1",
        ]);
        expect(state.players[0].library).toHaveLength(2);
    });

    it("discarding nothing draws nothing (the 'if you do' clause)", () => {
        const state = chapterTwo(["h1", "h2"], []);
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "h1",
            "h2",
        ]);
        expect(state.players[0].library).toHaveLength(3);
    });
});

describe("Fable of the Mirror-Breaker — chapter III (CR 712.14a / 400.7)", () => {
    it("exiles the Saga and returns it transformed as Reflection of Kiki-Jiki", () => {
        const { state } = fableBoard(2);
        tickChapter(state);

        // A NEW object (CR 400.7): the front face is gone from the battlefield.
        expect(state.players[0].battlefield).toHaveLength(1);
        const backFace = state.players[0].battlefield[0];
        expect(getDefinition((backFace.card as { id: string }).id).name).toBe(
            "Reflection of Kiki-Jiki"
        );
        expect(backFace.types).toEqual(
            expect.arrayContaining(["Enchantment", "Creature"])
        );
        expect(backFace.subtypes).not.toContain("Saga");
        expect(backFace.power).toBe(2);
        expect(backFace.toughness).toBe(2);
        // CR 714.3a's lore counters do not survive the zone change.
        expect(backFace.counters?.[LORE_COUNTER] ?? 0).toBe(0);
        expect(state.players[0].exile).toHaveLength(0);
    });

    it("'under YOUR control' — a Saga you control but do not OWN returns under YOU", () => {
        // The clause the ORI flip-walker template does not have: those say
        // "under his OWNER's control". Without the Op's `controller` override
        // the returning permanent would land in p2's battlefield.
        const { state } = fableBoard(2, { ownerId: "p2" });
        tickChapter(state);

        expect(state.players[0].battlefield).toHaveLength(1);
        expect(state.players[0].battlefield[0].controllerId).toBe("p1");
        expect(state.players[0].battlefield[0].ownerId).toBe("p2");
        expect(state.players[1].battlefield).toHaveLength(0);
    });

    it("SURFACE — the transformed back face projects to both viewers", () => {
        const { state } = fableBoard(2);
        tickChapter(state);
        const backFace = state.players[0].battlefield[0];

        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === backFace.id
            )!;
            expect(slim.types).toEqual(
                expect.arrayContaining(["Enchantment", "Creature"])
            );
            const def = getDefinition((slim.card as { id: string }).id);
            expect(def.name).toBe("Reflection of Kiki-Jiki");
            expect(def.activatedAbilities?.[0]?.id).toBe(KIKI_ABILITY_ID);
        }
    });
});

describe("Reflection of Kiki-Jiki — the copy ability (CR 707.2 / 603.7a)", () => {
    /** A transformed Fable on p1's battlefield, untapped and not summoning
     *  sick, plus whatever other permanents the case needs. */
    function kikiBoard(extra: CardInstanceState[] = []): {
        state: GameState;
        kiki: CardInstanceState;
    } {
        const { state } = fableBoard(2);
        tickChapter(state);
        const kiki = state.players[0].battlefield[0];
        kiki.isSummoningSick = false;
        state.players[0].battlefield.push(
            ...extra.filter((c) => c.controllerId === "p1")
        );
        state.players[1].battlefield.push(
            ...extra.filter((c) => c.controllerId !== "p1")
        );
        state.players[0].manaPool = { C: 5 };
        state.phase = "PRECOMBAT_MAIN";
        state.priorityPlayerId = "p1";
        return { state, kiki };
    }

    const activate = (state: GameState, kiki: CardInstanceState) =>
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: kiki.id,
            abilityId: KIKI_ABILITY_ID,
        });

    it("'ANOTHER' — with no other creature it has no legal target at all", () => {
        // Reflection of Kiki-Jiki is itself a NONLEGENDARY creature you
        // control, so without the self-exclusion it would be its own legal
        // target and this activation would succeed.
        const { state, kiki } = kikiBoard();
        expect(() => activate(state, kiki)).toThrow(/legal target/i);
    });

    it("'NONLEGENDARY … YOU CONTROL' — a legendary of yours and an opponent's creature are both illegal", () => {
        // A REAL legendary definition — the layer system derives live
        // supertypes (CR 205.4a) from the definition, so an instance-level
        // `supertypes` override would be invisible to `excludeSupertypes` and
        // the test would pass for the wrong reason.
        const legendary = makeInstance(jasmineBoreal.id, {
            id: "legend1",
            controllerId: "p1",
        });
        const theirs = makeInstance(elvishArchers.id, {
            id: "theirs1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const { state, kiki } = kikiBoard([legendary, theirs]);
        expect(() => activate(state, kiki)).toThrow(/legal target/i);
    });

    it("a nonlegendary creature you control IS legal; the self pick is rejected", () => {
        const mine = makeInstance(elvishArchers.id, {
            id: "mine1",
            controllerId: "p1",
        });
        const { state, kiki } = kikiBoard([mine]);
        activate(state, kiki);
        expect(state.pendingTarget).toBeDefined();
        expect(state.pendingTarget!.excludeInstanceIds).toContain(kiki.id);
        // The server re-validates every pick against the SAME materialised
        // filters, so "another" holds at selection time too.
        expect(() =>
            applyOneTargetSelection(state, "p1", {
                targetType: "permanent",
                targetId: kiki.id,
            })
        ).toThrow();
    });

    it("creates a token copy WITH HASTE (a copiable value, CR 707.2) and sacrifices it at the next end step", () => {
        const mine = makeInstance(elvishArchers.id, {
            id: "mine1",
            controllerId: "p1",
        });
        const { state, kiki } = kikiBoard([mine]);
        activate(state, kiki);
        const pt = state.pendingTarget!;
        pt.selected = [{ type: "permanent", id: "mine1" }];
        finalizeTargetSelection(state, pt, "p1");
        resolveTopOfStack(state);

        const copy = state.players[0].battlefield.find(
            (c) => c.isToken && c.id !== "mine1"
        );
        expect(copy).toBeDefined();
        expect(copy!.staticAbilities).toContain("haste");
        // The copy is a nonlegendary token, so the legend rule (CR 704.5j)
        // never applies: the original survives alongside it.
        expect(
            state.players[0].battlefield.filter((c) => c.id === "mine1")
        ).toHaveLength(1);

        // The delayed trigger (CR 603.7a) is scheduled, not fired yet.
        expect(state.delayedTriggers?.length ?? 0).toBeGreaterThan(0);

        // SURFACE — haste is a copiable value written onto the instance, so it
        // survives the wire projection (the client's own haste affordance
        // reads it there).
        const projected = projectPublicState(state, 1, "p1");
        const slimCopy = projected.players[0].battlefield.find(
            (c) => c.id === copy!.id
        )!;
        expect(slimCopy.staticAbilities).toContain("haste");
    });

    it("the delayed trigger sacrifices the copy at the beginning of the next end step", () => {
        const mine = makeInstance(elvishArchers.id, {
            id: "mine1",
            controllerId: "p1",
        });
        const { state, kiki } = kikiBoard([mine]);
        activate(state, kiki);
        const pt = state.pendingTarget!;
        pt.selected = [{ type: "permanent", id: "mine1" }];
        finalizeTargetSelection(state, pt, "p1");
        resolveTopOfStack(state);
        const copy = state.players[0].battlefield.find(
            (c) => c.isToken && c.id !== "mine1"
        )!;

        // CR 513.1 / 603.7a — the delayed trigger fires as the END step
        // begins, through the SAME `fireDelayedTriggers` call the END_STEP
        // phase entry makes (`gre/phases.ts`).
        fireDelayedTriggers(state, "next-end-step");
        while (state.stack.length > 0) resolveTopOfStack(state);

        expect(
            state.players[0].battlefield.find((c) => c.id === copy.id)
        ).toBeUndefined();
        // The ORIGINAL is untouched.
        expect(
            state.players[0].battlefield.find((c) => c.id === "mine1")
        ).toBeDefined();
        expect(getPlayer(state, "p1").life).toBe(20);
    });
});
