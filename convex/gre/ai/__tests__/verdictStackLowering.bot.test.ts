// The verdict lowering declares the stack (issue #3514, PRD #3397, ADR 0127).
//
// Every LIVE position here is built by the ENGINE — the blade builder walks a
// quiet board forward through the real cast / activation pipeline, or a move
// the production enumerator offered is applied through `applyMoveInSearch` —
// never a hand-written stack item. A hand-built stack can describe an object
// no game could have put there, and a round trip asserted against one proves
// nothing about the positions this slice exists to make judgeable.

import { describe, expect, it } from "vitest";
import { buildBladeState } from "../blade/runner";
import { buildVerdictPosition, candidateMoves } from "../verdicts/candidates";
import { lowerDecision } from "../verdicts/lowering";
import {
    stackFingerprint,
    stackRebuildMismatch,
    type SeatOf,
} from "../verdicts/stackFingerprint";
import { applyMoveInSearch } from "../../search";
import { getCardByName } from "../../../cards";
import {
    getDefinition,
    withTemporaryDefinition,
} from "../../../cards/registry";
import { isDepartedCombatantId, resolveTopOfStack } from "../../state";
import { COMBAT_DROPPED_PREFIX, specFromState } from "../../scenarioBuilder";
import { combatPartnerIds, findCardInAnyZone } from "../../lookup";
import { normalizeScenarioSpec } from "../../../debugScenarioSpec";
import { getEffectivePower, getEffectiveToughness } from "../../layers";
import { describeMove } from "../../describeMove";
import type { BladeSetupStep } from "../blade/types";
import type { CardInstanceState, GameState, StackItem } from "../../state";
import type {
    CardDefinition,
    EffectOp,
    TriggeredAbility,
} from "../../../cards/types";
import type {
    ScenarioSpec,
    ScenarioTriggerEvent,
} from "../../../debugScenarioSpec";

function engineBuilt(spec: ScenarioSpec, setup: BladeSetupStep[]): GameState {
    return buildBladeState({
        label: "verdict stack lowering fixture",
        spec,
        setup,
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [] },
    });
}

function seatsOf(state: GameState, botId: string): SeatOf {
    return (playerId) =>
        playerId === botId
            ? "me"
            : state.players.some((p) => p.id === playerId)
              ? "opp"
              : null;
}

/** Lower `state` from `botId`'s seat, naming the Bot's pick as the first
 *  candidate — any candidate the live position offers is a legitimate pick. */
function lower(state: GameState, botId: string) {
    const [first] = candidateMoves(state, botId);
    return lowerDecision(state, botId, describeMove(first, state));
}

/** The acceptance assertion: a candidate list, not a refusal, AND the rebuilt
 *  stack matches the live one on seat, name, kind, targets and `x`. */
function expectJudgeable(state: GameState, botId: string): void {
    const outcome = lower(state, botId);
    if (!outcome.ok) {
        throw new Error(`refused ${outcome.kind}: ${outcome.error}`);
    }
    expect(outcome.lowered.candidates.length).toBeGreaterThan(1);
    expect(outcome.lowered.spec.stack?.length).toBe(state.stack.length);
    const rebuilt = buildVerdictPosition(outcome.lowered.spec);
    const rebuiltBot = rebuilt.players[0].id;
    expect(stackFingerprint(rebuilt, seatsOf(rebuilt, rebuiltBot))).toEqual(
        stackFingerprint(state, seatsOf(state, botId))
    );
}

/** The opponent casts Powder Keg on their own turn; the Bot, holding a Bolt,
 *  decides whether to respond. */
