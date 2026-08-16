// RETURN-VALIDATOR conformance for the three Limited Event queries
// (`listOpenLimitedEvents`, `myLimitedEvents`, `getLimitedEvent`) — PRD #1628,
// issue #1644.
//
// ── Why this file exists ────────────────────────────────────────────────────
// Convex validates a function's return value against its `returns:` validator
// AT THE FUNCTION BOUNDARY, at runtime, and REJECTS an object carrying a field
// the validator doesn't declare. Nothing in the normal gate sees that boundary:
//
//   - `tsc` doesn't. The queries' handler type is `EventViewWithAutoBuild` (the
//     projection's own TS type), NOT `Infer<typeof limitedEventViewValidator>`.
//     Adding a field to `projectLimitedEvent` and forgetting the validator is
//     therefore type-clean — and, until it ships, invisible.
//   - The projection unit tests don't. They call `projectLimitedEvent`
//     directly; the validator is never consulted.
//
// That gap has already bitten twice in this PRD's slices: `standings` (#1666,
// caught only because that change touched both) and `viewerPairing` (#1644,
// shipped validator-less and rejected EVERY read — the whole Limited lobby and
// event page, not just the play phase).
//
// The project has no convex-test harness (see `adminAuth.test.ts`), so the
// query can't literally be invoked through a deployment here. What this file
// does instead is run the SAME check the boundary runs: it walks
// `limitedEventViewValidator.json` — the exact description Convex validates
// with, not a hand-copied list, the same idiom `limitedPlayPhaseSchema.test.ts`
// uses for the stored shape — over the value the REAL projection produces. A
// field present in one and absent from the other fails here exactly as it fails
// in production.
import { describe, it, expect } from "vitest";
import { limitedEventViewValidator } from "../limitedEvents";
import {
    resolveDeckCardMeta,
    tryGetDefinition,
    getCardByName,
    getPrintingsForCard,
} from "../cards";
import {
    basicLandsForColors,
    getCardColorIdentity,
    getPipCountsFromCost,
} from "../cards/colors";
import { getDefinitionProducibleColors, manaValue } from "../gre/constants";
import { makeRng } from "../gre/rng";
import {
    computeBotAutoBuiltDeck,
    type ResolveBasicLand,
} from "../limited/autoBuild";
import {
    projectViewerChallenges,
    type ChallengeGame,
} from "../limited/challenge";
import { computeEventCompletion } from "../limited/completion";
import type { LimitedPairing } from "../limited/eventTypes";
import {
    projectLimitedEvent,
    type LimitedEventRow,
} from "../limited/eventProjection";
import {
    buildEmptySeats,
    assignFreeSeat,
    fillBotSeats,
    generateSealedPools,
    type ResolveCardMeta,
} from "../limited/eventLogic";
import { resolveMatchFormat } from "../limited/matchFormat";
import { upsertPoolArrangementEntry } from "../limited/poolArrangement";
import { evaluateDeckStrength, type DeckStrength } from "../limited/matchSim";
import { getRuntimeBoosterConfig } from "../limited/registry";
import { openRound, type ResolveSeatStrength } from "../limited/rounds";
import type { GetCardEvalMeta } from "../limited/botDrafter";
import type { Color } from "../cards/types";
import {
    validatorJsonOf,
    validationErrors,
    type FieldJson,
} from "./fixtures/validatorWalk";

// ── Convex's own validator description, walked by the shared helper ────────
const viewValidatorJson = validatorJsonOf(limitedEventViewValidator);

// ── The exact resolver wiring `convex/limitedEvents.ts` injects ─────────────

const resolveCardMeta: ResolveCardMeta = (scryfallId) => {
    const def = tryGetDefinition(scryfallId);
    if (!def) return null;
    const meta = resolveDeckCardMeta(scryfallId);
    return meta ? { cardId: meta.cardId, cardName: def.name } : null;
};

