/**
 * The surfaces `bun run check:ui` walks, and the click sequences that reach
 * them (issue #2580). One entry here == one row in `budgets.json`; the two
 * lists are cross-checked by `evaluateRun`, so adding a surface without a
 * budget reds the lane instead of quietly measuring nothing.
 *
 * The walks are the executable copy of `docs/guides/ui-runbooks.md`. When one
 * of them drifts, update BOTH — the runbook is what a human follows when the
 * lane says a surface is unreachable and they have to see why.
 *
 * THE RULE FOR A WALK: reaching the screen is best-effort, but a failure to
 * reach it is never swallowed. Throw `Unreachable` with a reason a human can
 * act on ("no event with a pool"), and the lane reports the surface UNWALKED
 * and exits non-zero. Never fall back to a different screen and probe that.
 *
 * NON-DESTRUCTIVE BY CONSTRUCTION: the lane never concedes a match it did not
 * create and never loads a debug scenario into a game it did not create. A
 * pre-existing game is resumed read-only, and the surfaces that would clobber
 * it report UNWALKED. That is why an active game makes the lane red rather
 * than making it lie.
 */
import type { Page } from "playwright";

/** Thrown by a walk that could not reach its screen. Reason is user-facing. */
export class Unreachable extends Error {
    constructor(reason: string) {
        super(reason);
        this.name = "Unreachable";
    }
}

export interface WalkContext {
    baseUrl: string;
    /** The debug-scenario label the stress board surface loads. */
    stressScenarioLabel: string;
    /** Set once the lane has created the active game itself. */
    createdGame: boolean;
    log(message: string): void;
}

export interface Surface {
    id: string;
    label: string;
    walk(page: Page, ctx: WalkContext): Promise<void>;
}

const NAV_TIMEOUT = 20_000;
const STEP_TIMEOUT = 8_000;

/** Convex holds a websocket open, so `networkidle` never fires — settle on the
 *  app shell plus a short quiet period instead. */
async function settle(page: Page): Promise<void> {
    await page.waitForLoadState("domcontentloaded");
    await page
        .locator("main, [data-app-shell], body > #root")
        .first()
        .waitFor({ timeout: NAV_TIMEOUT })
        .catch(() => {});
    await page.waitForTimeout(1200);
}

async function goto(page: Page, ctx: WalkContext, path: string): Promise<void> {
    await page.goto(`${ctx.baseUrl}${path}`, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT,
    });
    await settle(page);
}

async function visible(
    page: Page,
    selector: string,
    timeout = STEP_TIMEOUT
): Promise<boolean> {
    try {
        await page
            .locator(selector)
            .first()
            .waitFor({ state: "visible", timeout });
        return true;
    } catch {
        return false;
    }
}

async function clickIfVisible(
    page: Page,
    selector: string,
    timeout = STEP_TIMEOUT
): Promise<boolean> {
    if (!(await visible(page, selector, timeout))) return false;
    await page.locator(selector).first().click({ timeout: STEP_TIMEOUT });
    return true;
}

/**
 * Open the n-th event under YOUR CURRENT EVENTS on `/limited`.
 *
 * The row's `View` is a BUTTON that navigates programmatically, not an
 * anchor — harvesting `a[href^='/limited/']` finds nothing and reports "no
 * event on this deployment" on a page that is showing one. Click the control
 * the runbook names.
 */
const EVENT_VIEW = "button:has-text('View'), a:has-text('View')";

/** A pack tile on the draft pick screen. The card NAME is only in the
 *  aria-label (`limited-draft-pack-card.tsx`), never in the text content, so
 *  a `:has-text('Draft pick')` selector matches nothing on a live pack. */
const DRAFT_PICK_TILE = "button[aria-label^='Draft pick:']";

async function limitedEventCount(
    page: Page,
    ctx: WalkContext
): Promise<number> {
    await goto(page, ctx, "/limited");
    return await page.locator(EVENT_VIEW).count();
}

async function openLimitedEvent(
    page: Page,
    ctx: WalkContext,
    index: number
): Promise<boolean> {
    await goto(page, ctx, "/limited");
    const views = page.locator(EVENT_VIEW);
    if (index >= (await views.count())) return false;
    await views.nth(index).click({ timeout: STEP_TIMEOUT });
    await page
        .waitForURL(/\/limited\/[^/]+$/, { timeout: NAV_TIMEOUT })
        .catch(() => {});
    await settle(page);
    return /^\/limited\/[^/]+$/.test(new URL(page.url()).pathname);
}

