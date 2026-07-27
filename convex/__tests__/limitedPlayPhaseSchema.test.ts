// Play-phase SCHEMA guard (PRD #1628, ADR 0076, issue #1640).
//
// The project has no convex-test harness, so a document can't be written and
// read back through a real deployment here. What CAN be asserted — and is what
// the "round-trips without loss" acceptance criterion actually protects — is
// that the stored shape and the pure domain type agree FIELD FOR FIELD in both
// directions: a field the type has and the schema lacks is dropped on write; a
// field the schema has and the type lacks is invisible to every reader. Both
// are silent, so both are pinned here.
//
// The assertions run against `schema.tables.*.validator.json`, the same
// description Convex itself validates documents with — not a hand-copied list.
import { describe, it, expect } from "vitest";
import schema from "../schema";
import { LIMITED_EVENT_STATUSES } from "../limited/eventStatus";
import { LIMITED_MATCH_FORMATS } from "../limited/matchFormat";
import type {
    LimitedPairing,
    LimitedPairingResult,
    LimitedRound,
} from "../limited/eventTypes";

/** One field of an object validator, as Convex describes it. */
interface FieldJson {
    fieldType: ValidatorJson;
    optional: boolean;
}
type ValidatorJson =
    | { type: "object"; value: Record<string, FieldJson> }
    | { type: "array"; value: ValidatorJson }
    | { type: "union"; value: ValidatorJson[] }
    | { type: "literal"; value: unknown }
    | { type: string; value?: unknown };

/** `.json` is how Convex itself describes a validator, but it is not part of
 *  every validator variant's PUBLIC type — hence the one narrowing cast, made
 *  here and nowhere else. */
function validatorJson(table: keyof typeof schema.tables): ValidatorJson {
    return (
        schema.tables[table].validator as unknown as { json: ValidatorJson }
    ).json;
}

function objectFields(json: ValidatorJson): Record<string, FieldJson> {
    if (json.type !== "object") throw new Error("not an object validator");
    return json.value as Record<string, FieldJson>;
}

function tableFields(
    table: keyof typeof schema.tables
): Record<string, FieldJson> {
    return objectFields(validatorJson(table));
}

function arrayElement(json: ValidatorJson): ValidatorJson {
    if (json.type !== "array") throw new Error("not an array validator");
    return json.value as ValidatorJson;
}

function literalMembers(json: ValidatorJson): unknown[] {
    if (json.type !== "union") throw new Error("not a union validator");
    return (json.value as ValidatorJson[]).map((m) => {
        if (m.type !== "literal") throw new Error("not a literal member");
        return m.value;
    });
}

const eventFields = tableFields("limitedEvents");

describe("limitedEvents.status union (ADR 0076)", () => {
    it("declares exactly the four lifecycle statuses the domain module knows", () => {
        expect(literalMembers(eventFields.status.fieldType).sort()).toEqual(
            [...LIMITED_EVENT_STATUSES].sort()
        );
    });

    it("keeps status required (an event always has one)", () => {
        expect(eventFields.status.optional).toBe(false);
    });
});

describe("limitedEvents play-phase fields (PRD #1628, issue #1640)", () => {
    // Backward compatibility AC: an event created before the play phase
    // existed carries NONE of these, so every one must be optional or every
    // existing document instantly fails validation.
    it.each([
        "matchFormat",
        "roundDeadlineMinutes",
        "currentRound",
        "rounds",
    ])("declares %s as an OPTIONAL field (existing events keep working)", (f) => {
        expect(eventFields[f]).toBeDefined();
        expect(eventFields[f].optional).toBe(true);
    });

    it("declares matchFormat as exactly the formats the domain module offers", () => {
        expect(literalMembers(eventFields.matchFormat.fieldType).sort()).toEqual(
            [...LIMITED_MATCH_FORMATS].sort()
        );
    });
});

