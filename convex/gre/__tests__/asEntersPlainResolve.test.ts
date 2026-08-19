// CR 614.12a / 608.3 (ADR 0100 D5, issue #2570) — the THIRD resolution shape.
//
// D5 prices re-entry for the two CHECKPOINTED shapes: a stepped `resolveSteps`
// body resumes at its recorded step, an Effect Script skips every Op below its
// resume position. A plain imperative `resolve()` closure carries no checkpoint
// at all — and, by construction, has already returned by the time the
// suspension predicate is consulted. The correct amount of it to re-run is
// zero, so a stackless as-enters Entry Park must NOT suspend at those sites:
// the item pops and `finalizeAsEnters`'s no-live-parking-item branch runs the
// entry tail.
//
// Every fixture here is synthetic (`registerTokenDefinition`, the pattern
// `asEnters.test.ts` and `aura-host-choice.test.ts` already use): the bug is an
// engine-shape bug, and one row per SHAPE is what the producer census asks for
// — not one row per shipped card.
//
// The discriminator under test is deliberately narrow, and the `must NOT`
// blocks at the bottom are the half that says so: a plain body with a REAL
// stack-coupled choice outstanding still suspends, and both checkpointed shapes
// are untouched.
import { describe, expect, it } from "vitest";
import { resolveTopOfStack, type GameState, type StackItem } from "../state";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { registerTokenDefinition } from "../../cards";
import type { SpellContext, TokenSpec } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { soulExchange } from "../../cards/sets/fem/black";
import { voiceOfAll } from "../../cards/sets/pls/white";

// --- The shared body -------------------------------------------------------

/** The token every fixture parks on: one owed `payLife` choice, capped at 1 so
 *  the answer is a single unambiguous submission. */
const PARKING_TOKEN: TokenSpec = {
    name: "Plain-Resolve Parking Horror",
    types: ["Creature"],
    subtypes: ["Horror"],
    power: 1,
    toughness: 1,
    entersWith: { asEnters: [{ kind: "payLife", cap: 1 }] },
};

/** An OBSERVABLE side effect committed BEFORE the entry, then the entry. The
 *  life total is the whole assay: a body replayed from its first statement
 *  gains a second life and mints a second token. */
function gainThenPark(ctx: SpellContext): void {
    ctx.gainLife(ctx.controller, 5);
    ctx.createToken(PARKING_TOKEN, ctx.controller, 1);
}

// --- Fixtures, one per plain-`resolve()` dispatch branch --------------------

const SPELL_PLAIN_ID = "test-2570-spell-plain";
registerTokenDefinition({
    id: SPELL_PLAIN_ID,
    rarity: "common",
    name: "Test Plain Spell",
    oracleText: "You gain 5 life. Create a token.",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    resolve: gainThenPark,
});

const SPELL_MODAL_ID = "test-2570-spell-modal";
registerTokenDefinition({
    id: SPELL_MODAL_ID,
    rarity: "common",
    name: "Test Modal Spell",
    oracleText: "Choose one — • You gain 5 life. Create a token.",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    modes: [
        {
            id: "gain-and-token",
            label: "Gain and token",
            oracleText: "You gain 5 life. Create a token.",
            resolve: gainThenPark,
        },
    ],
});

const TRIGGER_ABILITY_ID = "test-2570-trigger";
const TRIGGER_PLAIN_ID = "test-2570-creature-plain-trigger";
registerTokenDefinition({
    id: TRIGGER_PLAIN_ID,
    rarity: "common",
    name: "Test Plain Trigger Creature",
    oracleText: "When this creature enters, you gain 5 life. Create a token.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Horror"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        {
            id: TRIGGER_ABILITY_ID,
            event: "PERMANENT_ENTERED",
            oracleText:
                "When this creature enters, you gain 5 life. Create a token.",
            matches: () => true,
            resolve: (ctx) => gainThenPark(ctx),
        },
    ],
});

