/// <reference types="node" />
// Design-token contrast guard (phase-3 unification, ADR 0007).
//
// The phase-3 audit measured two WCAG failures straight from this stylesheet:
// `text-disabled` at 3.13:1 and `danger`-as-text at 3.43:1. The fixes are
// token values, and the only thing keeping them fixed is a test that reads
// the tokens and re-derives the ratios (WCAG relative luminance). jsdom can't
// evaluate stylesheets, so we parse `src/index.css` text (Node fs) — same
// pattern as motion-gating.test.ts.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

/** Parse `--color-<name>: <hex>` declarations out of the `@theme inline`
 *  block (semantic palette; shadcn primitives in :root are duplicates). */
function themeColors(source: string): Record<string, string> {
    const start = source.indexOf("@theme inline {");
    expect(start, "@theme inline block present").toBeGreaterThan(-1);
    const open = source.indexOf("{", start);
    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") {
            depth--;
            if (depth === 0) {
                end = i;
                break;
            }
        }
    }
    const body = source.slice(open + 1, end);
    const out: Record<string, string> = {};
    for (const m of body.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
        out[m[1]] = m[2].toLowerCase();
    }
    return out;
}

function luminance(hex: string): number {
    const c = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => {
        const v = parseInt(c.slice(i, i + 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

const colors = themeColors(css);
const SURFACES = ["surface-base", "surface", "surface-elevated"] as const;

describe("design tokens — WCAG contrast (phase 3)", () => {
    it("parses the semantic palette", () => {
        expect(Object.keys(colors).length).toBeGreaterThan(20);
        expect(colors["text-disabled"]).toBeDefined();
    });

    it.each([
        "text",
        "text-muted",
        "text-disabled",
        "parchment",
        "accent",
        "accent-strong",
        "danger-strong",
        "success-strong",
        "secondary-accent-strong",
    ])("%s is ≥4.5:1 on every surface token", (token) => {
        for (const surface of SURFACES) {
            const r = ratio(colors[token], colors[surface]);
            expect(
                r,
                `${token} (${colors[token]}) on ${surface} (${colors[surface]}) = ${r.toFixed(2)}:1`
            ).toBeGreaterThanOrEqual(4.5);
        }
    });

    it.each([
        "signal-self",
        "signal-self-strong",
        "signal-opponent",
        "signal-opponent-strong",
        "signal-pending",
        "signal-pending-strong",
        "signal-target",
        "signal-target-strong",
    ])("%s is ≥4.5:1 on every surface token", (token) => {
        for (const surface of SURFACES) {
            const r = ratio(colors[token], colors[surface]);
            expect(
                r,
                `${token} (${colors[token]}) on ${surface} (${colors[surface]}) = ${r.toFixed(2)}:1`
            ).toBeGreaterThanOrEqual(4.5);
        }
    });

    it("border-strong is ≥3:1 (WCAG 1.4.11 UI boundary) on surface + input", () => {
        expect(
            ratio(colors["border-strong"], colors["surface"])
        ).toBeGreaterThanOrEqual(3);
        // --input lives in the shadcn :root block, not @theme inline.
        expect(colors["border-strong"]).toBeDefined();
    });

    it("plate labels pass: parchment on danger ≥4.5, surface-base on accent ≥4.5, surface-base on success ≥4.5", () => {
        expect(
            ratio(colors["parchment"], colors["danger"])
        ).toBeGreaterThanOrEqual(4.5);
        expect(
            ratio(colors["surface-base"], colors["accent"])
        ).toBeGreaterThanOrEqual(4.5);
        expect(
            ratio(colors["surface-base"], colors["success"])
        ).toBeGreaterThanOrEqual(4.5);
    });

    it("the retired values stay retired (the two original failures)", () => {
        // #6f6244 was text-disabled at 3.13:1; if it ever comes back this
        // test pair fails above — assert the token moved explicitly.
        expect(colors["text-disabled"]).not.toBe("#6f6244");
    });
});
