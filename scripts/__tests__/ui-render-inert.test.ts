// Golden fixtures for the hunk classifier (issue #10393): a changed module
// owes `check:ui` nothing only when EVERY changed line — removed on the base,
// added on the head — sits in a render-inert construct. Each fixture is a
// base / head pair; the changed lines are derived by a line LCS, the shape
// `git diff -U0` reports.
import { describe, expect, it } from "vitest";
import {
    bootConfigImports,
    classifyRenderInert,
    isRenderInertCandidate,
    type ModuleHunks,
} from "../lib/ui-render-inert";
import { uiWalkOwed } from "../lib/ui-scope";

/** The 1-based lines `after` adds and `before` loses, by line LCS. */
function hunksOf(before: string, after: string): ModuleHunks {
    const a = before.split("\n");
    const b = after.split("\n");
    const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
        new Array<number>(b.length + 1).fill(0)
    );
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            lcs[i][j] =
                a[i] === b[j]
                    ? lcs[i + 1][j + 1] + 1
                    : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        }
    }
    const removed: number[] = [];
    const added: number[] = [];
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) {
            i++;
            j++;
        } else if (
            j < b.length &&
            (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])
        ) {
            added.push(++j);
        } else {
            removed.push(++i);
        }
    }
    return { before, after, removed, added };
}

const DIALOG = "src/components/board/next-game-dialog.tsx";

/** A dialog shaped like `manual-game-over-dialog.tsx` (PR #10390): a
 *  component with state, a named handler wired through `onClick`, and a
 *  value import only that handler reads. */
const BASE = `import { useState } from "react";
import { storeSession } from "~/lib/session";
import { formatScore } from "~/lib/score";

export default function NextGameDialog({ onSwitch, score }: Props) {
    const [busy, setBusy] = useState(false);
    const label = formatScore(score);

    const handleNext = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const next = await fetchNext();
            if (next) {
                storeSession(next.id);
                onSwitch(next.id);
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="dialog">
            <span>{label}</span>
            <button onClick={handleNext}>Next</button>
            <button
                onClick={() => {
                    onSwitch(null);
                }}
            >
                Leave
            </button>
        </div>
    );
}
`;

const judge = (head: string, base: string = BASE) =>
    classifyRenderInert(DIALOG, hunksOf(base, head));

describe("classifyRenderInert — render-inert hunks (issue #10393)", () => {
    it("a handler-body-only edit in a *dialog* file is render-inert", () => {
        const head = BASE.replace(
            "            if (next) {\n                storeSession(next.id);\n                onSwitch(next.id);\n            }\n",
            "            // The route persists the session itself.\n            if (next) onSwitch(next.id);\n"
        ).replace('import { storeSession } from "~/lib/session";\n', "");
        const verdict = judge(head);
        expect(verdict).toEqual({
            inert: true,
            reason: expect.stringContaining("the handleNext handler's body"),
        });
        // …and the dialog's NAME rule no longer owes a walk for it.
        expect(
            uiWalkOwed(
                [DIALOG],
                () => "if (next) onSwitch(next.id);\n",
                () => false,
                () => verdict
            )
        ).toMatchObject({ owed: false, inert: [{ path: DIALOG }] });
    });

    it("removing a value import whose binding only a handler read is render-inert", () => {
        const head = BASE.replace(
            'import { storeSession } from "~/lib/session";\n',
            ""
        ).replace("                storeSession(next.id);\n", "");
        expect(judge(head)).toEqual({
            inert: true,
            reason: expect.stringContaining(
                "an import from ~/lib/session whose changed bindings only handlers read"
            ),
        });
    });

    it("adding a binding to an import render already reads is render-inert when only a handler reads the new one", () => {
        const head = BASE.replace(
            'import { storeSession } from "~/lib/session";',
            'import { clearSession, storeSession } from "~/lib/session";'
        ).replace(
            "        if (busy) return;\n",
            "        if (busy) return;\n        clearSession();\n"
        );
        expect(judge(head)).toMatchObject({ inert: true });
    });

    it("a single-line JSX edit around an inline arrow reaches rendering: the line holds JSX tokens", () => {
        const base = BASE.replace(
            "            <button\n                onClick={() => {\n                    onSwitch(null);\n                }}\n            >\n                Leave\n            </button>",
            "            <button onClick={() => onSwitch(null)}>Leave</button>"
        );
        const head = base.replace("onSwitch(null)", "onSwitch(undefined)");
        expect(judge(head, base)).toMatchObject({ inert: false });
    });

    it("an edit inside an inline on* prop's arrow is render-inert", () => {
        const head = BASE.replace("onSwitch(null)", "onSwitch(undefined)");
        expect(judge(head)).toEqual({
            inert: true,
            reason: "an inline onClick handler's body",
        });
    });

    it("a comment-only edit is render-inert", () => {
        const head = BASE.replace(
            "    const handleNext",
            "    // Next game of the match.\n    const handleNext"
        );
        expect(judge(head)).toEqual({
            inert: true,
            reason: "comments / blank lines",
        });
    });
});