const TRIGGER_MODAL_ABILITY_ID = "test-2570-trigger-modal";
const TRIGGER_MODAL_ID = "test-2570-creature-modal-trigger";
registerTokenDefinition({
    id: TRIGGER_MODAL_ID,
    rarity: "common",
    name: "Test Modal Trigger Creature",
    oracleText: "When this creature enters, choose one — • …",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Horror"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        {
            id: TRIGGER_MODAL_ABILITY_ID,
            event: "PERMANENT_ENTERED",
            oracleText: "When this creature enters, choose one — • …",
            matches: () => true,
            modes: [
                {
                    id: "gain-and-token",
                    label: "Gain and token",
                    oracleText: "You gain 5 life. Create a token.",
                    resolve: gainThenPark,
                },
            ],
        },
    ],
});

const ACTIVATED_ABILITY_ID = "test-2570-activated";
const ACTIVATED_PLAIN_ID = "test-2570-creature-plain-activated";
registerTokenDefinition({
    id: ACTIVATED_PLAIN_ID,
    rarity: "common",
    name: "Test Plain Activated Creature",
    oracleText: "{T}: You gain 5 life. Create a token.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Horror"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: ACTIVATED_ABILITY_ID,
            cost: { tap: true },
            useStack: true,
            oracleText: "{T}: You gain 5 life. Create a token.",
            resolve: gainThenPark,
        },
    ],
});

const ACTIVATED_MODAL_ABILITY_ID = "test-2570-activated-modal";
const ACTIVATED_MODAL_ID = "test-2570-creature-modal-activated";
registerTokenDefinition({
    id: ACTIVATED_MODAL_ID,
    rarity: "common",
    name: "Test Modal Activated Creature",
    oracleText: "{T}: Choose one — • …",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Horror"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: ACTIVATED_MODAL_ABILITY_ID,
            cost: { tap: true },
            useStack: true,
            oracleText: "{T}: Choose one — • …",
            modes: [
                {
                    id: "gain-and-token",
                    label: "Gain and token",
                    oracleText: "You gain 5 life. Create a token.",
                    resolve: gainThenPark,
                },
            ],
        },
    ],
});

const DELAYED_TRIGGER_ID = "test-2570-delayed";
const DELAYED_HOST_ID = "test-2570-delayed-host";
registerTokenDefinition({
    id: DELAYED_HOST_ID,
    rarity: "common",
    name: "Test Delayed Host",
    oracleText: "At the beginning of the next end step, …",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    delayedTriggers: [
        {
            id: DELAYED_TRIGGER_ID,
            oracleText:
                "At the beginning of the next end step, you gain 5 life. Create a token.",
            timing: "next-end-step",
            resolve: (ctx) => gainThenPark(ctx),
        },
    ],
    resolve: () => {},
});

// --- must-NOT fixtures ------------------------------------------------------

/** A plain body that parks AND then raises a REAL stack-coupled choice — one
 *  that lands in the queue under the SAME `PendingChoiceKind` the park uses.
 *  `PARKING_TOKEN`'s `payLife` declaration enqueues as `option-pick`
 *  (`enqueueAsEntersChoice`, `state.ts`), and `ctx.requestOptionChoice` is the
 *  imperative primitive that produces that identical kind, so after this body
 *  runs the queue holds two `option-pick` entries distinguishable ONLY by
 *  `stackItemId` / `asEntersCardId`. The park is exempt; the stack-coupled pick
 *  is not, so the site must still suspend. This is the collision a `kind ===`
 *  discriminator swallows, made constructible — replacing
 *  `isStacklessEntryPark`'s body with `c.kind === "option-pick"` exempts both
 *  and the test below goes red. */
const SPELL_PLAIN_PLUS_CHOICE_ID = "test-2570-spell-plain-plus-choice";
registerTokenDefinition({
    id: SPELL_PLAIN_PLUS_CHOICE_ID,
    rarity: "common",
    name: "Test Plain Spell With Real Choice",
    oracleText: "Create a token, then choose one — • Left. • Right.",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    resolve: (ctx) => {
        gainThenPark(ctx);
        ctx.requestOptionChoice({
            playerId: ctx.controller,
            choiceId: "pick",
            options: [
                { id: "left", label: "Left" },
                { id: "right", label: "Right" },
            ],
            prompt: "Choose left or right",
        });
    },
});

