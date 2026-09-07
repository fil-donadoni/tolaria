/**
 * The lockfile state-regression guard (issue #2696).
 *
 * Fixtures, not the real lockfile. The guard's whole job is to fire when a card
 * leaves the `ready` pool, and on the tree we happen to have, no card is
 * leaving — so a test that ran against `data/oracle-compiled.json` would be
 * green for the same reason a deleted guard is green. Two hand-built card
 * arrays are the only way to watch it work.
 */

import { describe, it, expect } from "vitest";
import type { CardRow } from "../lib/oracle-lockfile";
import {
    parseRegressionLedger,
    readyRegressions,
    regressionMessage,
    staleAcknowledgements,
    unacknowledgedRegressions,
    type RegressionLedger,
} from "../lib/oracle-state-regressions";

function row(oracleId: string, name: string, state: CardRow["state"]): CardRow {
    return { oracleId, name, state };
}

const BASELINE: CardRow[] = [
    row("id-smother", "Smother", "ready"),
    row("id-warchief", "Goblin Warchief", "ready"),
    row("id-port", "Rishadan Port", "ready"),
    row("id-tog", "Psychatog", "quarantine"),
    row("id-echoes", "Haunting Echoes", "unparsed"),
];

const ledger = (
    entries: RegressionLedger["acknowledged"]
): RegressionLedger => ({ acknowledged: entries });

describe("readyRegressions", () => {
    it("is empty when nothing left the ready pool", () => {
        expect(readyRegressions(BASELINE, BASELINE)).toEqual([]);
    });

    it("reports a ready card that fell to unparsed", () => {
        const current = BASELINE.map((r) =>
            r.oracleId === "id-warchief"
                ? row(r.oracleId, r.name, "unparsed")
                : r
        );
        expect(readyRegressions(BASELINE, current)).toEqual([
            {
                oracleId: "id-warchief",
                name: "Goblin Warchief",
                to: "unparsed",
            },
        ]);
    });

    it("reports a ready card that fell to quarantine", () => {
        const current = BASELINE.map((r) =>
            r.oracleId === "id-smother"
                ? row(r.oracleId, r.name, "quarantine")
                : r
        );
        expect(readyRegressions(BASELINE, current)).toEqual([
            { oracleId: "id-smother", name: "Smother", to: "quarantine" },
        ]);
    });

    it("reports a ready card whose row disappeared as `absent`", () => {
        const current = BASELINE.filter((r) => r.oracleId !== "id-port");
        expect(readyRegressions(BASELINE, current)).toEqual([
            { oracleId: "id-port", name: "Rishadan Port", to: "absent" },
        ]);
    });

    it("ignores movement INTO ready, and movement below it", () => {
        const current = [
            row("id-smother", "Smother", "ready"),
            row("id-warchief", "Goblin Warchief", "ready"),
            row("id-port", "Rishadan Port", "ready"),
            // quarantine -> ready is the point of the project.
            row("id-tog", "Psychatog", "ready"),
            // unparsed -> quarantine is a grammar detail, not a pool loss.
            row("id-echoes", "Haunting Echoes", "quarantine"),
        ];
        expect(readyRegressions(BASELINE, current)).toEqual([]);
    });

    it("sorts by name, so a multi-card loss reads as a list", () => {
        const current = BASELINE.map((r) =>
            r.state === "ready" ? row(r.oracleId, r.name, "unparsed") : r
        );
        expect(readyRegressions(BASELINE, current).map((r) => r.name)).toEqual([
            "Goblin Warchief",
            "Rishadan Port",
            "Smother",
        ]);
    });
});

describe("unacknowledgedRegressions", () => {
    const current = BASELINE.map((r) =>
        r.oracleId === "id-smother" ? row(r.oracleId, r.name, "unparsed") : r
    );
    const regressions = readyRegressions(BASELINE, current);

    it("passes a regression through when the ledger is empty", () => {
        expect(
            unacknowledgedRegressions(regressions, ledger([])).map(
                (r) => r.name
            )
        ).toEqual(["Smother"]);
    });

    it("suppresses the one the ledger acknowledges", () => {
        const acked = ledger([
            {
                oracleId: "id-smother",
                name: "Smother",
                reason: "the destroy-with-no-regeneration clause moved behind a slot rewrite",
                issue: "#2699",
            },
        ]);
        expect(unacknowledgedRegressions(regressions, acked)).toEqual([]);
    });

    it("does not let an acknowledgement of a DIFFERENT card cover this one", () => {
        const acked = ledger([
            { oracleId: "id-port", name: "Rishadan Port", reason: "unrelated" },
        ]);
        expect(
            unacknowledgedRegressions(regressions, acked).map((r) => r.name)
        ).toEqual(["Smother"]);
    });
});

describe("staleAcknowledgements", () => {
    it("names an entry matching no live regression", () => {
        const acked = ledger([
            { oracleId: "id-port", name: "Rishadan Port", reason: "landed" },
        ]);
        expect(staleAcknowledgements([], acked).map((a) => a.name)).toEqual([
            "Rishadan Port",
        ]);
    });

    it("does not name an entry that is still covering a regression", () => {
        const regressions = readyRegressions(
            BASELINE,
            BASELINE.filter((r) => r.oracleId !== "id-port")
        );
        const acked = ledger([
            { oracleId: "id-port", name: "Rishadan Port", reason: "landed" },
        ]);
        expect(staleAcknowledgements(regressions, acked)).toEqual([]);
    });
});

describe("parseRegressionLedger", () => {
    it("accepts the committed empty ledger's shape", () => {
        expect(
            parseRegressionLedger('{"acknowledged": []}').acknowledged
        ).toEqual([]);
    });

    it("refuses an entry with no reason — an id alone explains nothing", () => {
        expect(() =>
            parseRegressionLedger(
                '{"acknowledged": [{"oracleId": "id-x", "name": "X"}]}'
            )
        ).toThrow(/has no `reason`/);
    });

    it("refuses a blank reason", () => {
        expect(() =>
            parseRegressionLedger(
                '{"acknowledged": [{"oracleId": "id-x", "name": "X", "reason": "   "}]}'
            )
        ).toThrow(/has no `reason`/);
    });

    it("refuses a document with no `acknowledged` array", () => {
        expect(() => parseRegressionLedger("{}")).toThrow(
            /`acknowledged` must be an array/
        );
    });
});

describe("regressionMessage", () => {
    it("names every lost card and its destination state", () => {
        const message = regressionMessage([
            { oracleId: "id-smother", name: "Smother", to: "unparsed" },
            { oracleId: "id-port", name: "Rishadan Port", to: "absent" },
        ]);
        expect(message).toContain("Smother (id-smother) ready -> unparsed");
        expect(message).toContain("Rishadan Port (id-port) ready -> absent");
        expect(message).toContain("data/oracle-state-regressions.json");
    });
});
