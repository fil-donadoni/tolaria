// The quiz's lowering, judged by the ONE consumer that matters: the fit
// (issue #3405, PRD #3397, ADR 0124 §1).
//
// A verdict given in play is worth exactly as much as `evalPairsOf` can do with
// it months later, and that function rebuilds the position from the spec,
// re-enumerates, and matches the stored candidates BY KEY. Every plausible way
// of building this quiz — reading the candidates off the DecisionTrace, keying
// them by the live game's instance ids, lowering the wire projection instead of
// the bot's own reconstruction — produces a payload that renders perfectly and
// then fails at fit time as "candidate no longer enumerated", where nobody can
// still say what the judge meant.
//
// So these tests do not assert on the quiz's shape. They take what the quiz
// would submit, make the Verdict the mutation would store, and run the REAL
// pair builder over it.

import { describe, it, expect } from "vitest";
import { buildBladeState } from "@convex/gre/ai/blade/runner";
import { candidateMoves } from "@convex/gre/ai/verdicts/candidates";
import { evalPairsOf } from "@convex/gre/ai/verdicts/evalPairs";
import type { Verdict } from "@convex/gre/ai/verdicts/types";
import { describeMove } from "@convex/gre/describeMove";
import { projectPublicState } from "@convex/gameProjections";
import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import type { GameState } from "@convex/gre/state";
import type { Move } from "@convex/gre";
import { PLACEHOLDER_CARD_ID } from "@convex/gre";
import { getLegalActions } from "@convex/gre/rules";
import {
    makeMutationCtx,
    runMutation,
} from "@convex/__tests__/gameMutationHarness";
import { submit } from "@convex/verdicts";
import {
    buildVerdictQuiz,
    formatRefusalReport,
    quizRefusal,
    QUIZ_ONLY_REFUSAL_KINDS,
    QUIZ_REFUSAL_KINDS,
    QUIZ_REFUSALS,
} from "../verdict-quiz";
import { VERDICT_REFUSAL_KINDS } from "@convex/gre/ai/verdicts/lowering";
import type { AiTraceSource } from "../trace-store";

const SEQ = 42;

/** The board a decision is taken on, and the wire projection of it the consult
 *  is handed — the two halves the trace store keeps. */
/**
 * The board as a REAL game hands it over (issue #3483): the seats' own
 * nicknames, and an opaque per-game handle for every seat and every card
 * instance — none of which a rebuild from a `ScenarioSpec` reproduces.
 *
 * It matters because the blade harness allocates the SAME ids on both sides:
 * the fixture's live board and the lowering's rebuild both start from
 * `buildBladeBaseState` and both number their instances from the same counter,
 * so a comparison keyed off raw ids passes for free here and fails in play.
 * Every id is PREFIXED rather than replaced, so uniqueness is preserved, and
 * the substitution is on the quoted JSON token — which only a string-valued
 * field can match (a card definition id is a UUID and an ability id is a
 * slug, so neither collides with an instance id).
 */
function asLiveGame(state: GameState, names: [string, string]): GameState {
    const handles = new Set<string>(state.players.map((player) => player.id));
    for (const player of state.players) {
        for (const zone of [
            player.battlefield,
            player.hand,
            player.graveyard,
            player.exile,
            player.library,
        ]) {
            for (const card of zone) handles.add(card.id);
        }
    }
    let json = JSON.stringify(state);
    for (const handle of handles) {
        json = json.replaceAll(`"${handle}"`, `"live-${handle}"`);
    }
    const live = JSON.parse(json) as GameState;
    live.players[0].name = names[0];
    live.players[1].name = names[1];
    return live;
}

function position(
    spec: ScenarioSpec,
    /** Supply the seats' real nicknames to get the position a real table would
     *  produce — see {@link asLiveGame}. Omit it and the fixture keeps the
     *  blade harness's own names and ids, which is what every test written
     *  before issue #3483 relies on. */
    liveSeatNames?: [string, string]
): {
    state: GameState;
    botId: string;
    source: AiTraceSource;
} {
    const built = buildBladeState({
        label: "verdict-quiz fixture",
        spec,
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [] },
    });
    const state = liveSeatNames ? asLiveGame(built, liveSeatNames) : built;
    const botId = state.players[0].id;
    return {
        state,
        botId,
        source: { state: projectPublicState(state, SEQ, botId), botId },
    };
}

