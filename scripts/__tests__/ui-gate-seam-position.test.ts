// The declared-position deep link, the lane's half (issue #9272): the URL the
// walker asks a load through, and the record it reads back. The round trip is
// the one that matters — what `seamPositionPath` writes must reach
// `uiSeam.loadPosition` as the same label and guard after TanStack's own
// search parsing, which JSON-parses every value (a bare `12` arrives as a
// number and the seam's parameter filter drops it).
import { defaultParseSearch } from "@tanstack/router-core";
import { describe, expect, it } from "vitest";
import {
    pickUiSeamParams,
    UI_SEAM_DECK_NAME_PARAM,
    UI_SEAM_FIXTURE_PARAM,
    UI_SEAM_POSITION_PARAM,
    UI_SEAM_POSITION_PATH,
    UI_SEAM_UNLESS_AT_PARAM,
    uiSeamUrl,
} from "../../convex/lib/uiSeamNamespace";
import { readUiSeamPositionArgs } from "../../src/lib/uiSeam/ui-seam-position-args";
import {
    parsePositionRecord,
    seamPositionPath,
} from "../ui-gate/seam-position";

/** What the position page hands `loadPosition` for a URL the lane built. */
function argsReceivedFor(url: string) {
    const [path, query = ""] = url.split("?");
    const search = pickUiSeamParams(
        defaultParseSearch(`?${query}`) as Record<string, unknown>
    );
    return {
        path,
        args: readUiSeamPositionArgs(
            search[UI_SEAM_POSITION_PARAM],
            search[UI_SEAM_UNLESS_AT_PARAM]
        ),
    };
}

describe("seamPositionPath → the position page's args (issue #9272)", () => {
    it("asks a first load of a label with no guard", () => {
        expect(
            argsReceivedFor(seamPositionPath("ui-gate board", undefined))
        ).toEqual({
            path: UI_SEAM_POSITION_PATH,
            args: { label: "ui-gate board" },
        });
    });

    it("carries the previous load's game and seq when the label repeats", () => {
        const url = seamPositionPath("ui-gate board", {
            label: "ui-gate board",
            gameId: "k57abc123",
            seq: 12,
        });
        expect(argsReceivedFor(url).args).toEqual({
            label: "ui-gate board",
            unlessAt: { gameId: "k57abc123", seq: 12 },
        });
    });

    it("asks a plain load when the previous load was another label", () => {
        const url = seamPositionPath("ui-gate combat", {
            label: "ui-gate board",
            gameId: "k57abc123",
            seq: 12,
        });
        expect(argsReceivedFor(url).args).toEqual({ label: "ui-gate combat" });
    });

    it.each([
        ["a label JSON would read as a number", "12"],
        ["a label JSON would read as a boolean", "true"],
        ["a label with reserved URL characters", "a&b=c?d #e"],
    ])("survives %s", (_case, label) => {
        expect(
            argsReceivedFor(seamPositionPath(label, undefined)).args
        ).toEqual({ label });
    });
});

describe("uiSeamUrl (issue #9272)", () => {
    it("quotes every value so the router hands it back as the same string", () => {
        const url = uiSeamUrl("/__uiseam/limited-deck", {
            [UI_SEAM_FIXTURE_PARAM]: "ui-gate-draft-1",
            [UI_SEAM_DECK_NAME_PARAM]: "ui-gate archive deck",
        });
        const search = defaultParseSearch(`?${url.split("?")[1]}`);
        expect(pickUiSeamParams(search as Record<string, unknown>)).toEqual({
            [UI_SEAM_FIXTURE_PARAM]: "ui-gate-draft-1",
            [UI_SEAM_DECK_NAME_PARAM]: "ui-gate archive deck",
        });
    });

    it("is the bare path with no parameters", () => {
        expect(uiSeamUrl("/__uiseam/echo", {})).toBe("/__uiseam/echo");
    });
});

describe("parsePositionRecord (issue #9272)", () => {
    const record = { label: "L", gameId: "g1", seq: 4, loaded: true };

    it("reads back the page's record for the label it asked", () => {
        expect(parsePositionRecord(JSON.stringify(record), "L")).toEqual(
            record
        );
    });

    it.each([
        ["no record", null],
        ["unparsable text", "{not json"],
        ["another label's record", JSON.stringify({ ...record, label: "M" })],
        ["a fractional seq", JSON.stringify({ ...record, seq: 4.5 })],
        ["a missing game id", JSON.stringify({ ...record, gameId: undefined })],
        ["a missing loaded flag", JSON.stringify({ ...record, loaded: "yes" })],
    ])("is undefined for %s — the next load is then a plain one", (_c, raw) => {
        expect(parsePositionRecord(raw, "L")).toBeUndefined();
    });
});
