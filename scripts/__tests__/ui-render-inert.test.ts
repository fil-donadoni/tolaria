// Golden fixtures for the hunk classifier (issue #10393): a changed module
// owes `check:ui` nothing only when EVERY changed line — removed on the base,
// added on the head — sits in a render-inert construct. Each fixture is a
// base / head pair; the changed lines are derived by a line LCS, the shape
// `git diff -U0` reports.
import { describe, expect, it } from "vitest";
import {
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

    it("a side-effect import reaches rendering", () => {
        const head = `import "./next-game-dialog.css";\n${BASE}`;
        expect(judge(head)).toEqual({
            inert: false,
            at: `${DIALOG}:1: a side-effect import`,
        });
    });
});

describe("isRenderInertCandidate", () => {
    it("clears only src/** TS modules that are not global styling inputs", () => {
        expect(isRenderInertCandidate(DIALOG)).toBe(true);
        expect(isRenderInertCandidate("src/main.tsx")).toBe(false);
        expect(isRenderInertCandidate("src/router.tsx")).toBe(false);
        expect(isRenderInertCandidate("src/lib/design-tokens.ts")).toBe(false);
        expect(isRenderInertCandidate("src/index.css")).toBe(false);
        expect(isRenderInertCandidate("convex/game.ts")).toBe(false);
    });
});
