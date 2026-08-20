// Typed mirror of the design tokens declared in `src/index.css`
// (ADR 0101 §2 — design system v3, issue #2581).
//
// WHY A MIRROR AT ALL. CSS custom properties are invisible to TypeScript and to
// every test that does not run a browser: `getComputedStyle` under happy-dom
// resolves nothing, and the stylesheet is a string. So the values live twice —
// once where the browser reads them (`src/index.css`) and once here, typed —
// and `src/__tests__/design-tokens.test.ts` re-parses the stylesheet and fails
// on ANY divergence between the two. That drift guard is the only thing that
// makes a mirror safe; without it a mirror is just a stale copy.
//
// Consumers:
//   - `src/routes/design-system/**` renders the census FROM this file, so the
//     page cannot describe a token the stylesheet no longer declares.
//   - `src/__tests__/design-tokens.test.ts` checks CSS ↔ mirror agreement and
//     the Panel bracket/title clearance arithmetic.
//
// Adding a token: declare it in `src/index.css` (`@layer base :root` for
// non-colour tokens, `@theme inline` for `--color-*`), then add the row here.
// The test fails until both sides agree.

/** One token: its CSS custom-property name, the value declared in
 *  `src/index.css`, and the role it plays in the system. */
export type TokenSpec = {
    /** Custom-property name including the leading `--`. */
    readonly name: string;
    /** The value EXACTLY as declared in `src/index.css` (whitespace is
     *  normalised before comparison, nothing else). */
    readonly value: string;
    readonly role: string;
};

