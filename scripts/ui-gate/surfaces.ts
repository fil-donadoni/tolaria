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
    /**
     * Walk this surface BEFORE the lane signs in, on the signed-out page.
     *
     * The auth screen is the one thing `<AuthGate>` makes unreachable to a
     * signed-in session, so it was invisible to this lane by construction —
     * the very screen every user meets first was the only one with no
     * measurement behind it. A `preAuth` surface is walked at the top of each
     * viewport's context; `ensureSignedIn` re-navigates to the app root
     * afterwards, so leaving the sign-in form mid-flow costs the rest of the
     * run nothing.
     */
    preAuth?: boolean;
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

/** A pack tile in the Draft Room. Two traps in one selector:
 *  - the card NAME is only in the aria-label (`limited-draft-pack-card.tsx`),
 *    never in the text content, so `:has-text('Draft pick')` matches nothing;
 *  - the tile is a `div role="button"` (it has to be — it is also the dnd-kit
 *    draggable), so the `button[...]` selector this used to be matched ZERO
 *    tiles on a live pack. That is why `budgets.json` recorded "renders no
 *    pack for this seat right now": the lane was looking for an element that
 *    does not exist (issue #2587). */
const DRAFT_PICK_TILE = "[role=button][aria-label^='Draft pick:']";

/** The phone-only snap surface and its two strip halves (issue #2588). Absent
 *  at desktop/tablet widths, where the room renders the split instead. */
const DRAFT_SNAP_SCROLLER = "[data-slot=draft-snap-scroller]";
const DRAFT_STRIP_DROP = "[data-slot=draft-strip-drop]";
const DRAFT_POOL = "[data-slot=draft-pool]";

/**
 * Land on `/limited/<id>/draft` with a live pack for this seat.
 *
 * Issue #2587 moved the pick screen OFF the event page onto its own immersive
 * route. Two ways in, and the walk takes whichever the deployment offers: the
 * event page redirects a seated player while a Pick is pending (one-shot per
 * tab), and once that shot is spent the event page offers "Enter the Draft
 * Room". Shared by both draft surfaces, so the two can never drift apart
 * about what "the room" means.
 */
async function reachDraftRoom(page: Page, ctx: WalkContext): Promise<void> {
    const count = await limitedEventCount(page, ctx);
    if (count === 0) {
        throw new Unreachable(
            "no Limited event on this deployment — create one from /limited (+ Create Event) and re-run"
        );
    }
    for (let i = 0; i < Math.min(count, 3); i++) {
        const landed = await openLimitedEvent(page, ctx, i);
        if (landed === null) continue;
        if (landed === "event") {
            if (
                !(await clickIfVisible(
                    page,
                    "a:has-text('Enter the Draft Room')",
                    4000
                ))
            ) {
                continue;
            }
            await page
                .waitForURL(/\/draft$/, { timeout: NAV_TIMEOUT })
                .catch(() => {});
            await settle(page);
        }
        if (!page.url().endsWith("/draft")) continue;
        // The room renders for a Sealed seat too (reveal mode), so reaching
        // the URL is not enough: the surface these rows budget is the PICK
        // screen, and its tiles are the proof.
        if (await visible(page, DRAFT_PICK_TILE, 4000)) return;
    }
    throw new Unreachable(
        "no Limited event is in the drafting phase with a live pack for this seat (the pick screen is /limited/<id>/draft since issue #2587)"
    );
}

/**
 * Issue #2588 AC 1/2: on a phone the room is ONE scroller with
 * `scroll-snap-type: y mandatory` holding two 85% panes, so exactly two
 * offsets rest — `0` and the scroller's own maximum. Nothing in between is a
 * resting position, which is what makes each strip a stable tab rather than a
 * band that drifts half off screen.
 *
 * `draftSnapStops.test.ts` proves the arithmetic that produces the
 * percentages, but it runs on happy-dom, which has no scroller and no
 * snapping — so it cannot prove the RESTING BEHAVIOUR, and until this helper
 * existed nothing did (review finding 1 on PR #2652). Sample offsets across
 * the range, let each settle, collect the distinct values it comes to rest at.
 *
 * A no-op off a phone: the split has no snap scroller.
 */
