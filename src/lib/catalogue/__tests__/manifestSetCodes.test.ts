import { describe, it, expect, vi } from "vitest";

vi.mock("../definitionShards", () => ({
    isKnownSetCode: (code: string) => ["lea", "arn"].includes(code),
}));

const { manifestSetCodes } = await import("../manifestSetCodes");

/** The Sets a seat's Manifest rows ask for (issue #5615): deduped, in row
 *  order, unknown codes dropped — the Manifest's `setCode` is a hint. */
describe("manifestSetCodes", () => {
    const e = (setCode: string) => ({ definitionId: `${setCode}-x`, setCode });

    it("unions the rows, each code once, in first-seen order", () => {
        expect(
            manifestSetCodes([
                { playerId: "p1", entries: [e("arn"), e("lea"), e("arn")] },
                { playerId: "p2", entries: [e("lea")] },
            ])
        ).toEqual(["arn", "lea"]);
    });

    it("drops a code this client's index does not know, and skips null and loading rows", () => {
        expect(
            manifestSetCodes([
                null,
                undefined,
                { playerId: "p1", entries: [e("zzz"), e("lea")] },
            ])
        ).toEqual(["lea"]);
    });
});