/**
 * Reach a live board. Runbook: "Start a solo game from cold" plus its
 * "Blocked by an active game" branch — with the branch resolved the safe way
 * round (Resume, never Concede: ending someone's match is their call).
 */
async function ensureBoard(page: Page, ctx: WalkContext): Promise<void> {
    if (page.url().includes("/game")) {
        if (await visible(page, "text=/Pass|YOUR GO|Untap|Upkeep/i", 4000))
            return;
    }
    await goto(page, ctx, "/");

    // Already inside a match? Resume it — read-only, and it is the only branch
    // that does not destroy state the developer may care about.
    if (await clickIfVisible(page, "button:has-text('Resume')", 4000)) {
        ctx.log("resumed the pre-existing active game");
    } else {
        const picked = await clickIfVisible(
            page,
            "button:has-text('Select')",
            6000
        );
        if (!picked) {
            throw new Unreachable(
                "the lobby offered neither Resume nor a deck Select button — is the deployment seeded with preset decks?"
            );
        }
        if (
            !(await clickIfVisible(page, "button:has-text('Solo Game')", 6000))
        ) {
            throw new Unreachable(
                "Solo Game stayed disabled after selecting a deck"
            );
        }
        ctx.createdGame = true;
        ctx.log("created a solo game");
    }

    await page.waitForURL(/\/game/, { timeout: NAV_TIMEOUT }).catch(() => {
        throw new Unreachable("the lobby never routed to /game");
    });
    await settle(page);

    // Coin toss, then one mulligan prompt per seat. Both are conditional: a
    // resumed game is usually past them.
    await clickIfVisible(page, "button:has-text('Play')", 6000);
    for (let seat = 0; seat < 2; seat++) {
        if (!(await clickIfVisible(page, "button:has-text('Keep')", 6000)))
            break;
        await page.waitForTimeout(800);
    }
    await settle(page);

    if (
        !(await visible(
            page,
            "text=/Pass|YOUR GO|Untap|Upkeep|Library/i",
            10_000
        ))
    ) {
        throw new Unreachable(
            "reached /game but no board affordance rendered within 10s"
        );
    }
}

