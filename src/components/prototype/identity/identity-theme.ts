// PROTOTYPE — throwaway (branch prototype/identity-v4).
// The knobs the switcher exposes + the CSS-variable sets each one maps to.
// Everything is namespaced `--p-*` so nothing leaks into the real tokens.

export const SURFACES = ["lobby", "board"] as const;
export const GROUNDS = ["graphite", "ink", "brown"] as const;
export const FRAMES = ["a", "b", "c"] as const;
export const ACCENTS = ["mono", "brass"] as const;
export const PERMS = ["crop", "card"] as const;
export const DENSITIES = ["menu", "list"] as const;

export type Surface = (typeof SURFACES)[number];
export type Ground = (typeof GROUNDS)[number];
export type Frame = (typeof FRAMES)[number];
export type Accent = (typeof ACCENTS)[number];
export type Perm = (typeof PERMS)[number];
export type Density = (typeof DENSITIES)[number];

export interface IdentitySearch {
    surface?: Surface;
    ground?: Ground;
    frame?: Frame;
    accent?: Accent;
    perm?: Perm;
    density?: Density;
}

export const DEFAULTS: Required<IdentitySearch> = {
    surface: "lobby",
    ground: "graphite",
    frame: "a",
    accent: "mono",
    perm: "card",
    density: "menu",
};

export const FRAME_LABEL: Record<Frame, string> = {
    a: "A · hairline + grain",
    b: "B · thin brackets",
    c: "C · no frame",
};

function pick<T extends string>(
    v: unknown,
    allowed: readonly T[]
): T | undefined {
    return typeof v === "string" && (allowed as readonly string[]).includes(v)
        ? (v as T)
        : undefined;
}

export function validateIdentitySearch(
    search: Record<string, unknown>
): IdentitySearch {
    const out: IdentitySearch = {};
    const s = pick(search.surface, SURFACES);
    const g = pick(search.ground, GROUNDS);
    const f = pick(search.frame, FRAMES);
    const a = pick(search.accent, ACCENTS);
    const p = pick(search.perm, PERMS);
    const d = pick(search.density, DENSITIES);
    if (s) out.surface = s;
    if (g) out.ground = g;
    if (f) out.frame = f;
    if (a) out.accent = a;
    if (p) out.perm = p;
    if (d) out.density = d;
    return out;
}

const GROUND_VARS: Record<Ground, Record<string, string>> = {
    graphite: {
        "--p-bg": "#0b0d11",
        "--p-bg-deep": "#07080b",
        "--p-surface": "#14171c",
        "--p-elevated": "#1c2027",
        "--p-text": "#e8e2d2",
        "--p-muted": "#9a968c",
        "--p-faint": "#6b6861",
        "--p-ivory": "#efe9da",
        "--p-line": "rgba(232, 226, 210, 0.12)",
        "--p-line-strong": "rgba(232, 226, 210, 0.30)",
        "--p-halo": "rgba(232, 226, 210, 0.06)",
    },
    ink: {
        "--p-bg": "#080b14",
        "--p-bg-deep": "#04060c",
        "--p-surface": "#10141f",
        "--p-elevated": "#171c2a",
        "--p-text": "#e6e4dc",
        "--p-muted": "#9599a6",
        "--p-faint": "#646a78",
        "--p-ivory": "#eeeadf",
        "--p-line": "rgba(226, 228, 236, 0.12)",
        "--p-line-strong": "rgba(226, 228, 236, 0.30)",
        "--p-halo": "rgba(180, 190, 220, 0.07)",
    },
    brown: {
        "--p-bg": "#0d0b07",
        "--p-bg-deep": "#080603",
        "--p-surface": "#16110a",
        "--p-elevated": "#241d12",
        "--p-text": "#e9e0cb",
        "--p-muted": "#b7a984",
        "--p-faint": "#7d6b42",
        "--p-ivory": "#f3ead2",
        "--p-line": "rgba(201, 162, 75, 0.22)",
        "--p-line-strong": "rgba(201, 162, 75, 0.45)",
        "--p-halo": "rgba(201, 162, 75, 0.08)",
    },
};

const ACCENT_VARS: Record<Accent, Record<string, string>> = {
    mono: {
        "--p-accent": "var(--p-ivory)",
        "--p-accent-ink": "#0b0d11",
        "--p-accent-glow": "rgba(239, 233, 218, 0.55)",
        "--p-rule": "var(--p-line-strong)",
    },
    brass: {
        "--p-accent": "#c9a65b",
        "--p-accent-ink": "#1a1406",
        "--p-accent-glow": "rgba(201, 166, 91, 0.55)",
        "--p-rule": "rgba(201, 166, 91, 0.55)",
    },
};

// Game-state signals — unchanged from today's tokens on purpose (they are not
// part of the identity question; they carry meaning).
const SIGNAL_VARS: Record<string, string> = {
    "--p-self": "#34d399",
    "--p-opp": "#fb7185",
    "--p-pending": "#fbbf24",
    "--p-target": "#a78bfa",
    "--p-danger": "#b1473a",
    "--p-danger-strong": "#e89384",
};

export function themeStyle(
    ground: Ground,
    accent: Accent
): Record<string, string> {
    return { ...GROUND_VARS[ground], ...ACCENT_VARS[accent], ...SIGNAL_VARS };
}

/** Google Fonts link for the display face (DEV prototype only — a real
 *  adoption would vendor the woff2 like Beleren is). */
export const DISPLAY_FONT_HREF =
    "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300..700;1,300..700&display=swap";