describe("classifyRenderInert — hunks that reach rendering stay owed (fail-closed)", () => {
    it("a state-setter call added in a handler reaches rendering", () => {
        const head = BASE.replace(
            "                onSwitch(next.id);\n",
            "                onSwitch(next.id);\n                setBusy(false);\n"
        );
        expect(judge(head)).toEqual({
            inert: false,
            at: expect.stringMatching(
                /:17: a line of the handleNext handler that sets state/
            ),
        });
    });

    it("a JSX edit reaches rendering", () => {
        const head = BASE.replace("<span>{label}</span>", "<b>{label}</b>");
        expect(judge(head)).toEqual({
            inert: false,
            at: `${DIALOG}:25: JSX (base side)`,
        });
    });

    it("a className edit reaches rendering", () => {
        const head = BASE.replace(
            'className="dialog"',
            'className="dialog wide"'
        );
        expect(judge(head)).toMatchObject({ inert: false });
    });

    it("an edit in the component's top-level body reaches rendering", () => {
        const head = BASE.replace(
            "formatScore(score);",
            "formatScore(score).trim();"
        );
        expect(judge(head)).toEqual({
            inert: false,
            at: expect.stringMatching(
                /:7: the body of NextGameDialog \(a component, hook or helper render can reach\)/
            ),
        });
    });

    it("an unparsable module reaches rendering", () => {
        const head = BASE.replace(
            "                onSwitch(next.id);\n",
            "                onSwitch(next.id;\n"
        );
        expect(judge(head)).toEqual({
            inert: false,
            at: expect.stringContaining("unparsable module"),
        });
    });

    it("an edit to an import binding render reads reaches rendering", () => {
        const head = BASE.replace(
            'import { formatScore } from "~/lib/score";',
            'import { formatScore } from "~/lib/score-v2";'
        );
        expect(judge(head)).toEqual({
            inert: false,
            at: expect.stringContaining(
                ":3: an import whose binding is read outside an event handler"
            ),
        });
    });

    it("a 'handler' render also calls is no handler", () => {
        const base = BASE.replace(
            "<span>{label}</span>",
            "<span>{label}{handleNext.length}</span>"
        );
        const head = base.replace(
            "if (busy) return;",
            "if (busy) return null;"
        );
        expect(judge(head, base)).toMatchObject({ inert: false });
    });

    it("an effect body is no handler", () => {
        const base = BASE.replace(
            "    const label",
            "    useEffect(() => {\n        track(score);\n    }, [score]);\n    const label"
        );
        const head = base.replace("track(score);", "track(score, 1);");
        expect(judge(head, base)).toMatchObject({ inert: false });
    });

    it("an exported function is no handler: its callers live elsewhere", () => {
        const base = `export const handleNext = () => {\n    go(1);\n};\n`;
        const head = base.replace("go(1)", "go(2)");
        expect(classifyRenderInert(DIALOG, hunksOf(base, head))).toMatchObject({
            inert: false,
        });
    });

    it("an <img onError> / onLoad body runs at rest: no handler (review, issue #10393)", () => {
        const base = BASE.replace(
            "            <span>{label}</span>\n",
            "            <img\n                onError={(e) => {\n                    e.currentTarget.src = fallback;\n                }}\n                onLoad={() => {\n                    onImageLoaded?.();\n                }}\n            />\n"
        );
        expect(base).not.toBe(BASE);
        const head = base
            .replace("src = fallback;", "src = placeholder;")
            .replace("onImageLoaded?.();", "onImageLoaded?.(true);");
        expect(judge(head, base)).toMatchObject({ inert: false });
    });

    it("a custom component's at-rest callback (onReady) is no handler", () => {
        const base = BASE.replace(
            "            <span>{label}</span>\n",
            "            <Preview\n                onReady={() => {\n                    reveal(1);\n                }}\n            />\n"
        );
        const head = base.replace("reveal(1);", "reveal(2);");
        expect(judge(head, base)).toMatchObject({ inert: false });
    });

    it("a side-effect import reaches rendering", () => {
        const head = `import "./next-game-dialog.css";\n${BASE}`;
        expect(judge(head)).toEqual({
            inert: false,
            at: `${DIALOG}:1: a side-effect import`,
        });
    });
});

