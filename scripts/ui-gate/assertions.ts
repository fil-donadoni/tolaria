/**
 * NAMED ASSERTIONS — the positive half of the invariant gate (ADR 0132 §3,
 * issue #3649, PRD #3643).
 *
 * The Floors say what must never be true of a screen (`floors.ts`): no card
 * collapsed to zero, no control stranded, no serious axe violation. They are
 * blind to the other half of the question — whether the screen still OFFERS
 * what it exists to offer. The lobby walk asserted a `<main>` element and
 * nothing else, so a lobby that lost every Mode Tile, its primary action and
 * its deck shelves would have measured a clean `PASS`
 * (`docs/findings/2726-ui-gate-lobby-walk-asserts-almost-nothing.md`).
 *
 * So every surface DECLARES what it promises about itself, by name:
 *
 *   { label: "mode tile: Solo game", locator: { selector: '[data-mode-tile="solo"]' }, check: "reachable" }
 *
 * and each promise is evaluated at EVERY viewport, on the Settled Screen, and
 * printed as its own line of the Verdict Block (`assert <surface> <viewport>
 * PASS|FAIL <label>`), which `land` re-derives. A label is therefore part of
 * the receipt's fixed text: renaming one changes what a PR must paste.
 *
 * THE THREE CHECKS.
 *
 *   - `reachable` — Playwright's own actionability check WITHOUT the click
 *     (`click({ trial: true })`: visible, stable, enabled, and the element
 *     that answers a pointer at its own centre), plus the element's centre
 *     landing inside the viewport once Playwright has scrolled to it. The
 *     scroll is deliberate and is the same distinction `probe.js` draws
 *     between `stranded` and `reachable`: a control below the fold of a
 *     scrolling page is reachable by a gesture and is not a defect, while one
 *     that cannot be brought into the viewport at all is.
 *   - `visible` — rendered and visible, nothing about gestures. For a control
 *     whose whole point is that it is DISABLED in the state the walk measures
 *     (the Loadout's primary plate on a lobby with no deck selected).
 *   - `contrast` — axe-core's `color-contrast` rule over that element's
 *     subtree only. The surface-wide axe run is already a Floor; this is the
 *     one that says WHICH subtree had to pass, so a CTA that goes
 *     low-contrast is named by the assertion that covered it rather than
 *     drowned in a page count.
 *
 * LOCATORS ARE ROLE+NAME OR `data-*`, and the offline guard below refuses
 * anything else. A locator like `main, [role=main]` or `.btn-primary` is a
 * promise about markup, which is exactly the promise that keeps passing while
 * the screen loses its content; a role+name locator is a promise about what a
 * USER can find, and a `data-*` attribute is a seam the app declares on
 * purpose (`data-mode-tile`, `data-lobby-primary`, `data-deck-select`) for the
 * controls whose visible text is a deck name or a selected tile's title.
 */
import type { Locator, Page } from "playwright";

/** The checks a surface may declare. */
export const ASSERTION_CHECKS = ["reachable", "visible", "contrast"] as const;

export type AssertionCheck = (typeof ASSERTION_CHECKS)[number];

/**
 * How an assertion addresses its element. Role+name is what a user (and a
 * screen reader) can find; a `data-*` selector is a declared walk seam.
 */
export type AssertionLocator =
    | { role: string; name: string }
    | { selector: string };

/** One promise a surface makes about itself, checked at every viewport. */
export interface NamedAssertion {
    /**
     * The name this promise is printed and re-derived by. Stable text in the
     * Verdict Block: keep it short, say what the element IS, and change it
     * only when the promise itself changes.
     */
    label: string;
    locator: AssertionLocator;
    check: AssertionCheck;
}

/** One assertion's outcome at one viewport. `detail` is empty on a pass and
 *  is printed in the DIAGNOSTIC block, never on the verdict line — a
 *  Playwright message differs between two runs of one tree. */
