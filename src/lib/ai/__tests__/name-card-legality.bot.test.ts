// The bot's answer to a `name-card` window must be legal by the SAME rule the
// server enforces (issue #2497).
//
// Why this is a freeze and not a bad play: `ESCALATION_POLICY.choice` is
// `{ decline: null, canPass: false }` — CR 608.2 provides no way to decline a
// mid-resolution choice, so the ladder has NOTHING below rung 2, the
// minimal-legal submission. A rejected `submitNameCard` leaves the state
// unchanged and the ladder is deterministic, so the next walk — the watchdog's,
// or the human's `resolveStuck` click, which re-runs `buildBotView` +
// `escalationLadder` on the same state — recomputes the identical rejected
// string. The game stops (ADR 0047, #2283/#2284).
//
// `applyNameCardSubmit` has TWO checks past registry-existence, and the bot's
// old default (own top library card, else the literal "Plains") was blind to
// both:
//
//   row | producer                                          | server check          | old default legal?
//   ----|---------------------------------------------------|-----------------------|-------------------
//   A   | `requestNameCard` plain (Petra Sphinx)             | registry only         | yes
//   B   | `requestNameCard` + `excludeBasicLand` (Desperate  | CR 201.3 no-basic-land| NO — live today
//       |   Research, `inv/black`; Sarcomancy's sibling)     |                       |
//   C   | as-enters `{ kind: "name" }` unfiltered            | registry only         | yes
//   D   | as-enters `{ kind: "name", filter }` (Meddling     | `handCardMatchesFilter`| NO — #2467
//       |   Mage shape, #2467)                              |                       |
//
// Rows B and D are the must-NOT rows and each gets its own "the old answer IS
// rejected" assertion, so the fix is proven against the real server primitive
// rather than against the picker's own premise. `enumerateMoves` returns []
// while a choice is pending, so `chooseOwedChoiceAction` is the ONLY producer
// of a submitted name — there is no search-side second door.

import { describe, expect, it } from "vitest";
import {
    getCardByName,
    registerTokenDefinition,
    tryGetCardByName,
} from "@convex/cards";
import type { CardDefinition } from "@convex/cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import type { GameState, PendingChoice } from "@convex/gre";
import { applyNameCardSubmit } from "@convex/gre";
import {
    putReanimatedSetOnBattlefield,
    resolveTopOfStack,
} from "@convex/gre/state";
import { refreshExpectedInput } from "@convex/gre/expectedInput";
import { buildBotView } from "../bot-view";
import { escalationLadder } from "../owed-input";
import type { BotAction } from "../brain";

const BOT = "p2";
const HUMAN = "p1";

/** Row D's fixture — "As this enters, choose a nonland card name", the Meddling
 *  Mage shape. Synthetic on purpose: `convex/cards/__tests__/asEntersUnion.test.ts`
 *  guarantees no SHIPPED card populates the as-enters union yet, and #2467 is
 *  the issue that ships the first one. `registerTokenDefinition` is the
 *  production seam that inserts a definition into the same registry
 *  `getDefinition` reads from. */
