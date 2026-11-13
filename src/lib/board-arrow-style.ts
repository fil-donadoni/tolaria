/** Gold accent tokens (ADR 0007). The arrow is a metallic gold filament: a soft
 *  gold aura, a gradient core, and a bright hairline highlight on top — no dark
 *  channel, no heavy glow. */
export const ARROW_ACCENT = "var(--color-accent)";
export const ARROW_STRONG = "var(--color-accent-strong)";

/** The ids of one SVG's `<defs>` (gradient, arrowhead, shadow). Two layers
 *  draw arrows — the board layer and the focus layer above the veil — and
 *  each owns its own defs, so no id is duplicated in the document. */
export type ArrowDefIds = {
    grad: string;
    head: string;
    shadow: string;
    /** Issue #9500 — the origin socket at the arrow's start. */
    tail?: string;
};

/** How strongly one arrow is drawn:
 *  - `quiet` — a stack target arrow at rest (issue #9326): faint and thin, so
 *    a stack full of targets does not tangle the board;
 *  - `normal` — today's resting filament (combat and manual arrows);
 *  - `emphasized` — part of the hovered relationship. */
export type ArrowStrength = "quiet" | "normal" | "emphasized";