export interface AssertResult {
    label: string;
    ok: boolean;
    detail: string;
}

/** A surface the guard reads: its id and whatever it declares. */
export interface AssertingSurface {
    id: string;
    asserts?: readonly NamedAssertion[];
}

/** A surface that does not declare its assertions yet, and the slice that
 *  gives it some. Same idiom as `UNWALKED_SURFACES` (`floors.ts`): the hole is
 *  a reviewable line with an issue on it, never a silent absence. */
export interface AssertionDebt {
    surface: string;
    issue: number;
}

/**
 * The surfaces still carrying no assertion, each with the slice that closes
 * it. Issue #3649 shipped the shape and the auth + lobby promises, issue #3651
 * the game, debug and admin ones; issue #3650 takes the deck, Limited and
 * draft surfaces. An entry is DELETED by the slice that declares that surface's
 * assertions — the guard reds on a debt row for a surface that has them, so
 * this list can only shrink.
 *
 * DRAINING A ROW MEANS THE SURFACE'S ENTRY POINTS, not one promise that cannot
 * fail. This guard enforces addressing style and presence; what holds the
 * lobby honest is the per-surface entry-point list in
 * `ui-gate-assertions.test.ts`, checked against the surface's runbook. Each of
 * #3650 and #3651 owes the equivalent list for the surfaces it takes.
 */
export const ASSERTION_DEBT: readonly AssertionDebt[] = [
    { surface: "deck-builder", issue: 3650 },
    { surface: "deck-detail", issue: 3650 },
    { surface: "limited-list", issue: 3650 },
    { surface: "limited-your-events", issue: 3650 },
    { surface: "limited-antechamber", issue: 3650 },
    { surface: "limited-build", issue: 3650 },
    { surface: "draft-pick", issue: 3650 },
    { surface: "draft-pool-stop", issue: 3650 },
    { surface: "draft-pool-peek", issue: 3650 },
];

/** The attribute a `contrast` assertion marks its subtree with while axe reads
 *  it. Removed in a `finally`, so a failed run never leaves it on the page. */
export const ASSERT_MARK_ATTRIBUTE = "data-ui-gate-assert";

/**
 * What the mark/unmark closures below need of their element.
 *
 * `tsconfig.scripts.json` carries no `lib.dom`, and the sibling walks pass
 * their page functions as SOURCE TEXT for exactly that reason (`topmostAt` in
 * `surfaces.ts`). That trick cannot be used here: Playwright evaluates a
 * STRING as an EXPRESSION, so `"(el) => el.setAttribute(…)"` evaluates to a
 * function and is never called with the element — measured on this branch, and
 * it fails silently as `No elements found for include in page Context` from
 * axe one step later, which reads like a contrast defect and is not one. A
 * real closure is passed instead, with its parameter narrowed here rather than
 * leaning on a global `HTMLElement`.
 */
interface MarkableElement {
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
}

/** How long one assertion waits for its element. Short on purpose: the screen
 *  is already settled when assertions run, so this is not a load wait. */
const ASSERT_TIMEOUT_MS = 5_000;

/** The locator as a reader should see it in a failure line. */
export function describeLocator(locator: AssertionLocator): string {
    return "selector" in locator
        ? locator.selector
        : `role=${locator.role} name=${JSON.stringify(locator.name)}`;
}

/**
 * A `data-*` compound: `[data-foo]`, `[data-foo="bar"]`, and anything hung off
 * one (`[data-deck-select]:not([disabled])`). What it refuses is a compound
 * that leads with a tag, class or id — `main`, `.panel`, `#root` — because
 * that is a claim about markup rather than about a named thing.
 */