const getCardEvalMeta: GetCardEvalMeta = (scryfallId) => {
    const meta = resolveDeckCardMeta(scryfallId);
    if (!meta) return null;
    const def = tryGetDefinition(meta.cardId);
    if (!def) return null;
    return {
        cardId: meta.cardId,
        colors: getCardColorIdentity(def),
        manaValue: manaValue(def.manaCost),
        rarity: meta.rarity,
        pips: getPipCountsFromCost(def.manaCost),
        producedColors: [...getDefinitionProducibleColors(def)],
    };
};

const getAutoBuildCardMeta = (scryfallId: string) => {
    const meta = resolveDeckCardMeta(scryfallId);
    if (!meta) return null;
    const def = tryGetDefinition(meta.cardId);
    if (!def) return null;
    return {
        cardId: meta.cardId,
        colors: getCardColorIdentity(def),
        manaValue: manaValue(def.manaCost),
        rarity: meta.rarity,
        isLand: def.types.includes("Land"),
        isBasicLand: def.supertypes?.includes("Basic") === true,
        pips: getPipCountsFromCost(def.manaCost),
        producedColors: [...getDefinitionProducibleColors(def)],
    };
};

function resolveBasicLandFor(setCode: string): ResolveBasicLand {
    return (color: Color) => {
        const name = basicLandsForColors([color])[0];
        const def = getCardByName(name);
        const printing = getPrintingsForCard(def.id).find(
            (p) => p.setCode === setCode
        );
        return { cardId: printing?.printId ?? def.id, cardName: name };
    };
}

// ── A real event row, and the exact value the queries return for it ─────────

/** The state `startLimitedEvent` leaves behind for an 8-seat LEA Sealed event
 *  with one human (seat 0) and seven bots — real Pools off the checked-in
 *  Booster Config. */
function startedEvent(): LimitedEventRow {
    const packSlots = ["lea"];
    const seats = generateSealedPools(
        fillBotSeats(assignFreeSeat(buildEmptySeats(8), "user1", "Alice")),
        packSlots,
        6,
        getRuntimeBoosterConfig,
        resolveCardMeta,
        makeRng(1644)
    );
    return {
        _id: "event-1644",
        createdBy: "user1",
        type: "sealed",
        status: "started",
        seatCount: 8,
        packSlots,
        sealedBoosterCount: 6,
        matchFormat: "bo3",
        seats,
        createdAt: 0,
        updatedAt: 0,
    };
}

/** Same event, with the viewer's seat carrying a Pool Arrangement in BOTH
 *  storage shapes (issue #1621): a legacy `column` entry an in-flight event
 *  still holds, an entry the current write path emits (`pins`), and one
 *  carrying both. `poolArrangement` is projected verbatim to its own seat's
 *  viewer, so every one of those shapes crosses the return boundary — the
 *  `pins` field had to be declared on `poolArrangementEntryValidator` in the
 *  same change that started writing it, or every Limited query would 500. */
function arrangedEvent(): LimitedEventRow {
    const event = startedEvent();
    const seats = [...event.seats];
    // The `pins` entries come from the REAL write path, so a change to the
    // emitted shape is caught here rather than shipping past the validator.
    let arrangement = upsertPoolArrangementEntry(
        [{ poolIndex: 0, column: 5 }],
        {
            poolIndex: 1,
            column: "lands",
        }
    );
    arrangement = upsertPoolArrangementEntry(arrangement, {
        poolIndex: 2,
        sideboard: true,
    });
    arrangement = [
        ...arrangement,
        { poolIndex: 3, column: 2, pins: { color: "color:R" } },
    ];
    seats[0] = { ...seats[0], poolArrangement: arrangement };
    return { ...event, seats };
}

/** Same event, but with the play phase open — `openPlayPhaseIfReady`'s pure
 *  core, so `currentRound`/`rounds`/`standings`/`viewerPairing` are all
 *  populated with real values rather than their empty defaults. */
