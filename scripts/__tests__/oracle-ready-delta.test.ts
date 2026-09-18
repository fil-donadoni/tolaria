// `oracle:report --delta` arithmetic (issue #3823).
import { describe, expect, it } from "vitest";
import type { CardRow } from "../lib/oracle-lockfile";
import { formatReadyDelta, readyDelta } from "../lib/oracle-ready-delta";

const row = (oracleId: string, state: CardRow["state"]): CardRow => ({
    oracleId,
    name: `card-${oracleId}`,
    state,
});

describe("readyDelta", () => {
    const before = [
        row("a", "ready"),
        row("b", "quarantine"),
        row("c", "quarantine"),
        row("d", "ready"),
    ];
    const after = [
        row("a", "ready"),
        row("b", "ready"),
        row("c", "quarantine"),
        row("d", "quarantine"),
    ];
    const sets = [
        { code: "AAA", oracleIds: new Set(["a", "b"]) },
        { code: "BBB", oracleIds: new Set(["c", "d"]) },
    ];

    it("counts gains and losses per set and across the corpus", () => {
        expect(readyDelta(before, after, sets)).toEqual([
            {
                scope: "AAA",
                before: 1,
                after: 2,
                gained: ["card-b"],
                lost: [],
            },
            {
                scope: "BBB",
                before: 1,
                after: 0,
                gained: [],
                lost: ["card-d"],
            },
            {
                scope: "corpus",
                before: 2,
                after: 2,
                gained: ["card-b"],
                lost: ["card-d"],
            },
        ]);
    });

    it("prints a signed delta per scope", () => {
        const text = formatReadyDelta(readyDelta(before, after, sets), "base");
        expect(text).toMatch(/^AAA\s+1\s+2\s+\+1\s+0$/m);
        expect(text).toMatch(/^BBB\s+1\s+0\s+-1\s+1$/m);
        expect(text).toMatch(/^corpus\s+2\s+2\s+0\s+1$/m);
    });
});
