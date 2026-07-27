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
import { evaluateDeckStrength, type DeckStrength } from "../limited/matchSim";
import { getRuntimeBoosterConfig } from "../limited/registry";
import { openRound, type ResolveSeatStrength } from "../limited/rounds";
import type { GetCardEvalMeta } from "../limited/botDrafter";
import type { Color } from "../cards/types";

// ── Convex's own validator description, and a checker for it ────────────────

interface FieldJson {
    fieldType: ValidatorJson;
    optional: boolean;
}
type ValidatorJson =
    | { type: "object"; value: Record<string, FieldJson> }
    | { type: "array"; value: ValidatorJson }
    | { type: "union"; value: ValidatorJson[] }
    | { type: "record"; keys: ValidatorJson; values: FieldJson }
    | { type: "literal"; value: unknown }
    | { type: string; value?: unknown };

/** `.json` is how Convex itself describes a validator, but it is not on every
 *  variant's PUBLIC type — hence the one narrowing cast, made here and nowhere
 *  else (same shape as `limitedPlayPhaseSchema.test.ts`'s). */
const viewValidatorJson = (
    limitedEventViewValidator as unknown as { json: ValidatorJson }
).json;

/** Validates `value` against Convex's `ValidatorJson`, returning the list of
 *  violations (empty = the boundary would accept it). Mirrors the server's
 *  semantics for the node types this wire shape actually uses: an object is
 *  STRICT (an undeclared field is a violation — the exact failure `standings`
 *  and `viewerPairing` each caused), a non-optional field must be present and
 *  not `undefined`, and a union needs one member to accept. */
function validationErrors(
    value: unknown,
    validator: ValidatorJson,
    path = "<return>"
): string[] {
    switch (validator.type) {
        case "any":
            return [];
        case "null":
            return value === null ? [] : [`${path}: expected null`];
        case "number":
            return typeof value === "number"
                ? []
                : [`${path}: expected number`];
        case "bigint":
            return typeof value === "bigint"
                ? []
                : [`${path}: expected bigint`];
        case "boolean":
            return typeof value === "boolean"
                ? []
                : [`${path}: expected boolean`];
        case "string":
        case "id":
            return typeof value === "string"
                ? []
                : [`${path}: expected string`];
        case "literal":
            return value === (validator as { value: unknown }).value
                ? []
                : [
                      `${path}: expected literal ${JSON.stringify(
                          (validator as { value: unknown }).value
                      )}`,
                  ];
        case "array": {
            if (!Array.isArray(value)) return [`${path}: expected array`];
            const element = (validator as { value: ValidatorJson }).value;
            return value.flatMap((entry, i) =>
                validationErrors(entry, element, `${path}[${i}]`)
            );
        }
        case "union": {
            const members = (validator as { value: ValidatorJson[] }).value;
            const accepted = members.some(
                (member) => validationErrors(value, member, path).length === 0
            );
            return accepted
                ? []
                : [
                      `${path}: matched no union member (${members
                          .map((m) => m.type)
                          .join(" | ")})`,
                  ];
        }
        case "object": {
            if (typeof value !== "object" || value === null)
                return [`${path}: expected object`];
            const fields = (validator as { value: Record<string, FieldJson> })
                .value;
            const errors: string[] = [];
            for (const key of Object.keys(value as Record<string, unknown>)) {
                if (!(key in fields)) {
                    errors.push(
                        `${path}.${key}: EXTRA field, absent from the returns validator`
                    );
                }
            }
            for (const [key, field] of Object.entries(fields)) {
                const entry = (value as Record<string, unknown>)[key];
                if (entry === undefined) {
                    if (!field.optional) {
                        errors.push(`${path}.${key}: MISSING required field`);
                    }
                    continue;
                }
                errors.push(
                    ...validationErrors(
                        entry,
                        field.fieldType,
                        `${path}.${key}`
                    )
                );
            }
            return errors;
        }
        default:
            return [`${path}: unhandled validator node "${validator.type}"`];
    }
}

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