function playingEvent(): LimitedEventRow {
    const event = startedEvent();
    const eventContext = {
        type: event.type,
        status: event.status,
        draftCompletedAt: event.draftCompletedAt,
    };
    const resolveBasicLand = resolveBasicLandFor(event.packSlots[0]);
    const cache = new Map<number, DeckStrength>();
    const seatStrength: ResolveSeatStrength = (seatIndex) => {
        const cached = cache.get(seatIndex);
        if (cached) return cached;
        const seat = event.seats.find((s) => s.seatIndex === seatIndex);
        const deck = seat
            ? computeBotAutoBuiltDeck(
                  seat,
                  eventContext,
                  getAutoBuildCardMeta,
                  resolveBasicLand
              )
            : null;
        const strength = evaluateDeckStrength(
            deck?.cards ?? [],
            getCardEvalMeta
        );
        cache.set(seatIndex, strength);
        return strength;
    };
    const round = openRound({
        eventId: event._id,
        roundNumber: 1,
        seats: event.seats,
        previousRounds: [],
        matchFormat: resolveMatchFormat(event.matchFormat),
        startedAt: 1_700_000_000_000,
        roundDeadlineMinutes: event.roundDeadlineMinutes,
        seatStrength,
    });
    return {
        ...event,
        status: "playing",
        currentRound: 1,
        rounds: [round],
    };
}

/** `playingEvent()` with the VIEWER's own pairing (seat 0) rewritten.
 *
 *  Every other fixture leaves seat 0's pairing UNDECIDED, so inside
 *  `viewerPairingValidator`'s object branch only the `null` side of
 *  `result`/`gameWins`/`gameLosses`/`outcome` and `isBye: false` was ever
 *  walked — a wrong TYPE on those, or a too-narrow `outcome` literal union,
 *  would have passed. These two fixtures walk the populated side. */
function playingEventWithViewerPairing(
    rewrite: (pairing: LimitedPairing) => LimitedPairing
): LimitedEventRow {
    const event = playingEvent();
    const round = event.rounds![0];
    return {
        ...event,
        rounds: [
            {
                ...round,
                pairings: round.pairings.map((p) =>
                    p.seatA === 0 || p.seatB === 0 ? rewrite(p) : p
                ),
            },
        ],
    };
}

/** Viewer's pairing PLAYED to a decision — populates `result`, `gameWins`,
 *  `gameLosses` and an `outcome` literal. */
const decidedViewerPairingEvent = (): LimitedEventRow =>
    playingEventWithViewerPairing((p) => ({
        // Normalised so the viewer is `seatA` — the seat-A-relative flip in
        // `projectViewerPairing` then makes the expected values unambiguous.
        seatA: 0,
        seatB: p.seatA === 0 ? p.seatB : p.seatA,
        result: { winsA: 2, winsB: 1, source: "played" },
    }));

/** Viewer holds the BYE — the one-sided shape (`opponentSeatIndex`/
 *  `opponentNickname` null, `isBye: true`, `outcome: "win"`). */
const byeViewerPairingEvent = (): LimitedEventRow =>
    playingEventWithViewerPairing(() => ({
        seatA: 0,
        result: { winsA: 2, winsB: 0, source: "bye" },
    }));

/** Two pending challenge Games in the event: one addressed TO the viewer
 *  (`incoming`) and one the viewer sent (`outgoing`), so BOTH viewer-scoped
 *  challenge fields are non-empty for the validator case below. An empty list
 *  is the blind spot that let `matchId` (issue #1645 review) be added to
 *  `ViewerIncomingChallenge` without the validator noticing. */
const pendingChallenges = (): ChallengeGame[] => [
    {
        gameId: "g-in",
        matchId: "m-in",
        challengerUserId: "user2",
        challengerSeatIndex: 1,
        challengedUserId: "user1",
        challengedSeatIndex: 0,
    },
    {
        gameId: "g-out",
        matchId: "m-out",
        challengerUserId: "user1",
        challengerSeatIndex: 0,
        challengedUserId: "user3",
        challengedSeatIndex: 2,
    },
];

