// CR 701.23b / 701.23d — catalogue census of Library Search floors (issue
// #3437). Every genuine `search-library` choice that states a card quality is
// authored with a minimum of zero; a bare-quantity search keeps its exact count.
import { describe, expect, it } from "vitest";
import "../../../cards/catalogue";
import { registeredDefinitions } from "../../../cards/registry";
import { isChoiceCountRange } from "../../../cards/types";
import { statesCardQuality } from "../librarySearchFloor";

interface SearchSite {
    card: string;
    op: Record<string, unknown>;
}

function collectSearchOps(node: unknown, card: string, out: SearchSite[]) {
    if (Array.isArray(node)) {
        for (const child of node) collectSearchOps(child, card, out);
        return;
    }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (
        record.op === "choice" &&
        record.kind === "search-library" &&
        record.zone === "library"
    ) {
        out.push({ card, op: record });
    }
    for (const value of Object.values(record)) {
        collectSearchOps(value, card, out);
    }
}

const SITES: SearchSite[] = [];
for (const definition of registeredDefinitions()) {
    collectSearchOps(definition, definition.name, SITES);
}

function authoredMin(op: Record<string, unknown>): number {
    const count = op.count as Parameters<typeof isChoiceCountRange>[0];
    return isChoiceCountRange(count)
        ? count.min
        : typeof count === "number"
          ? count
          : 1;
}

describe("Library Search floors across the catalogue (CR 701.23b/d)", () => {
    it("a search that states a quality is authored with a minimum of zero", () => {
        const offenders = SITES.filter(
            ({ op }) =>
                statesCardQuality(op.filter as never) && authoredMin(op) > 0
        ).map(({ card, op }) => `${card}: min ${authoredMin(op)}`);
        // A census that scanned nothing would pass vacuously.
        expect(SITES.length).toBeGreaterThan(40);
        expect(offenders).toEqual([]);
    });
});