async function assertTwoSnapStops(page: Page): Promise<void> {
    if (!(await visible(page, DRAFT_SNAP_SCROLLER, 2000))) return;
    // Passed as a STRING, like `runProbe`'s call in `index.ts`: this file is
    // compiled by `tsconfig.node.json`, which carries no `dom` lib, so an
    // inline browser closure would not type-check.
    const result = (await page.evaluate(`(async () => {
        const s = document.querySelector("${DRAFT_SNAP_SCROLLER}");
        if (!s) return null;
        // The AXIS is the one thing the orientation changes (see
        // \`useDraftSnapStops\`): portrait swipes down, landscape sideways.
        // Reading scrollTop on the landscape scroller measures a range of 0
        // and reports the panes "did not lay out" on a screen that is fine.
        const x = s.getAttribute("data-orientation") === "landscape";
        const max = Math.round(
            x ? s.scrollWidth - s.clientWidth : s.scrollHeight - s.clientHeight
        );
        if (max < 8) return { axis: x ? "x" : "y", max: max, rested: [], note: "no scrollable range" };
        const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 120)));
        const to = (v) => s.scrollTo(x ? { left: v, behavior: "instant" } : { top: v, behavior: "instant" });
        const rested = [];
        for (let i = 0; i <= 10; i++) {
            to((max * i) / 10);
            await frame();
            const at = Math.round(x ? s.scrollLeft : s.scrollTop);
            const snapped = at <= 2 ? 0 : Math.abs(at - max) <= 2 ? max : at;
            if (rested.indexOf(snapped) === -1) rested.push(snapped);
        }
        to(0);
        await frame();
        return { axis: x ? "x" : "y", max: max, rested: rested, note: "" };
    })()`)) as {
        axis: string;
        max: number;
        rested: number[];
        note: string;
    } | null;

    if (result === null) return;
    if (result.note !== "") {
        throw new Unreachable(
            `the phone Draft Room's snap scroller has no scrollable range on its ${result.axis} axis (max ${result.max}px) — the two panes did not lay out`
        );
    }
    const unexpected = result.rested.filter((v) => v !== 0 && v !== result.max);
    if (unexpected.length > 0 || result.rested.length !== 2) {
        throw new Unreachable(
            `the phone Draft Room rests at ${result.rested.length} ${result.axis}-offsets [${result.rested.join(", ")}], not exactly the two AC 1 requires ([0, ${result.max}])`
        );
    }
}

async function limitedEventCount(
    page: Page,
    ctx: WalkContext
): Promise<number> {
    await goto(page, ctx, "/limited");
    return await page.locator(EVENT_VIEW).count();
}

/**
 * Open the nth event from `/limited`, and report where it landed.
 *
 * Since issue #2587 the event page REDIRECTS a seated player into the Draft
 * Room (`/limited/<id>/draft`) while a Pick is pending — one-shot per tab, so
 * the first open of a drafting event lands on the room and a later one does
 * not. Both are legitimate landings, which is why this returns the pathname
 * shape rather than a boolean "did we reach the event page": a walk that
 * demanded the old URL would report a drafting event as unreachable.
 */
