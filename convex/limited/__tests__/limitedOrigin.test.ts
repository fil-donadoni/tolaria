// Limited Origin key + label (ADR 0106 §6, issue #5393): the canonical key a
// saved Limited deck carries, and the label derived from it.
import { describe, expect, it } from "vitest";
import {
    limitedOriginKey,
    limitedOriginLabel,
    parseLimitedOrigin,
} from "../limitedOrigin";

describe("limitedOriginKey", () => {
    it("keys a single-set draft once, whatever its pack count", () => {
        expect(
            limitedOriginKey({
                type: "draft",
                packSlots: ["lea", "lea", "lea"],
            })
        ).toBe("draft:lea");
    });

    it("keys a block sequence by its distinct sets in pack order", () => {
        expect(
            limitedOriginKey({
                type: "draft",
                packSlots: ["inv", "pls", "apc"],
            })
        ).toBe("draft:inv+pls+apc");
    });

    it("keys the cube as cube:<slug>, never as its Pack Source key", () => {
        expect(
            limitedOriginKey({
                type: "draft",
                packSlots: ["vintage-cube", "vintage-cube", "vintage-cube"],
            })
        ).toBe("draft:cube:vintage");
    });

    it("separates sealed from draft over the same set", () => {
        expect(limitedOriginKey({ type: "sealed", packSlots: ["lea"] })).toBe(
            "sealed:lea"
        );
        expect(limitedOriginKey({ type: "draft", packSlots: ["lea"] })).toBe(
            "draft:lea"
        );
    });

    it("lower-cases set codes so a typed code keys the same origin", () => {
        expect(limitedOriginKey({ type: "sealed", packSlots: ["LEA"] })).toBe(
            "sealed:lea"
        );
    });
});

describe("parseLimitedOrigin", () => {
    it("round-trips a cube and a block key", () => {
        expect(parseLimitedOrigin("draft:cube:vintage")).toEqual({
            type: "draft",
            sources: ["vintage-cube"],
        });
        expect(parseLimitedOrigin("sealed:inv+pls+apc")).toEqual({
            type: "sealed",
            sources: ["inv", "pls", "apc"],
        });
    });

    it("rejects a string that is not an origin key", () => {
        expect(parseLimitedOrigin("lea")).toBeNull();
        expect(parseLimitedOrigin("cube:lea")).toBeNull();
    });
});

describe("limitedOriginLabel", () => {
    it("labels the cube draft", () => {
        expect(limitedOriginLabel("draft:cube:vintage")).toBe(
            "Vintage Cube Draft"
        );
    });

    it("labels a single-set sealed by the set's full name", () => {
        expect(limitedOriginLabel("sealed:lea")).toBe(
            "Limited Edition Alpha Sealed"
        );
    });

    it("labels a block sequence in pack order", () => {
        expect(limitedOriginLabel("draft:inv+pls+apc")).toBe(
            "Invasion / Planeshift / Apocalypse Draft"
        );
    });

    it("degrades a source-less key to the bare kind", () => {
        expect(limitedOriginLabel("sealed:")).toBe("Sealed");
    });

    it("is null for a malformed key", () => {
        expect(limitedOriginLabel("not-an-origin")).toBeNull();
    });
});