/** `projectEventForViewer`'s composition, minus its three DB reads — the value
 *  the three queries actually hand to Convex's return validation: the pure
 *  projection, plus the query shell's `autoBuiltDeck`/`deckSummary` zip and its
 *  viewer-scoped challenge fields. */
function queryReturnValue(
    event: LimitedEventRow,
    viewerUserId: string | null,
    isAdmin = false,
    challenges: ChallengeGame[] = []
): unknown {
    const eventContext = {
        type: event.type,
        status: event.status,
        draftCompletedAt: event.draftCompletedAt,
    };
    const completion = computeEventCompletion(
        event.seats,
        eventContext,
        () => true
    );
    const base = projectLimitedEvent(
        event,
        viewerUserId,
        completion.completed,
        completion.seatsWithDeck,
        new Map(),
        completion.hasDeckBySeat,
        isAdmin
    );
    const resolveBasicLand = resolveBasicLandFor(event.packSlots[0]);
    const viewerChallenges = projectViewerChallenges(challenges, viewerUserId);
    return {
        ...base,
        seats: base.seats.map((seatView, i) => {
            const autoBuiltDeck = computeBotAutoBuiltDeck(
                event.seats[i],
                eventContext,
                getAutoBuildCardMeta,
                resolveBasicLand
            );
            return {
                ...seatView,
                autoBuiltDeck,
                deckSummary:
                    seatView.deckSummary ??
                    (autoBuiltDeck
                        ? {
                              colors: autoBuiltDeck.colors,
                              maindeckCount: autoBuiltDeck.cards.length,
                              sideboardCount: autoBuiltDeck.sideboard.length,
                          }
                        : null),
            };
        }),
        // Through the REAL reducer, so a field the projection adds and the
        // validator doesn't declare fails here exactly as it fails in
        // production (issue #1645 review added `matchId` this way). An EMPTY
        // challenge list can never catch that — hence the populated case below.
        viewerIncomingChallenges: viewerChallenges.incoming,
        viewerOutgoingChallenge: viewerChallenges.outgoing,
    };
}

