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
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import {
    V3_TOKEN_GROUPS,
    V4_TOKEN_GROUPS,
    ALL_TOKEN_GROUPS,
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

/** CSS comments removed. Several assertions below ask whether the stylesheet
 *  DOES something, and the surrounding comment routinely names the thing it
 *  deliberately does not do — a raw substring match reads that prose as the
 *  code. */
function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "");
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

    it("the Antique Bronze ground and gold are retired (ADR 0103 supersedes ADR 0007's values)", () => {
        // v4 is a VALUES swap on unchanged roles, so nothing structural fails
        // if the warm palette creeps back one token at a time — the rungs
        // above pass for brown just as they pass for graphite. Name the two
        // hexes that carried the old identity.
        expect(colors["surface-base"]).not.toBe("#0d0b07");
        expect(colors["accent"]).not.toBe("#c9a24b");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Design system v3 (ADR 0101 §2, issue #2581).
// ─────────────────────────────────────────────────────────────────────────────

describe("design tokens v3 — CSS ↔ typed mirror", () => {
    const allV3 = ALL_TOKEN_GROUPS.flatMap((g) => g.tokens);

    it("declares every mirrored family in @layer base :root, not @theme inline", () => {
        // Eight families × their tokens. A count assertion is the cheap guard
        // against a family being dropped from the mirror wholesale.
        expect(V3_TOKEN_GROUPS.map((g) => g.id)).toEqual([
            "fluid-type",
            "density",
            "control-heights",
            "motion",
            "panel-frame",
        ]);
        // Identity v4 (ADR 0103, issue #2722) adds three more; issue #2731
        // adds a fourth (menu rows).
        expect(V4_TOKEN_GROUPS.map((g) => g.id)).toEqual([
            "v4-display",
            "v4-frame",
            "v4-grain",
            "v4-menu-row",
        ]);
        expect(allV3.length).toBeGreaterThanOrEqual(36);
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

    it('[data-motion="reduced"] (issue #2595) collapses every duration to the same non-zero tick as the OS media query', () => {
        // The user's explicit Settings choice — same collapse as
        // `prefers-reduced-motion: reduce` above, but forced regardless of
        // what the OS reports.
        const decls = declarations(
            ruleBody(baseLayer, '[data-motion="reduced"]')
        );
        for (const name of [
            "--motion-fast",
            "--motion-base",
            "--motion-slow",
        ]) {
            expect(decls[name], `${name} overridden`).toBeDefined();
            const ms = Number(/^(\d+)ms$/.exec(decls[name]!.trim())?.[1]);
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

// ─────────────────────────────────────────────────────────────────────────────
// Identity v4 (ADR 0103, PRD #2721, issue #2722).
//
// Each token below gets a row that asserts something the token would be WRONG
// without — a shape, a relation, or the fact that the stylesheet actually
// consumes it. A row that only restated the mirror would be covered by the
// drift guard above already and would prove nothing new.
// ─────────────────────────────────────────────────────────────────────────────
describe("identity v4 — card corner (ADR 0103 §7)", () => {
    /** `4.8% / 3.45%` → `[4.8, 3.45]`. Throws on a length, which is the point:
     *  the corner has to be PROPORTIONAL or one token cannot serve a 63mm hand
     *  card and a 40px battlefield thumb at once. */
    function radiusPercents(value: string): [number, number] {
        const m = /^([\d.]+)%\s*\/\s*([\d.]+)%$/.exec(value.trim());
        if (!m)
            throw new Error(`--card-radius is not a percentage pair: ${value}`);
        return [Number(m[1]), Number(m[2])];
    }

    it("--card-radius is a percentage pair, not a length", () => {
        // A `px` radius here is the bug the token exists to prevent: it would
        // look right at exactly one card size and wrong at every other.
        const [h, v] = radiusPercents(rootTokens["--card-radius"]);
        expect(h).toBeCloseTo(4.8, 5);
        expect(v).toBeCloseTo(3.45, 5);
    });

    it("the horizontal fraction exceeds the vertical one, in the card's aspect ratio", () => {
        // A Magic card is 63×88mm, so the SAME physical corner is a bigger
        // fraction of the width than of the height. Equal percentages (the
        // obvious-looking `4.8% / 4.8%`) paint an egg.
        const [h, v] = radiusPercents(rootTokens["--card-radius"]);
        expect(h).toBeGreaterThan(v);
        // 63/88 = 0.716; the pair must encode the same ratio to within a
        // rounding step, or the corner is not circular.
        expect(v / h).toBeCloseTo(63 / 88, 2);
    });

    it(".card-corner applies the token (the recipe every card surface uses)", () => {
        const rule = /\.card-corner \{([\s\S]*?)\}/.exec(css);
        expect(rule, ".card-corner rule present").not.toBeNull();
        expect(rule![1]).toContain("var(--card-radius)");
    });
});

describe("identity v4 — inset card rings (ADR 0103 §8, issue #2724)", () => {
    /** The body of a top-level rule in `index.css`, by exact selector. */
    function ruleBody(selector: string): string {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const m = new RegExp(`${escaped} \\{([^}]*)\\}`).exec(css);
        expect(m, `${selector} rule present`).not.toBeNull();
        return m![1];
    }

    it(".card-ring implies the card corner, so a ring can never outrun its surface", () => {
        // The failure this prevents is a 2px ivory rectangle drawn around a
        // rounded card — the exact shape ADR 0103 §8 replaced.
        expect(ruleBody(".card-ring")).toContain("var(--card-radius)");
    });

    it("the ring is drawn INSET, above the art, and never intercepts a click", () => {
        const after = ruleBody(".card-ring::after");
        // `inset` is the whole point: an outward ring bleeds past the card's
        // corner and over its neighbours in a tight zone.
        expect(after).toMatch(/box-shadow:\s*inset\b/);
        expect(after).toContain("var(--card-ring-color");
        // Above the art (a plain inset box-shadow would paint UNDER it, which
        // is why Tailwind's `ring-inset` cannot do this job).
        expect(after).toMatch(/z-index:\s*\d+/);
        expect(after).toContain("pointer-events: none");
        // Follows whatever corner the element itself carries.
        expect(after).toContain("border-radius: inherit");
    });

    it("every ring role resolves to a real palette token", () => {
        const colors = themeColors(css);
        const roles: Record<string, string> = {
            ".card-ring-candidate": "--color-signal-target",
            ".card-ring-selected": "--color-accent",
            ".card-ring-attacking": "--color-signal-pending",
            ".card-ring-pending": "--color-signal-pending",
            ".card-ring-combat-1": "--color-combat-1",
            ".card-ring-combat-2": "--color-combat-2",
            ".card-ring-combat-3": "--color-combat-3",
            ".card-ring-combat-4": "--color-combat-4",
        };
        for (const [selector, token] of Object.entries(roles)) {
            const body = ruleBody(selector);
            expect(body, selector).toContain("--card-ring-color");
            expect(body, selector).toContain(`var(${token})`);
            // A role pointing at a token that does not exist paints nothing,
            // and paints nothing SILENTLY — the ring simply never appears.
            expect(
                colors[token.replace("--color-", "")],
                `${token} is a defined palette token`
            ).toBeTruthy();
        }
    });

    it("the current attacker differs from a declared attacker WITHOUT motion", () => {
        // The hole this closes (review of #2724): `attacking` is one token for
        // the attacker currently choosing its target AND for the attackers
        // already declared. Before v4 they differed by hue. After the collapse
        // the only difference left was `card-ring-pulse` — whose `animation`
        // is declared inside the single `prefers-reduced-motion: no-preference`
        // gate. With motion reduced the two states were pixel-identical, so a
        // reduced-motion player could not see which attacker was aiming.
        //
        // Hence the assertion is specifically about WHERE the static half is
        // declared: inside the gate it would be worth nothing.
        const gate = css.indexOf(
            "@media (prefers-reduced-motion: no-preference)"
        );
        expect(gate, "the motion gate is present").toBeGreaterThan(-1);

        const current = css.indexOf(".card-ring-current::after");
        expect(
            current,
            "the current attacker carries a static differentiator"
        ).toBeGreaterThan(-1);
        expect(
            current,
            "a differentiator declared INSIDE the motion gate does not exist for a reduced-motion player"
        ).toBeLessThan(gate);

        // And it must actually differ from the plain ring: same colour var,
        // different geometry (a heavier ring plus a second inset stop).
        const body = ruleBody(".card-ring-current::after");
        expect(body).toMatch(/box-shadow:[\s\S]*inset/);
        expect(body).toContain("--card-ring-w-current");
        expect(
            body.match(/inset/g)?.length,
            "two inset stops, so the halo reads at a glance"
        ).toBeGreaterThanOrEqual(2);
        expect(body).not.toContain("animation");
    });
});

describe("identity v4 — hairlines (ADR 0103 §5)", () => {
    /** Alpha of an `rgb(r g b / a)` value. */
    function alpha(value: string): number {
        const m = /\/\s*([\d.]+)\s*\)/.exec(value);
        expect(m, `alpha channel in ${value}`).not.toBeNull();
        return Number(m![1]);
    }

    it("both hairlines are translucent ivory, strong stronger than subtle", () => {
        // Translucency is the whole point: these are the edges that sit over
        // card art and gradients, where the flattened
        // `--color-border-subtle` hex would paint a visible grey line.
        for (const name of ["--hairline", "--hairline-strong"]) {
            expect(rootTokens[name], name).toMatch(
                /^rgb\(232 226 210 \/ [\d.]+\)$/
            );
        }
        expect(alpha(rootTokens["--hairline-strong"])).toBeGreaterThan(
            alpha(rootTokens["--hairline"])
        );
        expect(alpha(rootTokens["--hairline"])).toBeCloseTo(0.12, 5);
        expect(alpha(rootTokens["--hairline-strong"])).toBeCloseTo(0.3, 5);
    });

    it("the flattened hexes agree with the translucent pair, to within a rounding step", () => {
        // `--color-border-subtle` / `--color-border-accent` are the SAME two
        // hairlines flattened onto `--color-surface` for the Tailwind
        // `/opacity` utilities and the contrast guard. If the two drift, the
        // app paints two different hairlines depending on which one a
        // component happens to reach for — invisible in review, obvious on
        // screen.
        const surface = colors["surface"];
        const composite = (a: number): string => {
            const s = [1, 3, 5].map((i) =>
                parseInt(surface.slice(i, i + 2), 16)
            );
            const ivory = [232, 226, 210];
            return ivory
                .map((c, i) => Math.round(a * c + (1 - a) * s[i]))
                .map((c) => c.toString(16).padStart(2, "0"))
                .join("");
        };
        for (const [token, a] of [
            ["border-subtle", 0.12],
            ["border-accent", 0.3],
        ] as const) {
            const want = composite(a);
            const got = colors[token].slice(1);
            for (let i = 0; i < 3; i++) {
                const d = Math.abs(
                    parseInt(want.slice(i * 2, i * 2 + 2), 16) -
                        parseInt(got.slice(i * 2, i * 2 + 2), 16)
                );
                expect(
                    d,
                    `--color-${token} (#${got}) vs ivory/${a * 100} flattened on ${surface} (#${want}), channel ${i}`
                ).toBeLessThanOrEqual(1);
            }
        }
    });

    it("border-strong is brighter than the strong hairline (a control edge is not decoration)", () => {
        // WCAG 1.4.11 binds control boundaries at 3:1; ivory/30 is 2.37:1, so
        // the two roles cannot collapse into one token however much they look
        // alike.
        expect(
            ratio(colors["border-strong"], colors["surface"])
        ).toBeGreaterThan(ratio(colors["border-accent"], colors["surface"]));
    });

    it(".hairline / .hairline-strong apply the tokens", () => {
        for (const [cls, token] of [
            ["hairline", "--hairline"],
            ["hairline-strong", "--hairline-strong"],
        ] as const) {
            const rule = new RegExp(`\\.${cls} \\{([\\s\\S]*?)\\}`).exec(css);
            expect(rule, `.${cls} rule present`).not.toBeNull();
            expect(rule![1]).toContain(`var(${token})`);
            expect(rule![1]).toContain("var(--hairline-w)");
        }
    });
});

describe("identity v4 — page-ground grain (ADR 0103 §5)", () => {
    it("the grain image is a semicolon-free inline SVG data URI", () => {
        const v = rootTokens["--grain-image"];
        expect(v).toMatch(/^url\("data:image\/svg\+xml,%3Csvg /);
        expect(v).toContain("feTurbulence");
        // `data:image/svg+xml;utf8,…` is the natural way to write this and it
        // terminates the CSS declaration for every regex-based reader of the
        // stylesheet — this parser included, which would then see the token as
        // absent rather than as wrong.
        expect(v).not.toContain(";");
    });

    it("<body> actually paints the grain, as a background layer", () => {
        // Without this the tokens exist and nothing ever renders them. The
        // "background layer" half is load-bearing too: the prototype's fixed
        // full-viewport `::after` overlay would read as occluding every card
        // and control to the ui-gate probe's `elementFromPoint` sweep.
        // Comments stripped first: this rule's own comment EXPLAINS the fixed
        // overlay it is not, and a raw substring match would read that as the
        // defect.
        const body = stripComments(
            ruleBody(baseLayer, "body", "--grain-image")
        );
        expect(body).toContain("background-image: var(--grain-image)");
        expect(body).toContain("var(--grain-size)");
        expect(body).toContain("background-blend-mode: var(--grain-blend)");
        expect(body).not.toContain("position: fixed");
    });
});

describe("identity v4 — menu rows (ADR 0103 §5, issue #2731)", () => {
    it("the menu row height matches the coarse-pointer touch target", () => {
        // ADR 0103 §5: "Popovers and menus get 44px rows" — the same 44px
        // WCAG 2.5.8 comfort target `--control-h-coarse` already names, not a
        // second, independently-chosen number that could drift from it.
        expect(pxValue(rootTokens["--menu-row-h"])).toBe(44);
        expect(pxValue(rootTokens["--menu-row-h"])).toBe(
            pxValue(rootTokens["--control-h-coarse"])
        );
    });

    it("the row gap is a real, non-zero span", () => {
        expect(pxValue(rootTokens["--menu-row-gap"])).toBeGreaterThan(0);
    });
});

describe("identity v4 — Geist is the chrome face, Beleren is card-domain only (ADR 0103 §4)", () => {
    /** The `@theme inline` block verbatim (`themeColors` only returns the
     *  hexes it matched, so a font token needs the raw text). */
    function themeBlock(source: string): string {
        const at = source.indexOf("@theme inline {");
        expect(at, "@theme inline block present").toBeGreaterThan(-1);
        return block(source, source.indexOf("{", at));
    }
    const theme = stripComments(themeBlock(css));

    it("@theme inline exports --font-display and NOT --font-beleren", () => {
        // A `@theme` entry is exactly what makes Tailwind emit the matching
        // `font-*` utility. Dropping `--font-beleren` from this block is what
        // makes "no chrome consumer resolves to Beleren" true mechanically:
        // the class stops generating any font-family at all, so the ~75
        // component call sites that still carry the name inherit `font-sans`
        // (Geist) until the slices that own those files delete it.
        expect(theme).toMatch(/--font-display:\s*"Geist Variable"/);
        expect(theme).not.toContain("--font-beleren");
    });

    it("--font-beleren stays declared in :root, reserved for the card domain", () => {
        // Retired from the chrome, NOT deleted: the card-frame and
        // text-only-card renderers read it as `var(--font-beleren)`, and the
        // @font-face that loads the woff is still the point of it.
        const root = /:root \{([\s\S]*?)\n\}/.exec(css);
        expect(root, "first :root block").not.toBeNull();
        expect(root![1]).toMatch(/--font-beleren:\s*"Beleren", serif;/);
        expect(css).toContain('font-family: "Beleren"');
    });

    it("no CSS recipe applies the Beleren utility any more", () => {
        // `.btn-base` (every Button in the app) and `.heading-panel` were the
        // two `@apply font-beleren` sites; an `@apply` of a utility that no
        // longer exists is also a build error, so this row is the early
        // warning for re-adding one.
        expect(css).not.toMatch(/@apply[^;]*\bfont-beleren\b/);
    });

    it("the chrome display recipes are on the display face and its treatment", () => {
        for (const cls of ["text-display", "btn-base", "heading-panel"]) {
            const rule = new RegExp(`\\.${cls} \\{([\\s\\S]*?)\\n {4}\\}`).exec(
                css
            );
            expect(rule, `.${cls} rule present`).not.toBeNull();
            expect(rule![1], cls).toContain("var(--font-display)");
            expect(rule![1], cls).toContain("var(--display-weight)");
            expect(rule![1], cls).toContain("var(--display-tracking)");
            expect(rule![1], cls).toContain("var(--display-numerals)");
        }
    });

    // ── The residual-site RATCHET (PR #2783 review) ──────────────────────
    //
    // The CSS half of the Beleren retirement is fail-CLOSED: `@apply
    // font-beleren` is a hard BUILD error now that the utility does not exist
    // ("Cannot apply unknown utility class"), and the rows above pin the
    // `@theme inline` export. The TSX half is fail-OPEN, and that asymmetry is
    // the whole reason this row exists: a `className="… font-beleren …"` added
    // to a component compiles, type-checks, lints and renders — as Geist,
    // silently — because a Tailwind class is just a string.
    //
    // That matters right now specifically. This slice deliberately leaves ~74
    // inert `font-beleren` class names in ~56 component files, because those
    // files belong to thirteen sibling slices of PRD #2721 (#2723, #2724,
    // #2726, #2727, #2728, #2729-#2733) and editing them here would collide
    // with every one of them in the merge-train for zero rendered difference.
    // Each slice deletes its own as it re-skins. Without a ratchet, that
    // intermediate state can silently GROW instead of shrinking, and #2734's
    // closure sweep would be the first thing to notice — after the fact.
    //
    // So: the count may only ever go DOWN. #2734 ("closure: retire bracket/
    // filigree atoms and dead v3 recipes") is the slice that drives it to 0,
    // at which point this row and its constant are deleted with it.
    const BELEREN_RESIDUAL_CEILING = 21;

    /** Every `.ts`/`.tsx` under `src/`, except this guard file — which names
     *  the class in its own assertions and would otherwise count itself. */
    function sourceFiles(dir: string, out: string[] = []): string[] {
        for (const entry of readdirSync(dir)) {
            if (entry === "node_modules" || entry === "_generated") continue;
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) sourceFiles(full, out);
            else if (/\.tsx?$/.test(entry)) out.push(full);
        }
        return out;
    }

    it("the residual font-beleren sites only ever go DOWN (ratchet, #2734 drives them to 0)", () => {
        const root = resolve(process.cwd(), "src");
        const self = resolve(
            process.cwd(),
            "src/__tests__/design-tokens.test.ts"
        );
        const perFile: Array<[string, number]> = [];
        let count = 0;
        for (const file of sourceFiles(root)) {
            if (file === self) continue;
            const n = (readFileSync(file, "utf8").match(/font-beleren/g) ?? [])
                .length;
            if (n > 0) {
                perFile.push([relative(process.cwd(), file), n]);
                count += n;
            }
        }
        const worst = perFile
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([f, n]) => `${f} (${n})`)
            .join(", ");

        expect(
            count,
            `A NEW font-beleren site was added. The utility no longer exists (ADR 0103 §4) — ` +
                `the class renders NOTHING and the element silently falls back to Geist, which is ` +
                `why nothing else in the build complains. Use the display face instead: ` +
                `\`.text-display\`, or \`var(--font-display)\` + the --display-* tokens. ` +
                `Ceiling ${BELEREN_RESIDUAL_CEILING}, found ${count}. Heaviest files: ${worst}`
        ).toBeLessThanOrEqual(BELEREN_RESIDUAL_CEILING);

        // ...and the ceiling may not go slack. Without this, a slice that
        // deletes ten sites leaves nine spare slots for someone to add five
        // new ones under the old ceiling, undetected — a ratchet that never
        // ratchets is just a very patient rubber stamp.
        expect(
            count,
            `${BELEREN_RESIDUAL_CEILING - count} font-beleren site(s) were removed — thank you. ` +
                `Now LOWER \`BELEREN_RESIDUAL_CEILING\` to ${count} in this file, so the ratchet ` +
                `keeps its grip. When it reaches 0, delete this row and the constant with it (#2734).`
        ).toBe(BELEREN_RESIDUAL_CEILING);
    });

    it("the display treatment is the ADR's: 500 / −0.025em / lining tabular numerals", () => {
        expect(rootTokens["--display-weight"]).toBe("500");
        expect(rootTokens["--display-tracking"]).toBe("-0.025em");
        // Tabular is not a flourish: life totals and counts tick in place, and
        // proportional numerals make them jitter.
        expect(rootTokens["--display-numerals"]).toContain("tabular-nums");
        expect(rootTokens["--display-numerals"]).toContain("lining-nums");
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

describe("index.html pins the roomy density default (issue #2595, PR #2620 round-2 review)", () => {
    // The sign-in screen renders outside AuthGate's <Authenticated> branch,
    // where UserPreferencesEffect never mounts — so nothing ever sets
    // `[data-density]` on <html> for it. `index.html` hard-codes the roomy
    // default itself so the unauthenticated screen keeps Panel's roomy rhythm
    // instead of falling through to `comfortable` (no `[data-density]` match).
    // happy-dom never loads index.html, so this is a plain text read.
    it('<html> carries data-density="roomy"', () => {
        const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
        expect(html).toMatch(/<html[^>]*\bdata-density="roomy"/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Identity v4 — the PRIMITIVE recipes (ADR 0103 §3 / §5, issue #2723).
//
// The primitives' dom tests (`panel.test.tsx`, `button.test.tsx`,
// `banner.test.tsx`, `field.test.tsx`) assert which CLASS each variant
// resolves to. They cannot assert what that class PAINTS: happy-dom has no
// cascade and resolves no custom property, so `getComputedStyle` there returns
// empty strings. These rows close that half of the contract by parsing the
// stylesheet, exactly as the hairline and grain rows above do.
//
// The segmented control has no other home at all: there is no shared segmented
// COMPONENT — five consumers hand-build their markup on `.segment-pill` /
// `.segment-active` / `.segment-inactive` — so these three rules ARE its
// contract, and this is where it is testable.
// ─────────────────────────────────────────────────────────────────────────────
describe("identity v4 — primitive recipes (ADR 0103, issue #2723)", () => {
    describe("Panel material", () => {
        it("the panel corner is the ADR's 4–6px, and not a card corner", () => {
            const radius = pxValue(rootTokens["--panel-radius"]);
            expect(radius).toBeGreaterThanOrEqual(4);
            expect(radius).toBeLessThanOrEqual(6);
            // A panel is not a card: mixing in the proportional card fraction
            // is what made the v3 dialogs read as oversized cards.
            expect(rootTokens["--panel-radius"]).not.toContain("%");
        });

        it(".panel-physical is hairline + material: top-light and elevation, no bezel", () => {
            const body = ruleBody(css, ".panel-physical");
            expect(body).toContain("background-color: var(--color-surface)");
            expect(body).toContain("linear-gradient");
            expect(body).toContain("box-shadow");
            // The v3 bezel drew an inner GOLD hairline and an inner vignette,
            // which on a graphite ground read as a brown box on top of the
            // page rather than a plane lifted off it.
            expect(body).not.toContain("--color-accent");
        });

        it(".panel-physical declares no border shorthand — three consumers bring their own", () => {
            // `app-header.tsx` and the design-system BoardBanner specimen both
            // add their own border utilities to this class. A shorthand here
            // would paint a second, opaque edge over theirs.
            expect(ruleBody(css, ".panel-physical")).not.toMatch(
                /(^|\n)\s*border:/
            );
        });

        it("the header band and its rule draw ONE hairline between them", () => {
            // v3 drew the edge twice — a gold `border-bottom` on the band AND
            // the `.panel-rule` span — which on a hairline frame reads as a
            // double-struck line.
            expect(ruleBody(css, ".panel-header-band")).not.toContain(
                "border-bottom"
            );
            expect(ruleBody(css, ".panel-rule")).toContain(
                "var(--hairline-strong)"
            );
        });

        it("the one surviving ornament is on the hairline, not on gold", () => {
            expect(ruleBody(css, ".divider-line")).toContain(
                "var(--hairline-strong)"
            );
            expect(ruleBody(css, ".divider-line")).not.toContain(
                "linear-gradient"
            );
        });
    });

    describe("Button tones", () => {
        it("primary is the opaque ivory plate with a dark label and a resting glow", () => {
            const body = ruleBody(css, ".btn-tone-primary");
            expect(body).toContain("background-color: var(--color-accent)");
            expect(body).toContain("color: var(--color-surface-base)");
            // The glow RESTS: on a graphite ground a plate with no glow reads
            // as a white rectangle rather than as a lit control.
            expect(body).toContain("box-shadow: 0 8px 24px");
        });

        // The hierarchy the ADR is after: ONE plate per screen. A garnet
        // Concede plate beside an ivory Confirm plate is two primary actions.
        it.each([".btn-tone-secondary", ".btn-tone-destructive"] as const)(
            "%s is a hairline edge, not a plate",
            (selector) => {
                const body = ruleBody(css, selector);
                expect(body).toContain("background-color: transparent");
                expect(body).toContain("box-shadow: none");
            }
        );

        it("a control edge is border-strong or danger — never the decorative hairline", () => {
            // ivory/30 is 2.37:1 on `surface`; a control whose only boundary is
            // the decorative hairline fails WCAG 1.4.11's 3:1 for a control
            // boundary. Decoration and control edges are different roles.
            //
            // `.segment-pill` joined this list in PR #2827's round-1 review: it
            // shipped on `--hairline` (1.344:1) one describe-block from here.
            // The rule is about CONTROLS, not about buttons — scoping it to the
            // two button tones is what let a segmented control slip past it.
            expect(ruleBody(css, ".btn-tone-secondary")).toContain(
                "border-color: var(--color-border-strong)"
            );
            expect(ruleBody(css, ".segment-pill")).toContain(
                "border-color: var(--color-border-strong)"
            );
            expect(ruleBody(css, ".btn-tone-destructive")).toContain(
                "border-color: var(--color-danger)"
            );
            for (const selector of [
                ".btn-tone-secondary",
                ".btn-tone-destructive",
                ".segment-pill",
            ]) {
                expect(ruleBody(css, selector), selector).not.toContain(
                    "var(--hairline"
                );
            }
        });

        it("destructive keeps the high-contrast danger label", () => {
            // 7.99:1 on surface. Plain `danger` as a label was a phase-3
            // contrast failure at 3.43:1, and a hairline button has no plate
            // behind the text to rescue it.
            expect(ruleBody(css, ".btn-tone-destructive")).toContain(
                "color: var(--color-danger-strong)"
            );
        });
    });

    describe("Segmented control", () => {
        it("a segment is a recessed dark field with a control-strength edge", () => {
            const body = ruleBody(css, ".segment-pill");
            expect(body).toContain(
                "background-color: var(--color-surface-base)"
            );
            // NOT the decorative `--hairline` the ADR's prose names (PR #2827
            // round-1 review). Measured: the recessed field is 1.083:1 against
            // the panel, so it does not identify the control on its own and
            // this border is the SOLE boundary. `--hairline` is 1.344:1 there,
            // under WCAG 1.4.11's 3:1; `--color-border-strong` is 3.383:1.
            expect(body).toContain("border-color: var(--color-border-strong)");
        });

        it("a segment keeps its pointer-token height", () => {
            // ADR 0101 §2: 40px on a coarse pointer, 28px with a mouse. The v4
            // skin is colour + a 1px border-box edge; it must not have moved
            // the rung.
            expect(ruleBody(css, ".segment-pill")).toContain(
                "min-height: var(--control-h-sm)"
            );
        });

        it("a segment has a visible accent focus ring", () => {
            const body = ruleBody(css, ".segment-pill:focus-visible");
            expect(body).toContain("outline");
            expect(body).toContain("var(--color-accent)");
        });

        it("the selected segment is the ivory plate, not a wash", () => {
            const body = ruleBody(css, ".segment-active");
            expect(body).toContain("background-color: var(--color-accent)");
            expect(body).toContain("color: var(--color-surface-base)");
        });
    });
});