function dataCompound(part: string): boolean {
    return /^\[data-[a-z][a-z0-9-]*(?:[~^$*|]?=(?:"[^"]*"|'[^']*'|[^\]]+))?\]/.test(
        part
    );
}

/**
 * Why this locator is not a legal one, or `null`. The offline guard's whole
 * rule, pure and unit-testable: role+name, or a `data-*` selector naming ONE
 * element.
 */
export function locatorProblem(locator: AssertionLocator): string | null {
    if ("selector" in locator) {
        const selector = locator.selector.trim();
        if (selector === "") return "the selector is empty";
        if (selector.includes(","))
            return `\`${selector}\` names alternatives — an assertion addresses ONE element, so a comma is a promise about neither`;
        const parts = selector.split(/\s*>\s*|\s+/).filter(Boolean);
        const bare = parts.find((part) => !dataCompound(part));
        if (bare !== undefined)
            return `\`${selector}\` is a bare CSS locator at \`${bare}\` — an assertion addresses a role+name or a \`data-*\` seam, never markup`;
        return null;
    }
    if (locator.role.trim() === "") return "the role is empty";
    if (!/^[a-z]+$/.test(locator.role))
        return `\`${locator.role}\` is not an ARIA role`;
    if (locator.name.trim() === "")
        return `role=${locator.role} carries no accessible name — a nameless role is not a named assertion`;
    return null;
}

/**
 * THE OFFLINE GUARD (ADR 0132 §3). Every problem with the surface table's
 * assertions, in one pure function: a surface that declares none and is not in
 * the debt list, a debt row that has gone stale, an illegal locator, a
 * duplicate or unprintable label.
 *
 * Offline in the sense that matters here: no browser, no deployment, no
 * network — it is a vitest guard (`ui-gate-assertions.test.ts`) beside its
 * siblings `ui-gate-surface-entries.test.ts` and `ui-gate-floors.test.ts`, so
 * it runs in `check:guards` / `check:pr` / `bun run test` on every diff.
 */
export function assertionTableProblems(
    surfaces: readonly AssertingSurface[],
    debt: readonly AssertionDebt[] = ASSERTION_DEBT
): string[] {
    const problems: string[] = [];
    const owed = new Map(debt.map((d) => [d.surface, d]));
    const ids = new Set(surfaces.map((s) => s.id));

    for (const entry of debt) {
        if (!ids.has(entry.surface)) {
            problems.push(
                `ASSERTION_DEBT names \`${entry.surface}\`, which is not a surface — delete the row or fix the id`
            );
        }
        if (!Number.isInteger(entry.issue) || entry.issue <= 0) {
            problems.push(
                `ASSERTION_DEBT's \`${entry.surface}\` row carries no open issue — a coverage hole is tracked or it is closed`
            );
        }
    }

    for (const surface of surfaces) {
        const asserts = surface.asserts ?? [];
        const debtRow = owed.get(surface.id);
        if (asserts.length === 0) {
            if (!debtRow) {
                problems.push(
                    `${surface.id} declares no assertion — every surface promises at least one named thing about itself (ADR 0132 §3), or carries an ASSERTION_DEBT row with the issue that gives it one`
                );
            }
            continue;
        }
        if (debtRow) {
            problems.push(
                `${surface.id} declares ${asserts.length} assertion(s) and still has an ASSERTION_DEBT row (issue #${debtRow.issue}) — delete the row`
            );
        }
        const seen = new Set<string>();
        for (const assertion of asserts) {
            const label = assertion.label;
            if (label.trim() === "" || label !== label.trim()) {
                problems.push(
                    `${surface.id}: ${JSON.stringify(label)} is not a printable label — it is the receipt's own text, and \`land\` compares it trimmed`
                );
            }
            if (/[\r\n]/.test(label)) {
                problems.push(
                    `${surface.id}: ${JSON.stringify(label)} spans lines — one assertion is one line of the verdict block`
                );
            }
            if (seen.has(label)) {
                problems.push(
                    `${surface.id}: two assertions are labelled ${JSON.stringify(label)} — a label is how a failing promise is named`
                );
            }
            seen.add(label);
            const bad = locatorProblem(assertion.locator);
            if (bad) problems.push(`${surface.id} (${label}): ${bad}`);
            if (!ASSERTION_CHECKS.includes(assertion.check)) {
                problems.push(
                    `${surface.id} (${label}): \`${assertion.check}\` is not a check — one of ${ASSERTION_CHECKS.join(", ")}`
                );
            }
        }
    }

    return problems;
}

/**
 * The labels each surface promises, in declaration order — the vocabulary the
 * receipt is rendered from and the one `verify-receipt.ts` re-derives against.
 */
export function assertLabelsBySurface(
    surfaces: readonly AssertingSurface[]
): Record<string, readonly string[]> {
    return Object.fromEntries(
        surfaces.map((s) => [s.id, (s.asserts ?? []).map((a) => a.label)])
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// The browser half
// ─────────────────────────────────────────────────────────────────────────────

/** What one viewport's evaluation needs from the lane. */
export interface AssertionEnvironment {
    /** The context's viewport, in CSS pixels: what "in the viewport" means. */
    viewport: { width: number; height: number };
    /** Injects `axe-core` into the page. Called only by a `contrast` check, so
     *  a surface with none never pays for the injection. */
    ensureAxe: () => Promise<void>;
    timeoutMs?: number;
}

function resolveLocator(page: Page, locator: AssertionLocator): Locator {
    if ("selector" in locator) return page.locator(locator.selector);
    return page.getByRole(locator.role as Parameters<Page["getByRole"]>[0], {
        name: locator.name,
        exact: true,
    });
}

function firstLine(err: unknown): string {
    // Never `(err as Error).message`: a non-`Error` rejection would throw a
    // TypeError inside the catch that called this, and `evaluateAssertions`
    // promises to be total — one odd rejection would take the whole viewport
    // walk down instead of failing one promise.
    const message = err instanceof Error ? err.message : String(err);
    return message.split("\n")[0];
}

/** Playwright's actionability check, the scroll it performs, and the one thing
 *  it does not check: that the element ended up inside the viewport. */
async function checkReachable(
    element: Locator,
    env: AssertionEnvironment,
    timeout: number
): Promise<string | null> {
    try {
        await element.click({ trial: true, timeout });
    } catch (err) {
        return `not actionable: ${firstLine(err)}`;
    }
    const box = await element.boundingBox();
    if (!box) return "it has no layout box after the scroll";
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);
    const { width, height } = env.viewport;
    // `>=`: a centre exactly on the right or bottom edge is the first pixel
    // OUTSIDE the viewport, not the last one inside it.
    if (x < 0 || y < 0 || x >= width || y >= height) {
        return `its centre is at (${x}, ${y}), outside the ${width}x${height} viewport even after scrolling to it — no gesture reaches it`;
    }
    return null;
}

/**
 * axe-core's `color-contrast` rule, over this element's subtree only.
 *
 * FAIL-CLOSED ON INAPPLICABILITY. "No violations" is not "the rule passed":
 * axe's `color-contrast-matches` skips a DISABLED control and everything under
 * it, and matches nothing in a subtree with no text at all — so a promise
 * pointed at either reads green whatever the colours, which is the vacuous
 * assertion this whole mechanism exists to replace. A subtree the rule could
 * not judge at all is therefore a FAIL that says so.
 *
 * An `incomplete` node counts as judged: axe returns one where it cannot read
 * the background (art behind the text), and that is a "come and look", not a
 * proven violation — reading it as a red would put a flap back into the lane.
 */
async function checkContrast(
    page: Page,
    element: Locator,
    env: AssertionEnvironment
): Promise<string | null> {
    await env.ensureAxe();
    try {
        await element.evaluate((el, attr) => {
            (el as unknown as MarkableElement).setAttribute(attr, "1");
        }, ASSERT_MARK_ATTRIBUTE);
    } catch (err) {
        return `the subtree could not be marked for axe: ${firstLine(err)}`;
    }
    try {
        const selector = `[${ASSERT_MARK_ATTRIBUTE}]`;
        // No `resultTypes`: it truncates the node lists of everything that is
        // not a violation, and the passing and incomplete nodes are exactly
        // what says the rule APPLIED here.
        const result = (await page.evaluate(
            `(async () => {
                const r = await window.axe.run(
                    { include: [[${JSON.stringify(selector)}]] },
                    { runOnly: { type: "rule", values: ["color-contrast"] } }
                );
                const nodes = (rs) => rs.reduce((n, v) => n + v.nodes.length, 0);
                return {
                    passes: nodes(r.passes),
                    incomplete: nodes(r.incomplete),
                    violations: r.violations.flatMap((v) =>
                        v.nodes.map((n) => ({
                            impact: n.impact || v.impact || "unknown",
                            html: String(n.html || "").slice(0, 120),
                        }))
                    ),
                };
            })()`
        )) as {
            passes: number;
            incomplete: number;
            violations: { impact: string; html: string }[];
        };
        if (result.violations.length > 0) {
            return `${result.violations.length} colour-contrast violation(s): ${result.violations
                .slice(0, 3)
                .map((v) => `${v.impact} ${v.html}`)
                .join("; ")}`;
        }
        if (result.passes === 0 && result.incomplete === 0) {
            return "axe found nothing to contrast in this subtree — the rule did not apply (a disabled control, or no text), so this promise could never have failed: point it at an element the rule can judge";
        }
        return null;
    } catch (err) {
        return `axe could not read the subtree: ${firstLine(err)}`;
    } finally {
        await element
            .evaluate((el, attr) => {
                (el as unknown as MarkableElement).removeAttribute(attr);
            }, ASSERT_MARK_ATTRIBUTE)
            .catch(() => {});
    }
}

/**
 * Evaluate one surface's assertions on the CURRENT, settled page.
 *
 * Runs AFTER the probe, axe and the screenshot for this cell (`index.ts`'s
 * `measure()`): a `reachable` check scrolls the element into view, and the
 * measurement must be taken on the screen as it was found, not on the screen
 * the assertions left behind.
 *
 * Total by construction — every assertion produces a result, and an assertion
 * that throws for any reason is a FAIL carrying the reason. A missing element
 * is the failure this whole mechanism exists to catch, so it can never be an
 * exception that skips the rest of the list.
 */
export async function evaluateAssertions(
    page: Page,
    asserts: readonly NamedAssertion[],
    env: AssertionEnvironment
): Promise<AssertResult[]> {
    const timeout = env.timeoutMs ?? ASSERT_TIMEOUT_MS;
    const results: AssertResult[] = [];
    for (const assertion of asserts) {
        const where = describeLocator(assertion.locator);
        const fail = (detail: string): void => {
            results.push({
                label: assertion.label,
                ok: false,
                detail: `${assertion.check} \`${where}\` — ${detail}`,
            });
        };
        try {
            const all = resolveLocator(page, assertion.locator);
            const element = all.first();
            try {
                await element.waitFor({ state: "visible", timeout });
            } catch (err) {
                const n = await all.count().catch(() => -1);
                fail(
                    n === 0
                        ? "no element matches it"
                        : `${n === -1 ? "an" : n} element(s) match, none visible within ${Math.round(timeout / 1000)}s: ${firstLine(err)}`
                );
                continue;
            }
            const problem =
                assertion.check === "visible"
                    ? null
                    : assertion.check === "reachable"
                      ? await checkReachable(element, env, timeout)
                      : await checkContrast(page, element, env);
            if (problem) {
                fail(problem);
                continue;
            }
            results.push({ label: assertion.label, ok: true, detail: "" });
        } catch (err) {
            fail(`the check threw: ${firstLine(err)}`);
        }
    }
    return results;
}
