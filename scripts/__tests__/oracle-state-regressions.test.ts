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
    acknowledgementFromFlags,
    pruneStaleAcknowledgements,
    readyRegressions,
    regressionMessage,
    staleAcknowledgements,
    unacknowledgedRegressions,
    withAcknowledgement,
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
                trackedBy: 2699,
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
                '{"acknowledged": [{"oracleId": "id-x", "name": "X", "intended": true}]}'
            )
        ).toThrow(/has no `reason`/);
    });

    it("refuses a blank reason", () => {
        expect(() =>
            parseRegressionLedger(
                '{"acknowledged": [{"oracleId": "id-x", "name": "X", "reason": "   ", "intended": true}]}'
            )
        ).toThrow(/has no `reason`/);
    });

    const entry = (extra: string) =>
        `{"acknowledged": [{"oracleId": "id-x", "name": "X", "reason": "r"${extra}}]}`;

    it("refuses an entry naming neither `trackedBy` nor `intended`", () => {
        expect(() => parseRegressionLedger(entry(""))).toThrow(
            /carries neither/
        );
    });

    it("refuses an entry naming both dispositions", () => {
        expect(() =>
            parseRegressionLedger(entry(', "trackedBy": 12, "intended": true'))
        ).toThrow(/carries both/);
    });

    it("refuses a `trackedBy` that is not an issue number", () => {
        for (const bad of ['"#12"', "0", "1.5", "-3"])
            expect(() =>
                parseRegressionLedger(entry(`, "trackedBy": ${bad}`))
            ).toThrow(/positive issue number/);
    });

    it("refuses `intended: false`", () => {
        expect(() =>
            parseRegressionLedger(entry(', "intended": false'))
        ).toThrow(/other than `true`/);
    });

    it("accepts either disposition", () => {
        expect(
            parseRegressionLedger(entry(', "trackedBy": 6060')).acknowledged
        ).toHaveLength(1);
        expect(
            parseRegressionLedger(entry(', "intended": true')).acknowledged
        ).toHaveLength(1);
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

describe("pruneStaleAcknowledgements", () => {
    const acked = ledger([
        {
            oracleId: "id-port",
            name: "Rishadan Port",
            reason: "r",
            intended: true,
        },
        { oracleId: "id-smother", name: "Smother", reason: "r", trackedBy: 1 },
    ]);

    it("drops every entry when nothing regressed (base == tip after a landing)", () => {
        expect(pruneStaleAcknowledgements([], acked).acknowledged).toEqual([]);
    });

    it("keeps an entry still covering a live regression", () => {
        const regressions = readyRegressions(
            BASELINE,
            BASELINE.filter((r) => r.oracleId !== "id-port")
        );
        expect(
            pruneStaleAcknowledgements(regressions, acked).acknowledged.map(
                (a) => a.name
            )
        ).toEqual(["Rishadan Port"]);
    });
});

describe("withAcknowledgement", () => {
    it("replaces the entry of the same card instead of duplicating it", () => {
        const next = withAcknowledgement(
            ledger([
                { oracleId: "id-x", name: "X", reason: "old", intended: true },
            ]),
            { oracleId: "id-x", name: "X", reason: "new", trackedBy: 7 }
        );
        expect(next.acknowledged).toEqual([
            { oracleId: "id-x", name: "X", reason: "new", trackedBy: 7 },
        ]);
    });
});

describe("acknowledgementFromFlags (the oracle:mark-regressions writer)", () => {
    const ids = (name: string) =>
        name === "Smother" ? "id-smother" : undefined;
    const flags = (...rest: string[]) => [
        "--acknowledge",
        "Smother",
        "--reason",
        "why",
        ...rest,
    ];

    it("writes `trackedBy` from --tracked-by, `#` tolerated", () => {
        expect(
            acknowledgementFromFlags(flags("--tracked-by", "#6060"), ids)
        ).toEqual({
            oracleId: "id-smother",
            name: "Smother",
            reason: "why",
            trackedBy: 6060,
        });
    });

    it("writes `intended: true` from --intended", () => {
        expect(
            acknowledgementFromFlags(flags("--intended"), ids)
        ).toMatchObject({
            intended: true,
        });
    });

    it("refuses neither disposition, both, a bad number, an unknown card, no reason", () => {
        expect(acknowledgementFromFlags(flags(), ids)).toMatch(/exactly one/);
        expect(
            acknowledgementFromFlags(
                flags("--intended", "--tracked-by", "1"),
                ids
            )
        ).toMatch(/exactly one/);
        expect(
            acknowledgementFromFlags(flags("--tracked-by", "x"), ids)
        ).toMatch(/not an issue number/);
        expect(
            acknowledgementFromFlags(
                ["--acknowledge", "Nope", "--intended"],
                ids
            )
        ).toMatch(/no card named/);
        expect(
            acknowledgementFromFlags(
                ["--acknowledge", "Smother", "--intended"],
                ids
            )
        ).toMatch(/needs --reason/);
    });
});
