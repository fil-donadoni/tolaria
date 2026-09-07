/**
 * The per-boot action token's page-side carrier (#2628).
 *
 * Extracted from `telemetry-serve.ts` by ADR 0117 because the dashboard is now
 * a built Vite app and there are TWO documents the token has to ride into: the
 * BUILD's `index.html`, injected by the server on the way out, and the dev
 * server's transformed `index.html`, injected by a plugin in
 * `vite.dashboard.config.ts`. Two copies of an escaping rule is one copy too
 * many — the guard is only as good as its weaker half.
 *
 * The token itself is NOT here. It stays a module-private `const` in
 * `telemetry-serve.ts`, minted once per boot and never exported; everything
 * below is a pure function of the token it is handed.
 */

/** The `<meta name>` the page reads the token back out of. */
export const ACTION_TOKEN_META = "loop-action-token";

export function escapeAttribute(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Puts the boot token in the served page's `<head>`, which is how the
 * dashboard gets hold of it (guard 2). A cross-origin page cannot read it —
 * that is the same-origin policy doing the work the `Origin` check backs up.
 *
 * If the shell somehow had no `</head>` the injection would no-op and every
 * action would 401; `telemetry-serve.test.ts` pins that the shipped document
 * carries exactly one.
 */
export function injectActionToken(html: string, token: string): string {
    const tag = `<meta name="${ACTION_TOKEN_META}" content="${escapeAttribute(token)}" />`;
    // A FUNCTION replacer, never a string one (#2628 review round 1,
    // finding 5). `String.prototype.replace` reads `$&`, `` $` ``, `$'` and
    // `$1` in a STRING replacement as replacement patterns, and
    // `escapeAttribute` deliberately does not escape `$` (it is harmless in an
    // attribute) — so a token carrying one would splice surrounding document
    // text into the page. A function's return value is inserted verbatim,
    // which is what makes `escapeAttribute`'s "safe by construction rather
    // than by the token's current shape" claim actually true.
    return html.replace("</head>", () => `    ${tag}\n    </head>`);
}
