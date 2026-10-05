// Name-a-card validation over the packed corpus (issue #4166, PRD #4161):
// CR 201.3 — a named card must exist. The server answers that from the
// Definition Index's name index, so validating a name opens no packed block;
// only a restriction that reads the card's characteristics (CR 201.4a) builds
// the one named definition.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as literalSubmit from "../gre/pendingChoiceSubmit";
import { compiledReadyDefinitions } from "../cards/compiledPool";
import type { PendingChoice } from "../gre/state";

type SubmitModule = typeof literalSubmit;
type CardsModule = typeof import("../cards");

let packedSubmit: SubmitModule;
let packedCards: CardsModule;

beforeAll(async () => {
    vi.stubEnv("TOLARIA_PACKED_CORPUS_LOOKUP", "on");
    vi.resetModules();
    try {
        packedCards = (await import("../cards")) as CardsModule;
        packedSubmit =
            (await import("../gre/pendingChoiceSubmit")) as SubmitModule;
    } finally {
        vi.unstubAllEnvs();
        vi.resetModules();
    }
}, 120_000);

afterAll(() => {
    vi.resetModules();
});

const head = (nameRestriction?: PendingChoice["nameRestriction"]) =>
    ({
        kind: "name-card",
        playerId: "p1",
        stackItemId: "s1",
        nameRestriction,
    }) as PendingChoice;

const STATE = { stagedEntries: undefined };
const COMPILED = compiledReadyDefinitions[0]!.name;

describe("name-a-card validation, packed-corpus switch on (issue #4166)", () => {
    it("resolves a compiled card's name and a bogus one without opening a block", () => {
        expect(packedCards.packedCorpusInflations()).toBe(0);
        expect(
            packedSubmit.isLegalNamedCard(STATE, head(), COMPILED.toLowerCase())
        ).toBe(true);
        expect(
            packedSubmit.isLegalNamedCard(STATE, head(), "Not A Real Card")
        ).toBe(false);
        expect(packedCards.packedCorpusInflations()).toBe(0);
    });

    it("agrees with the literal path on lookup-only and twin names", () => {
        for (const name of [
            COMPILED,
            "Forest",
            "Wax // Wane",
            "Wax",
            "Wane",
            "Petty Theft",
            "nothing here",
        ]) {
            expect(packedSubmit.isLegalNamedCard(STATE, head(), name)).toBe(
                literalSubmit.isLegalNamedCard(STATE, head(), name)
            );
        }
        expect(
            literalSubmit.isLegalNamedCard(STATE, head(), "Wax // Wane")
        ).toBe(false);
    });

    it("still applies a characteristic restriction, building only the named card", () => {
        const before = packedCards.packedCorpusInflations();
        expect(
            packedSubmit.isLegalNamedCard(STATE, head("no-land"), "Forest")
        ).toBe(false);
        expect(
            packedSubmit.isLegalNamedCard(STATE, head("no-land"), COMPILED)
        ).toBe(true);
        expect(
            packedCards.packedCorpusInflations() - before
        ).toBeLessThanOrEqual(1);
    });
});