const FILTERED_NAME_ID = "test-only-bot-as-enters-name-filtered";
const filteredNameCreature: CardDefinition = {
    id: FILTERED_NAME_ID,
    rarity: "rare",
    name: "Test Bot Filtered Name Creature",
    oracleText: "As this creature enters, choose a nonland card name.",
    manaCost: { U: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Wizard"],
    power: 2,
    toughness: 2,
    entersWith: {
        asEnters: [{ kind: "name", filter: { excludeType: "Land" } }],
    },
};
registerTokenDefinition(filteredNameCreature);

/** The same fixture without the filter — row C, the unrestricted as-enters
 *  head, kept beside it so the "no restriction ⇒ unchanged answer" claim is
 *  checked rather than assumed. */
const PLAIN_NAME_ID = "test-only-bot-as-enters-name-plain";
const plainNameCreature: CardDefinition = {
    ...filteredNameCreature,
    id: PLAIN_NAME_ID,
    name: "Test Bot Plain Name Creature",
    oracleText: "As this creature enters, choose a card name.",
    entersWith: { asEnters: [{ kind: "name" }] },
};
registerTokenDefinition(plainNameCreature);

function baseState(): GameState {
    return makeState({
        players: [makePlayer(HUMAN), makePlayer(BOT)],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
    });
}

/** Reanimates one synthetic permanent under the BOT's control — the non-cast
 *  entry path that parks it on its as-enters choice (CR 614.12a). */
function stageAsEnters(defId: string): GameState {
    const state = baseState();
    const card = makeInstance(defId, {
        id: "staged-0",
        controllerId: BOT,
        ownerId: BOT,
        zone: "graveyard",
    });
    putReanimatedSetOnBattlefield(state, [{ card, controllerId: BOT }]);
    refreshExpectedInput(state);
    return state;
}

/** Casts Desperate Research (row B) for the bot and resolves into its
 *  `nameCard` Op, which suspends on the `no-basic-land` head. */
function desperateResearchState(): GameState {
    const state = baseState();
    pushSpell(state, getCardByName("Desperate Research").id, BOT);
    resolveTopOfStack(state);
    refreshExpectedInput(state);
    return state;
}

/** Row A — an ordinary unrestricted mid-resolution head (Petra Sphinx). */
function petraSphinxState(): GameState {
    const state = baseState();
    const sphinx = makeInstance(getCardByName("Petra Sphinx").id, {
        id: "sphinx",
        controllerId: BOT,
        ownerId: BOT,
    });
    state.players[1].battlefield.push(sphinx);
    pushSpell(state, getCardByName("Petra Sphinx").id, BOT);
    state.stack = [];
    // The head itself is what matters; raise it exactly as `requestNameCard`
    // does for an unrestricted choice, with a real stack item behind it.
    const item = pushSpell(state, getCardByName("Petra Sphinx").id, BOT);
    const head: PendingChoice = {
        stackItemId: item.id,
        step: 0,
        choiceId: "petra",
        playerId: BOT,
        kind: "name-card",
        count: 1,
        prompt: "Name a card.",
    };
    state.pendingChoices = [head];
    refreshExpectedInput(state);
    return state;
}

/** THE path under test: project the state the bot actually sees, build the
 *  view, and walk the escalation ladder — the exact three calls `resolveStuck`
 *  (`src/hooks/useVsAiDriver.ts`) makes before dispatching a rung. */
function rungTwo(state: GameState): BotAction {
    const projected = projectPublicState(state, 1, BOT);
    const view = buildBotView(projected, BOT);
    expect(view.owedInput?.kind).toBe("choice");
    const ladder = escalationLadder("choice", view);
    // `choice` has no rung 3 or 4 — this IS the whole ladder.
    expect(ladder.map((s) => s.rung)).toEqual([2]);
    return ladder[0].action;
}

function namedCardName(action: BotAction): string {
    expect(action.kind).toBe("name-card");
    if (action.kind !== "name-card") throw new Error("not a name-card action");
    return action.cardName;
}

describe("name-card rung 2 is legal by construction (CR 201.3 / 614.1c, #2497)", () => {
    it("row A — an unrestricted mid-resolution head keeps its pre-#2497 answer, and it is accepted", () => {
        const state = petraSphinxState();
        const name = namedCardName(rungTwo(state));
        expect(name).toBe("Plains");
        expect(() =>
            applyNameCardSubmit(state, { playerId: BOT, cardName: name })
        ).not.toThrow();
    });

    it("row B — the premise: Desperate Research's CR 201.3 head REJECTS the old 'Plains' default", () => {
        const state = desperateResearchState();
        expect(state.pendingChoices?.[0].nameRestriction).toBe("no-basic-land");
        expect(() =>
            applyNameCardSubmit(state, { playerId: BOT, cardName: "Plains" })
        ).toThrow(/basic land/i);
        // The rejection changed nothing — this is what makes a re-submission of
        // the same string a freeze rather than a retry.
        expect(state.pendingChoices?.[0].kind).toBe("name-card");
    });

    it("row B — the bot never names a basic land, and the submission advances the game", () => {
        const state = desperateResearchState();
        const name = namedCardName(rungTwo(state));
        const def = tryGetCardByName(name);
        expect(def).not.toBeNull();
        expect(
            def!.supertypes?.includes("Basic") && def!.types.includes("Land")
        ).toBeFalsy();
        expect(() =>
            applyNameCardSubmit(state, { playerId: BOT, cardName: name })
        ).not.toThrow();
        // Advanced: the head is consumed and the resolution ran on.
        expect(
            (state.pendingChoices ?? []).some((c) => c.kind === "name-card")
        ).toBe(false);
    });

    it("row C — an UNFILTERED as-enters head is answered exactly as before", () => {
        const state = stageAsEnters(PLAIN_NAME_ID);
        const name = namedCardName(rungTwo(state));
        expect(name).toBe("Plains");
        expect(() =>
            applyNameCardSubmit(state, { playerId: BOT, cardName: name })
        ).not.toThrow();
        expect(state.stagedEntries ?? []).toHaveLength(0);
    });

    it("row D — the premise: a filtered as-enters head REJECTS the old 'Plains' default", () => {
        const state = stageAsEnters(FILTERED_NAME_ID);
        expect(() =>
            applyNameCardSubmit(state, { playerId: BOT, cardName: "Plains" })
        ).toThrow(/legal card name/i);
        expect(state.stagedEntries ?? []).toHaveLength(1);
    });

    it("row D — the bot names a NONLAND card and the permanent finishes entering", () => {
        const state = stageAsEnters(FILTERED_NAME_ID);
        const name = namedCardName(rungTwo(state));
        expect(tryGetCardByName(name)!.types).not.toContain("Land");
        expect(() =>
            applyNameCardSubmit(state, { playerId: BOT, cardName: name })
        ).not.toThrow();
        // Advanced: the staged entry finalized onto the battlefield carrying
        // the answer (CR 614.1c).
        expect(state.stagedEntries ?? []).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        const entered = state.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === "staged-0");
        expect(entered?.chosenName).toBe(name);
    });

    it("resolveStuck's re-walk produces the SAME legal answer, not the rejected one", () => {
        // `resolveStuck` deliberately resets the attempt counter and re-walks
        // the ladder from the top on every click, and its catch is empty by
        // design. Before #2497 that meant re-submitting the rejected string
        // forever; now the re-walk is idempotent AND accepted.
        const state = stageAsEnters(FILTERED_NAME_ID);
        const first = namedCardName(rungTwo(state));
        const second = namedCardName(rungTwo(state));
        expect(second).toBe(first);
        expect(() =>
            applyNameCardSubmit(state, { playerId: BOT, cardName: second })
        ).not.toThrow();
        expect(state.stagedEntries ?? []).toHaveLength(0);
    });
});