/** A named group of tokens, as the census page renders them. */
export type TokenGroup = {
    readonly id: string;
    readonly title: string;
    readonly blurb: string;
    readonly tokens: readonly TokenSpec[];
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. Fluid type — clamp() between the phone (390px) and desktop (1440px) ends
//    of the ADR 0101 §1 viewport matrix.
// ─────────────────────────────────────────────────────────────────────────────
export const FLUID_TYPE_TOKENS: readonly TokenSpec[] = [
    {
        name: "--t-xs",
        value: "clamp(0.6875rem, 0.6643rem + 0.0952vw, 0.75rem)",
        role: "11 → 12px · labels, badges",
    },
    {
        name: "--t-sm",
        value: "clamp(0.75rem, 0.7036rem + 0.1905vw, 0.875rem)",
        role: "12 → 14px · fine print, hints",
    },
    {
        name: "--t-base",
        value: "clamp(0.875rem, 0.8286rem + 0.1905vw, 1rem)",
        role: "14 → 16px · body",
    },
    {
        name: "--t-lg",
        value: "clamp(1rem, 0.9536rem + 0.1905vw, 1.125rem)",
        role: "16 → 18px · panel titles",
    },
    {
        name: "--t-xl",
        value: "clamp(1.125rem, 1.0321rem + 0.381vw, 1.375rem)",
        role: "18 → 22px · section headings",
    },
    {
        name: "--t-2xl",
        value: "clamp(1.375rem, 1.1893rem + 0.7619vw, 1.875rem)",
        role: "22 → 30px · hero / title treatment",
    },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 2. Density — three rungs, base units 8 / 10 / 12px.
// ─────────────────────────────────────────────────────────────────────────────
export const DENSITY_TOKENS: readonly TokenSpec[] = [
    {
        name: "--density-unit-compact",
        value: "8px",
        role: "banners, pickers, board prompts",
    },
    {
        name: "--density-unit-comfortable",
        value: "10px",
        role: "phone-aware dialogs (default rhythm)",
    },
    {
        name: "--density-unit-roomy",
        value: "12px",
        role: "lobby, dialogs, full-page surfaces",
    },
    {
        name: "--density-unit",
        value: "var(--density-unit-comfortable)",
        role: "the active rhythm; set by [data-density]",
    },
    {
        name: "--panel-pad",
        value: "24px",
        role: "the active Panel padding; set by [data-density]",
    },
] as const;

/** The three v3 density rungs, with the outer Panel padding each resolves to.
 *  Rendered by the census; the padding values are asserted against the
 *  `[data-density]` rules in `src/index.css` by the drift guard. */
export const DENSITY_RUNGS = [
    {
        density: "compact",
        unit: "8px",
        panelPad: "8px",
        panelPadWide: null,
        replaces: 'v2 "compact" (p-2)',
    },
    {
        density: "comfortable",
        unit: "10px",
        panelPad: "12px",
        panelPadWide: "24px",
        replaces: 'v2 "compact-mobile" (p-3 / p-6 at 420px)',
    },
    {
        density: "roomy",
        unit: "12px",
        panelPad: "24px",
        panelPadWide: null,
        replaces: 'v2 "default" (p-6) — still the Panel default',
    },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 3. Pointer-aware control heights.
// ─────────────────────────────────────────────────────────────────────────────
export const CONTROL_HEIGHT_TOKENS: readonly TokenSpec[] = [
    {
        name: "--control-h-fine",
        value: "32px",
        role: "mouse / trackpad (pointer: fine)",
    },
    {
        name: "--control-h-coarse",
        value: "44px",
        role: "touch (pointer: coarse) — WCAG 2.5.8",
    },
    {
        name: "--control-h",
        value: "var(--control-h-fine)",
        role: "the active height; coarse under @media (pointer: coarse)",
    },
    {
        name: "--control-h-sm",
        value: "calc(var(--control-h) - 4px)",
        role: "dense rung: small buttons, segmented pills",
    },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 4. Motion.
// ─────────────────────────────────────────────────────────────────────────────
export const MOTION_TOKENS: readonly TokenSpec[] = [
    { name: "--motion-fast", value: "120ms", role: "hover, press, tone swap" },
    {
        name: "--motion-base",
        value: "200ms",
        role: "panel/sheet enter, tab change",
    },
    { name: "--motion-slow", value: "320ms", role: "route + overlay entrance" },
    {
        name: "--motion-ease-standard",
        value: "cubic-bezier(0.2, 0, 0, 1)",
        role: "default easing",
    },
    {
        name: "--motion-ease-emphasis",
        value: "cubic-bezier(0.22, 1, 0.36, 1)",
        role: "arrivals, one-shot flourishes",
    },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 5. Panel v3 frame.
// ─────────────────────────────────────────────────────────────────────────────
export const PANEL_FRAME_TOKENS: readonly TokenSpec[] = [
    {
        name: "--panel-bracket-inset",
        value: "4px",
        role: "bracket offset from the panel border",
    },
    {
        name: "--panel-bracket-size",
        value: "10px",
        role: "bracket arm length (was a 40px filigree)",
    },
    { name: "--panel-bracket-width", value: "1px", role: "bracket stroke" },
    {
        name: "--panel-bracket-opacity",
        value: "0.5",
        role: "bracket opacity",
    },
    {
        name: "--panel-title-bracket-clearance",
        value: "4px",
        role: "minimum gap between bracket and title (ADR 0101 §2)",
    },
    {
        name: "--panel-header-pad-x",
        value: "20px",
        role: "title inset from the panel border",
    },
] as const;

/** Every v3 group, in census order. */
export const V3_TOKEN_GROUPS: readonly TokenGroup[] = [
    {
        id: "fluid-type",
        title: "Fluid type",
        blurb: "Each step interpolates between its 390px and 1440px value and clamps outside. Replaces the fixed text-xs…text-2xl jumps that made a phone read the desktop scale verbatim.",
        tokens: FLUID_TYPE_TOKENS,
    },
    {
        id: "density",
        title: "Density",
        blurb: "Three rungs, base units 8 / 10 / 12px. --density-unit is the internal rhythm, --panel-pad the outer Panel padding; both are set by [data-density].",
        tokens: DENSITY_TOKENS,
    },
    {
        id: "control-heights",
        title: "Pointer control heights",
        blurb: "Chosen by the input device, never by viewport width: 44px on a coarse pointer, 32px on a fine one.",
        tokens: CONTROL_HEIGHT_TOKENS,
    },
    {
        id: "motion",
        title: "Motion",
        blurb: "Named durations and easings. All three durations collapse to 1ms (not 0 — transitionend must still fire) under prefers-reduced-motion: reduce.",
        tokens: MOTION_TOKENS,
    },
    {
        id: "panel-frame",
        title: "Panel v3 frame",
        blurb: "10px inset brackets at 1px / opacity .5. The title inset must exceed the bracket reach by the clearance token — asserted arithmetically, since happy-dom has no layout engine.",
        tokens: PANEL_FRAME_TOKENS,
    },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Semantic colour palette (ADR 0007, phase 3). Moved out of
// `src/routes/design-system/sections-foundations.tsx`, where the same hexes
// were hand-maintained and could drift from `src/index.css` unnoticed; the
// drift guard now checks these against the `@theme inline` block too.
// ─────────────────────────────────────────────────────────────────────────────
export type ColorTokenSpec = {
    readonly name: string;
    readonly hex: string;
    readonly role: string;
};

export const PALETTE_TOKENS: readonly ColorTokenSpec[] = [
    { name: "surface-base", hex: "#0d0b07", role: "app ground" },
    { name: "surface", hex: "#16110a", role: "panel ground" },
    { name: "surface-elevated", hex: "#241d12", role: "raised plate" },
    { name: "border-subtle", hex: "#2e2516", role: "hairlines" },
    { name: "border-accent", hex: "#6b5a36", role: "gold trim" },
    { name: "accent", hex: "#c9a24b", role: "primary gold" },
    { name: "accent-strong", hex: "#ecc878", role: "bright gold" },
    { name: "accent-soft", hex: "#4a3a1c", role: "gold wash" },
    { name: "secondary-accent", hex: "#5f97a8", role: "cool teal" },
    { name: "secondary-accent-strong", hex: "#9cc6d4", role: "bright teal" },
    { name: "secondary-accent-soft", hex: "#234049", role: "teal wash" },
    { name: "danger", hex: "#b1473a", role: "garnet fill" },
    { name: "danger-strong", hex: "#e89384", role: "danger text" },
    { name: "danger-soft", hex: "#4a1a14", role: "danger wash" },
    { name: "success", hex: "#6fa05a", role: "success fill" },
    { name: "success-strong", hex: "#a8d292", role: "success text" },
    { name: "success-soft", hex: "#274a1f", role: "success wash" },
    { name: "parchment", hex: "#f3ead2", role: "brightest text" },
    { name: "text", hex: "#e9e0cb", role: "body text" },
    { name: "text-muted", hex: "#b7a984", role: "secondary text" },
    { name: "text-disabled", hex: "#968a68", role: "labels / disabled" },
] as const;

export const SIGNAL_TOKENS: readonly ColorTokenSpec[] = [
    { name: "border-strong", hex: "#7d6b42", role: "input/control edges" },
    { name: "signal-self", hex: "#34d399", role: "my turn/priority/selection" },
    { name: "signal-self-strong", hex: "#6ee7b7", role: "self, bright" },
    { name: "signal-opponent", hex: "#fb7185", role: "opponent turn" },
    {
        name: "signal-opponent-strong",
        hex: "#fda4af",
        role: "opponent, bright",
    },
    { name: "signal-pending", hex: "#fbbf24", role: "waiting/urgent" },
    { name: "signal-pending-strong", hex: "#fcd34d", role: "pending, bright" },
    { name: "signal-target", hex: "#a78bfa", role: "targetable/pickable" },
    { name: "signal-target-strong", hex: "#c4b5fd", role: "target, bright" },
    { name: "combat-1", hex: "#ef4444", role: "combat group ring" },
    { name: "combat-2", hex: "#3b82f6", role: "combat group ring" },
    { name: "combat-3", hex: "#22c55e", role: "combat group ring" },
    { name: "combat-4", hex: "#eab308", role: "combat group ring" },
] as const;

/** Categorical chart-series hues (issue #2586, dataviz skill) — identity
 *  color for a chart series (e.g. deck-stats type band segments), never
 *  status/signal meaning. Eight-slot FIXED order, validated against this
 *  app's own dark chart surface (`--color-surface`); see the token's own
 *  comment in `src/index.css` for the exact `validate_palette.js` command
 *  and results. Consumers assign slots by presence-order within a fixed
 *  canonical entity list (never by count/rank) so any two rendered-adjacent
 *  segments are always a validated adjacent pair. */
export const CHART_CATEGORICAL_TOKENS: readonly ColorTokenSpec[] = [
    { name: "chart-cat-1", hex: "#3987e5", role: "chart series 1" },
    { name: "chart-cat-2", hex: "#d95926", role: "chart series 2" },
    { name: "chart-cat-3", hex: "#199e70", role: "chart series 3" },
    { name: "chart-cat-4", hex: "#c98500", role: "chart series 4" },
    { name: "chart-cat-5", hex: "#d55181", role: "chart series 5" },
    { name: "chart-cat-6", hex: "#008300", role: "chart series 6" },
    { name: "chart-cat-7", hex: "#9085e9", role: "chart series 7" },
    { name: "chart-cat-8", hex: "#e66767", role: "chart series 8" },
] as const;

/** Parse a `<n>px` token value to a number. Throws on anything else, so a
 *  token that stops being a plain pixel length fails loudly instead of
 *  silently comparing as NaN. */
export function pxValue(value: string): number {
    const m = /^(-?[\d.]+)px$/.exec(value.trim());
    if (!m) throw new Error(`not a px length: ${value}`);
    return Number(m[1]);
}

/** The ADR 0101 §2 clearance invariant, as arithmetic over the frame tokens:
 *  a Panel title never sits within `--panel-title-bracket-clearance` of a
 *  corner bracket. Returns the actual gap in px (negative = overlap). */
export function bracketTitleGapPx(
    tokens: Record<string, string> = Object.fromEntries(
        PANEL_FRAME_TOKENS.map((t) => [t.name, t.value])
    )
): number {
    const reach =
        pxValue(tokens["--panel-bracket-inset"]) +
        pxValue(tokens["--panel-bracket-size"]);
    return pxValue(tokens["--panel-header-pad-x"]) - reach;
}