/** The CHECKPOINTED twin of `SPELL_PLAIN_ID`: identical observable behaviour,
 *  authored as a stepped resolve. It must keep suspending. */
const SPELL_STEPPED_ID = "test-2570-spell-stepped";
registerTokenDefinition({
    id: SPELL_STEPPED_ID,
    rarity: "common",
    name: "Test Stepped Spell",
    oracleText: "You gain 5 life. Create a token.",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    resolveSteps: [
        (ctx) => ctx.gainLife(ctx.controller, 5),
        (ctx) => {
            ctx.createToken(PARKING_TOKEN, ctx.controller, 1);
        },
    ],
});

/** The Effect-Script twin — `getResolveFn` returns a COMPILED script here, and
 *  the closure it returns is indistinguishable from an imperative one, so
 *  `spellBodyShape` has to read the DEFINITION. It must keep suspending. */
const SPELL_SCRIPT_ID = "test-2570-spell-script";
registerTokenDefinition({
    id: SPELL_SCRIPT_ID,
    rarity: "common",
    name: "Test Script Spell",
    oracleText: "You gain 5 life. Create a token.",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    effects: [
        { op: "gainLife", player: "controller", amount: 5 },
        {
            op: "createToken",
            controller: "controller",
            count: 1,
            token: {
                name: PARKING_TOKEN.name,
                types: ["Creature"],
                subtypes: ["Horror"],
                power: 1,
                toughness: 1,
                entersWith: { asEnters: [{ kind: "payLife", cap: 1 }] },
            },
        },
    ],
});

// --- Helpers ----------------------------------------------------------------

function board(): GameState {
    return makeState({
        players: [makePlayer("p1", { life: 20 }), makePlayer("p2")],
    });
}

function head(state: GameState) {
    return (state.pendingChoices ?? [])[0];
}

function answer(state: GameState, ids: string[]): void {
    const h = head(state);
    applyPendingChoiceSubmit(state, {
        playerId: h.playerId,
        stackItemId: h.stackItemId,
        step: h.step,
        choiceId: h.choiceId,
        cardInstanceIds: ids,
    });
}

/** A trigger stack item exactly as `collectTriggers`/`buildTriggerItem` builds
 *  one, for a source already on the battlefield. */
function pushTrigger(
    state: GameState,
    defId: string,
    abilityId: string,
    chosenModeId?: string
): StackItem {
    const item: StackItem = {
        ...makeInstance(defId, {
            id: `trig-${abilityId}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "stack",
        }),
        castById: "p1",
        triggeredAbilityId: abilityId,
        triggerSourceId: "src",
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: "src",
            controllerId: "p1",
            types: ["Creature"],
        } as StackItem["triggerEvent"],
        ...(chosenModeId ? { chosenModeId } : {}),
    };
    state.stack.push(item);
    return item;
}

function pushActivation(
    state: GameState,
    defId: string,
    abilityId: string,
    chosenModeId?: string
): StackItem {
    const item: StackItem = {
        ...makeInstance(defId, {
            id: `act-${abilityId}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "stack",
        }),
        castById: "p1",
        abilityId,
        ...(chosenModeId ? { chosenModeId } : {}),
    };
    state.stack.push(item);
    return item;
}

/** The assertion every "runs exactly once" row shares: the park happened, the
 *  item is GONE from the stack (nothing left to replay), and after the answer
 *  there is exactly one token and exactly one life gain. */