// Boot files (issue #10616): `src/main.tsx` and `vite.config.ts` are global by
// path; only their boot-configuration regions, trivia and the imports only
// those regions read are inert — nothing else, handlers included.
const MAIN = "src/main.tsx";
const MAIN_BASE = `import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import { AppRouter } from "./app-router";

Sentry.init({
    dsn: "https://key@o1.ingest.sentry.io/2",
    enableLogs: true,
});

const onError = () => {
    console.warn("boot failed");
};
window.addEventListener("error", onError);

createRoot(document.getElementById("root")!).render(<AppRouter />);
`;
const judgeMain = (head: string) =>
    classifyRenderInert(MAIN, hunksOf(MAIN_BASE, head));

const VITE = "vite.config.ts";
const VITE_BASE = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            "/scryfall-proxy": {
                target: "https://cards.scryfall.io",
                changeOrigin: true,
            },
        },
    },
    build: {
        sourcemap: true,
    },
});
`;
const judgeVite = (head: string) =>
    classifyRenderInert(VITE, hunksOf(VITE_BASE, head));

describe("classifyRenderInert — boot files (issue #10616)", () => {
    it("a Sentry.init option plus an import only it reads is inert in src/main.tsx", () => {
        const head = MAIN_BASE.replace(
            `import { AppRouter } from "./app-router";`,
            `import { AppRouter } from "./app-router";
import { TUNNEL } from "~/lib/diagnostics/sentry-tunnel";`
        ).replace(
            `    enableLogs: true,`,
            `    enableLogs: true,
    tunnel: TUNNEL,`
        );
        expect(judgeMain(head).inert).toBe(true);
    });

    it("a Sentry.init line naming the feedback widget reaches rendering", () => {
        const head = MAIN_BASE.replace(
            `    enableLogs: true,`,
            `    enableLogs: true,
    integrations: [Sentry.feedbackIntegration()],`
        );
        expect(judgeMain(head)).toMatchObject({ inert: false });
    });

    it("an option inside a multi-line feedbackIntegration({...}) reaches rendering (review, issue #10616)", () => {
        const withFeedback = MAIN_BASE.replace(
            `    enableLogs: true,`,
            `    enableLogs: true,
    integrations: [
        Sentry.feedbackIntegration({
            colorScheme: "dark",
        }),
    ],`
        );
        expect(
            classifyRenderInert(
                MAIN,
                hunksOf(withFeedback, withFeedback.replace(`"dark"`, `"light"`))
            )
        ).toMatchObject({ inert: false });
    });

    it("a Sentry.init option that writes the DOM reaches rendering", () => {
        const head = MAIN_BASE.replace(
            `"https://key@o1.ingest.sentry.io/2"`,
            `(document.body.style.zoom = "2", "x")`
        );
        expect(judgeMain(head)).toMatchObject({ inert: false });
    });

    it("an import nothing reads reaches rendering on a boot file: its module runs at load", () => {
        const head = MAIN_BASE.replace(
            `import { AppRouter } from "./app-router";`,
            `import { AppRouter } from "./app-router";
import { unused } from "./theme-boot";`
        );
        expect(judgeMain(head)).toMatchObject({ inert: false });
    });

    it("a render line in src/main.tsx reaches rendering", () => {
        const head = MAIN_BASE.replace(
            "render(<AppRouter />)",
            "render(<AppRouter strict />)"
        );
        expect(judgeMain(head)).toMatchObject({ inert: false });
    });

    it("no handler rule on a boot file: a handler-body edit in src/main.tsx stays owed", () => {
        const head = MAIN_BASE.replace(`"boot failed"`, `"boot failed again"`);
        expect(judgeMain(head)).toMatchObject({ inert: false });
    });

    it("an import a Sentry.init option AND module top level read stays owed", () => {
        const head = MAIN_BASE.replace(
            `import { AppRouter } from "./app-router";`,
            `import { AppRouter } from "./app-router";
