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
import {
    V3_TOKEN_GROUPS,
    DENSITY_RUNGS,
    PALETTE_TOKENS,
    SIGNAL_TOKENS,
    CHART_CATEGORICAL_TOKENS,
    PANEL_FRAME_TOKENS,
    bracketTitleGapPx,
    pxValue,
} from "@/lib/design-tokens";

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

// ─────────────────────────────────────────────────────────────────────────────
// Non-colour tokens (design system v3, ADR 0101 §2, issue #2581).
//
// `themeColors()` above matches only `--color-<name>: #hex` inside `@theme
// inline`. The v3 families are NOT colours and do NOT live there — they are
// declared in the separate `@layer base { :root { … } }` block, so they need
// their own parser. A token added to the wrong block is invisible to both.
// ─────────────────────────────────────────────────────────────────────────────

/** Body of the block opening at `open` (which must index a `{`). */
function block(source: string, open: number): string {
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") {
            depth--;
            if (depth === 0) return source.slice(open + 1, i);
        }
    }
    throw new Error(`unbalanced block at ${open}`);
}

/** EVERY `@layer base { … }` block, concatenated. The stylesheet opens two of
 *  them (the shadcn reset near the top and the token block near the bottom);
 *  taking only the first is how a token parser silently sees nothing. */