/** A trace naming `chosen` as the move the search took. Only two of its fields
 *  are read by the lowering — `botId` and `chosen` — so the rest is the
 *  cheapest well-formed filling rather than a fake search result. */
function traceFor(state: GameState, botId: string, chosen: Move) {
    return {
        botId,
        chosen: describeMove(chosen, state),
        iterationsCompleted: 1,
        iterationsRequested: 1,
        elapsedMs: 1,
        stoppedBy: "iterations" as const,
        mechanism: "mean-reward" as const,
        candidates: [],
    };
}

const MAIN_PHASE: ScenarioSpec = {
    cards: [
        { name: "Mountain", owner: "me", zone: "battlefield" },
        { name: "Mountain", owner: "me", zone: "hand" },
        { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 3,
    landCount: 0,
    libraryCount: 20,
};

/** The ordinary case, and the one every fixture here used to miss: the human
 *  is holding cards. The projection gives their hand as `null` per card, and
 *  the adapter rebuilds it as opaque placeholders — which is what the lowering
 *  meets in every real game. */
const OPPONENT_HOLDS_CARDS: ScenarioSpec = {
    cards: [
        { name: "Mountain", owner: "me", zone: "battlefield" },
        { name: "Mountain", owner: "me", zone: "hand" },
        { name: "Lightning Bolt", owner: "opp", zone: "hand" },
        { name: "Grizzly Bears", owner: "opp", zone: "hand" },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 3,
    landCount: 0,
    libraryCount: 20,
};

/** CR 307.1 (issue #3454) — the judged seat holding priority on the OPPONENT's
 *  turn, with one instant it can actually pay for and one creature it cannot
 *  cast. The class the quiz used to refuse outright, and the one PRD #3397
 *  exists for: holding up removal instead of acting. */
const RESPONDING_ON_OPPONENTS_TURN: ScenarioSpec = {
    cards: [
        { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
        { name: "Mountain", owner: "opp", zone: "battlefield" },
        { name: "Forest", owner: "opp", zone: "battlefield" },
        { name: "Lightning Bolt", owner: "opp", zone: "hand" },
        // The sorcery-speed half the rebuild must NOT be able to offer: a land
        // to play (CR 305.1) and a creature the seat can actually PAY for
        // (CR 302.1 — hence the Forest above; with one Mountain the Bears are
        // uncastable on either turn and discriminate nothing). Without both,
        // the two candidate lists coincide and the comparison below proves
        // nothing — a rebuild that lost the turn holder passes for free.
        { name: "Mountain", owner: "opp", zone: "hand" },
        { name: "Grizzly Bears", owner: "opp", zone: "hand" },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 3,
    landCount: 0,
    libraryCount: 20,
};

/** A board whose decision TARGETS A PLAYER (issue #3483). Seal of Fire's
 *  "Sacrifice this enchantment: It deals 2 damage to any target" costs no mana
 *  and no tap (CR 602.1), so at priority both seats and the creature are live
 *  targets — and the two seat-targeting candidates are the ones the describer
 *  renders with a player NAME. */
const SEAL_AT_A_PLAYER: ScenarioSpec = {
    cards: [
        { name: "Seal of Fire", owner: "me", zone: "battlefield" },
        { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 3,
    landCount: 0,
    libraryCount: 20,
};

const DECLARE_ATTACKERS: ScenarioSpec = {
    cards: [
        { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
        { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
    ],
    phase: "DECLARE_ATTACKERS",
    turn: 5,
    landCount: 0,
    libraryCount: 20,
};

/** The Verdict `verdicts.submit` would store from this quiz. */
function verdictOf(
    quiz: {
        spec: ScenarioSpec;
        candidates: { key: string; description: string }[];
    },
    rightIndex: number
): Verdict {
    return {
        id: "in-play-test",
        spec: quiz.spec,
        seat: "me",
        candidates: quiz.candidates,
        answer: { kind: "right", rightIndexes: [rightIndex] },
        author: "Tessa",
        createdAt: new Date(0).toISOString(),
        source: "in-play",
    };
}

describe("buildVerdictQuiz — a judgement the fit can still read (issue #3405)", () => {
    for (const [name, spec] of [
        ["a main-phase decision", MAIN_PHASE],
        ["a declare-attackers decision", DECLARE_ATTACKERS],
    ] as const) {
        it(`lowers ${name} into candidates the pair builder resolves`, () => {
            const { state, botId, source } = position(spec);
            const moves = candidateMoves(state, botId);
            expect(moves.length).toBeGreaterThan(1);
            const chosen = moves.find((m) => m.kind === "pass") ?? moves[0];

            const result = buildVerdictQuiz(
                traceFor(state, botId, chosen),
                source
            );
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            const { quiz } = result;

            // The Bot's own move is one of the offered candidates, found
            // through the describer rather than through an id the rebuild
            // cannot have.
            expect(quiz.candidates[quiz.botPickIndex].description).toBe(
                describeMove(chosen, state)
            );

            // THE claim: the fit rebuilds this position and finds every
            // candidate the quiz named.
            const pairs = evalPairsOf(verdictOf(quiz, quiz.botPickIndex));
            expect(pairs.error).toBeUndefined();
            expect(pairs.pairs.length).toBe(quiz.candidates.length - 1);
        });
    }

    it("judges a decision that TARGETS A PLAYER, at a table whose seats have real names (issue #3483)", () => {
        const { state, botId, source } = position(SEAL_AT_A_PLAYER, [
            "Mr bambury",
            "Tessa",
        ]);
        const opponentId = state.players[1].id;
        // The premise: this board shares no identity with the one the lowering
        // will rebuild. Asserted, because a fixture that happened to agree
        // would make the whole test vacuous.
        expect(botId).not.toBe("p1");
        expect(state.players[0].battlefield[0].id).not.toMatch(/^\d+$/);
        const chosen = candidateMoves(state, botId).find(
            (move) =>
                move.kind === "activate-ability" &&
                move.targets.some(
                    (target) =>
                        target.type === "player" && target.id === opponentId
                )
        );
        expect(chosen).toBeDefined();
        // The live sentence names the player, which is a fact NO
        // `ScenarioSpec` carries and no rebuild can reproduce. Comparing the
        // two lists through it refused this whole class of decision.
        expect(describeMove(chosen!, state)).toContain("Tessa");

        const result = buildVerdictQuiz(
            traceFor(state, botId, chosen!),
            source
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const { quiz } = result;

        // The pick is the move that was played, carried across the rebuild by
        // canonical key — and the candidate a tester reads names the seat's
        // ROLE, never the harness's "Blade P2".
        const played = quiz.candidates[quiz.botPickIndex].description;
        expect(played).toContain("Seal of Fire");
        expect(played).toContain("the opponent");
        expect(played).not.toContain("Blade P");

        // And the claim every one of these tests makes: the fit rebuilds this
        // position and finds every candidate the quiz named.
        const pairs = evalPairsOf(verdictOf(quiz, quiz.botPickIndex));
        expect(pairs.error).toBeUndefined();
        expect(pairs.pairs.length).toBe(quiz.candidates.length - 1);
    });

    it("judges a position where the opponent is holding cards (CR 400.2, issue #3452)", () => {
        // The hidden hand has no IDENTITY to lower — the hand is a hidden zone,
        // and a spec names cards by name. Until issue #3452 it was dropped and
        // said, so every verdict taken in a real game was judged on a board
        // where the opponent held an EMPTY hand and the evaluation's `hand`
        // term read low by exactly the cards it lost. The count now rides in
        // the spec and rebuilds as the same opaque placeholders the Bot's own
        // search ran on.
        const { state, botId, source } = position(OPPONENT_HOLDS_CARDS);
        const liveOppHand = state.players[1].hand.length;
        expect(liveOppHand).toBe(2);
        const result = buildVerdictQuiz(
            traceFor(state, botId, candidateMoves(state, botId)[0]),
            source
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const { quiz } = result;

        // Carried, not dropped: the count is in the spec and the note is gone.
        expect(quiz.spec.hiddenHand).toEqual({ opp: liveOppHand });
        expect(quiz.dropped.some((note) => /hand: \d+ card/.test(note))).toBe(
            false
        );

        // THE acceptance criterion: the rebuilt hand is the size the live one
        // was. Rebuilt through the real builder, not through the spec's own
        // arithmetic.
        const rebuilt = buildBladeState({
            label: "verdict-quiz rebuilt hidden hand",
            spec: quiz.spec,
            bot: "me",
            budget: { iterations: 1 },
            tier: "must",
            expect: { moves: [] },
        });
        expect(rebuilt.players[1].hand).toHaveLength(liveOppHand);
        // And opaque: no rebuilt placeholder is castable, by either seat
        // (`getLegalActions` checks the sentinel id — `gre/rules.ts`).
        for (const card of rebuilt.players[1].hand) {
            expect((card.card as { id: string }).id).toBe(PLACEHOLDER_CARD_ID);
            expect(getLegalActions(rebuilt, rebuilt.players[1], card)).toEqual(
                []
            );
            expect(getLegalActions(rebuilt, rebuilt.players[0], card)).toEqual(
                []
            );
        }

        expect(evalPairsOf(verdictOf(result.quiz, 0)).error).toBeUndefined();
    });

    it("judges a decision taken with priority on the opponent's turn (CR 307.1, issue #3454)", () => {
        // This used to be a REFUSAL: the spec had no field for the turn holder,
        // so the rebuild came back as the Bot's own turn — a strictly larger,
        // sorcery-speed candidate list — and "pass" being in both lists meant
        // the pick still resolved and the verdict answered a question nobody
        // asked. `activePlayer` / `priority` / `passCount` (issue #3454) carry
        // the fact, and the candidate-list comparison inside the quiz is what
        // proves it: a turn holder that failed to survive the lowering shows up
        // there as sorcery-speed moves the live list never had.
        const state = buildBladeState({
            label: "verdict-quiz opponent-turn fixture",
            spec: RESPONDING_ON_OPPONENTS_TURN,
            setup: [{ kind: "pass" }],
            bot: "opp",
            budget: { iterations: 1 },
            tier: "must",
            expect: { moves: [] },
        });
        const respondingSeat = state.players[1].id;
        // The position really is the one under test: the opponent holds the
        // turn, the judged seat holds priority with a pass already banked.
        expect(state.activePlayerId).toBe(state.players[0].id);
        expect(state.priorityPlayerId).toBe(respondingSeat);
        expect(state.passCount).toBe(1);

        const moves = candidateMoves(state, respondingSeat);
        expect(moves.length).toBeGreaterThan(1);
        const chosen = moves.find((m) => m.kind === "pass") ?? moves[0];

        const result = buildVerdictQuiz(
            traceFor(state, respondingSeat, chosen),
            {
                state: projectPublicState(state, SEQ, respondingSeat),
                botId: respondingSeat,
            }
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const { quiz } = result;

        // Lowered in the judged seat's own frame: it is "me", the turn holder
        // is "opp", and the banked pass came with it.
        expect(quiz.spec.activePlayer).toBe("opp");
        expect(quiz.spec.priority).toBe("me");
        expect(quiz.spec.passCount).toBe(1);
        // Neither fact is reported as a loss any more.
        expect(
            quiz.dropped.some((note) => /^(active player|priority:)/.test(note))
        ).toBe(false);

        // THE claim: the fit rebuilds this position and resolves every
        // candidate the quiz named.
        expect(quiz.candidates[quiz.botPickIndex].description).toBe(
            describeMove(chosen, state)
        );
        const pairs = evalPairsOf(verdictOf(quiz, quiz.botPickIndex));
        expect(pairs.error).toBeUndefined();
        expect(pairs.pairs.length).toBe(quiz.candidates.length - 1);
    });

    it("judges a BLOCKING decision, attackers already declared (CR 509.1, issue #3458)", () => {
        // The other half of the class PRD #3397 exists for, and the one the
        // quiz refused outright for longer: a `ScenarioSpec` could seed only an
        // EMPTY DECLARE_ATTACKERS combat object, so lowering a position taken
        // after attackers were declared rewound it to the attack step — the
        // rebuild offered the `attack:` the Bot had already made and owed the
        // defender no block at all. Measured at 19.8% of Bot decisions.
        const state = buildBladeState({
            label: "verdict-quiz block-window fixture",
            spec: DECLARE_ATTACKERS,
            setup: [{ kind: "declare-attackers" }],
            bot: "opp",
            budget: { iterations: 1 },
            tier: "must",
            expect: { moves: [] },
        });
        const defenderId = state.players[1].id;
        // The position really is the one under test: the attack is declared
        // and confirmed, and the defender owes the block.
        expect(state.phase).toBe("DECLARE_BLOCKERS");
        expect(state.combat?.confirmed).toBe(true);
        expect(state.combat?.attackerIds.length).toBe(1);

        const moves = candidateMoves(state, defenderId);
        expect(moves.length).toBeGreaterThan(1);
        const chosen =
            moves.find((m) => m.kind === "declare-blockers") ?? moves[0];

        const result = buildVerdictQuiz(traceFor(state, defenderId, chosen), {
            state: projectPublicState(state, SEQ, defenderId),
            botId: defenderId,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const { quiz } = result;

        // Lowered in the judged seat's own frame: the defender is "me", the
        // attacker holds the turn, and the declaration came with it.
        expect(quiz.spec.combat?.attackers).toEqual(["Grizzly Bears"]);
        expect(quiz.spec.combat?.confirmed).toBe(true);
        expect(quiz.spec.activePlayer).toBe("opp");
        // The loss it replaces is gone.
        expect(quiz.dropped.some((note) => note.startsWith("combat:"))).toBe(
            false
        );

        // THE claim: the rebuilt position offers the block that was actually
        // made, and the fit resolves every candidate the quiz named.
        expect(quiz.candidates[quiz.botPickIndex].description).toBe(
            describeMove(chosen, state)
        );
        const pairs = evalPairsOf(verdictOf(quiz, quiz.botPickIndex));
        expect(pairs.error).toBeUndefined();
        expect(pairs.pairs.length).toBe(quiz.candidates.length - 1);
    });

    it("submits through the REAL mutation, which validates what it stores", async () => {
        // The door the quiz's payload actually has to pass: index bounds,
        // duplicate move keys, and every card name in the position resolving
        // against the engine's own vocabulary. A quiz that produced a name the
        // catalogue cannot place would fail HERE, at the tester's gesture, and
        // this is what says it does not.
        const { state, botId, source } = position(OPPONENT_HOLDS_CARDS);
        const result = buildVerdictQuiz(
            traceFor(state, botId, candidateMoves(state, botId)[0]),
            source
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const { quiz } = result;

        const { ctx, doc } = makeMutationCtx("u-tester", [
            {
                _id: "u-tester",
                __table: "users",
                nickname: "Tessa",
                isTester: true,
            },
        ]);
        const id = await runMutation<Record<string, unknown>, string>(
            submit,
            ctx,
            {
                spec: quiz.spec,
                seat: "me",
                candidates: quiz.candidates,
                answer: { kind: "right", rightIndexes: [quiz.botPickIndex] },
                botPickIndex: quiz.botPickIndex,
            }
        );
        expect(doc(id).candidates).toEqual(quiz.candidates);
    });

    it("names a candidate list the mutation's own bounds accept", () => {
        // `verdicts.submit` refuses two candidates sharing a move key — a pair
        // built from them is permanently unsatisfiable. The enumerator cannot
        // produce one, and this is what says so about the list the quiz builds
        // rather than about the enumerator in the abstract.
        const { state, botId, source } = position(DECLARE_ATTACKERS);
        const result = buildVerdictQuiz(
            traceFor(state, botId, candidateMoves(state, botId)[0]),
            source
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const keys = result.quiz.candidates.map((c) => c.key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys.every((key) => key.length > 0)).toBe(true);
    });

    it("refuses a decision taken with a spell on the stack", () => {
        // A decision taken with a SPELL ON THE STACK, on the Bot's own turn —
        // the ordinary "do I hold up anything else?" window. The lowering
        // cannot express a stack, so the rebuild is the same board with the
        // Bolt simply gone: a quiet position where nothing is about to die.
        // Every other guard passes (the Bot's own move is there, the list
        // survives), which is exactly why this one exists.
        const state = buildBladeState({
            label: "verdict-quiz spell-on-stack fixture",
            spec: {
                cards: [
                    { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                    { name: "Mountain", owner: "me", zone: "hand" },
                    { name: "Mountain", owner: "opp", zone: "battlefield" },
                    { name: "Lightning Bolt", owner: "opp", zone: "hand" },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 3,
                landCount: 0,
                libraryCount: 20,
            },
            // The opponent Bolts the Bot's creature in the Bot's own main
            // phase; priority comes back to the Bot with the spell still on the
            // stack — "do I answer this?", the commonest window there is.
            setup: [
                // The Bot passes with an empty stack, which is what hands the
                // opponent the window to cast into.
                { kind: "pass", seat: "me" },
                {
                    kind: "cast",
                    card: "Lightning Bolt",
                    by: "opp",
                    target: "Grizzly Bears",
                },
            ],
            bot: "me",
            budget: { iterations: 1 },
            tier: "must",
            expect: { moves: [] },
        });
        const botId = state.players[0].id;
        const result = buildVerdictQuiz(
            traceFor(state, botId, candidateMoves(state, botId)[0]),
            { state: projectPublicState(state, SEQ, botId), botId }
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        // With no journal handed in, a stack the lowering cannot walk back to
        // a quiet board is refused — its own kind since issue #3480, because
        // "nobody recorded the window" is a coverage gap a caller can close,
        // not the structural one `stack-mid-resolution` names.
        expect(result.refusal.kind).toBe("stack-not-journalled");
        expect(result.refusal.detail).toContain("on the stack");
        // The KIND is all the record carries: the title comes from the one
        // table, looked up by kind, so no refusal site can write its own
        // (issue #3457).
        expect(QUIZ_REFUSALS[result.refusal.kind].title.length).toBeGreaterThan(
            0
        );
        expect(formatRefusalReport(result.refusal, { id: 1 })).toContain(
            QUIZ_REFUSALS["stack-not-journalled"].title
        );
    });
});

describe("the refusal a panel renders (issue #3457)", () => {
    it("titles every kind the quiz can refuse with, the lowering's and its own", () => {
        // The vocabulary is INHERITED, never restated: every kind
        // `lowerDecision` refuses with is a kind the panel can title, plus the
        // two sites only a browser has.
        for (const kind of VERDICT_REFUSAL_KINDS) {
            expect(QUIZ_REFUSAL_KINDS).toContain(kind);
        }
        expect(QUIZ_REFUSAL_KINDS.length).toBe(
            VERDICT_REFUSAL_KINDS.length + QUIZ_ONLY_REFUSAL_KINDS.length
        );
        for (const kind of QUIZ_REFUSAL_KINDS) {
            const { title } = QUIZ_REFUSALS[kind];
            expect(title.length).toBeGreaterThan(0);
            // ONE line — a title that wraps to a paragraph is the flat red
            // paragraph this slice replaced.
            expect(title).not.toContain("\n");
        }
        // And no two kinds share a title: the point is telling three refusals
        // in a row apart at a glance.
        const titles = QUIZ_REFUSAL_KINDS.map((k) => QUIZ_REFUSALS[k].title);
        expect(new Set(titles).size).toBe(titles.length);
    });

    it("reports kind, title, detail, the decision's identity and every dropped note", () => {
        const refusal = quizRefusal("different-decision", "the detail", [
            "first note",
            "second note",
        ]);
        const report = formatRefusalReport(refusal, { id: 7, seq: 4242 });

        expect(report).toContain("verdict quiz refusal: different-decision");
        expect(report).toContain(QUIZ_REFUSALS["different-decision"].title);
        expect(report).toContain("the detail");
        // The board it was given on — a pasted refusal with no seq names none.
        expect(report).toContain("decision #7 at seq 4242");
        // Each note on its OWN line, never a semicolon run-on.
        expect(report).toContain("not captured (2):");
        expect(report).toContain("\n- first note\n");
        expect(report).toContain("\n- second note");
    });

    it("omits the seq a decision was pushed without, and the notes it has none of", () => {
        const report = formatRefusalReport(
            quizRefusal("position-not-held", "gone"),
            { id: 3 }
        );
        expect(report).toContain("decision #3");
        expect(report).not.toContain("seq");
        expect(report).not.toContain("not captured");
    });

    it("names the tracking issue only for a kind whose cause IS one known gap", () => {
        // `combat-not-captured` is issue #3458 and nothing else; a
        // `different-decision` is caused by whichever fact the lowering lost
        // on THIS board, so it names none and lets `dropped[]` say it.
        expect(QUIZ_REFUSALS["combat-not-captured"].trackedBy).toBe(3458);
        expect(QUIZ_REFUSALS["different-decision"].trackedBy).toBe(null);
        expect(
            formatRefusalReport(quizRefusal("combat-not-captured", "x"), {
                id: 1,
            })
        ).toContain("tracked by issue #3458");
        expect(
            formatRefusalReport(quizRefusal("different-decision", "x"), {
                id: 1,
            })
        ).not.toContain("tracked by");
    });
});
