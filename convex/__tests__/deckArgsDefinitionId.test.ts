// Every game-start mutation takes a DECK straight from the client, and since
// Card Prints (ADR 0140, issue #4117) every deck card the deck builder saves
// carries `definitionId`. Convex validates arguments at the function boundary
// BEFORE the handler runs, so an args validator that does not name the field
// rejects the whole mutation — `createSoloGame` failed exactly this way in
// `check:ui`, with
//
//   ArgumentValidationError: Object contains extra field `definitionId` that
//   is not in the validator. Path: .deck.cards[0]
//
// and no test saw it: `tsc` is happy (the TS type is structural), and every
// hand-written fixture in the suite builds a deck WITHOUT the field, so the
// suite only ever exercised the shape that already worked.
//
// The project has no convex-test harness, so a mutation cannot be invoked
// through a deployment here. This file uses the idiom
// `debugSetupScenarioArgsLockStep.test.ts` established for exactly this class:
// walk the validator's OWN `.json` description — the exact thing Convex
// validates against — via `exportArgs()`, which is plain JS with no backend.
// A hand-copied list of expected fields would just be the same mistake twice.
import { describe, it, expect } from "vitest";
import { createGame, createSoloGame, joinGame } from "../game";
import {
    validationErrors,
    type FieldJson,
    type ValidatorJson,
} from "./fixtures/validatorWalk";

type ExportsArgs = { exportArgs: () => string };

const argsJsonOf = (fn: unknown) =>
    JSON.parse((fn as ExportsArgs).exportArgs());

/** A deck exactly as the deck builder saves it and the lobby hands it on:
 *  `cardId` is the chosen PRINTING, `definitionId` the card's identity. */
const deckWithDefinitionIds = {
    id: "deck-1",
    name: "Test deck",
    format: "freeform",
    cards: [
        {
            cardId: "print-1",
            cardName: "Cavern Harpy",
            definitionId: "cavern-harpy",
        },
    ],
    sideboard: [
        {
            cardId: "print-2",
            cardName: "Lightning Bolt",
            definitionId: "lightning-bolt",
        },
    ],
};

/** The same deck as saved BEFORE this slice — the field is optional, so every
 *  caller that predates it must keep validating. */
const deckWithout = {
    ...deckWithDefinitionIds,
    cards: [{ cardId: "print-1", cardName: "Cavern Harpy" }],
    sideboard: [{ cardId: "print-2", cardName: "Lightning Bolt" }],
};

const MUTATIONS: readonly [string, unknown][] = [
    ["createSoloGame", createSoloGame],
    ["createGame", createGame],
    ["joinGame", joinGame],
];

describe("game-start args accept a deck carrying definitionId (issue #4117)", () => {
    for (const [name, fn] of MUTATIONS) {
        const argsJson = argsJsonOf(fn);
        const fields = (argsJson as { value: Record<string, FieldJson> }).value;

        // `{ deck }` alone, so the walk is about the deck shape and not about
        // whatever else each mutation happens to require.
        const deckOnly: ValidatorJson = {
            type: "object",
            value: { deck: fields.deck },
        };

        it(`${name} declares definitionId on a Maindeck card`, () => {
            const deckObject = fields.deck.fieldType as Extract<
                ValidatorJson,
                { type: "object" }
            >;
            const cards = deckObject.value.cards.fieldType as Extract<
                ValidatorJson,
                { type: "array" }
            >;
            const card = cards.value as Extract<
                ValidatorJson,
                { type: "object" }
            >;
            expect(Object.keys(card.value)).toContain("definitionId");
            expect(card.value.definitionId.optional).toBe(true);
        });

        it(`${name} accepts the deck the builder actually saves`, () => {
            expect(
                validationErrors(
                    { deck: deckWithDefinitionIds },
                    deckOnly,
                    "<args>"
                )
            ).toEqual([]);
        });

        it(`${name} still accepts a deck saved before the field existed`, () => {
            expect(
                validationErrors({ deck: deckWithout }, deckOnly, "<args>")
            ).toEqual([]);
        });
    }
});
