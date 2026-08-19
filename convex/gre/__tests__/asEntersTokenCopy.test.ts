// CR 707.6 / 614.12 — the as-enters choices a TOKEN COPY owes (ADR 0100
// census row C, issue #2558, the last slice of PRD #2043).
//
//   707.6 "When copying a permanent, any choices that have been made for that
//   permanent aren't copied. Instead, if an object enters the battlefield as a
//   copy of another permanent, the object's controller will get to make any
//   'as [this] enters the battlefield' choices for it."
//
//   614.12 example: "Voice of All says 'As this creature enters, choose a
//   color' and 'This creature has protection from the chosen color.' An effect
//   creates a token that's a copy of Voice of All. As that token is created,
//   the token's controller chooses a color for it."
//
//   707.5 "An object that enters the battlefield 'as a copy' … becomes a copy
//   as it enters the battlefield. It doesn't enter the battlefield, and then
//   become a copy of that permanent."
//
// The token-copy primitive used to mint the token from a 0/0 "Copy" placeholder
// and overwrite its copiable characteristics only AFTER `createTokenPermanents`
// had returned — so the CR 614 chokepoint inside that call was handed a
// placeholder with no `entersWith` and a card object presenting a synthesized
// "Copy" definition, and neither of its two branches could see the clause.
// The fix is CR 707.5's own shape: the copy is stamped on BEFORE the
// chokepoint, so the chokepoint reads the COPIED definition (the
// presented-definition branch) exactly as it does for a Clone that copied
// mid-resolution.
//
// Producer census for this path (one row = one test below):
//   * the `createTokenCopy` Op (`gre/effects/interpreter.ts`) — counts, and
//     needs its own replay marker because a park suspends and RE-ENTERS it;
//   * `SpellContext.createTokenCopyOf` called from a resolve() closure
//     (Sin, Spira's Punishment `fin/multicolor.ts`) — counts;
//   * plain `createToken` / `createTokenPermanents` — must NOT change: a token
//     with no copied definition owes nothing, and a token whose own SPEC
//     declares `asEnters` must still owe those clauses exactly once.
import { describe, expect, it } from "vitest";
import {
    createTokenPermanents,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";
import {
    applyNameCardSubmit,
    applyPendingChoiceSubmit,
} from "../pendingChoiceSubmit";
import { checkStateBasedActions } from "../sba";
import { collectTriggers } from "../triggers";
import { projectPublicState } from "../../gameProjections";
import { registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { voiceOfAll } from "../../cards/sets/pls/white";
import { meddlingMage } from "../../cards/sets/pls/multicolor";
import { primalClay } from "../../cards/sets/atq/colorless";
import { illusionaryTerrain } from "../../cards/sets/ice/blue";
import { grizzlyBears } from "../../cards/sets/lea/green";
import { sinSpirasPunishment } from "../../cards/sets/fin/multicolor";
import type { EffectOp, GameEvent } from "../../cards/types";

// --- Harness ----------------------------------------------------------------

/** A synthetic DSL-only sorcery: "create N tokens that are copies of target
 *  permanent". Registered through the registry injection seam
 *  (`registerTokenDefinition`, the idiom `effects/__tests__/interpreter.test.ts`
 *  uses), so it resolves through the REAL `resolveTopOfStack` → `runOpList`
 *  path — which is the only way the Op's suspend/re-entry behaviour is
 *  exercised at all. */
function registerCopyScript(id: string, count?: number): string {
    const op: EffectOp = {
        op: "createTokenCopy",
        source: { target: 0 },
        controller: "controller",
        ...(count !== undefined ? { count } : {}),
    };
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { U: 2 },
        types: ["Sorcery"],
        targetRequirement: {
            type: ["Creature", "Artifact", "Enchantment"],
            count: 1,
        },
        effects: [op],
    });
    return id;
}

const COPY_ONE = registerCopyScript("test-2558-copy-one");
const COPY_TWO = registerCopyScript("test-2558-copy-two", 2);

/** p1 controls `source`; p1 casts the copy sorcery at it. Returns the state
 *  with the sorcery already on the stack, targets announced. */
function withSourceAndCopySpell(
    source: CardInstanceState,
    scriptId: string = COPY_ONE
): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [source] }),
            makePlayer("p2"),
        ],
    });
    pushSpell(state, scriptId, "p1", [{ type: "permanent", id: source.id }]);
    return state;
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

function tokensOf(state: GameState, playerId: string): CardInstanceState[] {
    const player = state.players.find((p) => p.id === playerId)!;
    return player.battlefield.filter((c) => c.isToken);
}

