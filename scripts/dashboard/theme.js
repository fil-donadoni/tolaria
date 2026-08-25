/**
 * The light/dark toggle (#2625).
 *
 * `theme.js` deliberately does NOT import History's `refresh`: it would drag
 * the whole History module graph into the statically imported set that must
 * load before the Now panel can poll (see history-boot.js). Instead History
 * registers itself as a listener when — and only when — it boots, so a page
 * with no telemetry store still has a working theme button.
 */

const listeners = [];

/** Called after every theme change, in registration order. */
export function onThemeChange(fn) {
    listeners.push(fn);
}

export function initTheme(params) {
    // ?theme=light|dark pins the palette for a link or a capture.
    const themeParam = params.get("theme");
    if (themeParam === "light" || themeParam === "dark")
        document.documentElement.setAttribute("data-theme", themeParam);

    document.getElementById("theme").addEventListener("click", () => {
        const cur = document.documentElement.getAttribute("data-theme");
        const next =
            cur === "dark"
                ? "light"
                : cur === "light"
                  ? null
                  : matchMedia("(prefers-color-scheme: dark)").matches
                    ? "light"
                    : "dark";
        if (next) document.documentElement.setAttribute("data-theme", next);
        else document.documentElement.removeAttribute("data-theme");
        for (const fn of listeners) fn();
    });
}