// Field-for-field agreement between the stored round shape and the pure
// `LimitedRound`/`LimitedPairing`/`LimitedPairingResult` types. The `satisfies`
// expressions below are the type half (they fail to COMPILE if the type gains
// a field this test doesn't know about); the key-set assertions are the schema
// half (they fail at RUNTIME if the schema gains or loses one).
describe("limitedEvents.rounds ↔ LimitedRound (round-trip, no field loss)", () => {
    const roundJson = arrayElement(eventFields.rounds.fieldType);
    const roundSchemaFields = objectFields(roundJson);
    const pairingJson = arrayElement(
        roundSchemaFields.pairings.fieldType
    );
    const pairingSchemaFields = objectFields(pairingJson);
    const resultSchemaFields = objectFields(
        pairingSchemaFields.result.fieldType
    );

    it("stores every LimitedRound field, and no field the type doesn't have", () => {
        const typed = {
            roundNumber: 1,
            startedAt: 0,
            deadlineAt: 1,
            pairings: [],
        } satisfies Required<LimitedRound>;
        expect(Object.keys(roundSchemaFields).sort()).toEqual(
            Object.keys(typed).sort()
        );
        // Optionality matches the type's own `?` markers.
        expect(roundSchemaFields.roundNumber.optional).toBe(false);
        expect(roundSchemaFields.startedAt.optional).toBe(false);
        expect(roundSchemaFields.pairings.optional).toBe(false);
        expect(roundSchemaFields.deadlineAt.optional).toBe(true);
    });

    it("stores every LimitedPairing field, and no field the type doesn't have", () => {
        const typed = {
            seatA: 0,
            seatB: 1,
            matchId: "m",
            result: { winsA: 0, winsB: 0, source: "played" },
        } satisfies Required<LimitedPairing>;
        expect(Object.keys(pairingSchemaFields).sort()).toEqual(
            Object.keys(typed).sort()
        );
        // A bye is `seatB` absent, an unplayed pairing `matchId`/`result`
        // absent — all three MUST be optional or a bye can't be stored.
        expect(pairingSchemaFields.seatA.optional).toBe(false);
        expect(pairingSchemaFields.seatB.optional).toBe(true);
        expect(pairingSchemaFields.matchId.optional).toBe(true);
        expect(pairingSchemaFields.result.optional).toBe(true);
    });

    it("stores every LimitedPairingResult field, source included and required", () => {
        const typed = {
            winsA: 2,
            winsB: 0,
            source: "simulated",
        } satisfies Required<LimitedPairingResult>;
        expect(Object.keys(resultSchemaFields).sort()).toEqual(
            Object.keys(typed).sort()
        );
        // `source` is required, not decorative (PRD #1628): the standings UI
        // needs it to explain an awarded win.
        expect(resultSchemaFields.source.optional).toBe(false);
        expect(literalMembers(resultSchemaFields.source.fieldType).sort()).toEqual(
            ["bye", "played", "simulated", "timeout"]
        );
    });
});

// `limitedPairing` on matches/games: the back-reference that lets a finished
// Match find its pairing without scanning the event's rounds.
describe("matches/games.limitedPairing (PRD #1628, issue #1640)", () => {
    it.each(["matches", "games"] as const)(
        "declares an optional { round, seatA, seatB } on %s",
        (table) => {
            const field = tableFields(table).limitedPairing;
            expect(field).toBeDefined();
            // Optional: every non-event Match (and every free event challenge)
            // has none.
            expect(field.optional).toBe(true);
            const fields = objectFields(field.fieldType);
            expect(Object.keys(fields).sort()).toEqual([
                "round",
                "seatA",
                "seatB",
            ]);
            for (const key of Object.keys(fields)) {
                expect(fields[key].optional).toBe(false);
            }
        }
    );

    it("keeps limitedPairing alongside the existing limitedEventId binding", () => {
        // The pairing is meaningless without the event it belongs to — both
        // fields ship together on both tables (issue #1577 + #1640).
        for (const table of ["matches", "games"] as const) {
            const fields = tableFields(table);
            expect(fields.limitedEventId).toBeDefined();
            expect(fields.limitedPairing).toBeDefined();
        }
    });
});
