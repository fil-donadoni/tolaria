/**
 * Boot-configuration regions of the two BOOT FILES (issue #10616): the spans
 * of `src/main.tsx` and `vite.config.ts` whose tokens configure something that
 * cannot move a pixel, read by the hunk classifier (`ui-render-inert.ts`).
 *
 * WHY. Both files are global by path — the app shell, the build configuration
 * — so any changed line in them owed a FULL walk. PR #10614 (issue #10414)
 * added a `tunnel` option to `Sentry.init(...)` and a dev-server proxy entry:
 * monitoring transport, no rendered element, still FULL. These regions let
 * such a hunk contribute nothing, and nothing else in the two files.
 *
 * RESTRICTED, and fail-closed like the rest of the scoper. On a boot file the
 * classifier accepts ONLY trivia, a token inside one of these regions, and a
 * value import whose new bindings only these regions read — no event-handler
 * rule, no other construct. The regions:
 *
 *   - `src/main.tsx`: the argument list of a `Sentry.init(...)` call — the
 *     SDK's DSN, transport, sampling and scrubbing options. A line naming the
 *     feedback widget or the report dialog (both render DOM) — on the line
 *     or on any call enclosing it inside the region — stays reaching.
 *   - `vite.config.ts`: the `proxy` table of the `server` / `preview` blocks
 *     of the `defineConfig({...})` object — dev-server request forwarding,
 *     which shapes no bundle. A line whose key is the bare root (`"/"`,
 *     `"^/"`), which would shadow every route the walk loads, stays reaching.
 *
 * ACCEPTED RESIDUALS, recorded rather than closed:
 *   - a proxy key other than the root that shadows a path the app loads
 *     (`/assets`, a route) is not recognised: the key may be computed, and
 *     the walk would show the breakage as a load failure, not a layout one;
 *   - a `Sentry.init` integration other than feedback that injects DOM is
 *     not recognised by name (none of the SDK's others does);
 *   - a region admits ANY expression: a call into app code evaluated at boot
 *     (`tracesSamplerFor(...)`) is cleared on its changed line alone. A line
 *     naming the DOM, a class or style, or a state setter (the handler rule's
 *     `RENDER_REACHING`) stays reaching, and so does an import no line reads.
 */
import * as ts from "typescript";

/** The files whose boot-configuration regions this module reads. */
export const BOOT_CONFIG_FILES: readonly string[] = [
    "src/main.tsx",
    "vite.config.ts",
];

export interface BootRegion {
    start: number;
    end: number;
    label: string;
}

export interface BootConfigScan {
    regions: BootRegion[];
    /** A line inside a region that this matches reaches rendering anyway. */
    refuse: { test: RegExp; why: string };
}

/** Sentry's widgets that DO render: the feedback button and the crash dialog. */
const SENTRY_RENDERING_OPTION = /feedback|reportDialog/i;

/** A proxy key that is the bare root, shadowing every route. */
const ROOT_PROXY_KEY = /^\s*["'`]\^?\/["'`]\s*:/;

export function isBootConfigFile(path: string): boolean {
    return BOOT_CONFIG_FILES.includes(path);
}

/** The boot-configuration regions of `sf`, or `null` when `path` is not a
 *  boot file. */
export function bootConfigScan(
    path: string,
    sf: ts.SourceFile
): BootConfigScan | null {
    if (path === "src/main.tsx") {
        return {
            regions: sentryInitArguments(sf),
            refuse: {
                test: SENTRY_RENDERING_OPTION,
                why: "a Sentry.init option naming the feedback widget or report dialog, which render",
            },
        };
    }
    if (path === "vite.config.ts") {
        return {
            regions: devServerProxyTables(sf),
            refuse: {
                test: ROOT_PROXY_KEY,
                why: "a dev-server proxy key on the bare root, which shadows every route",
            },
        };
    }
    return null;
}

function walk(sf: ts.SourceFile, visit: (n: ts.Node) => void): void {
    const go = (n: ts.Node): void => {
        visit(n);
        ts.forEachChild(n, go);
    };
    go(sf);
}

/** Every `Sentry.init(<args>)` call's argument span. */
function sentryInitArguments(sf: ts.SourceFile): BootRegion[] {
    const out: BootRegion[] = [];
    walk(sf, (n) => {
        if (!ts.isCallExpression(n) || n.arguments.length === 0) return;
        const callee = n.expression;
        if (
            !ts.isPropertyAccessExpression(callee) ||
            !ts.isIdentifier(callee.expression) ||
            callee.expression.text !== "Sentry" ||
            callee.name.text !== "init"
        ) {
            return;
        }
        out.push({
            start: n.arguments[0].getStart(sf),
            end: n.arguments[n.arguments.length - 1].getEnd(),
            label: "the Sentry.init options (monitoring transport and sampling)",
        });
    });
    return out;
}

/** The `proxy` table of `server` / `preview` in `defineConfig({...})`. */
function devServerProxyTables(sf: ts.SourceFile): BootRegion[] {
    const out: BootRegion[] = [];
    walk(sf, (n) => {
        if (
            !ts.isCallExpression(n) ||
            !ts.isIdentifier(n.expression) ||
            n.expression.text !== "defineConfig"
        ) {
            return;
        }
        const config = n.arguments[0];
        if (!config || !ts.isObjectLiteralExpression(config)) return;
        for (const block of ["server", "preview"]) {
            const server = propertyObject(config, block);
            const proxy = server && propertyObject(server, "proxy");
            if (!proxy) continue;
            out.push({
                start: proxy.getStart(sf),
                end: proxy.getEnd(),
                label: "the dev-server proxy table (forwards requests, shapes no bundle)",
            });
        }
    });
    return out;
}

/** `obj.<name>` when it is written as a plain property holding an object
 *  literal; `null` otherwise (computed, spread, shorthand, a reference). */
function propertyObject(
    obj: ts.ObjectLiteralExpression,
    name: string
): ts.ObjectLiteralExpression | null {
    for (const p of obj.properties) {
        if (
            ts.isPropertyAssignment(p) &&
            (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
            p.name.text === name &&
            ts.isObjectLiteralExpression(p.initializer)
        ) {
            return p.initializer;
        }
    }
    return null;
}
