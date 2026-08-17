// CR 614.1c / 614.12 (ADR 0100) — the as-enters choice point: a permanent that
// owes an "as it enters" choice is held off EVERY zone until it answers, and
// resumes correctly whether or not a stack item is waiting on it.
//
// Slice 1 (#2492) wires no card, so every fixture here registers its own
// synthetic `CardDefinition` through `registerTokenDefinition` — the production
// seam that inserts a definition into the SAME registry `getDefinition` reads
// from (the pattern `aura-host-choice.test.ts` already uses for its
// enchant-player Aura). The catalogue-wide guard that no SHIPPED card populates
// the union lives in `convex/cards/__tests__/asEntersUnion.test.ts`.
import { describe, expect, it } from "vitest";
import {
    putReanimatedSetOnBattlefield,
    resolveTopOfStack,
    createTokenPermanents,
    type GameState,
} from "../state";
import { finalizeAsEnters } from "../asEnters";
import { compactState, expandState } from "../serialize";
import {
    applyNameCardSubmit,
    applyPendingChoiceSubmit,
} from "../pendingChoiceSubmit";
import { legalActions } from "../legalActions";
import { computeExpectedInput } from "../expectedInput";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition, EffectTokenSpec } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { grizzlyBears, lightningBolt } from "../../cards/sets/lea";

// --- Synthetic definitions (engine capability, no shipped card) -------------

/** "As this creature enters, pay any amount of life, up to 3." */
const PAY_LIFE_ID = "test-only-as-enters-pay-life";
const payLifeCreature: CardDefinition = {
    id: PAY_LIFE_ID,
    rarity: "common",
    name: "Test Pay-Life Creature",
    oracleText: "As this creature enters, pay any amount of life.",
    manaCost: { B: 1 },
    types: ["Creature"],
    subtypes: ["Horror"],
    power: 1,
    toughness: 1,
    entersWith: { asEnters: [{ kind: "payLife", cap: 3 }] },
};
registerTokenDefinition(payLifeCreature);

/** "As this creature enters, it becomes a copy of any creature on the
 *  battlefield." The copy answer is what can GROW the owed list (CR 707.6). */
const COPY_ID = "test-only-as-enters-copy";
const copyCreature: CardDefinition = {
    id: COPY_ID,
    rarity: "common",
    name: "Test Copy Creature",
    oracleText: "As this creature enters, it becomes a copy of a creature.",
    manaCost: { U: 2 },
    types: ["Creature"],
    subtypes: ["Shapeshifter"],
    power: 0,
    toughness: 0,
    entersWith: {
        asEnters: [{ kind: "copy", filter: { types: ["Creature"] } }],
    },
};
registerTokenDefinition(copyCreature);

/** "As this creature enters, choose a card name." The one as-enters kind that
 *  reuses the `name-card` PendingChoice shape — and therefore the one whose
 *  submission does NOT come through `applyPendingChoiceSubmit`. */
const NAME_ID = "test-only-as-enters-name";
const nameCreature: CardDefinition = {
    id: NAME_ID,
    rarity: "common",
    name: "Test Name Creature",
    oracleText: "As this creature enters, choose a card name.",
    manaCost: { U: 1 },
    types: ["Creature"],
    subtypes: ["Wizard"],
    power: 1,
    toughness: 1,
    entersWith: { asEnters: [{ kind: "name" }] },
};
registerTokenDefinition(nameCreature);

/** "As this creature enters, choose a creature type." The second kind whose
 *  answer lands on a field the CR 400.7 entry reset clears. */
const SUBTYPES_ID = "test-only-as-enters-subtypes";
const subtypesCreature: CardDefinition = {
    id: SUBTYPES_ID,
    rarity: "common",
    name: "Test Subtypes Creature",
    oracleText: "As this creature enters, choose a creature type.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Shapeshifter"],
    power: 2,
    toughness: 2,
    entersWith: {
        asEnters: [{ kind: "subtypes", from: ["Goblin", "Elf"], count: 1 }],
    },
};
registerTokenDefinition(subtypesCreature);

/** A sorcery whose Effect Script creates `count` tokens that each owe an
 *  as-enters choice — the row-C replay fixture. */