/** Every permanent on every battlefield — used for the "nothing observes the
 *  token mid-choice" assertions (CR 707.5 / 704.5f). */
function allPermanents(state: GameState): CardInstanceState[] {
    return state.players.flatMap((p) => p.battlefield);
}

// --- The four shipped as-enters kinds, on a token copy -----------------------

describe("CR 614.12 / 707.6 — a token copy owes the COPIED card's as-enters choices", () => {
    it("mode: a token copy of Voice of All chooses a colour before it enters, and the granted protection is live (CR 614.12's own example)", () => {
        const source = makeInstance(voiceOfAll.id, {
            id: "voice",
            controllerId: "p1",
        });
        const state = withSourceAndCopySpell(source);
        resolveTopOfStack(state);

        // The choice is raised, and it belongs to the TOKEN, not the source.
        const prompt = head(state);
        expect(prompt.asEntersKind).toBe("mode");
        expect(prompt.playerId).toBe("p1");
        expect(prompt.asEntersCardId).not.toBe("voice");
        // CR 614.12a — the token has NOT entered: it is on no battlefield.
        expect(tokensOf(state, "p1")).toHaveLength(0);
        expect(state.stagedEntries).toHaveLength(1);

        answer(state, ["U"]);

        const token = tokensOf(state, "p1")[0];
        expect(token).toBeDefined();
        expect(token.chosenModeId).toBe("U");
        // CR 707.2 — the copy really is a Voice of All, not a 0/0 "Copy".
        expect(token.power).toBe(2);
        expect(token.toughness).toBe(2);
        expect(token.staticAbilities).toContain("flying");
        // CR 702.16 — the chosen colour's protection is materialized by the
        // layer pass the (deferred) token entry tail runs.
        expect(token.staticAbilities).toContain("protection from blue");
        expect(token.staticAbilities).not.toContain("protection from red");
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stagedEntries).toBeUndefined();
    });

    it("mode: the chosen mode and its protection survive the wire projection (mandatory)", () => {
        const source = makeInstance(voiceOfAll.id, {
            id: "voice",
            controllerId: "p1",
        });
        const state = withSourceAndCopySpell(source);
        resolveTopOfStack(state);
        answer(state, ["G"]);

        const token = tokensOf(state, "p1")[0];
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === token.id);
        expect(slim?.chosenModeId).toBe("G");
        expect(slim?.staticAbilities).toContain("protection from green");
        expect(slim?.power).toBe(2);
    });

    it("body: a token copy of Primal Clay picks a body and does NOT enter as a 0/0 (CR 704.5f)", () => {
        const source = makeInstance(primalClay.id, {
            id: "clay",
            controllerId: "p1",
        });
        const state = withSourceAndCopySpell(source);
        resolveTopOfStack(state);

        expect(head(state).asEntersKind).toBe("body");
        answer(state, ["2-2-flying"]);

        const token = tokensOf(state, "p1")[0];
        expect(token.power).toBe(2);
        expect(token.toughness).toBe(2);
        expect(token.staticAbilities).toContain("flying");
        // CR 704.5f — a 0/0 would be gone by the next sweep.
        checkStateBasedActions(state);
        expect(tokensOf(state, "p1")).toHaveLength(1);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === token.id);
        expect(slim?.toughness).toBe(2);
        expect(slim?.staticAbilities).toContain("flying");
    });

    it("name: a token copy of Meddling Mage names a card", () => {
        const source = makeInstance(meddlingMage.id, {
            id: "mage",
            controllerId: "p1",
        });
        const state = withSourceAndCopySpell(source);
        resolveTopOfStack(state);

        expect(head(state).asEntersKind).toBe("name");
        expect(head(state).kind).toBe("name-card");
        applyNameCardSubmit(state, {
            playerId: "p1",
            cardName: grizzlyBears.name,
        });

        const token = tokensOf(state, "p1")[0];
        expect(token.chosenName).toBe(grizzlyBears.name);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === token.id);
        expect(slim?.chosenName).toBe(grizzlyBears.name);
    });

    it("subtypes: a token copy of Illusionary Terrain chooses two basic land types", () => {
        const source = makeInstance(illusionaryTerrain.id, {
            id: "terrain",
            controllerId: "p1",
        });
        const state = withSourceAndCopySpell(source);
        resolveTopOfStack(state);

        expect(head(state).asEntersKind).toBe("subtypes");
        answer(state, ["Forest", "Island"]);

        const token = tokensOf(state, "p1")[0];
        expect(token.chosenSubtypes).toEqual(["Forest", "Island"]);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === token.id);
        expect(slim?.chosenSubtypes).toEqual(["Forest", "Island"]);
    });
});