function baseLayerBody(source: string): string {
    const bodies: string[] = [];
    for (const m of source.matchAll(/@layer base\s*\{/g)) {
        bodies.push(block(source, m.index + m[0].length - 1));
    }
    expect(bodies.length, "@layer base block(s) present").toBeGreaterThan(0);
    return bodies.join("\n");
}

const baseLayer = baseLayerBody(css);

/** Body of the rule matching `selector` inside the base layer. `mustContain`
 *  disambiguates when several blocks share a selector — `:root` appears in
 *  both `@layer base` blocks, and only one of them holds the v3 tokens. */
function ruleBody(source: string, selector: string, mustContain = ""): string {
    let from = 0;
    for (;;) {
        const at = source.indexOf(`${selector} {`, from);
        if (at === -1) break;
        const body = block(source, source.indexOf("{", at));
        if (!mustContain || body.includes(mustContain)) return body;
        from = at + selector.length;
    }
    throw new Error(
        `${selector} rule${mustContain ? ` containing ${mustContain}` : ""} not found in @layer base`
    );
}

/** `--name: value` declarations of a rule body, comments stripped, whitespace
 *  normalised. Only top-level declarations — a nested `@media` inside the body
 *  contributes nothing, which is what we want: the override is asserted
 *  separately. */
function declarations(body: string): Record<string, string> {
    const flat = body
        .replace(/\/\*[\s\S]*?\*\//g, "")
        // drop nested at-rule blocks so their declarations don't leak up
        .replace(/@[\w-]+[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, "");
    const out: Record<string, string> = {};
    for (const m of flat.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        out[m[1]] = m[2].replace(/\s+/g, " ").trim();
    }
    return out;
}

const rootTokens = declarations(
    ruleBody(baseLayer, ":root", "--panel-header-pad-x")
);

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

// ─────────────────────────────────────────────────────────────────────────────
// Design system v3 (ADR 0101 §2, issue #2581).
// ─────────────────────────────────────────────────────────────────────────────

describe("design tokens v3 — CSS ↔ typed mirror", () => {
    const allV3 = V3_TOKEN_GROUPS.flatMap((g) => g.tokens);

    it("declares every mirrored family in @layer base :root, not @theme inline", () => {
        // Five families × their tokens. A count assertion is the cheap guard
        // against a family being dropped from the mirror wholesale.
        expect(V3_TOKEN_GROUPS.map((g) => g.id)).toEqual([
            "fluid-type",
            "density",
            "control-heights",
            "motion",
            "panel-frame",
        ]);
        expect(allV3.length).toBeGreaterThanOrEqual(26);
    });

    it.each(allV3.map((t) => [t.name, t.value] as const))(
        "%s matches the value declared in src/index.css",
        (name, value) => {
            expect(
                rootTokens[name],
                `${name} is not declared in @layer base :root — a non-colour token in @theme inline is invisible to this guard`
            ).toBeDefined();
            expect(rootTokens[name].replace(/\s+/g, " ")).toBe(
                value.replace(/\s+/g, " ")
            );
        }
    );

    it("every fluid-type step is a clamp() between two rem bounds", () => {
        for (const t of V3_TOKEN_GROUPS[0].tokens) {
            expect(t.value, t.name).toMatch(
                /^clamp\(\s*[\d.]+rem\s*,\s*[\d.]+rem \+ [\d.]+vw\s*,\s*[\d.]+rem\s*\)$/
            );
        }
    });

    it("the coarse pointer rung is 44px and beats the fine rung", () => {
        expect(pxValue(rootTokens["--control-h-coarse"])).toBe(44);
        expect(pxValue(rootTokens["--control-h-fine"])).toBe(32);
        expect(
            pxValue(rootTokens["--control-h-coarse"])
        ).toBeGreaterThanOrEqual(pxValue(rootTokens["--control-h-fine"]));
    });

    it("@media (pointer: coarse) actually swaps --control-h", () => {
        // Without this the tokens exist and nothing ever picks the touch rung.
        expect(baseLayer).toMatch(
            /@media \(pointer: coarse\)[\s\S]*?--control-h:\s*var\(--control-h-coarse\)/
        );
    });

    it("prefers-reduced-motion collapses every duration to a non-zero tick", () => {
        const reduced =
            /@media \(prefers-reduced-motion: reduce\)([\s\S]*?)\n {4}\}/.exec(
                baseLayer
            );
        expect(reduced, "reduced-motion override present").not.toBeNull();
        for (const name of [
            "--motion-fast",
            "--motion-base",
            "--motion-slow",
        ]) {
            const m = new RegExp(`${name}:\\s*([^;]+);`).exec(reduced![1]);
            expect(m, `${name} overridden under reduced motion`).not.toBeNull();
            const ms = Number(/^(\d+)ms$/.exec(m![1].trim())?.[1]);
            // 1ms, not 0: `transitionend` must still fire or a listener waits
            // forever.
            expect(ms).toBeGreaterThan(0);
            expect(ms).toBeLessThanOrEqual(1);
        }
    });

    it.each(DENSITY_RUNGS.map((r) => [r.density, r] as const))(
        "the %s density rung resolves to the unit and padding the mirror claims",
        (density, rung) => {
            const decls = declarations(
                ruleBody(baseLayer, `[data-density="${density}"]`)
            );
            expect(decls["--density-unit"]).toBe(
                `var(--density-unit-${density})`
            );
            expect(decls["--panel-pad"]).toBe(rung.panelPad);
            expect(rootTokens[`--density-unit-${density}`]).toBe(rung.unit);
        }
    );

    it("the comfortable rung steps up to its wide padding at the 420px breakpoint", () => {
        // The phone-aware rung (issue #1817). `PILE_GRID_COMPACT_BREAKPOINT_PX`
        // must stay in step with this number.
        const wide = DENSITY_RUNGS.find(
            (r) => r.density === "comfortable"
        )!.panelPadWide;
        expect(wide).toBe("24px");
        expect(baseLayer).toMatch(
            new RegExp(
                `@media \\(min-width: 420px\\)[\\s\\S]*?\\[data-density="comfortable"\\][\\s\\S]*?--panel-pad:\\s*${wide};`
            )
        );
    });

    it("the density rungs are strictly ordered 8 < 10 < 12", () => {
        const units = DENSITY_RUNGS.map((r) => pxValue(r.unit));
        expect(units).toEqual([8, 10, 12]);
    });
});

describe("Panel v3 bracket / title clearance (ADR 0101 §2)", () => {
    // NOT a layout test, deliberately. happy-dom has no layout engine —
    // `getBoundingClientRect()` returns zeroes — so a geometric "the title is
    // ≥4px from the bracket" assertion would pass on a panel whose title sits
    // underneath the bracket. The invariant is therefore asserted
    // ARITHMETICALLY over the four frame tokens parsed out of the stylesheet.
    const frame = Object.fromEntries(
        PANEL_FRAME_TOKENS.map((t) => [t.name, rootTokens[t.name]])
    );

    it("a Panel title is never within the clearance token of a bracket", () => {
        const clearance = pxValue(
            rootTokens["--panel-title-bracket-clearance"]
        );
        const gap = bracketTitleGapPx(frame);
        expect(
            gap,
            `--panel-header-pad-x (${frame["--panel-header-pad-x"]}) must exceed the bracket reach ` +
                `(--panel-bracket-inset ${frame["--panel-bracket-inset"]} + --panel-bracket-size ` +
                `${frame["--panel-bracket-size"]}) by at least ${clearance}px; actual gap ${gap}px`
        ).toBeGreaterThanOrEqual(clearance);
    });

    it("the ADR's clearance floor is at least 4px", () => {
        // The token may be raised, never lowered below the ADR's contract.
        expect(
            pxValue(rootTokens["--panel-title-bracket-clearance"])
        ).toBeGreaterThanOrEqual(4);
    });

    it("the bracket is the ADR's 10px / 1px / .5 frame", () => {
        expect(pxValue(frame["--panel-bracket-size"])).toBe(10);
        expect(pxValue(frame["--panel-bracket-width"])).toBe(1);
        expect(Number(frame["--panel-bracket-opacity"])).toBe(0.5);
    });

    it(".panel-bracket draws all four arms from the tokens", () => {
        // A bracket rule that hard-codes a number would make the arithmetic
        // above describe a frame the browser does not paint.
        for (const corner of ["tl", "tr", "bl", "br"]) {
            const rule = new RegExp(
                `\\.panel-bracket\\[data-corner="${corner}"\\]\\s*\\{([\\s\\S]*?)\\}`
            ).exec(css);
            expect(
                rule,
                `.panel-bracket[data-corner="${corner}"]`
            ).not.toBeNull();
            expect(rule![1]).toContain("var(--panel-bracket-inset)");
            expect(rule![1]).toContain("var(--panel-bracket-width)");
        }
        const base = /\.panel-bracket \{([\s\S]*?)\}/.exec(css)!;
        expect(base[1]).toContain("var(--panel-bracket-size)");
        expect(base[1]).toContain("var(--panel-bracket-opacity)");
    });

    it(".panel-title-clear pays the shortfall between panel padding and the title inset", () => {
        // The GameDialog path: its title lives in the Panel's padding box, not
        // in PanelHeader's full-bleed band, so it must add the difference
        // itself or a 12px-padded phone dialog puts the title inside the
        // bracket's 14px reach.
        const rule = /\.panel-title-clear \{([\s\S]*?)\n {4}\}/.exec(css);
        expect(rule, ".panel-title-clear rule present").not.toBeNull();
        expect(rule![1]).toContain("var(--panel-header-pad-x)");
        expect(rule![1]).toContain("var(--panel-pad)");
    });
});

describe("design-system census mirrors the stylesheet", () => {
    // The census page used to hand-maintain these hexes in
    // `sections-foundations.tsx`, where they could drift from `src/index.css`
    // unnoticed — a reference page quietly describing a palette that no longer
    // exists. Both now read the same typed mirror, and this is the guard.
    it.each(
        [...PALETTE_TOKENS, ...SIGNAL_TOKENS, ...CHART_CATEGORICAL_TOKENS].map(
            (t) => [t.name, t.hex]
        )
    )("%s matches @theme inline", (name, hex) => {
        expect(colors[name], `--color-${name} in @theme inline`).toBe(hex);
    });
});