const TOKEN_MAKER_ID = "test-only-as-enters-token-maker";
function tokenMakerDef(count: number): CardDefinition {
    return {
        id: `${TOKEN_MAKER_ID}-${count}`,
        rarity: "common",
        name: `Test Token Maker ${count}`,
        oracleText: `Create ${count} tokens.`,
        manaCost: { R: 1 },
        types: ["Sorcery"],
        effects: [
            {
                op: "createToken",
                controller: "controller",
                count,
                token: {
                    name: `As-Enters Horror ${count}`,
                    types: ["Creature"],
                    subtypes: ["Horror"],
                    power: 1,
                    toughness: 1,
                    entersWith: { asEnters: [{ kind: "payLife", cap: 1 }] },
                },
            },
        ],
    };
}
registerTokenDefinition(tokenMakerDef(1));
registerTokenDefinition(tokenMakerDef(3));

/** The as-enters token spec both multi-Op fixtures below park on. */
const PARKING_TOKEN: EffectTokenSpec = {
    name: "As-Enters Horror Multi",
    types: ["Creature"],
    subtypes: ["Horror"],
    power: 1,
    toughness: 1,
    entersWith: { asEnters: [{ kind: "payLife", cap: 1 }] },
};

/** A sorcery whose Effect Script runs an Op BEFORE the one that parks — the
 *  fixture for "Ops before the resume position never replay" (CR 608.3). */
const PRE_PARK_ID = "test-only-as-enters-pre-park";
registerTokenDefinition({
    id: PRE_PARK_ID,
    rarity: "common",
    name: "Test Pre-Park Sorcery",
    oracleText: "You gain 5 life. Create a token.",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    effects: [
        { op: "gainLife", player: "controller", amount: 5 },
        {
            op: "createToken",
            controller: "controller",
            count: 1,
            token: PARKING_TOKEN,
        },
    ],
});

/** A sorcery whose Effect Script runs an Op AFTER the one that parks — the
 *  fixture for CR 614.12a ("that choice is made before the permanent enters"). */
const POST_PARK_ID = "test-only-as-enters-post-park";
registerTokenDefinition({
    id: POST_PARK_ID,
    rarity: "common",
    name: "Test Post-Park Sorcery",
    oracleText: "Create a token. You gain 7 life.",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "createToken",
            controller: "controller",
            count: 1,
            token: PARKING_TOKEN,
        },
        { op: "gainLife", player: "controller", amount: 7 },
    ],
});

/** A TARGETED reanimation sorcery (the Resurrection shape) whose target leaves
 *  the graveyard as part of its own resolution — the fixture for "the resumed
 *  item is not re-gated on target legality" (CR 608.2b fixes it once). The
 *  trailing `gainLife` is the discriminator: a spell countered by game rules on
 *  resume never runs it. */
const REANIMATE_ID = "test-only-as-enters-reanimate";
registerTokenDefinition({
    id: REANIMATE_ID,
    rarity: "common",
    name: "Test Reanimate Sorcery",
    oracleText:
        "Return target creature card from your graveyard to the battlefield. You gain 7 life.",
    manaCost: { W: 2 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        zone: "graveyard",
        controller: "you",
    },
    effects: [
        { op: "moveZone", target: { target: 0 }, to: "battlefield" },
        { op: "gainLife", player: "controller", amount: 7 },
    ],
});

// --- Helpers ---------------------------------------------------------------