export const SURFACES: readonly Surface[] = [
    {
        id: "lobby",
        label: "Lobby (/)",
        async walk(page, ctx) {
            await goto(page, ctx, "/");
            if (!(await visible(page, "main, [role=main]", 10_000))) {
                throw new Unreachable("the lobby rendered no main region");
            }
        },
    },
    {
        id: "deck-builder",
        label: "Constructed deck builder (/decks/create)",
        async walk(page, ctx) {
            await goto(page, ctx, "/decks/create");
            if (!(await visible(page, "input, button", 10_000))) {
                throw new Unreachable("the deck builder rendered no controls");
            }
        },
    },
    {
        id: "design-system",
        label: "Design system census (/admin/design-system)",
        async walk(page, ctx) {
            // The permanent census page (ADR 0101 names it the living record
            // of v3). It lives UNDER /admin — it was moved off the guessable
            // top-level path with the other curation surfaces (router.tsx).
            //
            // The reachability check is the census HEADING, not `main`: the
            // 404 page also renders a `main`, so a `main`-only assertion
            // measured the not-found screen and reported PASS. Measured
            // exactly that on the wrong path while writing this walk.
            await goto(page, ctx, "/admin/design-system");
            if (
                !(await visible(
                    page,
                    "h1:has-text('Design system census')",
                    10_000
                ))
            ) {
                throw new Unreachable(
                    "/admin/design-system did not render the census heading"
                );
            }
        },
    },
    {
        id: "design-system-dialog",
        label: "GameDialog live demo (/admin/design-system → Open live demo)",
        async walk(page, ctx) {
            // The lane's only MODAL row. Every in-game dialog is a GameDialog,
            // and the census page opens a real one on demand — so the dialog
            // gets measured at all five viewports without touching a live game
            // (issue #2581; ADR 0101 §2 re-specifies the Panel frame those
            // dialogs are built on).
            await goto(page, ctx, "/admin/design-system");
            // The FIRST "Open live demo" is specimen A (GameDialog); B is the
            // plain shadcn dialog and C the ActionSheet. Wait rather than
            // probe: the census page is long and its sections mount late.
            const opener = page
                .getByRole("button", { name: "Open live demo" })
                .first();
            try {
                await opener.waitFor({ state: "visible", timeout: 10_000 });
            } catch {
                throw new Unreachable(
                    "/admin/design-system rendered no `Open live demo` button"
                );
            }
            await opener.scrollIntoViewIfNeeded({ timeout: STEP_TIMEOUT });
            await opener.click({ timeout: STEP_TIMEOUT });
            if (!(await visible(page, "[role=dialog]", STEP_TIMEOUT))) {
                throw new Unreachable(
                    "`Open live demo` did not open a dialog within 8s"
                );
            }
            await page.waitForTimeout(400);
        },
    },
    {
        id: "limited-list",
        label: "Limited events list (/limited)",
        async walk(page, ctx) {
            await goto(page, ctx, "/limited");
            if (!(await visible(page, "main, [role=main]", 10_000))) {
                throw new Unreachable("/limited rendered no main region");
            }
        },
    },
    {
        id: "limited-your-events",
        label: "Your Limited events (/limited/events)",
        async walk(page, ctx) {
            await goto(page, ctx, "/limited/events");
            if (!(await visible(page, "main, [role=main]", 10_000))) {
                throw new Unreachable(
                    "/limited/events rendered no main region"
                );
            }
        },
    },
    {
        id: "limited-build",
        label: "Limited pool builder (/limited/<id>/build)",
        async walk(page, ctx) {
            const count = await limitedEventCount(page, ctx);
            if (count === 0) {
                throw new Unreachable(
                    "no Limited event on this deployment — create one from /limited (+ Create Event) and re-run"
                );
            }
            for (let i = 0; i < Math.min(count, 3); i++) {
                if (!(await openLimitedEvent(page, ctx, i))) continue;
                if (
                    await clickIfVisible(
                        page,
                        "a:has-text('Build Deck'), button:has-text('Build Deck')",
                        4000
                    )
                ) {
                    await page
                        .waitForURL(/\/build$/, { timeout: NAV_TIMEOUT })
                        .catch(() => {});
                    await settle(page);
                    if (page.url().endsWith("/build")) return;
                }
            }
            throw new Unreachable(
                "no Limited event offered Build Deck (none has a ready pool for this seat)"
            );
        },
    },
    {
        id: "draft-pick",
        label: "Draft pick screen (/limited/<id> while drafting)",
        async walk(page, ctx) {
            const count = await limitedEventCount(page, ctx);
            if (count === 0) {
                throw new Unreachable(
                    "no Limited event on this deployment — create one from /limited (+ Create Event) and re-run"
                );
            }
            for (let i = 0; i < Math.min(count, 3); i++) {
                if (!(await openLimitedEvent(page, ctx, i))) continue;
                if (await visible(page, DRAFT_PICK_TILE, 4000)) {
                    return;
                }
            }
            throw new Unreachable(
                "no Limited event is in the drafting phase (the pick screen IS /limited/<id> while status=drafting)"
            );
        },
    },
    {
        id: "game-board",
        label: "Game board (/game)",
        async walk(page, ctx) {
            await ensureBoard(page, ctx);
        },
    },
    {
        id: "game-stress",
        label: "Game board — UI stress scenario",
        async walk(page, ctx) {
            await ensureBoard(page, ctx);
            if (!ctx.createdGame) {
                throw new Unreachable(
                    "an active game the lane did not create is in progress; loading a scenario would clobber it. Finish or concede it, then re-run"
                );
            }
            if (
                !(await clickIfVisible(page, "button:has-text('Debug')", 6000))
            ) {
                throw new Unreachable(
                    "no Debug panel toggle on the board — the signed-in account is probably not an admin"
                );
            }
            if (
                !(await clickIfVisible(
                    page,
                    "button:has-text('Scenarios')",
                    6000
                ))
            ) {
                throw new Unreachable(
                    "the Debug panel offered no Scenarios button"
                );
            }
            const search = page
                .locator("input[placeholder*='Search scenarios']")
                .first();
            if (
                !(await visible(
                    page,
                    "input[placeholder*='Search scenarios']",
                    6000
                ))
            ) {
                throw new Unreachable(
                    "the Scenarios list did not open (listDebugScenarios is admin-gated — is this account an admin?)"
                );
            }
            await search.fill(ctx.stressScenarioLabel);
            await page.waitForTimeout(600);
            const row = page.locator(
                `button:has-text(${JSON.stringify(ctx.stressScenarioLabel)})`
            );
            if ((await row.count()) === 0) {
                throw new Unreachable(
                    `debug scenario "${ctx.stressScenarioLabel}" is absent from this deployment — seed it with debugScenarios:seedScenarioDirect (see the PR receipt's scenario field)`
                );
            }
            await row.first().click({ timeout: STEP_TIMEOUT });
            await page.waitForTimeout(2500);
            await settle(page);
        },
    },
];

export const SURFACE_IDS: readonly string[] = SURFACES.map((s) => s.id);