// --- CR 707.6's "aren't copied" half ----------------------------------------

describe("CR 707.6 — the pick is FRESH, never inherited from the copied permanent", () => {
    it("a token copying a Voice of All that already chose red still chooses for itself", () => {
        const source = makeInstance(voiceOfAll.id, {
            id: "voice",
            controllerId: "p1",
        });
        // The source made its own choice on some earlier entry.
        source.chosenModeId = "R";
        const state = withSourceAndCopySpell(source);
        resolveTopOfStack(state);

        // "any choices that have been made for that permanent aren't copied":
        // the choice is raised even though the source has already answered it.
        expect(head(state).asEntersKind).toBe("mode");
        answer(state, ["U"]);

        const token = tokensOf(state, "p1")[0];
        expect(token.chosenModeId).toBe("U");
        // …and the source keeps its own.
        const voice = state.players[0].battlefield.find(
            (c) => c.id === "voice"
        )!;
        expect(voice.chosenModeId).toBe("R");
    });
});

// --- CR 707.5 / 704.5f — nothing observes the token mid-choice ---------------

describe("CR 707.5 / 704.5f — nothing observes the token while its choices are owed", () => {
    it("no SBA sweep and no wire projection can see the staged token", () => {
        const source = makeInstance(primalClay.id, {
            id: "clay",
            controllerId: "p1",
        });
        const state = withSourceAndCopySpell(source);
        resolveTopOfStack(state);

        // Mid-choice: the token is in NO zone at all.
        expect(state.stagedEntries).toHaveLength(1);
        const stagedId = state.stagedEntries![0].card.id;
        expect(allPermanents(state).map((c) => c.id)).not.toContain(stagedId);
        for (const player of state.players) {
            expect(player.graveyard.map((c) => c.id)).not.toContain(stagedId);
            expect(player.exile.map((c) => c.id)).not.toContain(stagedId);
        }

        // CR 704.5f — a sweep must not find a 0/0 to bin (there is no
        // observable 0/0 at all; the placeholder never reaches a zone).
        checkStateBasedActions(state);
        expect(state.stagedEntries).toHaveLength(1);
        expect(allPermanents(state).map((c) => c.id)).not.toContain(stagedId);

        // The wire shows no token on any battlefield either.
        const projected = projectPublicState(state, 1, "p1");
        for (const player of projected.players) {
            expect(player.battlefield.map((c) => c.id)).not.toContain(stagedId);
        }

        // The entry completes normally afterwards.
        answer(state, ["3-3"]);
        expect(tokensOf(state, "p1")).toHaveLength(1);
    });

    // The un-parked half of this — "the token copy's CR 603.6a announcement
    // carries the COPIED types and P/T, never the 0/0 'Copy' placeholder", the
    // invariant `deferEntryEvent` used to buy (#2300) and that applying the
    // copy before entry now buys structurally — is asserted on the emitted
    // event in `tokenEnteredTrigger.test.ts`. It is not re-asserted on the
    // parked path here because both paths announce from the SAME
    // `finishTokenEntry` frame, and by the time a parked entry's answer has
    // been submitted the resumed resolution has already drained
    // `state.pendingEvents` into the trigger scan.
});

// --- ADR 0100 D5 — the replay marker ----------------------------------------

describe("ADR 0100 D5 — creating more than one token copy owes each token its own choices exactly once", () => {
    it("count: 1 — one park, one answer, exactly ONE token", () => {
        const source = makeInstance(voiceOfAll.id, {
            id: "voice",
            controllerId: "p1",
        });
        const state = withSourceAndCopySpell(source, COPY_ONE);
        resolveTopOfStack(state);
        expect(state.stagedEntries).toHaveLength(1);
        answer(state, ["U"]);

        expect(tokensOf(state, "p1")).toHaveLength(1);
        expect(state.stack).toHaveLength(0);
    });

    it("count: 2 — two parks, two answers, exactly TWO tokens each with its OWN pick", () => {
        const source = makeInstance(voiceOfAll.id, {
            id: "voice",
            controllerId: "p1",
        });
        const state = withSourceAndCopySpell(source, COPY_TWO);
        resolveTopOfStack(state);

        // Both tokens of the batch were created and both parked (the whole
        // `count` loop runs before `runOpList` notices the parked count).
        expect(state.stagedEntries).toHaveLength(2);
        expect(state.pendingChoices).toHaveLength(2);
        expect(tokensOf(state, "p1")).toHaveLength(0);

        answer(state, ["U"]);
        answer(state, ["R"]);

        const tokens = tokensOf(state, "p1");
        // Exactly two — not four (the Op re-runs on resume) and not one (a
        // marker written before the loop would short-circuit the batch).
        expect(tokens).toHaveLength(2);
        expect(tokens.map((t) => t.chosenModeId).sort()).toEqual(["R", "U"]);
        expect(tokens[0].staticAbilities).toContain("protection from blue");
        expect(tokens[1].staticAbilities).toContain("protection from red");
        expect(state.stack).toHaveLength(0);
        expect(state.stagedEntries).toBeUndefined();
    });

    it("count: 2 of a source with NO as-enters clause still creates exactly two (the un-parked control)", () => {
        const source = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: "p1",
        });
        const state = withSourceAndCopySpell(source, COPY_TWO);
        resolveTopOfStack(state);

        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(tokensOf(state, "p1")).toHaveLength(2);
    });
});