function boardWithGraveyard(cards: CardDefinition[], life = 20): GameState {
    const p1 = makePlayer("p1", {
        life,
        graveyard: cards.map((def, i) =>
            makeInstance(def.id, {
                id: `staged-${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            })
        ),
    });
    return makeState({ players: [p1, makePlayer("p2")] });
}

/** Splices the graveyard cards out and puts them onto the battlefield as one
 *  simultaneous CR 400.7 batch — the non-cast (census row B) entry path. */
function reanimateAll(state: GameState): string[] {
    const gy = state.players[0].graveyard;
    const cards = gy.splice(0, gy.length);
    return putReanimatedSetOnBattlefield(
        state,
        cards.map((card) => ({ card, controllerId: "p1" }))
    );
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

function battlefieldIds(state: GameState): string[] {
    return state.players.flatMap((p) => p.battlefield.map((c) => c.id));
}

// --- The park itself -------------------------------------------------------

describe("as-enters park (CR 614.12a, ADR 0100 D2)", () => {
    it("holds the permanent off EVERY zone until the choice is answered", () => {
        const state = boardWithGraveyard([payLifeCreature]);
        reanimateAll(state);

        expect(state.stagedEntries).toHaveLength(1);
        expect(state.stagedEntries![0].card.id).toBe("staged-0");
        // Not on any battlefield, not in any graveyard/exile/hand/library.
        for (const p of state.players) {
            for (const zone of [
                p.battlefield,
                p.graveyard,
                p.exile,
                p.hand,
                p.library,
            ]) {
                expect(zone.some((c) => c.id === "staged-0")).toBe(false);
            }
        }
        expect(head(state).asEntersCardId).toBe("staged-0");
        expect(head(state).asEntersKind).toBe("payLife");
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("CR 119.4 — the life offer is capped at the chooser's live life total", () => {
        const state = boardWithGraveyard([payLifeCreature], 2);
        reanimateAll(state);

        expect(head(state).options?.map((o) => o.id)).toEqual(["0", "1", "2"]);
    });

    it("ADR 0047 — computeExpectedInput reports the parked choice as owed", () => {
        const state = boardWithGraveyard([payLifeCreature]);
        reanimateAll(state);

        // Through the real reducer, not a hand-built view.
        const expected = computeExpectedInput(state);
        expect(expected).toMatchObject({
            kind: "choice",
            playerId: "p1",
            stackItemId: "",
            choiceKind: "option-pick",
        });
    });
});

// --- D5 resume -------------------------------------------------------------

describe("as-enters resume (CR 117.3b, ADR 0100 D5)", () => {
    it("live parking stack item — the suspended resolution completes in the SAME mutation", () => {
        const state = boardWithGraveyard([payLifeCreature]);
        // A permanent spell resolving is what "parked" the entry: the entry is
        // staged mid-resolution, so the parking item is still on the stack
        // (resolution is peek-and-pop).
        const parking = pushSpell(state, grizzlyBears.id, "p1");
        reanimateAll(state);
        expect(state.stagedEntries).toHaveLength(1);
        expect(state.stagedEntries![0].parkedStackItemId).toBe(parking.id);
        expect(state.stack.map((s) => s.id)).toContain(parking.id);

        answer(state, ["1"]);

        // The parking item resolved here and now — no intervening priority
        // window, no second mutation.
        expect(state.stack.map((s) => s.id)).not.toContain(parking.id);
        expect(battlefieldIds(state)).toContain(parking.id);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.priorityPlayerId).toBe(state.activePlayerId);
        expect(state.players[0].life).toBe(19);
        expect(battlefieldIds(state)).toContain("staged-0");
    });

    it("no live parking stack item (cast permanent, census row A) — the finalize completes the entry itself and nothing throws", () => {
        const state = boardWithGraveyard([]);
        const item = pushSpell(state, PAY_LIFE_ID, "p1");

        // The cast permanent's own resolution pops the item BEFORE
        // `finalizeSpellResolution` runs, so the entry parks with an id that is
        // already off the stack.
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
        expect(state.stagedEntries).toHaveLength(1);
        expect(state.stagedEntries![0].origin).toBe("spell");
        expect(state.stagedEntries![0].parkedStackItemId).toBe(item.id);

        expect(() => answer(state, ["2"])).not.toThrow();

        expect(state.stagedEntries).toBeUndefined();
        expect(battlefieldIds(state)).toContain(item.id);
        expect(state.players[0].life).toBe(18);
        expect(state.priorityPlayerId).toBe(state.activePlayerId);
    });

    it("no live parking stack item (parked with an EMPTY stack) — still takes the else branch", () => {
        const state = boardWithGraveyard([payLifeCreature]);
        expect(state.stack).toHaveLength(0);
        reanimateAll(state);
        expect(state.stagedEntries![0].parkedStackItemId).toBeUndefined();

        expect(() => answer(state, ["0"])).not.toThrow();

        expect(battlefieldIds(state)).toContain("staged-0");
        expect(state.priorityPlayerId).toBe(state.activePlayerId);
    });

    it("a parked CAST permanent survives the DB round-trip and is still answerable", () => {
        // A pending choice is a stable save point, so this is the NORMAL path
        // for a parked spell, not an edge case: the entry tail re-enters
        // `finalizeSpellResolution`, which reads `item.castById` — a field only
        // `compactStackItem` carries across the round-trip.
        const state = boardWithGraveyard([]);
        const item = pushSpell(state, PAY_LIFE_ID, "p1");
        resolveTopOfStack(state);
        expect(state.stagedEntries![0].origin).toBe("spell");

        const reloaded = expandState(compactState(state));

        expect(() => answer(reloaded, ["2"])).not.toThrow();
        expect(reloaded.stagedEntries).toBeUndefined();
        expect(battlefieldIds(reloaded)).toContain(item.id);
        expect(reloaded.players[0].life).toBe(18);
    });

    it("the gameOver guard survives the move onto the shared tail", () => {
        // p1 is at 3 life and answers "pay 3": the SBA sweep inside the finalize
        // is what kills them (CR 704.5a). A second item is on the stack behind
        // the (already popped) parking item, and both players are auto-passing,
        // so a tail that ran on regardless would resolve it in a finished game.
        const state = boardWithGraveyard([], 3);
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        state.players[1].battlefield.push(victim);
        const second = pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "victim" },
        ]);
        pushSpell(state, PAY_LIFE_ID, "p1");
        state.autoPassPlayers = ["p1", "p2"];

        resolveTopOfStack(state);
        expect(state.stagedEntries).toHaveLength(1);

        answer(state, ["3"]);

        expect(state.players[0].life).toBe(0);
        expect(state.gameOver).toBeTruthy();
        // The second item has NOT resolved.
        expect(state.stack.map((s) => s.id)).toContain(second.id);
        expect(
            state.players[1].battlefield.some((c) => c.id === "victim")
        ).toBe(true);
    });
});

// --- D4 owed growth --------------------------------------------------------

describe("as-enters owed list grows mid-flight (CR 707.6, ADR 0100 D4)", () => {
    it("a copy answer appends the COPIED definition's own choices and the entry does not resume until the list is empty", () => {
        const state = boardWithGraveyard([copyCreature], 10);
        // The copy target is itself a permanent whose definition declares an
        // as-enters choice — exactly the reanimated-Clone-of-Meddling-Mage
        // shape CR 707.6 describes.
        state.players[0].battlefield.push(
            makeInstance(PAY_LIFE_ID, {
                id: "copy-source",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            })
        );
        reanimateAll(state);

        expect(head(state).asEntersKind).toBe("copy");
        expect(head(state).candidateIds).toContain("copy-source");

        answer(state, ["copy-source"]);

        // Still staged: the copy revealed a SECOND owed choice.
        expect(state.stagedEntries).toHaveLength(1);
        expect(state.stagedEntries![0].owed).toEqual([
            { kind: "payLife", cap: 3 },
        ]);
        expect(head(state).asEntersKind).toBe("payLife");
        expect(battlefieldIds(state)).not.toContain("staged-0");

        answer(state, ["2"]);

        expect(state.stagedEntries).toBeUndefined();
        expect(battlefieldIds(state)).toContain("staged-0");
        expect(state.players[0].life).toBe(8);
        const entered = state.players[0].battlefield.find(
            (c) => c.id === "staged-0"
        )!;
        expect((entered.card as { id: string }).id).toBe(PAY_LIFE_ID);
    });

    it("a definition already consulted is never re-owed", () => {
        const state = boardWithGraveyard([copyCreature], 10);
        state.players[0].battlefield.push(
            makeInstance(grizzlyBears.id, {
                id: "plain-bear",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            })
        );
        reanimateAll(state);

        answer(state, ["plain-bear"]);

        // Grizzly Bears declares no as-enters clause: nothing was appended and
        // the entry resumed immediately.
        expect(state.stagedEntries).toBeUndefined();
        expect(battlefieldIds(state)).toContain("staged-0");
    });
});

// --- CR 614.12b ------------------------------------------------------------

describe("CR 614.12b — simultaneous entries owing cost-bearing choices", () => {
    it("the second entry's candidate set is constrained by what the first committed", () => {
        const state = boardWithGraveyard([payLifeCreature, payLifeCreature], 5);
        reanimateAll(state);

        expect(state.stagedEntries).toHaveLength(2);
        const queue = state.pendingChoices ?? [];
        expect(queue).toHaveLength(2);
        // Both offers start at the full declared cap (3), which 5 life covers.
        expect(queue[0].options?.map((o) => o.id)).toEqual([
            "0",
            "1",
            "2",
            "3",
        ]);
        expect(queue[1].options?.map((o) => o.id)).toEqual([
            "0",
            "1",
            "2",
            "3",
        ]);

        answer(state, ["3"]);

        // 2 life left: the second permanent may no longer commit 3.
        expect(state.players[0].life).toBe(2);
        expect(head(state).options?.map((o) => o.id)).toEqual(["0", "1", "2"]);
        expect(() => answer(state, ["3"])).toThrow(/Not a legal choice/);

        answer(state, ["2"]);
        expect(state.players[0].life).toBe(0);
        expect(battlefieldIds(state)).toEqual(
            expect.arrayContaining(["staged-0", "staged-1"])
        );
    });
});

// --- D5 replay safety (census row C) ---------------------------------------

describe("as-enters token replay (ADR 0100 D5)", () => {
    for (const count of [1, 3]) {
        it(`creates exactly ${count} token(s) across the park/resume re-entry`, () => {
            const state = makeState({
                players: [makePlayer("p1", { life: 20 }), makePlayer("p2")],
            });
            const item = pushSpell(state, `${TOKEN_MAKER_ID}-${count}`, "p1");

            resolveTopOfStack(state);

            // The whole batch was created in ONE `ctx.createToken` call and
            // every one of them parked; the sorcery is suspended on the stack.
            expect(state.stagedEntries).toHaveLength(count);
            expect(state.pendingChoices).toHaveLength(count);
            expect(state.stack.map((s) => s.id)).toContain(item.id);

            for (let i = 0; i < count; i++) answer(state, ["1"]);

            expect(state.stagedEntries).toBeUndefined();
            expect(state.pendingChoices ?? []).toHaveLength(0);
            // The Op re-executed on resume (it is the Op at the resume
            // position) and must NOT have created a second batch.
            expect(state.players[0].battlefield).toHaveLength(count);
            expect(state.players[0].battlefield.every((c) => c.isToken)).toBe(
                true
            );
            expect(state.players[0].life).toBe(20 - count);
            expect(state.stack.map((s) => s.id)).not.toContain(item.id);
        });
    }

    it("a token batch that owes nothing still enters immediately (no park, no marker replay)", () => {
        const state = makeState();
        const ids = createTokenPermanents(
            state,
            {
                name: "Plain Token",
                types: ["Creature"],
                power: 2,
                toughness: 2,
            },
            "p1",
            2
        );

        expect(ids).toHaveLength(2);
        expect(state.stagedEntries).toBeUndefined();
        expect(state.players[0].battlefield).toHaveLength(2);
    });
});

// --- D5 replay safety inside a MULTI-Op script -----------------------------

describe("as-enters park mid-Effect-Script (ADR 0100 D5)", () => {
    it("CR 608.3 — Ops BEFORE the parking Op do not re-run on resume", () => {
        const state = makeState({
            players: [makePlayer("p1", { life: 20 }), makePlayer("p2")],
        });
        pushSpell(state, PRE_PARK_ID, "p1");

        resolveTopOfStack(state);

        // The `gainLife 5` ran once and the token parked. The script is
        // SUSPENDED, so its resume checkpoint must still be on the item — that
        // is what makes the completed Op skippable on re-entry.
        expect(state.players[0].life).toBe(25);
        expect(state.stagedEntries).toHaveLength(1);
        expect(state.stack[state.stack.length - 1].resolutionStep).toBe(1);

        answer(state, ["1"]);

        // 25 − 1 paid = 24. A script replayed from position 0 would gain 5
        // again and land on 29.
        expect(state.players[0].life).toBe(24);
        expect(state.players[0].battlefield).toHaveLength(1);
        expect(state.stack).toHaveLength(0);
    });

    it("CR 614.12a — Ops AFTER the parking Op do not run before the permanent enters", () => {
        const state = makeState({
            players: [makePlayer("p1", { life: 20 }), makePlayer("p2")],
        });
        pushSpell(state, POST_PARK_ID, "p1");

        resolveTopOfStack(state);

        // "That choice is made before the permanent enters the battlefield":
        // nothing after the park may run while the token is still in
        // `stagedEntries` and in no zone.
        expect(state.stagedEntries).toHaveLength(1);
        expect(state.players[0].life).toBe(20);
        expect(state.players[0].battlefield).toHaveLength(0);

        answer(state, ["1"]);

        // Now the trailing Op has run — exactly once, and after the entry.
        expect(state.players[0].life).toBe(26);
        expect(state.players[0].battlefield).toHaveLength(1);
        expect(state.stack).toHaveLength(0);
    });

    it("CR 608.2b — a targeted spell is not re-gated (and countered) on resume", () => {
        const state = boardWithGraveyard([payLifeCreature], 20);
        const item = pushSpell(state, REANIMATE_ID, "p1", [
            { type: "graveyard-card", id: "staged-0", playerId: "p1" },
        ]);

        resolveTopOfStack(state);

        // The target left the graveyard as part of this very resolution and is
        // now parked off every zone — target legality is fixed at the START of
        // resolution (CR 608.2b) and must not be re-asked on resume.
        expect(state.stagedEntries).toHaveLength(1);
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.stack.map((s) => s.id)).toContain(item.id);

        answer(state, ["1"]);

        // The trailing Op is the discriminator: a spell countered by game rules
        // on resume never reaches it (life would stay 19).
        expect(state.players[0].life).toBe(26);
        expect(battlefieldIds(state)).toContain("staged-0");
        expect(state.stack).toHaveLength(0);
    });
});

// --- The stackless `name-card` route ---------------------------------------

describe("as-enters `name` kind (CR 614.1c, ADR 0100 D3)", () => {
    it("is answerable through the SAME path every client and bot uses", () => {
        const state = boardWithGraveyard([nameCreature]);
        reanimateAll(state);

        // The prompt reuses the `name-card` shape, and `name-card` has its own
        // mutation: `applyPendingChoiceSubmit` explicitly bounces it
        // ("Use submitNameCard"), so this route is the ONLY one a client or the
        // bot can take.
        expect(head(state).kind).toBe("name-card");
        expect(head(state).stackItemId).toBe("");
        // …and the bot is offered exactly that action for this head (ADR 0047 —
        // an owed choice with no legal action is a freeze).
        expect(legalActions(state).map((a) => a.action.kind)).toContain(
            "submit-name-card"
        );

        applyNameCardSubmit(state, {
            playerId: "p1",
            cardName: "grizzly bears",
        });

        expect(state.stagedEntries).toBeUndefined();
        expect(state.pendingChoices ?? []).toHaveLength(0);
        const entered = state.players[0].battlefield.find(
            (c) => c.id === "staged-0"
        )!;
        // Normalized to the registry's canonical casing, like every other
        // name-card submission.
        expect(entered.chosenName).toBe(grizzlyBears.name);
        expect(state.priorityPlayerId).toBe(state.activePlayerId);
    });

    it("CR 614.1c vs CR 400.7 — a `subtypes` answer likewise survives the entry reset", () => {
        // `resetBattlefieldTransientState` clears `chosenSubtypes` (CR 603.6b)
        // because it belongs to the object that LEFT; the as-enters answer is
        // part of how the permanent is entering right now, so the entry tail
        // must re-apply it on the far side of that reset.
        const state = boardWithGraveyard([subtypesCreature]);
        reanimateAll(state);
        expect(head(state).asEntersKind).toBe("subtypes");

        answer(state, ["Goblin"]);

        const entered = state.players[0].battlefield.find(
            (c) => c.id === "staged-0"
        )!;
        expect(entered.chosenSubtypes).toEqual(["Goblin"]);
    });

    it("still rejects an unregistered name", () => {
        const state = boardWithGraveyard([nameCreature]);
        reanimateAll(state);

        expect(() =>
            applyNameCardSubmit(state, {
                playerId: "p1",
                cardName: "Not A Real Card",
            })
        ).toThrow(/Not a recognized card name/);
        expect(state.stagedEntries).toHaveLength(1);
    });
});

// --- Submission validation -------------------------------------------------

describe("as-enters submission validation", () => {
    it("rejects an option outside the offered set", () => {
        const state = boardWithGraveyard([payLifeCreature], 2);
        reanimateAll(state);
        expect(() => answer(state, ["3"])).toThrow(/Not a legal choice/);
    });

    it("rejects a copy pick outside the candidate allow-list", () => {
        const state = boardWithGraveyard([copyCreature], 10);
        state.players[0].battlefield.push(
            makeInstance(grizzlyBears.id, {
                id: "plain-bear",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            })
        );
        reanimateAll(state);
        expect(() => answer(state, ["nope"])).toThrow(
            /not an eligible choice/i
        );
    });

    it("finalizeAsEnters is a no-op when the head is not an as-enters choice", () => {
        const state = makeState();
        const before = JSON.stringify(state);
        finalizeAsEnters(state, ["whatever"]);
        expect(JSON.stringify(state)).toBe(before);
    });
});