import { DSN } from "./dsn";`
        )
            .replace(`"https://key@o1.ingest.sentry.io/2"`, "DSN")
            .replace(
                `window.addEventListener`,
                `console.log(DSN);
window.addEventListener`
            );
        expect(judgeMain(head)).toMatchObject({ inert: false });
    });

    it("a dev-server proxy entry is inert in vite.config.ts", () => {
        const head = VITE_BASE.replace(
            `        proxy: {
`,
            `        proxy: {
            "^/diag/relay$": {
                target: "https://o1.ingest.sentry.io",
                changeOrigin: true,
                rewrite: () => "/api/2/envelope/",
            },
`
        );
        expect(judgeVite(head).inert).toBe(true);
    });

    it("a proxy key on the bare root reaches rendering", () => {
        const head = VITE_BASE.replace(`"/scryfall-proxy": {`, `"/": {`);
        expect(judgeVite(head)).toMatchObject({ inert: false });
    });

    it("a build option edit in vite.config.ts reaches rendering", () => {
        const head = VITE_BASE.replace("sourcemap: true", "sourcemap: false");
        expect(judgeVite(head)).toMatchObject({ inert: false });
    });
});

// PR #10452 (issue #10321): the sampling options moved into a new module the
// Sentry.init options alone call (issue #10474).
const MAIN_TRACING = MAIN_BASE.replace(
    `import { AppRouter } from "./app-router";`,
    `import { AppRouter } from "./app-router";
import {
    sendableTransaction,
    tracesSamplerFor,
} from "~/lib/diagnostics/tracing";`
).replace(
    `    enableLogs: true,`,
    `    enableLogs: true,
    tracesSampler: tracesSamplerFor(import.meta.env.PROD),
    beforeSendTransaction: (event) => sendableTransaction(event),`
);

describe("bootConfigImports — imports only the Sentry.init options read (issue #10474)", () => {
    it("PR #10452's main.tsx hunk is inert, and its tracing import is admitted", () => {
        expect(judgeMain(MAIN_TRACING).inert).toBe(true);
        expect(bootConfigImports(MAIN, MAIN_TRACING)).toEqual({
            admitted: ["~/lib/diagnostics/tracing"],
            others: ["react-dom/client", "@sentry/react", "./app-router"],
        });
    });

    it("an import also read at module top level is not admitted", () => {
        const head = MAIN_TRACING.replace(
            `window.addEventListener`,
            `tracesSamplerFor(true);
window.addEventListener`
        );
        expect(bootConfigImports(MAIN, head)?.admitted).toEqual([]);
    });

    it("an import read inside a feedbackIntegration(...) call is not admitted: it mounts UI", () => {
        const head = MAIN_TRACING.replace(
            `    tracesSampler: tracesSamplerFor(import.meta.env.PROD),`,
            `    integrations: [
        Sentry.feedbackIntegration({
            sampler: tracesSamplerFor(true),
        }),
    ],`
        );
        expect(bootConfigImports(MAIN, head)?.admitted).toEqual([]);
    });

    it("a module also named by a dynamic import counts among the others", () => {
        const head = `${MAIN_TRACING}void import("~/lib/diagnostics/tracing");\n`;
        expect(bootConfigImports(MAIN, head)?.others).toContain(
            "~/lib/diagnostics/tracing"
        );
    });

    it("a template import() is unreadable: nothing admitted", () => {
        const head = `${MAIN_TRACING}void import(\`./x/\${location.hash}\`);\n`;
        expect(bootConfigImports(MAIN, head)).toBeNull();
    });

    it("no boot file, no boot imports", () => {
        expect(bootConfigImports("src/lib/x.ts", MAIN_TRACING)).toBeNull();
    });
});

describe("isRenderInertCandidate", () => {
    it("clears only src/** TS modules that are not global styling inputs", () => {
        expect(isRenderInertCandidate(DIALOG)).toBe(true);
        // The boot files, under the restricted rule set (issue #10616).
        expect(isRenderInertCandidate("src/main.tsx")).toBe(true);
        expect(isRenderInertCandidate("vite.config.ts")).toBe(true);
        expect(isRenderInertCandidate("vitest.config.ts")).toBe(false);
        expect(isRenderInertCandidate("src/router.tsx")).toBe(false);
        expect(isRenderInertCandidate("src/lib/design-tokens.ts")).toBe(false);
        expect(isRenderInertCandidate("src/index.css")).toBe(false);
        expect(isRenderInertCandidate("convex/game.ts")).toBe(false);
    });
});