function expectRanExactlyOnce(state: GameState, itemId: string): void {
    // Parked, and the resolution did NOT suspend: the item popped.
    expect(state.stagedEntries).toHaveLength(1);
    expect(state.pendingChoices).toHaveLength(1);
    expect(state.stack.map((s) => s.id)).not.toContain(itemId);
    expect(state.players[0].life).toBe(25);

    answer(state, ["1"]);

    expect(state.stagedEntries).toBeUndefined();
    expect(state.pendingChoices ?? []).toHaveLength(0);
    expect(state.players[0].battlefield.filter((c) => c.isToken)).toHaveLength(
        1
    );
    // 20 + 5 gained − 1 paid. A replayed body lands on 29.
    expect(state.players[0].life).toBe(24);
    expect(state.stack).toHaveLength(0);
}

// --- The seven plain-`resolve()` dispatch branches --------------------------

describe("plain resolve() + as-enters park (CR 608.3, ADR 0100 D5)", () => {
    it("spell: the body's side effect commits exactly once", () => {
        const state = board();
        const item = pushSpell(state, SPELL_PLAIN_ID, "p1");

        resolveTopOfStack(state);

        expectRanExactlyOnce(state, item.id);
    });

    it("spell, modal mode: the mode body commits exactly once", () => {
        const state = board();
        const item = pushSpell(state, SPELL_MODAL_ID, "p1");
        item.chosenModeId = "gain-and-token";

        resolveTopOfStack(state);

        expectRanExactlyOnce(state, item.id);
    });

    it("triggered ability: the body commits exactly once", () => {
        const state = board();
        const item = pushTrigger(state, TRIGGER_PLAIN_ID, TRIGGER_ABILITY_ID);

        resolveTopOfStack(state);

        expectRanExactlyOnce(state, item.id);
    });

    it("triggered ability, modal mode: the mode body commits exactly once", () => {
        const state = board();
        const item = pushTrigger(
            state,
            TRIGGER_MODAL_ID,
            TRIGGER_MODAL_ABILITY_ID,
            "gain-and-token"
        );

        resolveTopOfStack(state);

        expectRanExactlyOnce(state, item.id);
    });

    it("activated ability: the body commits exactly once", () => {
        const state = board();
        const item = pushActivation(
            state,
            ACTIVATED_PLAIN_ID,
            ACTIVATED_ABILITY_ID
        );

        resolveTopOfStack(state);

        expectRanExactlyOnce(state, item.id);
    });

    it("activated ability, modal mode: the mode body commits exactly once", () => {
        const state = board();
        const item = pushActivation(
            state,
            ACTIVATED_MODAL_ID,
            ACTIVATED_MODAL_ABILITY_ID,
            "gain-and-token"
        );

        resolveTopOfStack(state);

        expectRanExactlyOnce(state, item.id);
    });

    it("delayed triggered ability (template `resolve`): the body commits exactly once", () => {
        const state = board();
        const item: StackItem = {
            ...makeInstance(DELAYED_HOST_ID, {
                id: "delayed-item",
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            delayedTriggerId: DELAYED_TRIGGER_ID,
            delayedPayload: {},
        };
        state.stack.push(item);

        resolveTopOfStack(state);

        expectRanExactlyOnce(state, item.id);
    });
});

// --- The must-NOT rows ------------------------------------------------------

describe("the exemption is site- AND shape-local (issue #2570)", () => {
    it("a plain body whose stack-coupled choice SHARES the park's kind still suspends", () => {
        const state = board();
        const item = pushSpell(state, SPELL_PLAIN_PLUS_CHOICE_ID, "p1");

        resolveTopOfStack(state);

        // Two choices are outstanding: the exempt stackless park AND a
        // stack-coupled `requestOptionChoice`. The second is not exempt, so the
        // resolution suspends exactly as it does today — the item stays on the
        // stack so `selectResolutionChoice` can find it by `stackItemId`.
        const queue = state.pendingChoices ?? [];
        expect(queue).toHaveLength(2);
        // THE COLLISION, constructed rather than asserted about: both entries
        // carry kind `option-pick`. A `payLife` as-enters declaration enqueues
        // under that kind, and so does `ctx.requestOptionChoice` — so `kind`
        // cannot discriminate here even in principle.
        expect(queue.map((c) => c.kind)).toEqual([
            "option-pick",
            "option-pick",
        ]);
        // What DOES discriminate: the explicit `asEntersCardId` field the
        // as-enters finalize routes on, plus the stackless `stackItemId`.
        expect(
            queue.filter((c) => c.asEntersCardId !== undefined)
        ).toHaveLength(1);
        expect(queue.filter((c) => c.stackItemId === "")).toHaveLength(1);
        expect(queue.filter((c) => c.stackItemId === item.id)).toHaveLength(1);
        // The load-bearing assertion: a `kind === "option-pick"` exemption
        // would exempt BOTH, pop the item, and strand the body's own choice.
        expect(state.stack.map((s) => s.id)).toContain(item.id);
    });

    it("a stepped `resolveSteps` body still suspends, checkpointed at its step", () => {
        const state = board();
        const item = pushSpell(state, SPELL_STEPPED_ID, "p1");

        resolveTopOfStack(state);

        // The park suspends a CHECKPOINTED body: it has a step left to finish,
        // so ADR 0100 D5's rejection of a blanket exemption still governs here.
        // (What that resumed step does with its own replay-idempotence is the
        // step author's problem, exactly as D5 row C says — see
        // `docs/findings/2570-stepped-resolve-token-replay.md`.)
        expect(state.stagedEntries).toHaveLength(1);
        expect(state.stack.map((s) => s.id)).toContain(item.id);
        expect(state.stack[state.stack.length - 1].resolutionStep).toBe(1);
        // Step 0's `gainLife` committed once and is below the checkpoint.
        expect(state.players[0].life).toBe(25);
    });

    it("an `effects[]` spell still suspends — `getResolveFn` hides the shape behind one closure", () => {
        const state = board();
        const item = pushSpell(state, SPELL_SCRIPT_ID, "p1");

        resolveTopOfStack(state);

        // `spellBodyShape` reads the DEFINITION, not the returned closure: an
        // Effect Script has Ops below its resume position and must keep its
        // checkpoint.
        expect(state.stagedEntries).toHaveLength(1);
        expect(state.stack.map((s) => s.id)).toContain(item.id);
        expect(state.stack[state.stack.length - 1].resolutionStep).toBe(1);

        answer(state, ["1"]);

        expect(state.players[0].life).toBe(24);
        expect(
            state.players[0].battlefield.filter((c) => c.isToken)
        ).toHaveLength(1);
        expect(state.stack).toHaveLength(0);
    });
});

// --- One shipped census row: the GENERIC reanimation family -----------------

describe("shipped producer: Soul Exchange (fem/black.ts) — issue #2570 census", () => {
    it("reanimates a card owing an as-enters choice without suspending the spell", () => {
        // The dangerous census class is the GENERIC one: a plain `resolve()`
        // that calls `returnToBattlefield` on a player-chosen graveyard card
        // names no card, so it reaches EVERY wired as-enters declaration. Soul
        // Exchange is the spell-shaped representative (Dreams of the Dead is
        // the activated one, Krovikan Vampire / Seraph / Phelia the delayed
        // ones — all the same primitive, all the same branch).
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        makeInstance(voiceOfAll.id, {
                            id: "gy-voice",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, soulExchange.id, "p1", [
            { type: "graveyard-card", id: "gy-voice", playerId: "p1" },
        ]);

        resolveTopOfStack(state);

        // The body ran to completion, so the sorcery is OFF the stack and in
        // its owner's graveyard (CR 608.2m) with the entry still parked.
        expect(state.stagedEntries).toHaveLength(1);
        expect(head(state).asEntersKind).toBe("mode");
        expect(state.stack.map((s) => s.id)).not.toContain(item.id);

        answer(state, ["B"]);

        const entered = state.players[0].battlefield.find(
            (c) => c.id === "gy-voice"
        );
        expect(entered?.chosenModeId).toBe("B");
        expect(state.players[0].battlefield).toHaveLength(1);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
    });
});