function powderKegPosition(): { state: GameState; botId: string } {
    const state = engineBuilt(
        {
            cards: [
                { name: "Powder Keg", owner: "opp", zone: "hand" },
                { name: "Mountain", owner: "opp", count: 2 },
                { name: "Mountain", owner: "me" },
                { name: "Lightning Bolt", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            activePlayer: "opp",
            landCount: 0,
            libraryCount: 20,
        },
        [{ kind: "cast", card: "Powder Keg", by: "opp" }]
    );
    return { state, botId: state.players[0].id };
}

describe("the verdict lowering declares the stack (issue #3514)", () => {
    it("judges the Bot's response to the opponent's cast — [opp Powder Keg spell]", () => {
        const { state, botId } = powderKegPosition();
        expect(stackFingerprint(state, seatsOf(state, botId))).toEqual([
            "opp Powder Keg spell targets[] x=-",
        ]);
        expectJudgeable(state, botId);
    });

    it("judges a decision over the Bot's own targeted activation and the opponent's answer — [me Rishadan Port ability | opp Impulse spell]", () => {
        const state = engineBuilt(
            {
                cards: [
                    { name: "Rishadan Port", owner: "me" },
                    { name: "Mountain", owner: "me", count: 2 },
                    { name: "Lightning Bolt", owner: "me", zone: "hand" },
                    { name: "Island", owner: "opp" },
                    { name: "Swamp", owner: "opp" },
                    { name: "Impulse", owner: "opp", zone: "hand" },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 5,
                activePlayer: "me",
                landCount: 0,
                libraryCount: 20,
            },
            [
                {
                    kind: "activate",
                    card: "Rishadan Port",
                    ability: "rishadan-port-ability-2",
                    controller: "me",
                    target: "Swamp",
                },
                { kind: "cast", card: "Impulse", by: "opp" },
            ]
        );
        const botId = state.players[0].id;
        expect(stackFingerprint(state, seatsOf(state, botId))).toEqual([
            "me Rishadan Port ability:rishadan-port-ability-2 targets[permanent:opp Swamp {tapped}] x=-",
            "opp Impulse spell targets[] x=-",
        ]);
        expectJudgeable(state, botId);
    });
});

describe("the stack fingerprint sees what the lowering did not write (issue #3514)", () => {
    /** Two Grizzly Bears on the Bot's side — the SECOND one damaged — and the
     *  opponent's Bolt pointed at the damaged one. Cast through the production
     *  enumerator by instance id, so the target is the engine's, not a name
     *  resolved by a builder. The Bot holds a Bolt of its own, so it has a real
     *  decision. */
    function duplicateNameTarget(): { state: GameState; botId: string } {
        const state = buildVerdictPosition({
            cards: [
                { name: "Grizzly Bears", owner: "me" },
                { name: "Grizzly Bears", owner: "me", damageMarked: 1 },
                { name: "Mountain", owner: "me" },
                { name: "Lightning Bolt", owner: "me", zone: "hand" },
                { name: "Mountain", owner: "opp" },
                { name: "Lightning Bolt", owner: "opp", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            activePlayer: "opp",
            landCount: 0,
            libraryCount: 20,
        });
        const [bot, opp] = state.players;
        const damaged = bot.battlefield.find((c) => c.damageMarked === 1);
        expect(damaged).toBeDefined();
        const cast = candidateMoves(state, opp.id).find(
            (move) =>
                move.kind === "cast-spell" &&
                move.targets.length === 1 &&
                move.targets[0].id === damaged!.id
        );
        expect(cast).toBeDefined();
        applyMoveInSearch(state, opp.id, cast!);
        expect(state.stack).toHaveLength(1);
        return { state, botId: bot.id };
    }

    it("names the target's damage, so the damaged Bear is not the undamaged one", () => {
        const { state, botId } = duplicateNameTarget();
        expect(stackFingerprint(state, seatsOf(state, botId))).toEqual([
            "opp Lightning Bolt spell targets[permanent:me Grizzly Bears {damage=1}] x=-",
        ]);
        expectJudgeable(state, botId);
    });

    it("refuses a rebuild whose duplicate-name target resolved to the WRONG instance", () => {
        const { state, botId } = duplicateNameTarget();
        const outcome = lower(state, botId);
        if (!outcome.ok) throw new Error(outcome.error);
        const rebuilt = buildVerdictPosition(outcome.lowered.spec);
        const rebuiltBot = rebuilt.players[0];
        const liveSeats = seatsOf(state, botId);
        const rebuiltSeats = seatsOf(rebuilt, rebuiltBot.id);
        expect(
            stackRebuildMismatch(state, liveSeats, rebuilt, rebuiltSeats)
        ).toBe(null);

        // The builder's failure mode, reproduced: the spell pointed at the
        // other same-named permanent. Seat, name, kind, the candidate list —
        // all identical; only the target's observable facts differ.
        const targeted = rebuiltBot.battlefield.find(
            (c) => c.id === rebuilt.stack[0].targets?.[0]?.id
        );
        expect(targeted?.damageMarked).toBe(1);
        const undamaged = rebuiltBot.battlefield.find(
            (c) =>
                c.id !== targeted!.id &&
                (c.card as { id?: string }).id ===
                    (targeted!.card as { id?: string }).id
        );
        expect(undamaged).toBeDefined();
        (rebuilt.stack[0] as StackItem).targets = [
            { type: "permanent", id: undamaged!.id },
        ];
        const mismatch = stackRebuildMismatch(
            state,
            liveSeats,
            rebuilt,
            rebuiltSeats
        );
        expect(mismatch).not.toBe(null);
        expect(mismatch).toContain("damage=1");
        expect(mismatch).toContain("stack index 0");
    });
});

describe("a stack the spec cannot declare is refused by item and field (issue #3514)", () => {
    it("names a trigger's field — `opp Powder Keg spell: triggerEvent`", () => {
        const { state, botId } = powderKegPosition();
        // The one field `placeTriggersOnStack` always writes. Stamped on an
        // engine-cast object so the refusal is about exactly this field.
        (state.stack[0] as unknown as Record<string, unknown>).triggerEvent = {
            type: "CAST",
        };
        const outcome = lower(state, botId);
        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;
        expect(outcome.kind).toBe("stack-not-lowerable");
        expect(outcome.error).toContain("opp Powder Keg spell: triggerEvent");
    });

    it("names a payment still mid-flight — `pendingActivation`", () => {
        const { state, botId } = powderKegPosition();
        (state as unknown as Record<string, unknown>).pendingActivation = {
            playerId: botId,
        };
        // Straight to the lowering: a mid-flight payment owes no priority
        // decision, so there is no candidate to name as the Bot's pick — and
        // the refusal fires before any candidate is read.
        const outcome = lowerDecision(state, botId, "pass");
        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;
        expect(outcome.kind).toBe("stack-not-lowerable");
        expect(outcome.error).toContain("pendingActivation");
    });
});

// ---- A triggered ability on the stack (issue #3516, PRD #3397) ----
//
// The position #3513 deliberately left out: `placeTriggersOnStack` always
// stamps `triggerEvent`, and until this slice the residue rule refused every
// trigger because the spec had no vocabulary for a `GameEvent`.

/** Enduring Courage watches the Bot's own board ("whenever ANOTHER creature
 *  you control enters, IT gets +2/+0 and gains haste"), and the clause names
 *  the entering permanent through `$event.instanceId` — so the trigger's
 *  resolution reads the event, and a rebuild that loses it or binds the wrong
 *  same-named copy resolves onto a different board. A SECOND Grizzly Bears is
 *  already on the battlefield precisely so "the one that entered" is a
 *  question with a wrong answer. */
function enteredTriggerPosition(): { state: GameState; botId: string } {
    const state = engineBuilt(
        {
            cards: [
                { name: "Enduring Courage", owner: "me" },
                { name: "Grizzly Bears", owner: "me" },
                { name: "Forest", owner: "me", count: 2 },
                { name: "Mountain", owner: "me" },
                { name: "Grizzly Bears", owner: "me", zone: "hand" },
                { name: "Lightning Bolt", owner: "me", zone: "hand" },
                { name: "Mountain", owner: "opp" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            activePlayer: "me",
            landCount: 1,
            libraryCount: 20,
        },
        [
            { kind: "cast", card: "Grizzly Bears", by: "me" },
            { kind: "resolve-top" },
        ]
    );
    return { state, botId: state.players[0].id };
}

/** The board as names plus what a resolution can CHANGE about them: effective
 *  P/T (CR 613.4 — where the pump lands), tap state, graveyards and life.
 *  Instance ids never appear; each build allocates its own. */
function boardShape(state: GameState): string[] {
    return state.players.flatMap((player, seat) => [
        ...player.battlefield.map(
            (card) =>
                `p${seat} ${(card.card as { id?: string }).id} ${getEffectivePower(
                    state,
                    card
                )}/${getEffectiveToughness(state, card)}${
                    card.isTapped ? " tapped" : ""
                }`
        ),
        ...player.graveyard.map(
            (card) => `p${seat} gy ${(card.card as { id?: string }).id}`
        ),
        `p${seat} life=${player.life}`,
    ]);
}

describe("the verdict lowering declares a TRIGGER on the stack (issue #3516)", () => {
    it("judges a decision taken with the Bot's own entry trigger in flight", () => {
        const { state, botId } = enteredTriggerPosition();
        expect(state.stack).toHaveLength(1);
        // The definition id is read from the catalogue, never pasted: a
        // re-key would otherwise red this test for no reason of its own.
        const bearsId = getCardByName("Grizzly Bears").id;
        expect(stackFingerprint(state, seatsOf(state, botId))).toEqual([
            `me Enduring Courage trigger:enduring-courage-pump source=bf:me Enduring Courage event=PERMANENT_ENTERED(cardId="${bearsId}" controllerId=me instanceId=bf:me Grizzly Bears {sick} manaValue=2 power=2 toughness=2 types=["Creature"] wasCast=true) targets[] x=-`,
        ]);
        expectJudgeable(state, botId);
    });

    it("declares the event by NAME and SEAT, never by instance id", () => {
        const { state, botId } = enteredTriggerPosition();
        const outcome = lower(state, botId);
        if (!outcome.ok) throw new Error(`refused ${outcome.kind}`);
        const [entry] = outcome.lowered.spec.stack ?? [];
        expect(entry).toMatchObject({
            kind: "trigger",
            name: "Enduring Courage",
            controller: "me",
            abilityId: "enduring-courage-pump",
        });
        // The entering creature is the SECOND Grizzly Bears on that
        // battlefield — `nth`, read exactly as an announced target reads it.
        expect(entry.event?.fields?.instanceId).toEqual({
            kind: "object",
            ref: {
                zone: "battlefield",
                name: "Grizzly Bears",
                seat: "me",
                nth: 1,
            },
        });
        expect(entry.event?.fields?.controllerId).toEqual({
            kind: "player",
            seat: "me",
        });
        expect(entry.event?.fields?.wasCast).toEqual({
            kind: "scalar",
            value: true,
        });
    });

    it("RESOLVES to the board it resolved to in play — the pump lands on the creature that entered", () => {
        const { state, botId } = enteredTriggerPosition();
        const outcome = lower(state, botId);
        if (!outcome.ok) throw new Error(`refused ${outcome.kind}`);
        const rebuilt = buildVerdictPosition(outcome.lowered.spec);
        expect(rebuilt.stack).toHaveLength(1);

        // Through the resolution, not through field equality (the acceptance
        // criterion): the engine's own `resolveTopOfStack` on both boards.
        resolveTopOfStack(state);
        resolveTopOfStack(rebuilt);
        expect(state.stack).toHaveLength(0);
        expect(rebuilt.stack).toHaveLength(0);

        // The pump is +2/+0 until end of turn (CR 613.4c) on the entering
        // copy alone — so exactly one of the two Bears is a 4/2, and the
        // rebuilt board says the same thing the live one does.
        const pumped = state.players[0].battlefield.filter(
            (card) => getEffectivePower(state, card) === 4
        );
        expect(pumped).toHaveLength(1);
        expect(boardShape(rebuilt)).toEqual(boardShape(state));
    });
});

describe("a spell targeting a TRIGGER on the declared stack (issue #3516)", () => {
    /** CR 113.7a — the pairing the issue names: a stack item targeting a
     *  trigger resolves to `triggerSourceId ?? item.id`. An activated
     *  ability's item borrows its source's battlefield id, a trigger's is
     *  fresh with the source kept separately, and `seedDeclaredStack` writes
     *  the ENGINE's rule rather than `referenced.id`. Until this slice no
     *  declared stack could hold a trigger, so that line had no position to
     *  be wrong in. */
    it("rebuilds the CR 113.7a source pairing, and Stifle counters the same trigger", () => {
        const state = engineBuilt(
            {
                cards: [
                    { name: "Enduring Courage", owner: "me" },
                    { name: "Forest", owner: "me", count: 2 },
                    { name: "Mountain", owner: "me" },
                    { name: "Grizzly Bears", owner: "me", zone: "hand" },
                    { name: "Lightning Bolt", owner: "me", zone: "hand" },
                    { name: "Island", owner: "opp" },
                    { name: "Mountain", owner: "opp" },
                    { name: "Stifle", owner: "opp", zone: "hand" },
                    { name: "Lightning Bolt", owner: "opp", zone: "hand" },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 5,
                activePlayer: "me",
                landCount: 1,
                libraryCount: 20,
            },
            [
                { kind: "cast", card: "Grizzly Bears", by: "me" },
                { kind: "resolve-top" },
                // CR 117.3b — priority restarts with the ACTIVE player after
                // the trigger is placed, so the opponent has to be passed to
                // before they can answer it.
                { kind: "pass", seat: "me" },
                {
                    kind: "cast",
                    card: "Stifle",
                    by: "opp",
                    target: "Enduring Courage",
                },
            ]
        );
        const botId = state.players[0].id;
        expect(state.stack).toHaveLength(2);
        const [trigger, stifle] = state.stack;
        expect(stifle.targets?.[0]).toMatchObject({
            type: "spell",
            id: trigger.id,
            stackSourceId: trigger.triggerSourceId,
        });

        const outcome = lower(state, botId);
        if (!outcome.ok) throw new Error(`refused ${outcome.kind}`);
        expect(outcome.lowered.spec.stack?.[1].targets).toEqual([
            { kind: "stack", index: 0 },
        ]);
        const rebuilt = buildVerdictPosition(outcome.lowered.spec);
        const [rebuiltTrigger, rebuiltStifle] = rebuilt.stack;
        // The pairing, read back: the item's own id, and the SOURCE permanent
        // it is pinned to — never the fresh item id in both slots.
        expect(rebuiltStifle.targets?.[0]).toMatchObject({
            type: "spell",
            id: rebuiltTrigger.id,
            stackSourceId: rebuiltTrigger.triggerSourceId,
        });
        expect(rebuiltTrigger.triggerSourceId).not.toBe(rebuiltTrigger.id);

        // Through the resolution: Stifle counters the trigger, so the entering
        // Bears is NOT pumped — on both boards.
        resolveTopOfStack(state);
        resolveTopOfStack(rebuilt);
        expect(state.stack).toHaveLength(0);
        expect(rebuilt.stack).toHaveLength(0);
        expect(
            state.players[0].battlefield.filter(
                (card) => getEffectivePower(state, card) === 4
            )
        ).toHaveLength(0);
        expect(boardShape(rebuilt)).toEqual(boardShape(state));
    });
});

describe("an event that names an object in another zone (issue #3516)", () => {
    /** Standstill watches every cast, and its firing `SPELL_CAST` names the
     *  spell that is STILL ON THE STACK under the trigger — the one event
     *  reference that is a stack INDEX rather than a zone and a name. Its
     *  resolution reads the event too (`$event.caster`, a player ref). */
    it("declares a spell on the stack by INDEX, and the trigger resolves the same way", () => {
        const state = engineBuilt(
            {
                cards: [
                    { name: "Standstill", owner: "me" },
                    { name: "Island", owner: "me" },
                    { name: "Mountain", owner: "opp" },
                    { name: "Lightning Bolt", owner: "opp", zone: "hand" },
                    { name: "Grizzly Bears", owner: "me" },
                    { name: "Mountain", owner: "me" },
                    { name: "Lightning Bolt", owner: "me", zone: "hand" },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 5,
                activePlayer: "opp",
                landCount: 0,
                libraryCount: 20,
            },
            [
                {
                    kind: "cast",
                    card: "Lightning Bolt",
                    by: "opp",
                    target: "Grizzly Bears",
                },
            ]
        );
        const botId = state.players[0].id;
        expect(state.stack).toHaveLength(2);
        const outcome = lower(state, botId);
        if (!outcome.ok) throw new Error(`refused ${outcome.kind}`);
        const [, trigger] = outcome.lowered.spec.stack ?? [];
        expect(trigger.kind).toBe("trigger");
        expect(trigger.event?.fields?.spellInstanceId).toEqual({
            kind: "object",
            ref: { zone: "stack", index: 0 },
        });
        expect(trigger.event?.fields?.casterId).toEqual({
            kind: "player",
            seat: "opp",
        });

        const rebuilt = buildVerdictPosition(outcome.lowered.spec);
        resolveTopOfStack(state);
        resolveTopOfStack(rebuilt);
        // Standstill sacrificed itself and the CASTER's opponents drew three
        // (CR 603.2) — the seat the event named, on both boards.
        expect(boardShape(rebuilt)).toEqual(boardShape(state));
        expect(state.players[0].hand.length).toBe(
            rebuilt.players[0].hand.length
        );
    });

    /** Soul Net's death trigger on a real card: `CREATURE_DIED` names the dead
     *  creature in a GRAVEYARD and carries `damagedBySources` — the one
     *  `objectList` field a shipped position reaches, whose members are the
     *  Bolt that killed it, now in a graveyard of its own. */
    it("declares a graveyard object and an object LIST", () => {
        const state = engineBuilt(
            {
                cards: [
                    { name: "Soul Net", owner: "me" },
                    { name: "Mountain", owner: "me", count: 3 },
                    { name: "Lightning Bolt", owner: "me", zone: "hand" },
                    { name: "Incinerate", owner: "me", zone: "hand" },
                    { name: "Grizzly Bears", owner: "opp" },
                    { name: "Mountain", owner: "opp" },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 5,
                activePlayer: "me",
                landCount: 1,
                libraryCount: 20,
            },
            [
                {
                    kind: "cast",
                    card: "Lightning Bolt",
                    by: "me",
                    target: "Grizzly Bears",
                },
                { kind: "resolve-top" },
            ]
        );
        const botId = state.players[0].id;
        expect(state.stack).toHaveLength(1);
        const outcome = lower(state, botId);
        if (!outcome.ok) throw new Error(`refused ${outcome.kind}`);
        const [entry] = outcome.lowered.spec.stack ?? [];
        expect(entry.event?.fields?.creatureInstanceId).toEqual({
            kind: "object",
            ref: { zone: "graveyard", name: "Grizzly Bears", seat: "opp" },
        });
        expect(entry.event?.fields?.damagedBySources).toEqual({
            kind: "objects",
            refs: [{ zone: "graveyard", name: "Lightning Bolt", seat: "me" }],
        });
        const rebuilt = buildVerdictPosition(outcome.lowered.spec);
        expect(
            stackFingerprint(rebuilt, seatsOf(rebuilt, rebuilt.players[0].id))
        ).toEqual(stackFingerprint(state, seatsOf(state, botId)));
    });
});

/** Soul Net on the battlefield, its trigger on the stack off an opponent's
 *  Goblin TOKEN dying to Earthquake — the dead creature is in no zone
 *  (CR 111.7). */
function soulNetTokenDeathPosition(): GameState {
    return engineBuilt(
        {
            cards: [
                { name: "Soul Net", owner: "me" },
                // Two for the Earthquake; the third leaves the Bot a Bolt to
                // weigh against passing, and the {1} Soul Net asks for.
                { name: "Mountain", owner: "me", count: 3 },
                { name: "Earthquake", owner: "me", zone: "hand" },
                { name: "Lightning Bolt", owner: "me", zone: "hand" },
                { name: "Goblin", owner: "opp", token: true },
                { name: "Mountain", owner: "opp" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            activePlayer: "me",
            landCount: 1,
            libraryCount: 20,
        },
        [
            // Earthquake for 1, never a targeted Bolt: the blade matcher
            // names cards, and a TOKEN has no card name to name it by.
            { kind: "cast", card: "Earthquake", by: "me", x: 1 },
            { kind: "resolve-top" },
        ]
    );
}

/** `name`'s definition with ONE triggered ability rewritten — the variant a
 *  test registers (`withTemporaryDefinition`) to ask the same position of an
 *  ability that reads its event. */
function withTrigger(
    name: string,
    abilityId: string,
    rewrite: (ability: TriggeredAbility) => TriggeredAbility
): CardDefinition {
    const def = getCardByName(name);
    return {
        ...def,
        triggeredAbilities: (def.triggeredAbilities ?? []).map((ability) =>
            ability.id === abilityId ? rewrite(ability) : ability
        ),
    };
}

const AJANI = "Ajani, Nacatl Pariah";
const AJANI_CATS_DIE = "ajani-nacatl-pariah-cats-die-transform";

/** The report of issue #9868, decision #25: Ajani's 2/1 Cat Warrior token
 *  attacks, Phelia (2/2) blocks, both die to combat damage, and the Bot holds
 *  priority with Ajani's "one or more other Cats you control die" trigger on
 *  the stack. Ajani is tapped so the token attacks alone; the block is applied
 *  as a move, because a token has no card name for the blade matcher. */
function ajaniTokenBlockedByPheliaPosition(): GameState {
    const state = engineBuilt(
        {
            cards: [
                { name: AJANI, owner: "me", tapped: true },
                { name: "Cat Warrior", owner: "me", token: true },
                { name: "Mountain", owner: "me" },
                { name: "Lightning Bolt", owner: "me", zone: "hand" },
                { name: "Phelia, Exuberant Shepherd", owner: "opp" },
                { name: "Plains", owner: "opp" },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 5,
            activePlayer: "me",
            landCount: 1,
            libraryCount: 20,
        },
        [{ kind: "declare-attackers" }]
    );
    const [me, opp] = state.players;
    const phelia = opp.battlefield.find((c) => c.types.includes("Creature"));
    const [attackerId] = state.combat?.attackerIds ?? [];
    if (!phelia || attackerId === undefined) {
        throw new Error("fixture: no blocker or no declared attacker");
    }
    applyMoveInSearch(state, opp.id, {
        kind: "declare-blockers",
        assignments: [{ blockerId: phelia.id, attackerId }],
    });
    applyMoveInSearch(state, me.id, { kind: "pass" });
    applyMoveInSearch(state, opp.id, { kind: "pass" });
    return state;
}

describe("a trigger that cannot read its event is declared without the fields the spec cannot name (issue #9868)", () => {
    /** CR 603.2 / CR 111.7 — an opponent's Goblin TOKEN dies to an Earthquake
     *  and ceases to exist; Soul Net's script (`mayPay` + `if` + `gainLife`)
     *  holds no `$event` read, no intervening-if and no imperative body, so
     *  nothing can read the dead creature's id. The stack is declared without
     *  it, the decision is judgeable, and both boards resolve the trigger to
     *  the same prompt. */
    it("judges a decision over a died trigger fired by a TOKEN death, and resolves it to the same board", () => {
        const state = soulNetTokenDeathPosition();
        const botId = state.players[0].id;
        expect(state.stack.map((item) => item.triggeredAbilityId)).toEqual([
            "soul-net-life",
        ]);
        expectJudgeable(state, botId);

        const outcome = lower(state, botId);
        if (!outcome.ok) throw new Error(`refused ${outcome.kind}`);
        const [entry] = outcome.lowered.spec.stack ?? [];
        // The unnameable id is absent; what the spec CAN say still travels.
        expect(entry.event?.type).toBe("CREATURE_DIED");
        expect(entry.event?.fields).not.toHaveProperty("creatureInstanceId");
        expect(entry.event?.fields?.creatureControllerId).toEqual({
            kind: "player",
            seat: "opp",
        });

        const rebuilt = buildVerdictPosition(outcome.lowered.spec);
        resolveTopOfStack(state);
        resolveTopOfStack(rebuilt);
        expect(boardShape(rebuilt)).toEqual(boardShape(state));
        // Both suspended on the same "you may pay" (CR 603.5).
        expect(state.pendingChoices).toHaveLength(1);
        expect(rebuilt.pendingChoices?.map((c) => c.prompt)).toEqual(
            state.pendingChoices?.map((c) => c.prompt)
        );
    });

    /** The report itself. Phelia died FIRST in the simultaneous destruction
     *  (CR 704.3), so her slot in the combat record was already retired to a
     *  tombstone (CR 506.4) when the token's last-known partners were read:
     *  `combatPartnerIds` names an id no zone answers to, which is why a card
     *  sitting in a graveyard was "unnameable". Neither field is readable by
     *  Ajani's script, so the stack is declared without both.
     *
     *  Asserted on `specFromState`, the stack's own verdict; the combat record
     *  holding the two tombstones is the suite below (issue #10120). */
    it("declares Ajani's trigger off a Cat Warrior token blocked by Phelia — no stack blocker", () => {
        const state = ajaniTokenBlockedByPheliaPosition();
        const botId = state.players[0].id;
        const [trigger] = state.stack;
        expect(trigger.triggeredAbilityId).toBe(AJANI_CATS_DIE);
        const firing = trigger.triggerEvent;
        if (firing?.type !== "CREATURE_DIED") throw new Error("no death");
        expect(firing.combatPartnerIds?.map(isDepartedCombatantId)).toEqual([
            true,
        ]);

        const { spec, stackBlockers } = specFromState(state, {
            mySeatId: botId,
        });
        expect(stackBlockers).toEqual([]);
        const [entry] = spec.stack ?? [];
        expect(entry.abilityId).toBe(AJANI_CATS_DIE);
        expect(entry.event?.fields).not.toHaveProperty("creatureInstanceId");
        expect(entry.event?.fields).not.toHaveProperty("combatPartnerIds");
        // CR 603.10a — Phelia dealt the damage and is a CARD in a graveyard,
        // named like any other graveyard object.
        expect(entry.event?.fields?.damagedBySources).toEqual({
            kind: "objects",
            refs: [
                {
                    zone: "graveyard",
                    name: "Phelia, Exuberant Shepherd",
                    seat: "opp",
                },
            ],
        });
        const outcome = lower(state, botId);
        expect(outcome.ok ? "ok" : outcome.kind).not.toBe(
            "stack-not-lowerable"
        );
    });

    /** The guard the omission must not weaken: the SAME position, asked of an
     *  ability whose script reads `$event.card` (CR 400.7e — "that card"),
     *  still refuses, per field — and says of the partner list what it is. */
    it("still refuses, per field, when the script reads `$event`", () => {
        const state = ajaniTokenBlockedByPheliaPosition();
        const botId = state.players[0].id;
        const exileThatCard = {
            op: "moveZone",
            target: { ref: "$event.card" },
            to: "exile",
        } as EffectOp;
        withTemporaryDefinition(
            withTrigger(AJANI, AJANI_CATS_DIE, (ability) => ({
                ...ability,
                effects: [...(ability.effects ?? []), exileThatCard],
            })),
            () => {
                const { spec, stackBlockers, dropped } = specFromState(state, {
                    mySeatId: botId,
                });
                expect(spec.stack).toBeUndefined();
                expect(stackBlockers.map((b) => b.field)).toEqual([
                    "triggerEvent:combatPartnerIds",
                    "triggerEvent:creatureInstanceId",
                ]);
                expect(
                    dropped.find((note) => note.includes('"combatPartnerIds"'))
                ).toContain("retired combat-record id (CR 506.4)");
            }
        );
    });
});

function cardName(card: CardInstanceState): string {
    return getDefinition((card.card as { id: string }).id).name;
}

/** What the combat record says to the readers of its HISTORY, in a frame a
 *  live board and its rebuild share: slots by position, cards by name, players
 *  by seat — never an instance id, which a rebuild reassigns. A slot nothing on
 *  a battlefield answers to reads `departed`. */
function combatHistory(state: GameState, botId: string) {
    const combat = state.combat;
    if (!combat) throw new Error("no combat");
    const nameOf = (id: string): string =>
        cardName(findCardInAnyZone(state, id)!);
    const slot = (id: string): string =>
        isDepartedCombatantId(id) ? "departed" : nameOf(id);
    const blockers = Object.keys(combat.blockerAssignments);
    return {
        attackers: combat.attackerIds.map(slot),
        // CR 509.1h — blocked or unblocked, per attacker slot.
        blocked: combat.attackerIds.map(
            (id) => combat.blockedAttackerIds?.includes(id) ?? false
        ),
        // CR 509.1a — who blocks which slot, and who each slot's partners are.
        blockers: blockers
            .map((id) => ({
                blocker: slot(id),
                blocking: combat.blockerAssignments[id].map((attackerId) =>
                    combat.attackerIds.indexOf(attackerId)
                ),
            }))
            .sort((a, b) => a.blocker.localeCompare(b.blocker)),
        partners: combat.attackerIds.map((id) =>
            combatPartnerIds(state, id).map(slot).sort()
        ),
        // CR 508.1b — the players the declaration attacked.
        attackedPlayers: (combat.attackedPlayerIds ?? []).map((id) =>
            id === botId ? "me" : "opp"
        ),
        // CR 608.2h — the last-known lookups: a card still in a zone, and the
        // slot it left behind.
        lookups: Object.entries(combat.departedCombatants ?? {})
            .filter(([original]) => findCardInAnyZone(state, original))
            .map(([original, tombstone]) => ({
                card: nameOf(original),
                attackerSlot: combat.attackerIds.indexOf(tombstone),
                blockerSlot: blockers.includes(tombstone),
            })),
    };
}

/** Savannah Lions attacks and Grizzly Bears blocks, then `response` is cast
 *  on the Lions by `by` and resolves — the attacker leaves the battlefield
 *  mid-combat with the Bot holding priority afterwards. */
function lionsBlockedThenRemovedPosition(
    response: string,
    by: "me" | "opp"
): GameState {
    return engineBuilt(
        {
            cards: [
                { name: "Savannah Lions", owner: "me" },
                { name: "Plains", owner: "me", count: 2 },
                { name: "Lightning Bolt", owner: "me", zone: "hand" },
                { name: "Mountain", owner: "me" },
                { name: "Grizzly Bears", owner: "opp" },
                { name: "Plains", owner: "opp", count: 2 },
                { name: response, owner: by, zone: "hand" },
            ],
            phase: "DECLARE_ATTACKERS",
            turn: 5,
            activePlayer: "me",
            landCount: 0,
            libraryCount: 20,
        },
        [
            { kind: "declare-attackers" },
            {
                kind: "declare-blockers",
                blocks: [
                    { blocker: "Grizzly Bears", attacker: "Savannah Lions" },
                ],
            },
            ...(by === "opp"
                ? [{ kind: "pass" as const, seat: "me" as const }]
                : []),
            {
                kind: "cast",
                card: response,
                by,
                target: "Savannah Lions",
                x: 0,
            },
            { kind: "resolve-top" },
        ]
    );
}

describe("a combat record naming departed combatants is declared slot by slot (issue #10120)", () => {
    /** CR 506.4 / CR 509.1h — the report of issue #9868, past the stack: the
     *  Cat Warrior token and Phelia traded, so the record holds an attacker
     *  slot and a blocker slot under tombstones and nothing on a battlefield
     *  is in combat. The decision is judgeable, and the rebuilt record gives
     *  every history reader the answer the live one gives. */
    it("judges the decision over Ajani's died trigger, on a rebuilt record that answers as the live one does", () => {
        const state = ajaniTokenBlockedByPheliaPosition();
        const botId = state.players[0].id;
        expectJudgeable(state, botId);

        const outcome = lower(state, botId);
        if (!outcome.ok) throw new Error(`refused ${outcome.kind}`);
        const { spec, dropped } = outcome.lowered;
        expect(
            dropped.filter((note) => note.startsWith(COMBAT_DROPPED_PREFIX))
        ).toEqual([]);
        expect(spec.combat?.attackers).toEqual([]);
        expect(spec.combat?.departed).toEqual({
            // CR 111.7 — the token ceased to exist: a slot, and no card.
            attackers: [{ slot: 0 }],
            blockers: [
                {
                    blocking: [0],
                    now: {
                        zone: "graveyard",
                        name: "Phelia, Exuberant Shepherd",
                        seat: "opp",
                    },
                },
            ],
        });
        // The stored row is read back through the tolerant normalizer.
        expect(normalizeScenarioSpec(spec).combat?.departed).toEqual(
            spec.combat?.departed
        );

        const rebuilt = buildVerdictPosition(spec);
        const history = combatHistory(rebuilt, rebuilt.players[0].id);
        expect(history).toEqual(combatHistory(state, botId));
        expect(history).toEqual({
            attackers: ["departed"],
            blocked: [true],
            blockers: [{ blocker: "departed", blocking: [0] }],
            partners: [["departed"]],
            attackedPlayers: ["opp"],
            lookups: [
                {
                    card: "Phelia, Exuberant Shepherd",
                    attackerSlot: -1,
                    blockerSlot: true,
                },
            ],
        });
    });

    /** CR 400.7 — Ephemerate exiles the blocked Lions and returns it: the card
     *  is back on the battlefield, a new object in no combat slot, while the
     *  slot it left stays blocked by the Bears. The rebuilt slot must be the
     *  tombstone, never the returned card's id — that would put the new
     *  object back into the combat it left. */
    it("rebuilds a departed slot that answers no battlefield lookup, even with the card back on the battlefield", () => {
        const state = lionsBlockedThenRemovedPosition("Ephemerate", "me");
        const botId = state.players[0].id;
        const { spec, dropped } = specFromState(state, { mySeatId: botId });
        expect(
            dropped.filter((note) => note.startsWith(COMBAT_DROPPED_PREFIX))
        ).toEqual([]);
        expect(spec.combat?.attackers).toEqual([]);
        expect(spec.combat?.departed).toEqual({
            attackers: [
                {
                    slot: 0,
                    now: {
                        zone: "battlefield",
                        name: "Savannah Lions",
                        seat: "me",
                    },
                },
            ],
        });

        const rebuilt = buildVerdictPosition(spec);
        const combat = rebuilt.combat!;
        const battlefieldIds = rebuilt.players.flatMap((p) =>
            p.battlefield.map((c) => c.id)
        );
        const [slot] = combat.attackerIds;
        expect(combat.attackerIds).toHaveLength(1);
        expect(isDepartedCombatantId(slot)).toBe(true);
        expect(battlefieldIds).not.toContain(slot);

        const lions = rebuilt.players[0].battlefield.find(
            (c) => cardName(c) === "Savannah Lions"
        )!;
        expect(lions.isAttacking).toBeFalsy();
        expect(combatPartnerIds(rebuilt, lions.id)).toEqual([]);
        // CR 608.2h — the lookup by the card's id finds the slot it left.
        expect(combat.departedCombatants).toEqual({ [lions.id]: slot });
        expect(combatHistory(rebuilt, rebuilt.players[0].id)).toEqual(
            combatHistory(state, botId)
        );
    });

    /** The guard: Unexpectedly Absent puts the blocked Lions into its owner's
     *  LIBRARY, which the spec fills by count and cannot name a card in. The
     *  slot is still declared — the Bears' attacker stays blocked — but the
     *  lookup by the Lions' id has nothing to be rebuilt from, so the fact is
     *  reported and the decision refused. */
    it("still refuses, with its own note, a departed combatant now in a zone the spec cannot name", () => {
        const state = lionsBlockedThenRemovedPosition(
            "Unexpectedly Absent",
            "opp"
        );
        const botId = state.players[0].id;
        const { spec, dropped } = specFromState(state, { mySeatId: botId });
        expect(spec.combat?.departed).toEqual({ attackers: [{ slot: 0 }] });
        expect(
            dropped.filter((note) => note.startsWith(COMBAT_DROPPED_PREFIX))
        ).toEqual([
            expect.stringContaining(
                "an attacker that left the battlefield (CR 506.4) is now a card the spec cannot name"
            ),
        ]);
        const outcome = lower(state, botId);
        expect(outcome.ok ? "ok" : outcome.kind).toBe("combat-not-captured");
    });
});

describe("a trigger the spec cannot declare is refused by field (issue #3516)", () => {
    /** Soul Net watches every death ("whenever a creature dies"); the creature
     *  that died is an opponent's GOBLIN TOKEN, which ceased to exist the
     *  moment it left the battlefield (CR 111.7). The event names an object
     *  that is in no zone at all — and Soul Net's own script never reads it,
     *  so the refusal is asked of a variant that DOES (issue #9868): the
     *  shipped ability with an intervening-if in front of it (CR 603.4). */
    it("names the event field — `me Soul Net trigger:soul-net-life: triggerEvent:creatureInstanceId`", () => {
        const state = soulNetTokenDeathPosition();
        const botId = state.players[0].id;
        expect(state.stack).toHaveLength(1);
        withTemporaryDefinition(
            withTrigger("Soul Net", "soul-net-life", (ability) => ({
                ...ability,
                interveningIf: () => true,
            })),
            () => {
                const outcome = lower(state, botId);
                expect(outcome.ok).toBe(false);
                if (outcome.ok) return;
                expect(outcome.kind).toBe("stack-not-lowerable");
                expect(outcome.error).toContain(
                    "trigger:soul-net-life: triggerEvent:creatureInstanceId"
                );
            }
        );
    });

    /** CR 603.3b — simultaneous triggers parked off-stack while their
     *  controller orders them. Not on the stack, and not a note either: a
     *  rebuild without them is a board those triggers never fired on. */
    it("names triggers awaiting CR 603.3b ordering — `pendingTriggerBatch`", () => {
        const { state, botId } = powderKegPosition();
        state.pendingTriggerBatch = [state.stack[0]];
        const outcome = lowerDecision(state, botId, "pass");
        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;
        expect(outcome.kind).toBe("stack-not-lowerable");
        expect(outcome.error).toContain("pendingTriggerBatch");
    });

    /** CR 603.3b — a `oncePerEventBatch` ability that fired on several events
     *  at once carries the whole set in `triggerEventBatch`. One entry carries
     *  ONE event, so the batch is residue, and the ADR names it as a
     *  deliberate exclusion rather than an oversight. Stamped on an
     *  engine-built trigger so the refusal is about exactly this field. */
    it("names `triggerEventBatch` as residue", () => {
        const { state, botId } = enteredTriggerPosition();
        state.stack[0].triggerEventBatch = [
            state.stack[0].triggerEvent!,
            state.stack[0].triggerEvent!,
        ];
        const outcome = lower(state, botId);
        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;
        expect(outcome.kind).toBe("stack-not-lowerable");
        expect(outcome.error).toContain("triggerEventBatch");
    });

    /** Tarpan's own death trigger ("when this creature dies, you gain 1
     *  life"): the source is in a graveyard, and the spec describes a trigger
     *  by a source it can PLACE. CR 603.10 — the item is a clone of the last
     *  known information, which the one `cards` entry for the card cannot
     *  also be. */
    it("names a source that is not on the battlefield", () => {
        const state = engineBuilt(
            {
                cards: [
                    { name: "Tarpan", owner: "opp" },
                    { name: "Mountain", owner: "me" },
                    { name: "Lightning Bolt", owner: "me", zone: "hand" },
                    { name: "Mountain", owner: "opp" },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 5,
                activePlayer: "me",
                landCount: 1,
                libraryCount: 20,
            },
            [
                {
                    kind: "cast",
                    card: "Lightning Bolt",
                    by: "me",
                    target: "Tarpan",
                },
                { kind: "resolve-top" },
            ]
        );
        const botId = state.players[0].id;
        expect(state.stack).toHaveLength(1);
        const outcome = lower(state, botId);
        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;
        expect(outcome.kind).toBe("stack-not-lowerable");
        expect(outcome.error).toContain("trigger-source-not-on-battlefield");
    });
});

describe("an AUTHORED trigger event is checked against the vocabulary (issue #3516)", () => {
    /** A declared stack is hand-edited as often as it is lowered (ADR 0044 —
     *  the DB is the source of truth for preset scenarios), and
     *  `resolveTopOfStack` gates the trigger branch on the item carrying an
     *  event AT ALL, never on its shape. So an event naming no member of the
     *  union would resolve with every read `undefined`: a different board,
     *  silently. The rebuild throws instead, the way every other unresolvable
     *  name in a declared stack throws. */
    const authored = (event: ScenarioTriggerEvent): ScenarioSpec => ({
        cards: [
            { name: "Enduring Courage", owner: "me" },
            { name: "Grizzly Bears", owner: "me" },
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 5,
        stack: [
            {
                kind: "trigger",
                name: "Enduring Courage",
                controller: "me",
                abilityId: "enduring-courage-pump",
                event,
            },
        ],
    });

    it("throws on an event type that is no `GameEvent` member", () => {
        expect(() =>
            buildVerdictPosition(authored({ type: "PERMANENT_ENTER" }))
        ).toThrow(/not a GameEvent type/);
    });

    it("throws when a field is declared as the wrong kind", () => {
        expect(() =>
            buildVerdictPosition(
                authored({
                    type: "PERMANENT_ENTERED",
                    fields: {
                        // A player id declared as a scalar would rebuild as a
                        // stale id from the game it was captured in.
                        controllerId: { kind: "scalar", value: "p1" },
                    },
                })
            )
        ).toThrow(/declared as "scalar"/);
    });
});
