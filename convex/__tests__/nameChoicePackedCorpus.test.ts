// Name-a-card validation over the packed corpus (issue #4166, PRD #4161):
// A named card must exist. The server answers that from the
// Definition Index's name index, so validating a name opens no packed block;
// only a restriction that reads the card's characteristics (CR 201.4a) builds
// the one named definition.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as SubmitIndex from "../gre/pendingChoiceSubmit";
import { packedServerCorpus } from "../cards/compiledPool";
import type { PendingChoice } from "../gre/state";

type SubmitModule = typeof SubmitIndex;
type CardsModule = typeof import("../cards");

let packedSubmit: SubmitModule;
let packedCards: CardsModule;

// A fresh graph: its block memo starts empty, whatever an earlier file in this
// worker (`isolate: false`) resolved — exactly a cold Convex request.
beforeAll(async () => {
    vi.resetModules();
    try {
        packedCards = (await import("../cards")) as CardsModule;
        packedSubmit =
            (await import("../gre/pendingChoiceSubmit")) as SubmitModule;
    } finally {
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
const COMPILED = packedServerCorpus!.names[0]!;

describe("name-a-card validation over the packed corpus (issue #4166)", () => {
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

    it("answers lookup-only and twin names from the index", () => {
        // A split card is named by one half, never by its combined name; an
        // adventure's spell half is a name of its own.
        const expected: [string, boolean][] = [
            [COMPILED, true],
            ["Forest", true],
            ["Wax // Wane", false],
            ["Wax", true],
            ["Wane", true],
            ["Petty Theft", true],
            ["nothing here", false],
        ];
        for (const [name, legal] of expected) {
            expect([
                name,
                packedSubmit.isLegalNamedCard(STATE, head(), name),
            ]).toEqual([name, legal]);
        }
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