async function openLimitedEvent(
    page: Page,
    ctx: WalkContext,
    index: number
): Promise<"event" | "draft" | null> {
    await goto(page, ctx, "/limited");
    const views = page.locator(EVENT_VIEW);
    if (index >= (await views.count())) return null;
    await views.nth(index).click({ timeout: STEP_TIMEOUT });
    await page
        .waitForURL(/\/limited\/[^/]+(\/draft)?$/, { timeout: NAV_TIMEOUT })
        .catch(() => {});
    await settle(page);
    const path = new URL(page.url()).pathname;
    if (/^\/limited\/[^/]+\/draft$/.test(path)) return "draft";
    if (/^\/limited\/[^/]+$/.test(path)) return "event";
    return null;
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
        id: "auth-sign-in",
        label: "Sign in (signed out, /)",
        preAuth: true,
        async walk(page, ctx) {
            await goto(page, ctx, "/");
            if (!(await visible(page, "input[type=email]", 15_000))) {
                throw new Unreachable(
                    "the app root did not render the sign-in form — is this context already signed in?"
                );
            }
        },
    },
    {
        id: "auth-forgot-password",
        label: "Password reset, step 1 (signed out, / → Forgot password?)",
        preAuth: true,
        async walk(page, ctx) {
            await goto(page, ctx, "/");
            if (!(await visible(page, "input[type=email]", 15_000))) {
                throw new Unreachable(
                    "the app root did not render the sign-in form — is this context already signed in?"
                );
            }
            if (
                !(await clickIfVisible(
                    page,
                    "button:has-text('Forgot password')"
                ))
            ) {
                throw new Unreachable(
                    "no `Forgot password?` control on the sign-in screen"
                );
            }
            if (!(await visible(page, "button:has-text('Send Code')", 6000))) {
                throw new Unreachable(
                    "`Forgot password?` did not swap in the reset form"
                );
            }
            await settle(page);
            // STEP 2 (code + new password) is NOT walked: reaching it needs a
            // live `flow: "reset"` round-trip, which mints a real OTP and
            // spends a real Resend send on every viewport of every run. The
            // step-2 layout is covered by
            // `src/components/auth/__tests__/forgot-password-form.test.tsx`
            // for behaviour and by a hand-driven CDP pass for layout — see
            // `docs/guides/ui-runbooks.md`.
        },
    },
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
        id: "deck-detail",
        label: "Deck detail (/decks/mono-red-burn)",
        async walk(page, ctx) {
            // `mono-red-burn` is a code-defined preset (`convex/deckPresets.ts`)
            // seeded into the `presetDecks` table on every deployment — always
            // present, unlike a user deck, so the walk needs no prior create
            // step (issue #2591: curve + legality + Edit/Play). `findDeckBySlug`
            // (`src/lib/deckLookup.ts`) matches `presetId === slug` exactly, so
            // the slug here MUST be a real entry in `deckPresets.ts` — a
            // deployment-only slug (e.g. a manually renamed row) throws
            // Unreachable on any other deployment.
            await goto(page, ctx, "/decks/mono-red-burn");
            if (
                !(await visible(page, "h1:has-text('Mono Red Burn')", 10_000))
            ) {
                throw new Unreachable(
                    "/decks/mono-red-burn did not render the deck detail heading"
                );
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
        // Issue #2590: `/limited/events` is now a REDIRECT stub to
        // `/limited?mine=1` — the your-events page it used to render was
        // absorbed into the merged list. The walk proves the redirect
        // actually lands somewhere real rather than just checking "a main
        // region exists" (which a stuck redirect's own loading screen would
        // also satisfy).
        label: "Your Limited events redirect (/limited/events → /limited?mine=1)",
        async walk(page, ctx) {
            await goto(page, ctx, "/limited/events");
            // The redirect target's query string is `?mine=true`, not
            // `?mine=1` — `stringifySearch` serializes the boolean, it never
            // emits the numeric literal a hand-typed/bookmarked URL would use
            // (see `src/router.tsx`'s `validateSearch`, which accepts both on
            // the way IN). A pattern anchored to `?mine=1` can never match
            // this navigation, so it always burned the full NAV_TIMEOUT
            // before falling through to the weaker substring check below.
            await page
                .waitForURL(/\/limited(\?.*)?$/, { timeout: NAV_TIMEOUT })
                .catch(() => {});
            if (!page.url().includes("/limited")) {
                throw new Unreachable(
                    "/limited/events did not redirect to /limited"
                );
            }
            if (!(await visible(page, "main, [role=main]", 10_000))) {
                throw new Unreachable(
                    "/limited/events redirected, but /limited rendered no main region"
                );
            }
        },
    },
    {
        id: "limited-antechamber",
        // Issue #2590: the event detail page — now a compact avatar row +
        // actions, with the Table Ring wired in as a dialog rather than
        // rendered inline. Lands specifically on the "event" case
        // `openLimitedEvent` reports — a drafting seat that gets redirected
        // straight to the Draft Room is a DIFFERENT surface (`draft-pick`
        // below), not this one.
        label: "Limited event antechamber (/limited/<id>)",
        async walk(page, ctx) {
            const count = await limitedEventCount(page, ctx);
            if (count === 0) {
                throw new Unreachable(
                    "no Limited event on this deployment — create one from /limited (+ Create Event) and re-run"
                );
            }
            for (let i = 0; i < Math.min(count, 3); i++) {
                if ((await openLimitedEvent(page, ctx, i)) !== "event") {
                    continue;
                }
                if (await visible(page, "main, [role=main]", 10_000)) return;
            }
            throw new Unreachable(
                "no Limited event landed on its antechamber (every seated event redirected straight to the Draft Room)"
            );
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
                if ((await openLimitedEvent(page, ctx, i)) !== "event")
                    continue;
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
        label: "Draft Room (/limited/<id>/draft)",
        async walk(page, ctx) {
            await reachDraftRoom(page, ctx);
            // AC 1/2 of issue #2588 ("exactly two scroll positions are
            // reachable") is a LAYOUT claim, and happy-dom cannot make it.
            // This is the only place it is asserted against a real scroller.
            await assertTwoSnapStops(page);
        },
    },
    {
        id: "draft-pool-stop",
        label: "Draft Room, pool stop (/limited/<id>/draft, swiped)",
        async walk(page, ctx) {
            // The SECOND state of the same route, and the biggest new surface
            // issue #2588 shipped. The `draft-pick` walk returns as soon as a
            // pack tile is visible, so it always measures the PACK stop — the
            // pool pane went in with no browser measurement at all (review
            // finding 1 on PR #2652), which is exactly the #2511 shape: in
            // portrait `LimitedDraftPool` runs `arrange="column"`, so two
            // `DeckZoneSurface`s share ~70% of a 390x844 screen, and a
            // collapsed MV row passes every happy-dom test there is.
            //
            // Off a phone there is no snap surface (`useViewportMode` calls
            // both tablets "desktop"), so the equivalent state is the split's
            // pool column scrolled to its end — still the pool at its far
            // extent, still a state `draft-pick` never probes.
            await reachDraftRoom(page, ctx);
            await assertTwoSnapStops(page);

            if (await visible(page, DRAFT_SNAP_SCROLLER, 2000)) {
                if (
                    !(await clickIfVisible(
                        page,
                        `${DRAFT_STRIP_DROP}[data-zone=maindeck]`,
                        4000
                    ))
                ) {
                    throw new Unreachable(
                        "the phone Draft Room rendered a snap scroller but no pool strip drop target to swipe with"
                    );
                }
                await page.waitForTimeout(700);
                const stop = await page
                    .locator(DRAFT_SNAP_SCROLLER)
                    .first()
                    .getAttribute("data-stop");
                if (stop !== "pool") {
                    throw new Unreachable(
                        `tapping the pool strip left the Draft Room at data-stop="${stop ?? "null"}" instead of "pool"`
                    );
                }
                // Reaching the stop is NOT reaching the pool. `pool.length === 0`
                // makes `LimitedDraftPool` return an `EmptyState` with no
                // `[data-slot=draft-pool]` at all, and neither `probe.js` (no
                // card-count floor) nor `budgets.ts` (no minimum-n rule) can
                // tell an empty pane from a healthy one: a Pick #1 seat would
                // score `zero0 occ0 stranded0 starved0` and pass GREEN, making
                // the one measurement that discharges the pool pane's layout
                // claims silently vacuous. Same guard the split branch below
                // runs — the fixture, not the stop, is what must be asserted.
                if (!(await visible(page, DRAFT_POOL, 4000))) {
                    throw new Unreachable(
                        'the phone Draft Room reached the pool stop but rendered no pool pane — this surface needs a seat with a NON-EMPTY pool (make a few picks in the room first: select a tile, then [data-editing-action="Pick"])'
                    );
                }
                return;
            }

            if (!(await visible(page, DRAFT_POOL, 4000))) {
                throw new Unreachable(
                    "the Draft Room rendered no pool pane — this seat's pool toggle may be off, or the pool is empty (this surface needs a NON-EMPTY pool: make a few picks first)"
                );
            }
            await page.evaluate(`(() => {
                const pool = document.querySelector("${DRAFT_POOL}");
                for (let p = pool && pool.parentElement; p; p = p.parentElement) {
                    if (p.scrollHeight > p.clientHeight + 2) {
                        p.scrollTop = p.scrollHeight;
                        return;
                    }
                }
            })()`);
            await page.waitForTimeout(400);
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