// --- The must-NOT rows: plain token creation is untouched --------------------

describe("plain token creation is unchanged (the must-NOT census rows)", () => {
    it("a token with no copied definition and no declared clause enters immediately", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const ids = createTokenPermanents(
            state,
            { name: "Soldier", types: ["Creature"], power: 1, toughness: 1 },
            "p1"
        );
        expect(ids).toHaveLength(1);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stagedEntries).toBeUndefined();
        expect(tokensOf(state, "p1")).toHaveLength(1);
    });

    it("a token whose OWN spec declares asEnters owes it exactly ONCE, not twice", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        createTokenPermanents(
            state,
            {
                name: "Chameleon",
                types: ["Creature"],
                power: 0,
                toughness: 0,
                entersWith: {
                    asEnters: [
                        {
                            kind: "body",
                            options: [
                                {
                                    id: "1-1",
                                    label: "1/1",
                                    power: 1,
                                    toughness: 1,
                                },
                                {
                                    id: "2-2",
                                    label: "2/2",
                                    power: 2,
                                    toughness: 2,
                                },
                            ],
                        },
                    ],
                },
            },
            "p1"
        );
        // The declared branch supplies the clause and the (now also readable)
        // presented-definition branch must not append a duplicate: the token
        // synthesizes a definition carrying the SAME array, and
        // `consultedDefIds` records it at park time.
        expect(state.stagedEntries).toHaveLength(1);
        expect(state.stagedEntries![0].owed).toHaveLength(1);
        expect(state.pendingChoices).toHaveLength(1);

        answer(state, ["2-2"]);
        // One choice, one answer, one token — no second clause discovered off
        // the synthesized definition.
        expect(state.stagedEntries).toBeUndefined();
        expect(state.pendingChoices ?? []).toHaveLength(0);
        const token = tokensOf(state, "p1")[0];
        expect(token.power).toBe(2);
    });
});

// --- The resolve()-closure producer ------------------------------------------

describe("the resolve() producer: Sin, Spira's Punishment (fin/multicolor.ts)", () => {
    it("its token copy of a card with an as-enters clause is created exactly once", () => {
        const sin = makeInstance(sinSpirasPunishment.id, {
            id: "sin",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [sin],
                    // TWO copies of the same card, so the random pick is
                    // deterministic in effect AND a replay of the body has a
                    // second card to exile — which is exactly what the
                    // run-to-completion marker must prevent. With one card the
                    // replay finds an empty pool and hides the bug.
                    graveyard: [
                        makeInstance(voiceOfAll.id, {
                            id: "gy-voice-a",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        }),
                        makeInstance(voiceOfAll.id, {
                            id: "gy-voice-b",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const event: GameEvent = {
            type: "PERMANENT_ENTERED",
            instanceId: "sin",
            controllerId: "p1",
            types: ["Creature"],
        };
        state.stack.push(...collectTriggers(state, [event]));
        resolveTopOfStack(state);

        expect(head(state)?.asEntersKind).toBe("mode");
        answer(state, ["B"]);

        // Exactly one token, and exactly one card left the graveyard — a
        // replay of Sin's whole resolve() closure would have exiled the second
        // card and created a second copy (Voice of All is not a land, so the
        // Oracle loop stops after one iteration).
        expect(tokensOf(state, "p1")).toHaveLength(1);
        expect(tokensOf(state, "p1")[0].chosenModeId).toBe("B");
        expect(state.players[0].graveyard).toHaveLength(1);
        expect(state.players[0].exile).toHaveLength(1);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stagedEntries).toBeUndefined();
        expect(state.stack).toHaveLength(0);
    });
});