describe("limitedEventViewValidator accepts what the queries actually return (issue #1644)", () => {
    // `listOpenLimitedEvents` reads with no viewer; `myLimitedEvents` and
    // `getLimitedEvent` read as a seated user (and, for #1583, as an admin).
    // All three pin the SAME `returns:` validator, so one rejected field breaks
    // all three — hence all three viewer shapes are covered here.
    const cases: [string, () => unknown][] = [
        [
            "listOpenLimitedEvents (no viewer), before the play phase",
            () => queryReturnValue(startedEvent(), null),
        ],
        [
            "myLimitedEvents (seated viewer), before the play phase",
            () => queryReturnValue(startedEvent(), "user1"),
        ],
        [
            "getLimitedEvent (seated viewer), play phase open",
            () => queryReturnValue(playingEvent(), "user1"),
        ],
        [
            "getLimitedEvent (admin viewer), play phase open",
            () => queryReturnValue(playingEvent(), "user1", true),
        ],
        [
            "getLimitedEvent (non-seated viewer), play phase open",
            () => queryReturnValue(playingEvent(), "someone-else"),
        ],
        [
            "getLimitedEvent (seated viewer), viewer's pairing DECIDED",
            () => queryReturnValue(decidedViewerPairingEvent(), "user1"),
        ],
        [
            "getLimitedEvent (seated viewer), viewer holds the BYE",
            () => queryReturnValue(byeViewerPairingEvent(), "user1"),
        ],
        [
            "getLimitedEvent (own seat), Pool Arrangement in BOTH storage shapes",
            () => queryReturnValue(arrangedEvent(), "user1"),
        ],
        [
            "getLimitedEvent (seated viewer), pending challenges POPULATED",
            () =>
                queryReturnValue(
                    playingEvent(),
                    "user1",
                    false,
                    pendingChallenges()
                ),
        ],
    ];

    for (const [label, build] of cases) {
        it(`${label} passes return validation`, () => {
            expect(validationErrors(build(), viewValidatorJson)).toEqual([]);
        });
    }

    it("declares viewerPairing — the field #1644 added to the projection", () => {
        // Named explicitly so the regression reads as itself and not as a
        // generic "some field drifted".
        const fields = (
            viewValidatorJson as { value: Record<string, FieldJson> }
        ).value;
        expect(Object.keys(fields)).toContain("viewerPairing");
        expect(
            validationErrors(
                queryReturnValue(playingEvent(), "user1"),
                viewValidatorJson
            )
        ).toEqual([]);
    });

    it("the DECIDED and BYE fixtures really populate the nullable pairing fields", () => {
        // Guards the two fixtures above from silently degenerating back into
        // the undecided shape — which would make them duplicates of the other
        // cases and re-open the `null`-only blind spot they exist to close.
        const decided = (
            queryReturnValue(decidedViewerPairingEvent(), "user1") as {
                viewerPairing: Record<string, unknown>;
            }
        ).viewerPairing;
        expect(decided.isBye).toBe(false);
        expect(decided.result).toEqual({
            winsA: 2,
            winsB: 1,
            source: "played",
        });
        expect(decided.gameWins).toBe(2);
        expect(decided.gameLosses).toBe(1);
        expect(decided.outcome).toBe("win");

        const bye = (
            queryReturnValue(byeViewerPairingEvent(), "user1") as {
                viewerPairing: Record<string, unknown>;
            }
        ).viewerPairing;
        expect(bye.isBye).toBe(true);
        expect(bye.opponentSeatIndex).toBeNull();
        expect(bye.opponentNickname).toBeNull();
        expect(bye.outcome).toBe("win");
    });

    it("declares the incoming challenge's matchId — the field the #1645 review added", () => {
        // The populated case above is only worth anything if the fixture
        // really fills both challenge fields — assert that, then name the
        // field so the regression reads as itself.
        const value = queryReturnValue(
            playingEvent(),
            "user1",
            false,
            pendingChallenges()
        ) as {
            viewerIncomingChallenges: { matchId: string }[];
            viewerOutgoingChallenge: unknown;
        };
        expect(value.viewerIncomingChallenges).toEqual([
            { gameId: "g-in", matchId: "m-in", challengerSeatIndex: 1 },
        ]);
        expect(value.viewerOutgoingChallenge).not.toBeNull();
        expect(validationErrors(value, viewValidatorJson)).toEqual([]);
    });

    it("declares the Pool Arrangement's `pins` — the field #1621 started writing", () => {
        // The case above is only worth anything if the fixture really carries
        // a `pins` entry across the boundary; assert that, then name the field
        // so the regression reads as itself rather than as generic drift.
        const value = queryReturnValue(arrangedEvent(), "user1") as {
            seats: { seatIndex: number; poolArrangement: unknown }[];
        };
        const arrangement = value.seats.find((s) => s.seatIndex === 0)!
            .poolArrangement as Record<string, unknown>[];
        expect(arrangement.some((entry) => entry.pins !== undefined)).toBe(
            true
        );
        expect(arrangement.some((entry) => entry.column !== undefined)).toBe(
            true
        );
        expect(validationErrors(value, viewValidatorJson)).toEqual([]);
    });

    it("would REJECT a projection field the validator doesn't declare", () => {
        // Proves the check above has teeth: this is the exact shape of the
        // #1644 bug (and of #1666's `standings` before it).
        const withDrift = {
            ...(queryReturnValue(playingEvent(), "user1") as object),
            someFutureSliceField: 1,
        };
        expect(validationErrors(withDrift, viewValidatorJson)).toEqual([
            "<return>.someFutureSliceField: EXTRA field, absent from the returns validator",
        ]);
    });
});
