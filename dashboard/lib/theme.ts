/**
 * The dashboard's theme, as a store (PRD #3148 S1).
 *
 * THREE states, not two. `data-theme="light"` and `data-theme="dark"` are
 * explicit choices; the attribute's ABSENCE means "follow the system", which
 * is a real third answer and not a synonym for light — `dashboard/index.css`
 * redefines its tokens under `prefers-color-scheme` for exactly that state.
 * The toggle cycles through all three so an operator can get back to it.
 *
 * Two things this took over from `scripts/dashboard/theme.js`, and one it
 * added:
 *
 * - `?theme=light|dark` still PINS the palette for a shared link or a capture.
 *   A pin is not a preference: it does not overwrite what the operator chose.
 * - `onThemeChange` still exists, because History redraws its SVG charts with
 *   colours read from the computed style and has to be told. It registers
 *   itself only when it boots (a page with no telemetry store must still have
 *   a working theme button), which is why this is a listener list and not an
 *   import from History.
 * - The choice is now REMEMBERED (`localStorage`). Before the port it lived in
 *   a DOM attribute and died on reload, so an operator re-picked dark on every
 *   visit.
 */

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

const STORAGE_KEY = "tolaria.dashboard.theme";

const listeners = new Set<() => void>();

function isTheme(value: unknown): value is Theme {
    return (
        typeof value === "string" &&
        (THEMES as readonly string[]).includes(value)
    );
}

/** Reading storage throws in a browser configured to block site data, and the
 *  dashboard must come up anyway — a theme is not worth a blank page. */
function storedTheme(): Theme | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return isTheme(raw) ? raw : null;
    } catch {
        return null;
    }
}

function persist(theme: Theme): void {
    try {
        localStorage.setItem(STORAGE_KEY, theme);
    } catch {
        // Same reasoning as `storedTheme`: unavailable storage degrades to a
        // per-session choice, never to an error.
    }
}

/** The DOM attribute is the single source the CSS reads, so it is also the
 *  single source this module reads back. */
function applyToDocument(theme: Theme): void {
    if (theme === "system") {
        document.documentElement.removeAttribute("data-theme");
        return;
    }
    document.documentElement.setAttribute("data-theme", theme);
}

export function getTheme(): Theme {
    const attr = document.documentElement.getAttribute("data-theme");
    return isTheme(attr) ? attr : "system";
}

export function setTheme(theme: Theme): void {
    applyToDocument(theme);
    persist(theme);
    for (const fn of listeners) fn();
}

/** light → dark → system → light. Every state is reachable from every other,
 *  which a two-state toggle cannot offer once the third exists. */
export function cycleTheme(): void {
    const order: Theme[] = ["light", "dark", "system"];
    const next = order[(order.indexOf(getTheme()) + 1) % order.length];
    setTheme(next);
}

/**
 * Resolve the initial theme, once, before the first paint.
 *
 * Order is deliberate: a `?theme=` PIN wins for the life of the page but is
 * never written to storage — a link someone pasted must not silently rewrite
 * the preference of whoever opened it.
 */
export function initTheme(params: URLSearchParams): void {
    const pinned = params.get("theme");
    if (isTheme(pinned)) {
        applyToDocument(pinned);
        return;
    }
    applyToDocument(storedTheme() ?? "system");
}

export function onThemeChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** `useSyncExternalStore`'s subscribe half. The media query is part of it:
 *  in `system` the RESOLVED palette changes with no call to `setTheme`, and a
 *  toggle label reading "system (dark)" has to follow. */
export function subscribeToTheme(onStoreChange: () => void): () => void {
    const off = onThemeChange(onStoreChange);
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", onStoreChange);
    return () => {
        off();
        media.removeEventListener("change", onStoreChange);
    };
}

/** What the page is ACTUALLY painted as — `system` resolved against the OS. */
export function resolvedTheme(): "light" | "dark" {
    const theme = getTheme();
    if (theme !== "system") return theme;
    return matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
}
