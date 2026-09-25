/**
 * The surfaces `bun run check:ui` walks, and the click sequences that reach
 * them (issue #2580). Every entry is walked and held to the Floors at every
 * viewport (`floors.ts`, ADR 0132) unless `UNWALKED_SURFACES` declares it with
 * an issue; a walk that reaches nothing reds the lane instead of quietly
 * measuring nothing.
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
// Type-only: `lane-account.ts` builds the run's labels from the leaf module the
// SEEDING mutation reads them from, so renaming a label cannot leave the lane
// addressing a row that no longer exists (issue #2822 review), and the walks
// receive them on `WalkContext` because they are per RUN now (issue #3626).
import type { FixtureLabels } from "./lane-account.ts";
// The one wait before a measurement (issue #3644): no fixed sleep remains in
// this module, and `ui-gate-settle.test.ts` reds if a sleep comes back.
import { waitForSettledScreen } from "./settle.ts";
import type { NamedAssertion } from "./assertions.ts";

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
    /** This run's Limited fixture labels (`ui-gate/<runId>/…`, issue #3626):
     *  seeded at bootstrap for the run's own account, so a concurrent run's
     *  seeding can never drop them and its rows never reach this run's list. */
    fixtureLabels: FixtureLabels;
    /** The debug-scenario label the `game-manage-yields` surface loads
     *  (`yields-scenario.json`, issue #3629). */
    yieldsScenarioLabel: string;
    /** The debug-scenario label the `game-debug-sheet-ai` surface loads
     *  (`ai-trace-scenario.json`, issue #3652). */
    aiTraceScenarioLabel: string;
    /** The debug-scenario label the `game-board` surface loads
     *  (`board-scenario.json`, issue #3695) — the ORDINARY mid-game board, as
     *  opposed to `stressScenarioLabel`'s 55-card extreme. Two rows, two
     *  positions: the screen a player sees most of a game, and the worst one
     *  the layout has to survive. */
    boardScenarioLabel: string;
    /** The debug-scenario label the `game-combat` surface loads
     *  (`combat-scenario.json`, issue #3708) — the BLOCK WINDOW: a confirmed
     *  attack (CR 508.1) with the block declaration owed to the human seat
     *  (CR 509.1). The one declared position whose `activePlayer` is `"opp"`,
     *  because the block is owed to the DEFENDING player and an attack by the
     *  human seat would put the opponent's half of combat on screen. */
    combatScenarioLabel: string;
    /** The debug-scenario label the `game-choice-prompt` surface loads
     *  (`choice-scenario.json`, issue #3708) — a spell on the stack with ONE
     *  pass already banked (CR 117.4), so the walk's single pass resolves it
     *  into a mid-resolution card choice (CR 608.2) over the board. */
    choiceScenarioLabel: string;
    /** Set once the lane has created the active game itself. */
    createdGame: boolean;
    /** Issue #2671 review H2. The `deck-builder` walk's fixture import trips
     *  `useDeckWorkspace`'s autosave, so a real `userDecks` row exists by the
     *  time `walk()` returns. `walk()` records the auto-assigned name here;
     *  `cleanup()` reads it (on the SAME page, right after the probe has
     *  measured this exact state) to delete that one row by name from the
     *  lobby's My Decks list, then clears the field. `undefined` means
     *  nothing to clean up. */
    lastCreatedDeckName?: string;
    /** Set once the lane has created the VS-AI game itself (issue #3492).
     *
     *  Deliberately NOT `createdGame`: each flag is the licence to load a
     *  declared position into ONE kind of match the lane owns, and the two
     *  kinds are conceded by different walks at different points in the run.
     *  Two flags, two permissions.
     *
     *  It used to say a vs-AI board must never take a scenario at all, because
     *  the bot drives the other seat and the position would keep moving under
     *  the probe. What changed is WHICH position (ADR 0132 §4, issue #3652):
     *  `ai-trace-scenario.json` declares `activePlayer`/`priority` on the
     *  human seat, so `useVsAiDriver` is never owed an input and the bot has
     *  nothing to move — the declared position is what makes the vs-AI board
     *  measurable, not what makes it unstable. */
    createdVsAiGame?: boolean;
    log(message: string): void;
}

export interface Surface {
    id: string;
    /**
     * The route module(s) this surface's walk renders, repo-relative (issue
     * #3627). `check:ui` selects the surface when a changed file is in the
     * import closure of any of them (`scripts/lib/ui-scope.ts`).
     *
     * EVERY route the walk passes through, not only the one it measures: the
     * game surfaces start their match from the lobby and the draft surfaces
     * open their event from `/limited`, so a change that breaks that path
     * breaks the surface too, and must select it. The entry is the ROUTE's
     * module even when the walk measures an overlay opened from it, and a
     * nested route lists its layout route (the admin pages render inside
     * `admin-layout.route.tsx`). Each must be a
     * `src/routes/**\/*.route.tsx` module that `src/router.tsx` imports —
     * `ui-gate-surface-entries.test.ts` reds otherwise, so a renamed route
     * cannot silently drop a surface out of every scope.
     *
     * The signed-out auth surfaces declare the route at `/`: the form itself
     * is `<AuthGate>`, which the router mounts around every route, so any
     * change to it is in the shell's closure and forces the full run anyway.
     */
    entries: readonly string[];
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
    /**
     * The walk plays inside a game the lane creates (issue #3644). Before an
     * Infra Verdict is retried, the lane ends that game (`recreateLaneGame`)
     * so the retry deals a fresh one instead of resuming a board the machine
     * left half-answered.
     */
    needsGame?: boolean;
    /**
     * Selectors whose boxes (and scroll offsets) must hold still, beside the
     * main region and any open dialog, before the surface is a Settled Screen
     * (`settle.ts`). The elements the surface exists to measure.
     */
    settleTargets?: readonly string[];
    /**
     * What this surface PROMISES about itself (ADR 0132 §3, issue #3649):
     * named controls and regions, each checked at every viewport once the
     * screen has settled, each printed as its own line of the Verdict Block.
     *
     * The Floors say what must never be true of the screen; these say what
     * must still be TRUE of it. A surface whose walk asserts only that a
     * `<main>` rendered measures whatever the route happened to paint — the
     * lobby could have lost every Mode Tile, its primary action and both deck
     * shelves and still walked green
     * (`docs/findings/2726-ui-gate-lobby-walk-asserts-almost-nothing.md`). The entry
     * points the surface's runbook names (`docs/guides/ui-runbooks.md`) are
     * its minimum.
     *
     * Locators are role+name or a `data-*` seam, never bare CSS, and every
     * surface declares at least one — both refused offline by
     * `scripts/__tests__/ui-gate-assertions.test.ts`. A surface with none
     * carries an `ASSERTION_DEBT` row naming the slice that gives it some.
     */
    asserts?: readonly NamedAssertion[];
    /**
     * The overlay component modules that are ON SCREEN when the probe measures
     * this surface (issue #3420) — repo-relative, the file that renders the
     * layer. This is the surface's coverage CLAIM, and the UI census
     * (`scripts/lib/ui-census.ts`) reads it as the only way a walked surface
     * covers a dialog.
     *
     * MEASURED, never merely reachable. The game route imports every board
     * dialog and the walks click THROUGH several of them (the pregame dialog
     * is dismissed before any measurement) — neither is coverage, and listing
     * one here would be a false green of exactly the kind the census exists to
     * remove. List a module only when the probe photographs it.
     *
     * NO PER-VIEWPORT GRANULARITY. A claim says the probe photographs this
     * module, not that it does so at all five viewports: `draft-pool-peek` is
     * viewport-SPLIT by design (issue #2861) and its rail exists on two of the
     * five. The census reads a claim as coverage either way — "measured
     * somewhere" and "measured everywhere" are one status here, and a surface
     * whose claim is partial says so in its own comment.
     *
     * A surface declared in `UNWALKED_SURFACES` covers nothing whatever it
     * claims here; `ui-census.test.ts` also reds on an entry naming a module
     * that is not a censused overlay, so a renamed dialog cannot leave a
     * surface claiming coverage of a file that no longer exists.
     */
    mounts?: readonly string[];
    walk(page: Page, ctx: WalkContext): Promise<void>;
    /**
     * Runs AFTER the probe/axe/screenshot for this surface+viewport pass, on
     * the SAME page (issue #2671 review H2) — so it can undo state `walk()`
     * had to create for the probe to have something real to measure, without
     * touching what the probe already captured. A failure here is logged and
     * swallowed (`index.ts`'s `measure()`): cleanup is hygiene, not part of
     * the measurement this surface exists to take.
     */
    cleanup?(page: Page, ctx: WalkContext): Promise<void>;
}

const NAV_TIMEOUT = 20_000;
const STEP_TIMEOUT = 8_000;

/** The app shell, then a Settled Screen (`settle.ts`, issue #3644): the
 *  surface's ready marker up and a quiet window with nothing animating, nothing
 *  in flight to Convex and no measured box moving. Convex holds a websocket
 *  open, so `networkidle` never fires; this replaced a fixed 1.2s sleep, and it
 *  replaces every other sleep in this module too — a sleep measures early on a
 *  loaded machine and waits for nothing on a quiet one. A screen that never
 *  settles throws the `unsettled` Infra Verdict. */
async function settle(
    page: Page,
    targets: readonly string[] = []
): Promise<void> {
    await page.waitForLoadState("domcontentloaded");
    await page
        .locator("main, [data-app-shell], body > #root")
        .first()
        .waitFor({ timeout: NAV_TIMEOUT })
        .catch(() => {});
    await waitForSettledScreen(page, { targets });
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

/** Name whatever the browser hit-tests at a selector's own centre — the one
 *  fact that turns "could not be clicked" into something a reader can fix.
 *
 *  The page function is passed as SOURCE TEXT, not a closure: this file
 *  compiles under `tsconfig.scripts.json`, which carries no `lib.dom`, so a
 *  literal `document` in a callback here is a type error rather than a
 *  browser-side call (the same reason `probe.js` next door is plain JS). */
async function topmostAt(page: Page, selector: string): Promise<string> {
    try {
        const box = await page.locator(selector).first().boundingBox();
        if (!box) return "it has no layout box";
        const x = Math.round(box.x + box.width / 2);
        const y = Math.round(box.y + box.height / 2);
        const found = await page.evaluate<string>(`(() => {
            const el = document.elementFromPoint(${x}, ${y});
            if (!el) return "nothing hit-tests there";
            const cls = String(el.className || "").split(/\\s+/).filter(Boolean).slice(0, 4).join(".");
            return "hit target is <" + el.tagName.toLowerCase() + (cls ? " class=\\"" + cls + "\\"" : "") + ">";
        })()`);
        return found;
    } catch {
        return "hit target could not be read";
    }
}

async function clickIfVisible(
    page: Page,
    selector: string,
    timeout = STEP_TIMEOUT
): Promise<boolean> {
    if (!(await visible(page, selector, timeout))) return false;
    try {
        await page.locator(selector).first().click({ timeout: STEP_TIMEOUT });
    } catch (err) {
        // Playwright's own message is `click: Timeout 8000ms exceeded.` and
        // `index.ts` prints only its first line, so an un-narrated failure here
        // reaches the receipt as a bare timeout with no selector in it — a run
        // that says a click failed and not WHICH one (measured, issue #3492).
        // The element was visible a moment ago, so this is an actionability
        // failure, and the only fact that makes it fixable is WHAT is over it:
        // hit-test the target's own centre and name whatever answers.
        throw new Unreachable(
            `\`${selector}\` was visible but could not be clicked (${await topmostAt(page, selector)}): ${(err as Error).message.split("\n")[0]}`
        );
    }
    return true;
}

/* Prompt buttons matched EXACTLY, never by substring. `:has-text()` is a
 * case-insensitive SUBSTRING match, so `button:has-text('Keep')` also matches
 * the phase bar's `Upkeep (UPKEEP)` stop — measured at 390x844x3 on issue
 * #3492, where the mulligan click landed on the phase-stops panel instead and
 * left a `[role=dialog]` standing that nothing in the walk could answer. Every
 * short prompt label here goes through `:text-is()` for that reason. */
const MULLIGAN_KEEP = 'button:text-is("Keep")';
const PREGAME_PLAY = '[role=dialog] button:text-is("Play")';
const BANNER_RESUME = 'button:text-is("Resume")';
const BANNER_LEAVE = 'button:text-is("Leave")';
const BANNER_CONCEDE = 'button:text-is("Concede Match")';
/** The confirm dialog's destructive plate. `:has-text()` here and `:text-is()`
 *  on the banner twin above, and the asymmetry is load-bearing: Playwright's
 *  `:text-is()` matches the SMALLEST element carrying the text, and this one is
 *  an `ActionButton`, which wraps its label in a `<span>` — so the span matches
 *  and the `button` never does. Measured: the banner press landed, the dialog
 *  opened, and the plate read `NOT PRESSED` on every viewport of a full run,
 *  leaving the lane's own game standing. Scoped to the dialog because the
 *  banner button behind it carries the same words; inside the dialog the only
 *  other control is `Cancel`. */
const CONFIRM_CONCEDE = '[role=dialog] button:has-text("Concede Match")';

/**
 * Open an event's page from `/limited`.
 *
 * The row's `View` is a BUTTON that navigates programmatically, not an
 * anchor — harvesting `a[href^='/limited/']` finds nothing and reports "no
 * event on this deployment" on a page that is showing one. Click the control
 * the runbook names.
 */
const EVENT_VIEW = "button:has-text('View'), a:has-text('View')";

/**
 * THE SEEDED FIXTURE (issue #2822). Every Limited/Draft walk below addresses
 * ONE labelled event, never "the first row of whatever this account can see".
 *
 * The disease this cures: `listOpenLimitedEvents` returns every open event on
 * the deployment to everyone, so both the ROW COUNT of `/limited` and WHICH
 * SEAT the Draft Room walks measured were functions of a month of hand-made
 * events rather than of the code under test — `budgets.json` ceilings rotted
 * with no `src/` change, twice, with byte-identical numbers
 * (`docs/findings/2671-limited-list-budgets-drifted.md`). Giving the lane its
 * own account would not have bounded the list; addressing a fixture does.
 *
 * The rows are seeded by `convex/limitedFixtures.ts` and are DEPLOYMENT-LOCAL
 * (nothing in git, same tradeoff as a `debugScenarios` label). A missing
 * fixture reports UNWALKED carrying `FIXTURE_SEED_HINT` — never a fallback
 * walk of some other event, which is precisely what used to make a PASS mean
 * less than it read.
 *
 * Since issue #3626 the lane seeds them itself, at bootstrap, for the run's
 * own account and under the run's own labels (`ctx.fixtureLabels`) — the
 * seeder owns the strings, this file only addresses them.
 */
const FIXTURE_SEED_HINT =
    "the lane seeds its fixtures at bootstrap (limitedFixtures:seedUiGateFixtures) — read that run's bootstrap output";

/** The list, narrowed to THIS RUN's fixture rows by the `?label=` prefix filter
 *  (`src/router.tsx`). This is what makes the two list surfaces' row count a
 *  function of the LANE (two seeded events) instead of the deployment — or of
 *  a concurrent run's fixtures. */
function fixtureListPath(ctx: WalkContext): string {
    return `/limited?label=${ctx.fixtureLabels.prefix}`;
}

/** The row handle `limited-event-list-item.tsx` renders for a labelled event.
 *  `key={event._id}` is a React key, not an attribute — before this there was
 *  nothing in the DOM to select one specific event with. */
function fixtureRow(label: string): string {
    return `[data-limited-event-label="${label}"]`;
}

/**
 * Has at least one row matching `selector` rendered? WAITS for it rather than
 * counting once: under load the Limited list query answers seconds after the
 * navigation, and an immediate `count()` read a seeded fixture as absent —
 * measured on issue #3626's concurrent receipt at load ~60, where a run
 * reported its own freshly seeded fixture "not on this deployment".
 */
async function fixtureRowsRendered(
    page: Page,
    selector: string
): Promise<boolean> {
    return await page
        .locator(selector)
        .first()
        .waitFor({ state: "attached", timeout: NAV_TIMEOUT })
        .then(
            () => true,
            () => false
        );
}

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
 *  at desktop/tablet widths, where the room renders the STACKED arrangement
 *  instead — Booster band on top, Pool band beneath, each with its own
 *  scroller (issue #2820; there is no `"split"` layout value any more). */
const DRAFT_SNAP_SCROLLER = "[data-slot=draft-snap-scroller]";
const DRAFT_STRIP_DROP = "[data-slot=draft-strip-drop]";
const DRAFT_POOL = "[data-slot=draft-pool]";

/** The Pool's OWN scroll band in the stacked arrangement (issue #2820,
 *  `limited-draft-table.tsx` — `min-h-[17.5rem] flex-1 overflow-y-auto`).
 *
 *  Named explicitly, because the thing it replaced — "walk UP from
 *  `DRAFT_POOL` and scroll the first ancestor that overflows" — is precisely
 *  the shape issue #2822 exists to kill, one element up from the event list.
 *  An ancestor search does not say WHICH element it means, so when #2820
 *  changed the arrangement under it the search silently kept resolving: at
 *  every non-phone viewport it walked the whole chain to `<html>` and
 *  scrolled NOTHING (measured on the rebased tree: `draft-stacked-pool`
 *  508/508 at 1440x900x2, 287/287 at 820x1180x2, 441/441 at 1180x820x2 —
 *  `scrollHeight === clientHeight` at each, and every ancestor above it the
 *  same). Had ONE of those ancestors overflowed — `<main>` is one gesture
 *  from being a page scroller on this app, `docs/findings/2582-…` — it would
 *  have scrolled the PAGE and reported that as the pool at its far extent.
 *
 *  Its presence is now the walk's ASSERTION that the arrangement is still the
 *  one the walk was written for: absent, the surface goes UNWALKED and a
 *  human re-teaches it, rather than the lane quietly measuring elsewhere. The
 *  scrolling itself reaches past it into the pool's own scrollers — see
 *  `reachDraftPoolStop`. */
const DRAFT_STACKED_POOL = "[data-slot=draft-stacked-pool]";

/** A card tile inside the Pool/Sideboard pane, matched by the tooltip
 *  `DeckCardTile` always carries (`title="Remove <name>…"`,
 *  `limited-draft-pool.tsx`) — the same handle the component test suite
 *  drives (`getByTitle(/^Remove /)`). Scoped to `DRAFT_POOL`'s subtree so a
 *  desktop/tablet pane never accidentally matches a Booster tile instead
 *  (issue #2667, `draft-pool-peek`). */
const DRAFT_POOL_TILE = `${DRAFT_POOL} [data-card-tile][title^='Remove ']`;

/** The Peek Panel primitive both the Booster's own selection and the Pool's
 *  `DeckZonePeek` mount (`peek-panel.tsx`). Shared constant so `draft-pick`'s
 *  Booster panel and `draft-pool-peek`'s Pool panel assert the SAME mount
 *  point rather than two copies of the literal. */
const DRAFT_PEEK_PANEL = "[data-peek-panel]";

/** The one CTA that tells the POOL's `DeckZonePeek` apart from the BOOSTER's
 *  own `PeekPanel` — both render `[data-peek-panel]`, and the Booster's is
 *  already mounted by the time `draft-pool-peek` clicks anything
 *  (`pinDraftSelection`). `Move to…` is appended by `deck-zone-peek.tsx`
 *  alone, from its column-pin sheet. `EditingActionButton` publishes each
 *  CTA's label as `data-editing-action` (`editing-action-button.tsx`), which
 *  is the same handle the component suites drive. */
const DRAFT_POOL_PEEK_CTA = `${DRAFT_PEEK_PANEL} [data-editing-action="Move to…"]`;

/** The Draft Room's card context menu (issue #2861), replacing the Pool's
 *  `DeckZonePeek` off a phone (tablet/desktop, `useViewportMode`'s single
 *  "desktop" bucket). One `role=menu` per surface — Booster, Pool, Sideboard
 *  — distinguished the same way `DRAFT_POOL_PEEK_CTA` told the Pool's old
 *  Peek Panel apart from the Booster's: only the Pool's own menu ever offers
 *  "Move to…" (`limited-draft-table.tsx`'s `desktopPoolMenuActionsFor`). */
const DRAFT_POOL_MENU_MOVE_ITEM =
    '[role=menu] [role=menuitem]:has-text("Move to…")';

/**
 * Pins the Draft Room's Selected Card state (issue #2677). `seat.selectedPickId`
 * is SERVER state (`selectDraftPick`, ADR 0060) that survives across gate runs
 * on the SAME deployment — it is not reset by loading the room, and there is
 * no UI affordance to clear it (`setPeekClosedFor`, the Peek Panel's own
 * close button, only hides the panel locally; the mutation's `pickId: null`
 * clear path is never called from the client). That made the two Draft Room
 * surfaces' readings depend on whatever a PRIOR session left selected on this
 * seat rather than on anything this run controls — three runs on one pass
 * produced three different occlusion counts.
 *
 * Of the two states, only "has a Selected Card" is reachable
 * DETERMINISTICALLY: a single click on whichever tile the pack shows on top
 * OVERWRITES any prior selection with that tile's own `pickId`
 * (`selectDraftPick`'s handler always overwrites, never toggles) — idempotent
 * regardless of what the deployment already held. "No Selected Card" has no
 * such reachable action from this walk, so it is the state left unpinned.
 *
 * Waits for the tile's OWN aria-label to grow the "(selected)" suffix
 * (`limited-draft-pack-card.tsx`) rather than for the Peek Panel to mount,
 * because the panel does NOT mount on a phone at all (issue #2588 inlines its
 * CTA row into the snap strip there) — the aria-label flip is the one
 * completion signal common to every viewport this lane walks.
 */
async function pinDraftSelection(page: Page): Promise<void> {
    await page
        .locator(DRAFT_PICK_TILE)
        .first()
        .click({ timeout: STEP_TIMEOUT });
    const selected = await visible(
        page,
        "[role=button][aria-label*='(selected)']",
        STEP_TIMEOUT
    );
    if (!selected) {
        throw new Unreachable(
            'clicked a Draft Room pack tile to pin the Selected Card seat state, but no tile\'s aria-label ever gained "(selected)" — the selectDraftPick round-trip did not land'
        );
    }
    // Issue #2861: on the desktop/tablet regime that same click ALSO opens
    // the Booster's pack menu (`onOpenMenu`, no delay) — a TRANSIENT popup a
    // real player dismisses before moving on, never the room's settled state.
    // Left open, it sits at the click point rather than docked to a screen
    // edge (unlike the retired Peek Panel), occluding whatever pack tiles
    // happen to fall under it and skewing every walk that shares this helper
    // (`draft-pick`, `draft-pool-stop`, `draft-pool-peek`). Escape is a no-op
    // on a phone, where this same click never opens one.
    if (await visible(page, "[role=menu]", 500)) {
        await page.keyboard.press("Escape");
    }
}

/**
 * Land on `/limited/<id>/draft` with a live pack for this seat, with the
 * Selected Card seat state pinned (`pinDraftSelection`, issue #2677).
 *
 * Issue #2587 moved the pick screen OFF the event page onto its own immersive
 * route. Two ways in, and the walk takes whichever the deployment offers: the
 * event page redirects a seated player while a Pick is pending (one-shot per
 * tab), and once that shot is spent the event page offers "Enter the Draft
 * Room". Shared by both draft surfaces, so the two can never drift apart
 * about what "the room" means OR what seat state they measure in.
 */
async function reachDraftRoom(page: Page, ctx: WalkContext): Promise<void> {
    const landed = await openFixtureEvent(page, ctx, ctx.fixtureLabels.draft);
    if (landed === "event") {
        if (
            !(await clickIfVisible(
                page,
                "a:has-text('Enter the Draft Room')",
                4000
            ))
        ) {
            throw new Unreachable(
                `the "${ctx.fixtureLabels.draft}" fixture's event page offered no "Enter the Draft Room" — its seat has no live pack. ${FIXTURE_SEED_HINT}`
            );
        }
        await page
            .waitForURL(/\/draft$/, { timeout: NAV_TIMEOUT })
            .catch(() => {});
        await settle(page);
    }
    if (!page.url().endsWith("/draft")) {
        throw new Unreachable(
            `the "${ctx.fixtureLabels.draft}" fixture did not land in the Draft Room — the page is at ${page.url()}`
        );
    }
    // The room renders for a Sealed seat too (reveal mode), so reaching the
    // URL is not enough: the surface these rows budget is the PICK screen, and
    // its tiles are the proof.
    if (!(await visible(page, DRAFT_PICK_TILE, 4000))) {
        throw new Unreachable(
            `the "${ctx.fixtureLabels.draft}" fixture's Draft Room rendered no pack tile for this seat. ${FIXTURE_SEED_HINT}`
        );
    }
    await pinDraftSelection(page);
}

/**
 * Reach the Draft Room's POOL stop — the SECOND state of `/draft`, and the
 * biggest new surface issue #2588 shipped. The `draft-pick` walk returns as
 * soon as a pack tile is visible, so it always measures the PACK stop; the
 * pool pane went in with no browser measurement at all (review finding 1 on
 * PR #2652), which is exactly the #2511 shape: in portrait `LimitedDraftPool`
 * runs `arrange="column"`, so two `DeckZoneSurface`s share ~70% of a 390x844
 * screen, and a collapsed MV row passes every happy-dom test there is.
 *
 * Off a phone there is no snap surface (`useViewportMode` calls both tablets
 * "desktop"), so the equivalent state is every scroller the pool owns driven
 * to its end — still the pool at its far extent, still a state `draft-pick`
 * never probes. Which element that IS changed with issue #2820: see the
 * scroll block below, and `DRAFT_STACKED_POOL`.
 *
 * Extracted (issue #2667 review) so `draft-pool-peek` can reach the SAME pool
 * stop and then go one gesture further (select a tile, mount the Peek Panel)
 * instead of duplicating this reach logic.
 */
async function reachDraftPoolStop(page: Page, ctx: WalkContext): Promise<void> {
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
        await settle(page, [DRAFT_SNAP_SCROLLER]);
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
        // card-count floor) nor `floors.ts` (no minimum-n rule) can
        // tell an empty pane from a healthy one: a Pick #1 seat would
        // score `zero0 occ0 stranded0 starved0` and pass GREEN, making
        // the one measurement that discharges the pool pane's layout
        // claims silently vacuous. Same guard the stacked branch below
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
    if (!(await visible(page, DRAFT_STACKED_POOL, 4000))) {
        throw new Unreachable(
            `the Draft Room rendered a pool pane but no "${DRAFT_STACKED_POOL}" band to scroll it in — the non-phone arrangement changed (issue #2820 restored the stacked one) and this walk has to be re-taught which element IS the pool's scroller. Refusing to guess: scrolling whatever ancestor happens to overflow is how a walk starts measuring the page instead of the pool`
        );
    }
    // Drive EVERY scroller the pool owns to its end, ON ITS OWN AXIS, and
    // count how many actually had somewhere to go.
    //
    // Both halves of that are load-bearing, and each replaces a wrong
    // assumption the split-era walk carried:
    //
    //   - The BAND is not where the pool's overflow lives. Measured on the
    //     rebased tree, `draft-stacked-pool` is 508/508, 287/287 and 441/441
    //     (`scrollHeight`/`clientHeight`) at the three non-phone viewports —
    //     it never overflows, because its `flex-1` gives it whatever the
    //     Booster band leaves and its `min-h-[17.5rem]` floor keeps that
    //     honest. Scrolling only the band is a guaranteed no-op.
    //   - The overflow lives INSIDE `[data-slot=draft-pool]`, in
    //     `DeckZoneSurface`'s own card scroller (`deck-zone-surface.tsx:674`,
    //     `flex overflow-auto md:snap-none` — `snap-x` in the columns
    //     branch, so its far extent is the LAST Mana-Value column). At
    //     820x1180x2 that box is 201px around a 358px column and 12 of the
    //     24 pool tiles sit outside their port. A walk that leaves them there
    //     has not reached "the pool at its far extent"; it has re-measured
    //     `draft-pick`'s DOM under a second surface id, which is coverage
    //     that reads as two rows and proves one.
    //
    // ONE AXIS PER SCROLLER, the one it actually scrolls on. `overflow-auto`
    // is both axes, and pinning both ends at once is not "the far extent" —
    // it is off the end of the content: driving the columns scroller's
    // scrollTop to a 358px column's bottom inside a 201px port lifts every
    // card clear of the port, and the row measures `cardsOcc 0 reach24`, a
    // pool pane with no pool visible in it. Horizontal wins where it exists
    // because that is the axis this pane READS on (`snap-x snap-mandatory`,
    // left-to-right by Mana Value); the vertical overflow beside it is the
    // starved-container debt the `starved` metric already reports, not a
    // reading direction.
    //
    // `moved` is what makes the difference reportable rather than assumed: 0
    // means every scroller already fit, so this row IS `draft-pick`'s DOM at
    // that viewport and its readings mean what they say.
    const stop = (await page.evaluate(`(() => {
        const roots = [document.querySelector("${DRAFT_STACKED_POOL}")];
        const pool = document.querySelector("${DRAFT_POOL}");
        if (pool) roots.push(pool, ...pool.querySelectorAll("*"));
        let scrollers = 0;
        let moved = 0;
        for (const el of roots) {
            if (!el) continue;
            const cs = getComputedStyle(el);
            if (!/auto|scroll/.test(cs.overflowY + cs.overflowX)) continue;
            const dy = el.scrollHeight - el.clientHeight;
            const dx = el.scrollWidth - el.clientWidth;
            if (dy <= 2 && dx <= 2) continue;
            scrollers++;
            if (dx > 2) el.scrollLeft = el.scrollWidth;
            else el.scrollTop = el.scrollHeight;
            if (el.scrollTop > 2 || el.scrollLeft > 2) moved++;
        }
        return { scrollers: scrollers, moved: moved };
    })()`)) as { scrollers: number; moved: number };
    if (stop.scrollers > 0 && stop.moved === 0) {
        throw new Unreachable(
            `the Draft Room's pool has ${stop.scrollers} overflowing scroller(s) and not one of them would move — this surface measures the pool AT its far extent, and it is not there`
        );
    }
    await settle(page, [DRAFT_SNAP_SCROLLER, DRAFT_POOL]);
}

/**
 * Land on the `ui-gate/<runId>/open` fixture's antechamber
 * (`/limited/<id>`). Extracted (issue #4422) so the two overlays opened from
 * it — the Table Ring and the Leave Seat confirm — reach the SAME page
 * `limited-antechamber` measures.
 */
async function reachFixtureAntechamber(
    page: Page,
    ctx: WalkContext
): Promise<void> {
    // The `ui-gate/open` fixture, specifically (issue #2822): seating
    // still open is the one event state whose detail page neither
    // redirects into the Draft Room (`useDraftRoomRedirect` needs a
    // pending pick) nor auto-opens the deck builder
    // (`useAutoOpenLimitedBuilder` needs a final pool). Both of those
    // are ONE-SHOT PER TAB, so a fixture that tripped either would
    // measure the antechamber at some viewports and a different screen
    // at others.
    if (
        (await openFixtureEvent(page, ctx, ctx.fixtureLabels.open)) !== "event"
    ) {
        throw new Unreachable(
            `the "${ctx.fixtureLabels.open}" fixture did not land on its antechamber — it should still be OPEN (no pool, no pending pick). ${FIXTURE_SEED_HINT}`
        );
    }
    if (!(await visible(page, "main, [role=main]", 10_000))) {
        throw new Unreachable(
            "the Limited event antechamber rendered no main region"
        );
    }
}

/** The list's and the antechamber's openers for the Limited overlays
 *  (issue #4422), by each button's own visible text. */
const LIMITED_CREATE_EVENT = 'button:text-is("+ Create Event")';
const LIMITED_VIEW_TABLE = 'button:text-is("View Table")';
const LIMITED_LEAVE_SEAT = 'button:text-is("Leave Seat")';

/** `ActionSheet`'s own queryable handle (`ui/action-sheet.tsx`, issue #2584):
 *  it portals to `document.body`, so this is the only seam that names it. */
const ACTION_SHEET = "[data-action-sheet]";

/**
 * `draft-pool-stop` plus the one gesture that selects a Pool tile, leaving
 * whichever layer that selection opens in this viewport regime: the Pool's
 * `DeckZonePeek` on a phone (`"peek"`), the desktop Pool card menu off one
 * (`"menu"`, issue #2861). Extracted (issue #4422) so `draft-pool-move-sheet`
 * can go one gesture further — `Move to…` — from the SAME selected state
 * `draft-pool-peek` measures, instead of duplicating this reach logic.
 */
async function selectDraftPoolTile(
    page: Page,
    ctx: WalkContext
): Promise<"peek" | "menu"> {
    // Review finding (PR #2797 round 1, MEDIUM, issue #2667): no walk
    // ever opened the Pool's own `DeckZonePeek` — `draft-pick`
    // measures the pack stop, `draft-pool-stop` measures the pool
    // PANE but never TAPS a tile in it, so `poolSelection` stayed
    // `null` and the fixed panel stayed unmounted through all 60 prior
    // rows, including the two phone viewports issue #2667's own AC
    // names (390x844x3 / 844x390x3) — exactly the state
    // `draft-selection-actions.tsx` records was MEASURED to occlude
    // in portrait before this feature deleted that budget row. This
    // surface is `draft-pool-stop` plus the one gesture that was
    // missing: select a Pool tile and measure with the panel open.
    await reachDraftPoolStop(page, ctx);
    // The LAST tile, not the first (issue #2822). The pool renders as
    // OVERLAID column piles (ADR 0075), so on a full pool the first
    // tile of a pile is covered by the ones stacked on top of it and
    // Playwright's actionability check waits out its whole timeout on
    // it — measured, as a walk-threw UNWALKED at 1440x900x2, the
    // moment the fixture gave this seat a realistic 24-card pool. The
    // last tile is the top of its own pile at every viewport.
    const poolTile = page.locator(DRAFT_POOL_TILE).last();
    if ((await page.locator(DRAFT_POOL_TILE).count()) === 0) {
        throw new Unreachable(
            "reached the Draft Room's pool stop but found no Pool card tile to select — this surface needs the same NON-EMPTY pool `draft-pool-stop` does"
        );
    }
    await poolTile.scrollIntoViewIfNeeded({ timeout: STEP_TIMEOUT });
    await poolTile.click({ timeout: STEP_TIMEOUT });

    // Issue #2861 retires the Pool's `DeckZonePeek` off a phone: the
    // desktop/tablet regime (`useViewportMode`'s single "desktop"
    // bucket — no snap scroller mounted) now opens a card context
    // menu instead, on a short delay (the double-click window). The
    // phone regimes are UNCHANGED — same `DeckZonePeek` mount this
    // walk always asserted.
    if (await visible(page, DRAFT_SNAP_SCROLLER, 500)) {
        if (!(await visible(page, DRAFT_PEEK_PANEL, STEP_TIMEOUT))) {
            throw new Unreachable(
                "selected a Pool card tile but the Pool's Peek Panel (`[data-peek-panel]`) never mounted"
            );
        }
        // `[data-peek-panel]` alone cannot discharge this surface's
        // claim. `reachDraftRoom` has ALREADY pinned a Booster
        // selection (`pinDraftSelection`, issue #2677), and the
        // Booster's own `PeekPanel` uses the SAME attribute — so a
        // pool click that did nothing at all would leave the
        // Booster's panel standing and the assertion above green,
        // which is the "the test never reaches the code" shape. The
        // two panels' CTA rows are what differ: only the Pool's
        // `DeckZonePeek` appends `Move to…` (its column-pin sheet,
        // `deck-zone-peek.tsx`), and the Booster's never offers it.
        if (!(await visible(page, DRAFT_POOL_PEEK_CTA, STEP_TIMEOUT))) {
            throw new Unreachable(
                `a Peek Panel is mounted but it is not the POOL's — no ${DRAFT_POOL_PEEK_CTA} in it, which means the pool tile's click did not take and this row would have measured \`draft-pick\`'s Booster panel under a different surface id`
            );
        }
        return "peek";
    }

    // The menu opens on a delay so a double click can still cancel it
    // (`openDesktopPoolMenu`) — `visible()`'s own polling absorbs
    // that, no extra wait needed.
    if (!(await visible(page, DRAFT_POOL_MENU_MOVE_ITEM, STEP_TIMEOUT))) {
        throw new Unreachable(
            `selected a Pool card tile but no menu offering ${DRAFT_POOL_MENU_MOVE_ITEM} ever mounted — either the menu never opened, or it opened for a different surface (the Booster's own menu never offers "Move to…")`
        );
    }
    // The retired Peek Panel must never come back for this regime —
    // the whole point of issue #2861 is that no rail mounts here any
    // more, for any selection.
    if (await visible(page, DRAFT_PEEK_PANEL, 500)) {
        throw new Unreachable(
            "the desktop Pool menu opened, but a `[data-peek-panel]` ALSO mounted — issue #2861 retires that rail entirely on this regime"
        );
    }
    return "menu";
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
 * A no-op off a phone: the stacked arrangement has no snap scroller.
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

/**
 * Land on the fixture-filtered `/limited` list and assert the fixture is
 * actually seeded on this deployment.
 *
 * Returns the number of fixture rows, which is a constant of
 * `convex/limitedFixtures.ts` — that is the whole point: the list surfaces
 * measure a row set the lane fixes.
 */
async function reachFixtureList(page: Page, ctx: WalkContext): Promise<number> {
    await goto(page, ctx, fixtureListPath(ctx));
    if (!(await visible(page, "main, [role=main]", 10_000))) {
        throw new Unreachable("/limited rendered no main region");
    }
    const rendered = await fixtureRowsRendered(
        page,
        "[data-limited-event-label]"
    );
    const rows = await page.locator("[data-limited-event-label]").count();
    if (!rendered) {
        throw new Unreachable(
            `no seeded Limited fixture on this deployment — ${FIXTURE_SEED_HINT}`
        );
    }
    return rows;
}

/**
 * Open the fixture event with this label, and report where it landed.
 *
 * Since issue #2587 the event page REDIRECTS a seated player into the Draft
 * Room (`/limited/<id>/draft`) while a Pick is pending — one-shot per tab, so
 * the first open of a drafting event lands on the room and a later one does
 * not. Both are legitimate landings, which is why this returns the pathname
 * shape rather than a boolean "did we reach the event page": a walk that
 * demanded the old URL would report a drafting event as unreachable.
 *
 * `null` is never "try the next row" any more (issue #2822) — there is no
 * next row. It means this fixture's own View control led somewhere
 * unrecognised, and every caller turns that into UNWALKED.
 */
async function openFixtureEvent(
    page: Page,
    ctx: WalkContext,
    label: string
): Promise<"event" | "draft" | null> {
    await goto(page, ctx, `/limited?label=${label}`);
    const row = page.locator(fixtureRow(label));
    if (!(await fixtureRowsRendered(page, fixtureRow(label)))) {
        throw new Unreachable(
            `the seeded Limited fixture "${label}" is not on this deployment — ${FIXTURE_SEED_HINT}`
        );
    }
    await row.first().locator(EVENT_VIEW).first().click({
        timeout: STEP_TIMEOUT,
    });
    await page
        .waitForURL(/\/limited\/[^/]+(\/draft)?$/, { timeout: NAV_TIMEOUT })
        .catch(() => {});
    await settle(page);
    const path = new URL(page.url()).pathname;
    if (/^\/limited\/[^/]+\/draft$/.test(path)) return "draft";
    if (/^\/limited\/[^/]+$/.test(path)) return "event";
    return null;
}

/** The event id the page is currently on — how a walk reaches a route that
 *  has no link from the event page (`/limited/<id>/build` for a seat still
 *  mid-draft). Derived from the URL the fixture's own row navigated to, so it
 *  is still the fixture being addressed, never a positional guess. */
function currentEventId(page: Page): string {
    const match = /^\/limited\/([^/]+)/.exec(new URL(page.url()).pathname);
    if (!match) {
        throw new Unreachable(
            `expected to be on a /limited/<id> route, but the page is at ${page.url()}`
        );
    }
    return match[1];
}

/* The v4 lobby's walk hooks (ADR 0103 §6, issue #2726). ATTRIBUTES, not
 * `:has-text()` literals, because neither control the walk needs carries a
 * stable string any more: a Deck Shelf tile's visible text is the deck NAME
 * (its "Select <name>" is an `aria-label`, which `:has-text` does not read),
 * and the Loadout's single ivory plate is NAMED BY the selected Mode Tile
 * ("Play vs Bot" on a cold lobby), so `button:has-text('Solo Game')` would
 * match the Mode TILE — which selects and starts nothing. Both attributes are
 * declared as walk seams at their component (`deck-shelf-tile.tsx`,
 * `lobby-loadout.tsx`) and exercised through the real lobby wiring in
 * `src/components/lobby/__tests__/lobby.test.tsx`. */
const DECK_TILE_SELECTED = '[data-deck-tile][data-selected="true"]';
/** A card in the seat's hand (`gre-hand-card.tsx`) — the card-preview walk's
 *  subject. The hand is the one zone guaranteed non-empty on a freshly created
 *  solo game, where the battlefield is empty by rule (CR 103). */
const HAND_CARD = "[data-board-hand-card]";
/** The anchored preview pin (`card-preview-anchored.tsx`). */
const PREVIEW_ANCHORED = "[data-card-preview-anchored]";
/** The Engine View well (`card-preview-engine-view.tsx`, issue #2728), which
 *  issue #2704 fills with the tree. */
const ENGINE_VIEW_TREE = "[data-engine-view-tree]";
const DECK_TILE_SELECT = "[data-deck-tile] [data-deck-select]:not([disabled])";
/**
 * Select a deck the lane can actually play a game with: the PRESET shelf
 * first, any shelf second (issue #3493).
 *
 * Not merely "the first selectable tile": "Your decks" carries whatever the
 * account happens to hold, including the three-card rows THIS lane's own
 * `deck-builder` walk leaves behind when it dies before its cleanup. A solo
 * game on one of those is a DRAW by decking before the first priority, and the
 * Game Over dialog's modal scrim then swallows every later click on the board.
 * `createVsAiGame` reaches the same conclusion from the vs-AI side (#3492) and
 * this shares its selector.
 */
async function selectPlayableDeck(page: Page): Promise<boolean> {
    if (await clickIfVisible(page, PRESET_DECK_SELECT, 6000)) return true;
    return clickIfVisible(page, DECK_TILE_SELECT, 6000);
}

const MODE_TILE_SOLO = '[data-mode-tile="solo"]';
/** The lobby's DEFAULT mode tile — the one whose primary action opens the
 *  vs-AI setup dialog rather than creating a game (`lobby-vs-ai` below). */
const MODE_TILE_BOT = '[data-mode-tile="bot"]';
const LOBBY_PRIMARY = "[data-lobby-primary]:not([disabled])";

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
        // 1. A deck has to be the Loadout's ACTIVE one before the primary
        //    action ungates. An already-selected tile and an illegal one are
        //    both `disabled`, so this addresses the first tile that can
        //    actually take the selection — and the step is skipped outright
        //    when a tile already carries the selection. That is the SECOND
        //    `ensureBoard` call inside one viewport (`game-board` then
        //    `game-debug-sheet`, both below — `game-stress` names the same
        //    pairing but is still declared unwalked, issue #3506), which
        //    shares the context and so the
        //    `tolaria:selectedDeckId` the first call wrote. It is NOT how a
        //    later VIEWPORT starts: `index.ts`'s `browser.newContext({viewport,
        //    …})` passes no `storageState`, so every viewport begins with empty
        //    storage and viewports 2-5 reach a board through the `Resume`
        //    branch above, on the game viewport 1 created.
        if (!(await visible(page, DECK_TILE_SELECTED, 2000))) {
            if (!(await selectPlayableDeck(page))) {
                throw new Unreachable(
                    "the lobby offered neither Resume nor a selectable Deck Shelf tile — is the deployment seeded with preset decks?"
                );
            }
            await settle(page);
        }
        // 2. A Mode Tile SELECTS; it never starts anything. "Solo game" is the
        //    one whose primary action creates a game outright — the default
        //    "Play vs Bot" tile opens the vs-AI setup dialog instead, and
        //    "Open a table" hosts a seat and waits for a second player.
        if (!(await clickIfVisible(page, MODE_TILE_SOLO, 6000))) {
            throw new Unreachable(
                "the lobby's Mode Tiles offered no 'Solo game' tile — is the game-mode selector stuck on Cockatrice mode?"
            );
        }
        // 3. The single ivory plate, which now reads "Solo game".
        if (!(await clickIfVisible(page, LOBBY_PRIMARY, 6000))) {
            throw new Unreachable(
                "the Loadout's primary action stayed disabled after selecting a deck and the 'Solo game' Mode Tile"
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
    //
    // `:text-is()`, never `:has-text()` (issue #3493): `has-text` matches any
    // DESCENDANT text, and the board's phase list contains the word "Upkeep" —
    // so `button:has-text('Keep')` resolved to the phase-list toggle, left the
    // mulligan dialog open, and every later click on the board timed out
    // against its modal scrim. That is what had `game-board` and `game-stress`
    // sitting on stale `unwalked` rows.
    await clickIfVisible(page, "button:text-is('Play')", 6000);
    for (let seat = 0; seat < 2; seat++) {
        if (!(await clickIfVisible(page, MULLIGAN_KEEP, 6000))) break;
        await settle(page);
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

/** The board with the FIXED stress position loaded (`stress-scenario.json`).
 *
 *  Two surfaces need it, for the same reason every board row now loads a
 *  DECLARED position (ADR 0132 §4): a dealt solo game lands on a position
 *  nobody chose, and two runs of the same tree gave different card counts —
 *  which is what `game-board` was declared unwalked for until issue #3695 gave
 *  it `board-scenario.json`. A measurement means something only over a board
 *  somebody wrote down. */
async function ensureStressBoard(page: Page, ctx: WalkContext): Promise<void> {
    await ensureScenarioBoard(page, ctx, ctx.stressScenarioLabel);
}

/** The board with the debug scenario `label` loaded into the SOLO game the lane
 *  created — `ensureStressBoard`'s mechanism, for any fixed position. */
async function ensureScenarioBoard(
    page: Page,
    ctx: WalkContext,
    label: string
): Promise<void> {
    await ensureBoard(page, ctx);
    if (!ctx.createdGame) {
        throw new Unreachable(
            "an active game the lane did not create is in progress; loading a scenario would clobber it. Finish or concede it, then re-run"
        );
    }
    await loadScenarioOnBoard(page, label);
}

/** Load the debug scenario `label` into the game currently on screen.
 *
 *  Split from `ensureScenarioBoard` (issue #3652) because the vs-AI surface
 *  reaches its board a different way (`ensureVsAiBoard` — a different lobby
 *  affordance, a different pregame) and owns a different licence flag, but
 *  loads its declared position through exactly these clicks. One copy, so the
 *  two can never drift on the sheet's own selectors. The CALLER checks that
 *  the lane created the game it is about to overwrite. */
async function loadScenarioOnBoard(page: Page, label: string): Promise<void> {
    // The debug surface is a SHEET behind a slim « / » edge tab since issue
    // #3403 — `button:has-text('Debug')` addressed the retired seven-button
    // rail and had silently stopped matching anything.
    await openDebugSheet(page);
    if (!(await clickIfVisible(page, "button:has-text('Scenarios')", 6000))) {
        throw new Unreachable("the Debug panel offered no Scenarios button");
    }
    const search = page
        .locator("input[placeholder*='Search scenarios']")
        .first();
    if (
        !(await visible(page, "input[placeholder*='Search scenarios']", 6000))
    ) {
        throw new Unreachable(
            "the Scenarios list did not open (listDebugScenarios is admin-gated — is this account an admin?)"
        );
    }
    await search.fill(label);
    const rowSelector = `button:has-text(${JSON.stringify(label)})`;
    const row = page.locator(rowSelector);
    // Waits for the filtered row rather than sleeping 600ms and counting once:
    // under load the list query answers later than that, and the lane reported
    // a seeded scenario "absent" (issue #3626's runs, load 12-96).
    if (!(await fixtureRowsRendered(page, rowSelector))) {
        throw new Unreachable(
            `debug scenario "${label}" is absent from this deployment — seed it with debugScenarios:seedScenarioDirect (see the PR receipt's scenario field)`
        );
    }
    await row.first().click({ timeout: STEP_TIMEOUT });
    await settle(page);
    // The sheet is SETUP here, not the subject: `game-stress` and
    // `game-card-preview` measure the board, and at `lg` an open sheet takes
    // 480px off it (issue #3493) while at phone width it paints over the very
    // hand card the preview walk right-presses. `game-debug-sheet` re-opens it.
    await closeDebugSheet(page);
    await settle(page);
}

/**
 * Click a prompt that may VANISH while it is being clicked.
 *
 * `clickIfVisible` above is the right primitive for a control the walk owns:
 * a click that fails there is a defect and must surface. The coin toss and the
 * mulligan prompt are different — the other seat answers its half too, in a
 * vs-AI game asynchronously and while the page is live, so a control that was
 * visible when `visible()` returned can be gone before Playwright's
 * actionability check finishes. That race IS the prompt resolving itself,
 * which is the state the caller wanted; reporting the surface UNWALKED on a
 * `click: Timeout 8000ms exceeded` there (measured, issue #3492) describes a
 * board that reached exactly the position asked for.
 */
async function clickTransient(
    page: Page,
    selector: string,
    timeout = STEP_TIMEOUT
): Promise<boolean> {
    if (!(await visible(page, selector, timeout))) return false;
    try {
        await page.locator(selector).first().click({ timeout: STEP_TIMEOUT });
        return true;
    } catch {
        return false;
    }
}

/** The debug sheet's slim edge toggle and the sheet it opens
 *  (`debug-sheet.tsx`, issue #3403). The toggle's visible text is a chevron,
 *  so the walk addresses the attributes the component declares, never a
 *  string — and `aria-expanded` is what lets it OPEN the sheet rather than
 *  toggle it blind: the flag is persisted per device
 *  (`tolaria:debugSheetOpen`), so a second surface in the same context can
 *  arrive with it already open, and a blind click would then close the very
 *  thing being measured. */
/** The pile triggers a graveyard can be opened from. Landscape renders the
 *  tile itself (`player-graveyard.tsx`'s `data-zone-drop`); portrait renders
 *  a `GY` chip instead and hides the tile (`board-pile-chips.tsx`). Both
 *  players carry one, and nothing in the DOM names the viewer's — so the walk
 *  tries each and keeps the pile whose dialog offers the CTA. */
const GRAVEYARD_TRIGGERS = [
    // ONE chip selector: a narrower copy scoped to the viewer's bottom bar
    // matched a subset of this one, so a failed attempt re-clicked the same
    // chip under a second name (PR review).
    '[data-testid^="chip-graveyard-"]',
    '[data-zone-drop="graveyard"]',
] as const;
/** A pile tile that carries pile actions opens a context menu first, whose
 *  FIRST item browses the pile (`usePileBrowseMenu`, issue #2345). */
const PILE_BROWSE_ITEM = '[role=menuitem]:has-text("Browse pile…")';
const ZONE_CTA_FLASHBACK = '[role=dialog] button:text-is("Flashback")';

/** Open the viewer's own graveyard until its dialog shows the Flashback CTA
 *  (`game-zone-pile`, issue #3651). Every attempt that opened the WRONG pile
 *  is closed before the next, so the surface never measures two dialogs. */
async function openViewerGraveyard(page: Page): Promise<void> {
    const tried: string[] = [];
    for (const selector of GRAVEYARD_TRIGGERS) {
        const triggers = page.locator(selector);
        const count = await triggers.count();
        for (let i = 0; i < count; i++) {
            const trigger = triggers.nth(i);
            if (!(await trigger.isVisible().catch(() => false))) continue;
            tried.push(`${selector}#${i}`);
            await trigger.click({ timeout: STEP_TIMEOUT });
            await clickIfVisible(page, PILE_BROWSE_ITEM, 1500);
            if (await visible(page, ZONE_CTA_FLASHBACK, 3000)) return;
            await page.keyboard.press("Escape");
            await settle(page);
        }
    }
    throw new Unreachable(
        `no graveyard pile opened on a Flashback CTA (tried ${tried.join(", ") || "nothing — no visible graveyard trigger"}) — the board scenario puts Cabal Therapy in the viewer's graveyard; is it seeded, and is its cast still legal in that position?`
    );
}

const DEBUG_SHEET_TOGGLE = "[data-debug-sheet-toggle]";
const DEBUG_SHEET_TOGGLE_CLOSED =
    '[data-debug-sheet-toggle][aria-expanded="false"]';
const DEBUG_SHEET = "[data-debug-sheet]";
/** A stack row's per-ability **Yield** toggle (`stack-yield-toggle.tsx`), the
 *  stack panel's "Manage yields" control and one row of the box it opens
 *  (issue #3629). */
/** The block declaration's own call to action (issue #3708). With nothing
 *  selected the command slot reads exactly `No Blockers`
 *  (`useControllerActions`), which is what makes this addressable without
 *  selecting anything: the walk MEASURES the block window, it does not play it.
 *
 *  `:has-text()` rather than `:text-is()`, and the asymmetry is the same one
 *  `CONFIRM_CONCEDE` carries: the desktop pod renders this descriptor through
 *  `ActionButton`, which wraps its label in a `<span>`, so `:text-is()` would
 *  match the span and never the button. The substring is safe here — the phase
 *  bar's own stop reads `Declare Blockers`, which does not contain it. */
const BLOCK_DECLARATION_CTA = 'button:has-text("No Blockers")';
/** The priority pass, in the same command slot. `:text-is()` is wrong for the
 *  same reason as above, and a bare `:has-text("Pass")` would also match the
 *  `Pass Turn` side pill — which ends the TURN, not the priority round, and
 *  would walk straight past the resolution this surface exists to reach. The
 *  accessible name is the whole label, so role+name is exact at every
 *  viewport. */
const PASS_PRIORITY_CTA =
    'button:text-is("Pass"), button:has(> span:text-is("Pass"))';
/** The modal card picker a mid-resolution choice opens (`CardsPile` inside a
 *  `GameDialog`, issue #3708). The column is the dialog's own scroll port; the
 *  tiles are the candidates, each carrying its instance id. */
const CHOICE_PICKER = '[data-slot="game-dialog-column"]';
/** Every grid tile wraps its face in `CardTilt3D` (`cards-pile.tsx`), eligible
 *  and dimmed alike, so this counts CANDIDATES — not just the pickable ones.
 *  `data-flight-id` is the COLLAPSED pile's tile seam and is absent from the
 *  grid, which is how the first cut of this row read zero candidates against a
 *  picker that was showing seven. */
const CHOICE_PICKER_CARD = `${CHOICE_PICKER} [data-card-tilt-root]`;
/** `LibrarySearchConfirm`'s plate reads `Done (0/1)` while nothing is picked,
 *  so the label is not a constant — anchored on its stable head. */
const CHOICE_PICKER_CONFIRM = `${CHOICE_PICKER} button:has-text("Done")`;
const STACK_YIELD_TOGGLE = "[data-stack-yield-toggle]";
const MANAGE_YIELDS_CTA = '[data-manage-yields="panel"]';
const MANAGE_YIELDS_ROW = "[data-manage-yields-row]";
/** The AI trace box's OPEN body (`ai-decision-trace-box.tsx`, issue #3492).
 *  It carries the max-height this surface exists to measure, and it is
 *  mounted only for a vs-AI game — which makes its absence the one reliable
 *  tell that the walk reached the sheet on the wrong KIND of game. */
const AI_TRACE_BODY = "[data-ai-trace-body]";

/** The sheet's own scroll port (`debug-sheet.tsx`) — where the scenario form's
 *  pinned head is measured against. */
const DEBUG_SHEET_BODY = "[data-debug-sheet-body]";
/** The game route's board wrapper (`debug-board-area.tsx`, issue #3493). Its
 *  box IS the acceptance criterion: at `lg` and wider an open sheet takes
 *  exactly its own width off this element, and below `lg` it takes nothing. */
const BOARD_AREA = "[data-board-area]";
/** Kept in step with `src/components/debug/debug-sheet-metrics.ts` — imported
 *  rather than retyped is not an option here (`scripts/**` must not pull the
 *  frontend's alias graph into `bun run land`), so the lane asserts the number
 *  instead of trusting it. */
const DEBUG_SHEET_DESKTOP_WIDTH = 480;
/** The Tailwind `lg` breakpoint the push is behind. */
const DEBUG_SHEET_PUSH_MIN_WIDTH = 1024;
/** Sub-pixel slack: a bounding box is a float, and a 1px hairline border on
 *  the sheet is not part of the margin the board gives up. */
const PUSH_TOLERANCE = 2;

/** Open the debug sheet if it is not already open. IDEMPOTENT on purpose: the
 *  open flag is persisted per device (`tolaria:debugSheetOpen`), so a blind
 *  click on the tab is as likely to CLOSE the sheet as to open it. */
async function openDebugSheet(page: Page): Promise<void> {
    if (!(await visible(page, DEBUG_SHEET_TOGGLE, STEP_TIMEOUT))) {
        throw new Unreachable(
            "no debug sheet tab on the board — the signed-in account is neither a tester nor an admin (`canUseDebugSheet`)"
        );
    }
    // Only if it is CLOSED — the flag persists per device, so a blind click is
    // as likely to shut the sheet as to open it (issue #3492's idiom).
    await clickIfVisible(page, DEBUG_SHEET_TOGGLE_CLOSED, 2000);
    await settle(page);
    if (!(await visible(page, DEBUG_SHEET, STEP_TIMEOUT))) {
        throw new Unreachable(
            "the debug sheet tab reports expanded but no `[data-debug-sheet]` mounted"
        );
    }
}

/** Close it again, for the surfaces whose subject is the BOARD.
 *
 *  ESCAPE, not a second click on the tab: the open sheet sits at `z-sheet`
 *  (50) and the tab at `z-dev-overlay` (45), so the sheet PAINTS OVER its own
 *  toggle by design (`debug-sheet.tsx`) — Playwright reads that correctly as
 *  the sheet body intercepting the click, and waits out its timeout. Escape is
 *  the documented close, and `board.tsx`'s `POPUP_SELECTORS` lists the sheet,
 *  so it closes the sheet INSTEAD of popping the pause menu behind it. */
async function closeDebugSheet(page: Page): Promise<void> {
    const toggle = page.locator(DEBUG_SHEET_TOGGLE).first();
    if ((await toggle.count()) === 0) return;
    if ((await toggle.getAttribute("aria-expanded")) !== "true") return;
    await page.keyboard.press("Escape");
    await settle(page);
    if (await visible(page, DEBUG_SHEET, 1500)) {
        throw new Unreachable(
            'Escape did not close the debug sheet — the board\'s `POPUP_SELECTORS` no longer lists `[data-slot="sheet-content"]`?'
        );
    }
}

/** The board wrapper's measured width, in CSS pixels. */
async function boardAreaWidth(page: Page): Promise<number> {
    const box = await page.locator(BOARD_AREA).first().boundingBox();
    if (!box) {
        throw new Unreachable(
            `the game route mounted no \`${BOARD_AREA}\` box to measure — is this still the GRE board route?`
        );
    }
    return box.width;
}

/* The PRESET shelf's tiles, not "the first selectable tile anywhere in the
 * lobby" (issue #3492). The lobby renders two shelves — `Your decks` and
 * `Preset decks` (`lobby.tsx`) — and the unscoped selector `ensureBoard` uses
 * reaches whichever comes first, which is the user's. On this shared dev
 * account that is a `deck-builder` leftover: measured here, the vs-AI walk
 * dealt `Deck 38`, a freeform two-card list, to BOTH seats and the game ended
 * before the first prompt with `The game is a draw` — both players drew from
 * an empty library at the same moment. A preset is a real 60-card list, so the
 * position the probe measures is a board and not a scoreboard. */
const PRESET_SHELF = 'section:has(h2:text-is("Preset decks"))';
const PRESET_DECK_SELECT = `${PRESET_SHELF} [data-deck-tile] [data-deck-select]:not([disabled])`;
const PRESET_DECK_SELECTED = `${PRESET_SHELF} [data-deck-tile][data-selected="true"]`;

/**
 * Concede the active match from the lobby banner (`active-game-notice.tsx`).
 *
 * ONLY ever called on a game the lane created itself — ending someone's match
 * is their call, and every other walk here resumes rather than clears. The
 * banner's own control opens a confirm dialog whose destructive plate carries
 * the SAME label, so the second click is scoped to `[role=dialog]`: an
 * unscoped `:has-text('Concede Match')` would re-click the banner button and
 * leave the dialog standing.
 *
 * A waiting room (no opponent yet) offers `Leave` instead of `Concede Match`;
 * a vs-AI game is never in that state, but the branch costs one line and keeps
 * the helper honest about the two states the banner has.
 */
/** `clickIfVisible`, with its `Unreachable` folded into a trace line instead of
 *  thrown. For a retrying sequence that wants the diagnostic AND wants to keep
 *  going: absent reads as `false`, and so does present-but-unclickable, with
 *  the hit target recorded. */
async function pressed(
    page: Page,
    selector: string,
    timeout: number,
    trace: string[],
    pass: number
): Promise<boolean> {
    try {
        return await clickIfVisible(page, selector, timeout);
    } catch (err) {
        trace.push(`pass${pass}: ${(err as Error).message}`);
        return false;
    }
}

async function concedeLaneGame(
    page: Page,
    ctx: WalkContext,
    trace: string[] = []
): Promise<boolean> {
    for (let pass = 0; pass < 2; pass++) {
        await goto(page, ctx, "/");
        if (!(await visible(page, BANNER_RESUME, 4000))) {
            trace.push(`pass${pass}: no active-game banner`);
            return true;
        }
        // `clickIfVisible`, not `clickTransient`: nothing races these two the
        // way the bot races the toss and the mulligan, so an actionability
        // failure here is a real defect and must arrive with `topmostAt`'s hit
        // target rather than as a bare `false` two passes later (PR #3501
        // review). Caught rather than propagated so pass 1 still runs — the
        // banner's control follows the MATCH's status, which trails the
        // game's, so the second pass can succeed where the first could not.
        if (await pressed(page, BANNER_CONCEDE, 3000, trace, pass)) {
            trace.push(`pass${pass}: pressed banner Concede`);
            const dialog = await visible(page, "[role=dialog]", 4000);
            trace.push(
                `pass${pass}: confirm dialog ${dialog ? "open" : "ABSENT"}`
            );
            const confirmed = await pressed(
                page,
                CONFIRM_CONCEDE,
                STEP_TIMEOUT,
                trace,
                pass
            );
            trace.push(
                `pass${pass}: confirm plate ${confirmed ? "pressed" : "NOT PRESSED"}`
            );
        } else if (await pressed(page, BANNER_LEAVE, 3000, trace, pass)) {
            trace.push(`pass${pass}: pressed banner Leave`);
        } else {
            trace.push(`pass${pass}: banner offered neither Concede nor Leave`);
        }
        await settle(page);
        if (!(await visible(page, BANNER_RESUME, 3000))) {
            trace.push(`pass${pass}: banner gone`);
            return true;
        }
        trace.push(`pass${pass}: banner still standing`);
    }
    return false;
}

/**
 * End the game this lane created, so the next walk deals a fresh one — what a
 * `needsGame` surface needs before an Infra Verdict is retried (issue #3644).
 * A game the lane did not create is never touched (the non-destructive rule at
 * the top of this file); with none created there is nothing to do.
 */
export async function recreateLaneGame(
    page: Page,
    ctx: WalkContext
): Promise<void> {
    if (!ctx.createdGame && !ctx.createdVsAiGame) return;
    const trace: string[] = [];
    if (!(await concedeLaneGame(page, ctx, trace))) {
        throw new Unreachable(
            `could not end the lane's own game before a retry: ${trace.join("; ")}`
        );
    }
    ctx.createdGame = false;
    ctx.createdVsAiGame = false;
}

/** Create a vs-AI game from a lobby with no active game. Same three lobby
 *  steps `ensureBoard` uses, plus the setup dialog's confirm — the `bot` Mode
 *  Tile's primary action opens that dialog instead of creating anything, which
 *  is exactly what `lobby-vs-ai` measures one step earlier. */
async function createVsAiGame(page: Page, ctx: WalkContext): Promise<void> {
    if (!(await clickIfVisible(page, MODE_TILE_BOT, 6000))) {
        throw new Unreachable(
            "the lobby's Mode Tiles offered no 'Play vs Bot' tile"
        );
    }
    if (!(await visible(page, PRESET_DECK_SELECTED, 2000))) {
        if (!(await clickIfVisible(page, PRESET_DECK_SELECT, 6000))) {
            throw new Unreachable(
                "the lobby's `Preset decks` shelf offered no selectable tile \u2014 seed the deployment with `bun run seed:preset --all`"
            );
        }
        await settle(page);
    }
    if (!(await clickIfVisible(page, LOBBY_PRIMARY, 6000))) {
        throw new Unreachable(
            "the Loadout's primary action stayed disabled after selecting a preset deck and the 'Play vs Bot' Mode Tile"
        );
    }
    if (!(await visible(page, "[role=dialog]", STEP_TIMEOUT))) {
        throw new Unreachable(
            "the 'Play vs Bot' primary action did not open the vs-AI setup dialog within 8s"
        );
    }
    if (
        !(await clickIfVisible(
            page,
            "[role=dialog] button:has-text('Play vs AI')",
            STEP_TIMEOUT
        ))
    ) {
        throw new Unreachable(
            "the vs-AI setup dialog offered no 'Play vs AI' confirm"
        );
    }
    ctx.createdVsAiGame = true;
    ctx.log("created a vs-AI game");
}

/**
 * Reach a live VS-AI board — the one game kind that mounts the AI trace box.
 *
 * Non-destructive by the same rule as `ensureBoard`, and by a STRICTER reading
 * of it (PR #3501 review): the only game this walk ever ends is one IT created,
 * and `ensureBoard`'s solo game is not that game even though the lane owns it.
 * The board rows share ONE solo game across all five viewports on purpose —
 * `ensureBoard`'s own comment says viewports 2-5 reach a board through the
 * `Resume` branch, on the game viewport 1 dealt — so conceding it here to free
 * the vs-AI lobby gate would silently re-deal the subject `game-board` and
 * `game-stress` are measured against, from the tail of every viewport pass.
 * `game-board` walks again since issue #3695, so the collision is reachable
 * whenever this row runs after it in the same viewport pass; the branch below
 * reports it rather than resolving it, so re-enabling the remaining board rows
 * reds this row instead of quietly moving theirs.
 */
async function ensureVsAiBoard(page: Page, ctx: WalkContext): Promise<void> {
    await goto(page, ctx, "/");

    if (await visible(page, BANNER_RESUME, 4000)) {
        if (ctx.createdVsAiGame) {
            if (!(await clickIfVisible(page, BANNER_RESUME, 6000))) {
                throw new Unreachable(
                    "the lobby banner is up and this lane created the vs-AI game behind it, but its `Resume` could not be pressed — the walk cannot get back to the board it measured last viewport"
                );
            }
            ctx.log("resumed the vs-AI game this lane created");
        } else if (ctx.createdGame) {
            throw new Unreachable(
                "the lane's own SOLO game is active (a board row dealt it), and this surface needs a vs-AI game the lobby gate will not open while any game is in progress. Conceding it here would re-deal the fixed subject `game-board`/`game-stress` are budgeted against, at the tail of every viewport — so the two cannot share a run yet. Whichever slice re-walks the board rows owns resolving this"
            );
        } else {
            throw new Unreachable(
                "an active game the lane did not create is in progress. The vs-AI setup dialog opens only from the Loadout's primary plate, which `lobbyGate` disables while the account holds ANY game (`src/lib/lobbyGate.ts`) \u2014 and ending a match the lane does not own is not its call. Finish or concede it, then re-run"
            );
        }
    } else {
        await createVsAiGame(page, ctx);
    }

    await page.waitForURL(/\/game/, { timeout: NAV_TIMEOUT }).catch(() => {
        throw new Unreachable("the lobby never routed to /game");
    });
    await settle(page);

    // Answer the pregame prompts until nothing modal is left standing.
    //
    // POLLED, not a fixed sequence. The coin toss is a modal `GameDialog` with
    // four states (`pregame-dialog.tsx`: tossing / waiting / auto / prompt),
    // only one of which has a button, and in a vs-AI game the bot answers its
    // own half asynchronously — so which prompts this client ever sees, and in
    // what order, is not something the walk can assume. What it CAN assert is
    // the end state: no modal on the board. That matters more here than on any
    // other surface, because the thing this one measures is opened from a
    // `fixed` edge tab, and `dialog.tsx`'s scrim is `fixed inset-0` — a toss
    // dialog still up reads as "the toggle is visible but unclickable"
    // (measured, issue #3492).
    const promptsDeadline = Date.now() + 45_000;
    for (;;) {
        // No pause after an answer: the next pass's own waits (up to 1.2s
        // per prompt, 0.8s for the dialog) pace the loop.
        if (await clickTransient(page, PREGAME_PLAY, 1200)) continue;
        // The mulligan prompt is a draggable panel, not a dialog, so it never
        // blocks the toggle — but leaving it up leaves the board in a position
        // nobody chose, which is the flapping `game-board` was withdrawn for.
        if (await clickTransient(page, MULLIGAN_KEEP, 1200)) continue;
        if (!(await visible(page, "[role=dialog]", 800))) break;
        if (Date.now() > promptsDeadline) {
            const shown = (
                (await page
                    .locator("[role=dialog]")
                    .first()
                    .innerText()
                    .catch(() => "")) || "(no text)"
            )
                .replace(/\s+/g, " ")
                .slice(0, 200);
            throw new Unreachable(
                `a modal dialog was still open on the board 45s after the game was created, and it offered no \`Play\` or \`Keep\` to answer it with — the pregame sequence is stuck on: "${shown}"`
            );
        }
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

/** The pregame gate's own dialog (`pregame-dialog.tsx`): the coin toss, and
 *  the play/draw choice the toss winner owes (CR 103.1). */
const PREGAME_GATE = '[role=dialog]:has-text("Coin toss")';
/** The same layer as PLAIN CSS. `settle.ts` hands its targets to
 *  `querySelectorAll` in the page, which does not know Playwright's
 *  `:has-text()` engine and throws `not a valid selector` — measured, and it
 *  reported the surface UNWALKED. Only one dialog is up at the gate. */
const PREGAME_GATE_BOX = "[role=dialog]";

/**
 * Reach a game STOPPED at its pregame gate (issue #4419).
 *
 * `ensureBoard` above clicks straight THROUGH this dialog — it is in the way
 * of every board row — which is how the one screen every match opens with
 * ended up measured at no viewport, and why the census called it the sharpest
 * row in `DEBT`: a walk that dismisses a layer is not a walk that photographs
 * it.
 *
 * So this is `ensureBoard`'s lobby half WITHOUT the dismissal, and it refuses
 * rather than substitutes: a game already past its pregame cannot be rewound,
 * so the surface reports UNWALKED instead of measuring the board behind it.
 * The row's `cleanup` clicks the gate through afterwards, so the board rows
 * that follow it in this table find exactly the state they always did.
 */
async function ensurePregameGate(page: Page, ctx: WalkContext): Promise<void> {
    if (
        page.url().includes("/game") &&
        (await visible(page, PREGAME_GATE, 2000))
    ) {
        return;
    }
    await goto(page, ctx, "/");
    if (await clickIfVisible(page, BANNER_RESUME, 4000)) {
        ctx.log("resumed the pre-existing active game");
    } else {
        if (!(await visible(page, DECK_TILE_SELECTED, 2000))) {
            if (!(await selectPlayableDeck(page))) {
                throw new Unreachable(
                    "the lobby offered neither Resume nor a selectable Deck Shelf tile — is the deployment seeded with preset decks?"
                );
            }
            await settle(page);
        }
        if (!(await clickIfVisible(page, MODE_TILE_SOLO, 6000))) {
            throw new Unreachable(
                "the lobby's Mode Tiles offered no 'Solo game' tile — is the game-mode selector stuck on Cockatrice mode?"
            );
        }
        if (!(await clickIfVisible(page, LOBBY_PRIMARY, 6000))) {
            throw new Unreachable(
                "the Loadout's primary action stayed disabled after selecting a deck and the 'Solo game' Mode Tile"
            );
        }
        ctx.createdGame = true;
        ctx.log("created a solo game");
    }
    await page.waitForURL(/\/game/, { timeout: NAV_TIMEOUT }).catch(() => {
        throw new Unreachable("the lobby never routed to /game");
    });
    await settle(page);
    if (!(await visible(page, PREGAME_GATE, 10_000))) {
        throw new Unreachable(
            "reached /game with no pregame gate on screen — the game in progress is already past its coin toss, and rewinding it is not something a walk may do. Finish or concede it, then re-run"
        );
    }
    await settle(page, [PREGAME_GATE_BOX]);
}

/**
 * THE BOARD DIALOG SPECIMENS (issue #4419, slice of the census debt #4402).
 *
 * Seventeen `src/components/board/**` overlays paint a layer over a live game
 * and were measured at no viewport. Reaching each one on a real board would
 * mean reaching the exact position that opens it — a convoke cast with the
 * right pips, an escape cost with the right graveyard — so instead
 * `/admin/design-system` mounts each from fixture props
 * (`src/routes/design-system/sections-board-dialogs.tsx`) and the lane walks
 * ONE ROW PER DIALOG.
 *
 * ONE ROW PER DIALOG, NOT ONE FOR THE SECTION. Every one of these is a real
 * portal overlay at `position: fixed`: mounting them together would stack
 * seventeen scrims and measure whichever landed on top, and a walk that opened
 * each in turn would still photograph only the last — `reachable in
 * principle`, which is the status this census exists to refuse. The cost is
 * seventeen cheap rows (one navigation, one click, no game) and the return is
 * seventeen dialogs held to the Floors at all five viewports.
 *
 * `layer` is the CSS the walk waits on; `layerAssert` is the same layer
 * addressed the way an assertion must be (role+name or a declared `data-*`
 * seam). `entry` is the dialog's own action — what it exists to offer — or,
 * where its controls carry no stable accessible name (a mana pip is an `<img
 * alt="R">`), a `contrast` promise over the layer's own subtree.
 */
interface DialogSpecimen {
    /** Surface id suffix and the value of its section's opener seam. */
    slug: string;
    /** The censused module this row claims in `mounts`, under `src/components/`. */
    module: string;
    /** Human label, for the receipt's surface label. */
    label: string;
    /** CSS the walk waits on and settles against. */
    layer: string;
    layerAssert: NamedAssertion;
    entry: NamedAssertion;
}

const BOARD_DIALOG_SPECIMENS: readonly DialogSpecimen[] = [
    {
        slug: "activatable-ability",
        module: "board/activatable-ability-menu.tsx",
        label: "Activatable abilities (ActionSheet)",
        layer: "[data-action-sheet]",
        layerAssert: {
            label: "sheet layer",
            locator: { selector: "[data-action-sheet]" },
            check: "visible",
        },
        entry: {
            label: "ability row",
            locator: {
                role: "button",
                name: "Sacrifice this creature: Draw a card.",
            },
            check: "reachable",
        },
    },
    {
        slug: "attack-all",
        module: "board/attack-all-confirm-dialog.tsx",
        label: "Attack with all",
        layer: "[role=dialog]",
        layerAssert: {
            label: "dialog: Attack with all",
            locator: { role: "dialog", name: "Attack with all" },
            check: "visible",
        },
        entry: {
            label: "confirm: Attack",
            locator: { role: "button", name: "Attack" },
            check: "reachable",
        },
    },
    {
        slug: "cast-alt-hand-cost",
        module: "board/cast-alternative-hand-cost-dialog.tsx",
        label: "Alternative hand cost",
        layer: "[role=dialog]",
        layerAssert: {
            label: "dialog: Alternative cost",
            locator: { role: "dialog", name: "Alternative cost" },
            check: "visible",
        },
        entry: {
            label: "confirm: Discard 0/1",
            locator: { role: "button", name: "Discard 0/1" },
            check: "visible",
        },
    },
    {
        slug: "cast-exile-cost",
        module: "board/cast-exile-cost-dialog.tsx",
        label: "Flashback exile cost",
        layer: "[role=dialog]",
        layerAssert: {
            label: "dialog: Flashback cost",
            locator: { role: "dialog", name: "Flashback cost" },
            check: "visible",
        },
        entry: {
            label: "confirm: Exile 0/2",
            locator: { role: "button", name: "Exile 0/2" },
            check: "visible",
        },
    },
    {
        slug: "controller-phases",
        module: "board/controller-phase-list.tsx",
        label: "Turn phases",
        layer: "[role=dialog]",
        layerAssert: {
            label: "dialog: Turn phases",
            locator: { role: "dialog", name: "Turn phases" },
            check: "visible",
        },
        entry: {
            label: "close phase list",
            locator: { role: "button", name: "Close phase list" },
            check: "reachable",
        },
    },
    {
        slug: "convoke",
        module: "board/convoke-creature-dialog.tsx",
        label: "Convoke tapper",
        layer: "[role=dialog]",
        layerAssert: {
            label: "dialog: Convoke",
            locator: { role: "dialog", name: "Convoke" },
            check: "visible",
        },
        // `Tap 1/2`, not `0/2`: the tapper opens with the minimum already
        // picked, so this plate is the one confirm in the family that is
        // ENABLED at rest.
        entry: {
            label: "confirm: Tap 1/2",
            locator: { role: "button", name: "Tap 1/2" },
            check: "reachable",
        },
    },
    {
        slug: "discard-cost",
        module: "board/discard-cost-dialog.tsx",
        label: "Discard cost",
        layer: "[role=dialog]",
        layerAssert: {
            label: "dialog: Discard a card",
            locator: { role: "dialog", name: "Discard a card" },
            check: "visible",
        },
        entry: {
            label: "confirm: Discard 0/1",
            locator: { role: "button", name: "Discard 0/1" },
            check: "visible",
        },
    },
    {
        slug: "exile-cost",
        module: "board/exile-cost-dialog.tsx",
        label: "Exile cost",
        layer: "[role=dialog]",
        layerAssert: {
            label: "dialog: Exile from a graveyard",
            locator: { role: "dialog", name: "Exile from a graveyard" },
            check: "visible",
        },
        entry: {
            label: "confirm: Exile 0/1",
            locator: { role: "button", name: "Exile 0/1" },
            check: "visible",
        },
    },
    {
        slug: "game-over",
        module: "board/game-over-dialog.tsx",
        label: "Game Over (Bo3 interstitial)",
        layer: "[role=dialog]",
        layerAssert: {
            label: "dialog: Game Over",
            locator: { role: "dialog", name: "Game Over" },
            check: "visible",
        },
        entry: {
            label: "primary: Continue to Sideboarding",
            locator: { role: "button", name: "Continue to Sideboarding" },
            check: "reachable",
        },
    },
    {
        slug: "graveyard-target",
        module: "board/graveyard-target-dialog.tsx",
        label: "Graveyard target picker",
        layer: "[role=dialog]",
        layerAssert: {
            label: "dialog: Lightning Bolt",
            locator: { role: "dialog", name: "Lightning Bolt" },
            check: "visible",
        },
        // The picker's controls are CARD TILES, whose accessible name is a
        // card name the fixture chose — a promise about the fixture, not
        // about the screen. The dialog's own subtree contrast is the promise
        // worth keeping here.
        entry: {
            label: "picker contrast",
            locator: { role: "dialog", name: "Lightning Bolt" },
            check: "contrast",
        },
    },
    {
        slug: "hand-card-actions",
        module: "board/hand-card-action-menu.tsx",
        label: "Hand card actions (ActionSheet)",
        layer: "[data-action-sheet]",
        layerAssert: {
            label: "sheet layer",
            locator: { selector: "[data-action-sheet]" },
            check: "visible",
        },
        entry: {
            label: "primary action row",
            locator: { role: "button", name: "Cast Lightning Bolt" },
            check: "reachable",
        },
    },
    {
        slug: "mana-choice",
        module: "board/mana-choice-picker.tsx",
        label: "Mana choice picker",
        layer: '[data-slot="dialog-content"]',
        layerAssert: {
            label: "picker layer",
            locator: { selector: '[data-slot="dialog-content"]' },
            check: "visible",
        },
        // NOT the `Red` row. Its markup is a pip image beside the colour
        // name, so a browser composes its accessible name as `R Red` — and
        // `alt="R"` is the only thing keeping it from being `Red` alone.
        // happy-dom reads the same row as `Red`, which is how this promise
        // shipped green offline and broke at all five viewports (measured).
        // The layer's own contrast is the promise that holds.
        entry: {
            label: "picker contrast",
            locator: { selector: '[data-slot="dialog-content"]' },
            check: "contrast",
        },
    },
    {
        slug: "mana-spend",
        module: "board/mana-spend-choice-dialog.tsx",
        label: "Mana spend chooser",
        layer: "[role=dialog]",
        layerAssert: {
            label: "dialog: Choose mana to spend",
            locator: { role: "dialog", name: "Choose mana to spend" },
            check: "visible",
        },
        // Its controls are bare pip images (`<img alt="R">`).
        entry: {
            label: "chooser contrast",
            locator: { role: "dialog", name: "Choose mana to spend" },
            check: "contrast",
        },
    },
    {
        slug: "manual-game-over",
        module: "board/manual-game-over-dialog.tsx",
        label: "Manual Game Over",
        layer: "[role=dialog]",
        layerAssert: {
            label: "dialog: Game Over",
            locator: { role: "dialog", name: "Game Over" },
            check: "visible",
        },
        entry: {
            label: "primary: Back to Lobby",
            locator: { role: "button", name: "Back to Lobby" },
            check: "reachable",
        },
    },
    {
        slug: "manual-verb",
        module: "board/manual-verb-popover.tsx",
        label: "Manual verb prompt",
        layer: "[role=dialog]",
        layerAssert: {
            label: "dialog: Draw how many?",
            locator: { role: "dialog", name: "Draw how many?" },
            check: "visible",
        },
        // NOT its `Confirm` plate: the census page's own Panel specimen
        // renders a button of that exact name, and an assertion that can
        // resolve to a control outside the layer it is describing promises
        // nothing about the layer.
        entry: {
            label: "prompt contrast",
            locator: { role: "dialog", name: "Draw how many?" },
            check: "contrast",
        },
    },
    {
        slug: "pause-menu",
        module: "board/pause-menu-dialog.tsx",
        label: "Game Menu (pause)",
        layer: "[role=dialog]",
        layerAssert: {
            label: "dialog: Game Menu",
            locator: { role: "dialog", name: "Game Menu" },
            check: "visible",
        },
        entry: {
            label: "menu row: Report a bug",
            locator: { role: "button", name: "Report a bug" },
            check: "reachable",
        },
    },
    {
        slug: "sideboarding",
        module: "board/sideboarding-dialog.tsx",
        label: "Sideboarding",
        layer: "[role=dialog]",
        layerAssert: {
            label: "dialog: Sideboarding",
            locator: { role: "dialog", name: "Sideboarding" },
            check: "visible",
        },
        entry: {
            label: "primary: Ready",
            locator: { role: "button", name: "Ready" },
            check: "reachable",
        },
    },
];

/**
 * The four cross-cutting overlays (issue #4423, slice of the census debt issue
 * #4402): the legal disclaimer, the bug-report form, the Inspect overlay and
 * the Scenarios page's active-game confirm. Each belongs to no one page and
 * sits behind an opener the lane cannot reach with the state it has (a fresh
 * account, an active game at launch time), so `/admin/design-system` § 17
 * mounts each from fixture props (`src/routes/design-system/sections-overlays.tsx`)
 * and the lane walks them exactly as it walks § 16: one row per overlay.
 */
const OVERLAY_SPECIMENS: readonly DialogSpecimen[] = [
    {
        slug: "disclaimer",
        module: "legal/disclaimer-dialog.tsx",
        label: "Legal & Disclaimer",
        layer: "[role=dialog]",
        layerAssert: {
            label: "dialog: Legal & Disclaimer",
            locator: { role: "dialog", name: "Legal & Disclaimer" },
            check: "visible",
        },
        // The dialog's only action is reading it: its body text is what a
        // new account is shown, so the promise is that the text is legible.
        entry: {
            label: "disclaimer text contrast",
            locator: { role: "dialog", name: "Legal & Disclaimer" },
            check: "contrast",
        },
    },
    {
        slug: "bug-report",
        module: "bug-report/bug-report-dialog.tsx",
        label: "Report a bug",
        layer: "[role=dialog]",
        layerAssert: {
            label: "dialog: Report a bug",
            locator: { role: "dialog", name: "Report a bug" },
            check: "visible",
        },
        // `Submit` is disabled until the description is filled, which is
        // the state the specimen mounts in — promised `visible`, never
        // `reachable` (the same call as § 16's `0/N` plates).
        entry: {
            label: "primary: Submit",
            locator: { role: "button", name: "Submit" },
            check: "visible",
        },
    },
    {
        slug: "inspect-overlay",
        module: "editing/inspect-overlay.tsx",
        label: "Inspect overlay",
        layer: "[data-inspect-overlay]",
        layerAssert: {
            label: "dialog: Lightning Bolt",
            locator: { role: "dialog", name: "Lightning Bolt" },
            check: "visible",
        },
        entry: {
            label: "primary: Pick",
            locator: { role: "button", name: "Pick" },
            check: "reachable",
        },
    },
    {
        slug: "scenario-active-game",
        module: "admin/scenario-active-game-dialog.tsx",
        label: "Concede active game?",
        layer: "[role=dialog]",
        layerAssert: {
            label: "dialog: Concede active game?",
            locator: { role: "dialog", name: "Concede active game?" },
            check: "visible",
        },
        entry: {
            label: "confirm: Concede & Start",
            locator: { role: "button", name: "Concede & Start" },
            check: "reachable",
        },
    },
];

/**
 * THE CAST PICKER SPECIMENS (issue #4420, slice of the census debt #4402).
 *
 * The eight `src/components/cards/**` overlays a cast walks through — the
 * cost, mode and preview pickers — open at one instant of one cast the lane
 * cannot set up on demand. `/admin/design-system` § 18 mounts each from
 * fixture props (`src/routes/design-system/sections-cast-pickers.tsx`), and the
 * lane walks one `pick-*` row per opener, exactly as § 16's `dlg-*` rows.
 *
 * The anchored pickers (`AnchoredPicker`: additional cost, alternative cost,
 * yield preview, mode, Phyrexian) open where the opener was pressed and clamp
 * themselves to the viewport — their failure shape is a body that outgrows a
 * phone. Their rows are a label beside a caption, or mana-symbol images with no
 * alt text, so no row carries an accessible name worth promising: each is
 * addressed by the `data-testid` seam it already declares, or by the layer's
 * own contrast. `selectable-card` is the one inline specimen: a card with its
 * cast affordances rather than a layer.
 */
const ANCHORED = '[data-slot="dialog-content"]';

const CAST_PICKER_SPECIMENS: readonly DialogSpecimen[] = [
    {
        slug: "additional-cost",
        module: "cards/additional-cost-picker.tsx",
        label: "Additional cost picker",
        layer: ANCHORED,
        layerAssert: {
            label: "picker layer",
            locator: { selector: ANCHORED },
            check: "visible",
        },
        entry: {
            label: "leg row: Pay 3 life",
            locator: { selector: '[data-testid="additional-cost-leg-life"]' },
            check: "reachable",
        },
    },
    {
        slug: "alt-cost",
        module: "cards/alt-cost-picker.tsx",
        label: "Alternative cost picker",
        layer: ANCHORED,
        layerAssert: {
            label: "picker layer",
            locator: { selector: ANCHORED },
            check: "visible",
        },
        entry: {
            label: "row: Pay mana cost",
            locator: { role: "button", name: "Pay mana cost" },
            check: "reachable",
        },
    },
    {
        slug: "card-preview-yield",
        module: "cards/card-preview-yield-menu.tsx",
        label: "Card preview with a Yield",
        layer: ANCHORED,
        layerAssert: {
            label: "menu layer",
            locator: { selector: ANCHORED },
            check: "visible",
        },
        entry: {
            label: "row: Preview",
            locator: { selector: '[data-testid="card-preview-menu-preview"]' },
            check: "reachable",
        },
    },
    {
        slug: "cast-cost",
        module: "cards/cast-cost-dialog.tsx",
        label: "Cast cost dialog",
        layer: "[role=dialog]",
        layerAssert: {
            label: "dialog: Cast cost specimen",
            locator: { role: "dialog", name: "Cast cost specimen" },
            check: "visible",
        },
        // `visible`, not `reachable`: DISABLED at rest. The dialog mounts
        // `open`, as `useHandCardCommit` mounts it, so its closed→open reset
        // never runs and X opens empty — an invalid announcement until the
        // caster types one. Measured at all five viewports.
        entry: {
            label: "confirm: Cast",
            locator: { role: "button", name: "Cast" },
            check: "visible",
        },
    },
    {
        slug: "mode",
        module: "cards/mode-picker.tsx",
        label: "Mode picker (anchored)",
        layer: ANCHORED,
        layerAssert: {
            label: "picker layer",
            locator: { selector: ANCHORED },
            check: "visible",
        },
        entry: {
            label: "picker contrast",
            locator: { selector: ANCHORED },
            check: "contrast",
        },
    },
    {
        slug: "multi-mode",
        module: "cards/multi-mode-picker.tsx",
        label: "Multi-mode picker",
        layer: "[role=dialog]",
        layerAssert: {
            label: "dialog: Cryptic Command",
            locator: { role: "dialog", name: "Cryptic Command" },
            check: "visible",
        },
        // NOT its `Confirm` plate: the census page renders Panel and Button
        // specimens of that exact name.
        entry: {
            label: "picker contrast",
            locator: { role: "dialog", name: "Cryptic Command" },
            check: "contrast",
        },
    },
    {
        slug: "phyrexian",
        module: "cards/phyrexian-picker.tsx",
        label: "Phyrexian mana picker",
        layer: ANCHORED,
        layerAssert: {
            label: "picker layer",
            locator: { selector: ANCHORED },
            check: "visible",
        },
        entry: {
            label: "picker contrast",
            locator: { selector: ANCHORED },
            check: "contrast",
        },
    },
    {
        slug: "selectable-card",
        module: "cards/selectable-card.tsx",
        label: "Selectable card",
        layer: "[data-selectable-card-specimen]",
        layerAssert: {
            label: "card specimen",
            locator: { selector: "[data-selectable-card-specimen]" },
            check: "visible",
        },
        entry: {
            label: "printed card face",
            locator: {
                selector:
                    '[data-selectable-card-specimen] [data-card-face="printed"]',
            },
            check: "visible",
        },
    },
];

/** A section of `/admin/design-system` that mounts dialog specimens one at a
 *  time behind openers: the opener seam it declares and how a receipt row
 *  names it. */
interface DialogSpecimenSection {
    /** Surface id prefix: `dlg` (§ 16, § 17) or `pick` (§ 18). */
    idPrefix: string;
    /** The `data-*` attribute each opener carries, valued with the slug. */
    seam: string;
    /** Receipt label prefix and the section's `§ N` on the page. */
    title: string;
    index: string;
}

const BOARD_DIALOGS_SECTION: DialogSpecimenSection = {
    idPrefix: "dlg",
    seam: "data-board-dialog-specimen",
    title: "Board dialog",
    index: "16",
};

const OVERLAYS_SECTION: DialogSpecimenSection = {
    idPrefix: "dlg",
    seam: "data-overlay-specimen",
    title: "Overlay",
    index: "17",
};

const CAST_PICKERS_SECTION: DialogSpecimenSection = {
    idPrefix: "pick",
    seam: "data-cast-picker-specimen",
    title: "Cast picker",
    index: "18",
};

/** One `dlg-*` row: open the specimen page, press its opener, measure the
 *  layer it mounted. The entries are the design-system route's, as every
 *  other row on that page: the section lives inside it. */
function dialogSpecimenSurface(
    section: DialogSpecimenSection,
    spec: DialogSpecimen
): Surface {
    return {
        id: `${section.idPrefix}-${spec.slug}`,
        entries: [
            "src/routes/admin/admin-layout.route.tsx",
            "src/routes/design-system.route.tsx",
        ],
        label: `${section.title} — ${spec.label} (/admin/design-system § ${section.index})`,
        asserts: [spec.layerAssert, spec.entry],
        mounts: [`src/components/${spec.module}`],
        settleTargets: [spec.layer],
        async walk(page, ctx) {
            await goto(page, ctx, "/admin/design-system");
            const opener = page
                .locator(`[${section.seam}="${spec.slug}"]`)
                .first();
            try {
                await opener.waitFor({ state: "visible", timeout: 10_000 });
            } catch {
                throw new Unreachable(
                    `/admin/design-system rendered no \`${section.seam}\` opener for "${spec.slug}"`
                );
            }
            await opener.scrollIntoViewIfNeeded({ timeout: STEP_TIMEOUT });
            await opener.click({ timeout: STEP_TIMEOUT });
            // Park the pointer OFF the layer before measuring. The dialog
            // mounts centred, i.e. under the cursor the click left behind,
            // and a card tile under the pointer opens the hover CARD PREVIEW
            // over the dialog — measured: `dlg-discard-cost` and
            // `dlg-cast-exile-cost` broke `cardsSquare` at 390x844x3 on the
            // preview's art crop, which is a different surface's element and
            // a different surface's row.
            await page.mouse.move(2, 2);
            if (!(await visible(page, spec.layer, STEP_TIMEOUT))) {
                throw new Unreachable(
                    `the "${spec.slug}" specimen opened no \`${spec.layer}\` layer within 8s — an import that renders nothing is not a specimen`
                );
            }
            // An inline specimen mounts below the opener grid, possibly off
            // screen; a fixed overlay is already on it, and this is a no-op.
            await page
                .locator(spec.layer)
                .first()
                .scrollIntoViewIfNeeded({ timeout: STEP_TIMEOUT });
            await settle(page, [spec.layer]);
        },
    };
}

export const SURFACES: readonly Surface[] = [
    {
        id: "auth-sign-in",
        entries: ["src/routes/lobby.route.tsx"],
        label: "Sign in (signed out, /)",
        preAuth: true,
        // The screen every user meets first: the two fields, the submit, and
        // the two ways out of it. Addressed by role+name wherever the control
        // HAS a name a user could read — `input[type=password]` maps to no
        // ARIA role, which is why the password field carries a declared seam
        // instead (`data-auth-password`, `src/components/auth/auth-form.tsx`).
        asserts: [
            {
                label: "email field",
                locator: { role: "textbox", name: "Email" },
                check: "reachable",
            },
            {
                label: "password field",
                locator: { selector: "[data-auth-password]" },
                check: "reachable",
            },
            {
                label: "Sign In submit",
                locator: { role: "button", name: "Sign In" },
                check: "reachable",
            },
            {
                label: "Sign In submit contrast",
                locator: { role: "button", name: "Sign In" },
                check: "contrast",
            },
            {
                label: "sign-up entry",
                locator: { role: "button", name: "No account? Sign up" },
                check: "reachable",
            },
            {
                label: "password-reset entry",
                locator: { role: "button", name: "Forgot password?" },
                check: "reachable",
            },
        ],
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
        entries: ["src/routes/lobby.route.tsx"],
        label: "Password reset, step 1 (signed out, / → Forgot password?)",
        preAuth: true,
        // Step 1 is the whole walked screen (step 2 needs a real OTP — see the
        // walk below): the address field, the submit, and the way back.
        asserts: [
            {
                label: "email field",
                locator: { role: "textbox", name: "Email" },
                check: "reachable",
            },
            {
                label: "Send Code submit",
                locator: { role: "button", name: "Send Code" },
                check: "reachable",
            },
            {
                label: "back to sign in",
                locator: { role: "button", name: "Back to sign in" },
                check: "reachable",
            },
        ],
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
        entries: ["src/routes/lobby.route.tsx"],
        label: "Lobby (/)",
        /**
         * EVERY ENTRY POINT THE LOBBY RUNBOOK NAMES (`docs/guides/ui-runbooks.md`
         * § Start a solo game from cold, § Lobby, deck builder and the Limited
         * list). This is the coverage hole of
         * `docs/findings/2726-ui-gate-lobby-walk-asserts-almost-nothing.md`: the walk
         * below asserts a main region, so a lobby that had lost all four Mode
         * Tiles, the Loadout's plate, both deck shelves, the Limited footer
         * and the profile menu would still have measured green.
         *
         * `reachable`, not `visible`, for the controls, because the lobby is a
         * scrolling page and what matters is that a gesture gets there: the
         * check scrolls the element into view first and then requires its
         * centre inside the viewport, so a control below the fold passes and
         * one pinned under fixed chrome does not.
         */
        asserts: [
            // The four tiles are the ARENA set (`src/lib/lobbyModes.ts`): a
            // Cockatrice lobby offers `Solo table` instead of `Play vs Bot` /
            // `Solo game`. The lane never writes `tolaria:playMode`, so every
            // context opens on the `arena` default — a walk that starts
            // touching the game-mode selector owes this list the other set,
            // and four reds here would be that, not a product regression.
            {
                label: "mode tile: Play vs Bot",
                locator: { selector: '[data-mode-tile="bot"]' },
                check: "reachable",
            },
            {
                label: "mode tile: Solo game",
                locator: { selector: '[data-mode-tile="solo"]' },
                check: "reachable",
            },
            {
                label: "mode tile: Open a table",
                locator: { selector: '[data-mode-tile="table"]' },
                check: "reachable",
            },
            {
                label: "mode tile: Limited",
                locator: { selector: '[data-mode-tile="limited"]' },
                check: "reachable",
            },
            // VISIBLE, not reachable, and that is the promise: the Loadout's
            // single plate is `disabled` until a deck is the active one
            // (`src/lib/lobbyGate.ts`), and this walk selects nothing — so
            // requiring actionability here would assert the opposite of the
            // designed state.
            {
                label: "Loadout primary action",
                locator: { selector: "[data-lobby-primary]" },
                check: "visible",
            },
            // The contrast promise points at an ENABLED control with text:
            // axe's `color-contrast` rule skips a disabled one and everything
            // under it, so the same check on the plate above — disabled in the
            // state this walk measures — is a promise that could never fail.
            {
                label: "Limited re-entry contrast",
                locator: { role: "button", name: "Browse / Create Events" },
                check: "contrast",
            },
            {
                label: "deck shelf: first selectable tile",
                locator: {
                    selector:
                        "[data-deck-tile] [data-deck-select]:not([disabled])",
                },
                check: "reachable",
            },
            {
                label: "Limited re-entry",
                locator: { role: "button", name: "Browse / Create Events" },
                check: "reachable",
            },
            // One element at any viewport, never two: the profile lives in the
            // header band above a portrait phone and in the bottom nav's `Me`
            // popover on one (`app-shell.tsx` renders exactly one of the two
            // bands), and both carry the seam.
            {
                label: "profile menu entry",
                locator: { selector: "[data-profile-entry]" },
                check: "reachable",
            },
        ],
        async walk(page, ctx) {
            await goto(page, ctx, "/");
            if (!(await visible(page, "main, [role=main]", 10_000))) {
                throw new Unreachable("the lobby rendered no main region");
            }
        },
    },
    {
        id: "lobby-vs-ai",
        // The dialog is still open at measurement — the walk ends on it
        // (issue #3420).
        mounts: ["src/components/lobby/vs-ai-setup-dialog.tsx"],
        entries: ["src/routes/lobby.route.tsx"],
        label: "vs-AI setup dialog (/ \u2192 Play vs Bot \u2192 primary)",
        // The dialog's own controls — the selector that makes it the RIGHT
        // dialog, and the two plates that leave it.
        asserts: [
            {
                label: "AI Difficulty selector",
                locator: { role: "radiogroup", name: "AI Difficulty" },
                check: "visible",
            },
            {
                label: "dialog primary: Play vs AI",
                locator: { role: "button", name: "Play vs AI" },
                check: "reachable",
            },
            {
                label: "dialog Cancel",
                locator: { role: "button", name: "Cancel" },
                check: "reachable",
            },
        ],
        async walk(page, ctx) {
            // The difficulty selector lives BEHIND this dialog, so the `lobby`
            // row above — which only asserts a main region on `/` — has never
            // measured it. Issue #2790 added a fourth level (`Expert`) plus a
            // per-level description line to that selector, i.e. a wider
            // segmented control and one more text row at every viewport, which
            // is precisely the shape of change a lobby-only walk cannot see.
            await goto(page, ctx, "/");
            // `bot` is the lobby's DEFAULT mode tile, but the walk selects it
            // explicitly rather than trusting the default: a viewport that
            // reached a board earlier in the same context has already clicked
            // `solo` (`ensureBoard` above), and the tile selection is React
            // state, not storage — pinning it here keeps this row independent
            // of surface order.
            if (!(await clickIfVisible(page, MODE_TILE_BOT, 6000))) {
                throw new Unreachable(
                    "the lobby's Mode Tiles offered no 'Play vs Bot' tile"
                );
            }
            // The primary plate stays disabled until a deck is the Loadout's
            // active one. An already-selected tile is itself `disabled`, so
            // this step is skipped when the selection is already made.
            if (!(await visible(page, DECK_TILE_SELECTED, 2000))) {
                if (!(await clickIfVisible(page, DECK_TILE_SELECT, 6000))) {
                    throw new Unreachable(
                        "the lobby offered no selectable Deck Shelf tile \u2014 is the deployment seeded with preset decks?"
                    );
                }
                await settle(page);
            }
            if (!(await clickIfVisible(page, LOBBY_PRIMARY, 6000))) {
                throw new Unreachable(
                    "the Loadout's primary action stayed disabled after selecting a deck and the 'Play vs Bot' Mode Tile"
                );
            }
            // The dialog is the subject; the difficulty radiogroup is what
            // makes it the RIGHT dialog (`difficulty-selector.tsx` declares the
            // `aria-label` as its walk seam, and the lobby's other dialogs —
            // join-by-code, delete-deck — carry none).
            if (!(await visible(page, "[role=dialog]", STEP_TIMEOUT))) {
                throw new Unreachable(
                    "the 'Play vs Bot' primary action did not open a dialog within 8s"
                );
            }
            if (
                !(await visible(
                    page,
                    '[role=dialog] [role=radiogroup][aria-label="AI Difficulty"]',
                    STEP_TIMEOUT
                ))
            ) {
                throw new Unreachable(
                    "the vs-AI setup dialog opened without its AI Difficulty selector"
                );
            }
            await settle(page);
        },
    },
    {
        id: "deck-builder",
        entries: ["src/routes/deck-builder.route.tsx"],
        label: "Constructed deck builder (/decks/create)",
        /**
         * EVERY ENTRY POINT THE BUILDER'S RUNBOOK NAMES (`docs/guides/ui-runbooks.md`
         * § Lobby, deck builder and the Limited list): the way cards get IN
         * (Import), the two zones they land in, the source they are dragged
         * from, and the save surface — the name field and Done.
         *
         * A PROMISE HOLDS AT ALL FIVE VIEWPORTS OR IT IS NOT ONE. That is the
         * constraint shaping every list below, because an assertion carries no
         * viewport condition: it is evaluated at each of the five and any cell
         * can red the run. The builder's save surface is two different
         * components — `SaveDeckBar` off a phone, `DeckBottomBar` in portrait
         * (`deck-builder-shell.tsx` swaps them, it does not stack them) — so
         * the promises here name what BOTH render: a "Deck name" field and a
         * Done plate. Issue #3650 gave `SaveDeckBar`'s field the explicit
         * `aria-label` its portrait twin already had, so the two are addressed
         * by one rule rather than by an accname fallback on one side.
         *
         * The `contrast` promise points at Done: enabled, with text, in the
         * state this walk measures — axe's `color-contrast` rule skips a
         * disabled control, and a promise that cannot fail is the thing this
         * mechanism exists to replace.
         */
        asserts: [
            {
                label: "Import entry point",
                locator: { role: "button", name: "Import" },
                check: "reachable",
            },
            {
                label: "deck name field",
                locator: { role: "textbox", name: "Deck name" },
                check: "reachable",
            },
            {
                label: "primary action: Done",
                locator: { role: "button", name: "Done" },
                check: "reachable",
            },
            {
                label: "Maindeck pane",
                locator: { selector: '[data-deck-pane="maindeck"]' },
                check: "visible",
            },
            {
                label: "Sideboard pane",
                locator: { selector: '[data-deck-pane="sideboard"]' },
                check: "visible",
            },
            // The constructed builder's third pane — the card search results
            // the other two are filled FROM. The Limited builder has no source
            // panel (its cards come from a dealt Pool), which is why its own
            // list below promises only two panes.
            {
                label: "Card source pane",
                locator: { selector: '[data-deck-pane="source"]' },
                check: "visible",
            },
            {
                label: "Done contrast",
                locator: { role: "button", name: "Done" },
                check: "contrast",
            },
        ],
        async walk(page, ctx) {
            await goto(page, ctx, "/decks/create");
            if (!(await visible(page, "input, button", 10_000))) {
                throw new Unreachable("the deck builder rendered no controls");
            }
            // Issue #2671: this walk used to leave both zones empty, which hid
            // a regression class from the probe entirely — `starved` can only
            // fire once a real card TILE exists to compare a shrunk port
            // against (`scripts/ui-gate/probe.js`), and an empty zone has no
            // tile. Importing a tiny decklist seeds both zones without a drag
            // simulation (the same `Import` entry point a player uses).
            const DIALOG_TEXTAREA = '[role="dialog"] textarea';
            const DIALOG_PREVIEW =
                "[role=\"dialog\"] button:has-text('Preview')";
            const DIALOG_CONFIRM = "[role=\"dialog\"] button:has-text('Add ')";
            if (
                !(await clickIfVisible(page, "button:has-text('Import')", 6000))
            ) {
                throw new Unreachable(
                    "the deck builder offered no Import button"
                );
            }
            if (!(await visible(page, DIALOG_TEXTAREA, STEP_TIMEOUT))) {
                throw new Unreachable(
                    "the Import decklist dialog did not open"
                );
            }
            // Every card in this builder renders as a member of an OVERLAID
            // Column pile (ADR 0075, `deck-column-pile.tsx`), stacked
            // whenever 2+ cards share a grouping bucket — by design, not a
            // defect, and orthogonal to this issue. A decklist with any
            // duplicate name or two cards of the same mana value would stack
            // a pile and paint the probe's centre-point occlusion check on
            // ITS OWN buried tiles, noise this fixture has no reason to
            // carry. Every line below is both a UNIQUE name and its own
            // distinct mana value (one basic land total, so the "Lands" pile
            // never gets a second member either) — no two cards this walk
            // adds can ever land in the same pile.
            await page
                .locator(DIALOG_TEXTAREA)
                .fill(
                    "Deck\n1 Forest\n1 Llanowar Elves\n1 Grizzly Bears\n\nSideboard\n1 Shivan Dragon\n1 Circle of Protection: Red"
                );
            if (!(await clickIfVisible(page, DIALOG_PREVIEW, STEP_TIMEOUT))) {
                throw new Unreachable(
                    "the Import dialog's Preview button never enabled"
                );
            }
            if (!(await visible(page, DIALOG_CONFIRM, STEP_TIMEOUT))) {
                throw new Unreachable(
                    "the pasted decklist resolved no cards to import"
                );
            }
            await page.locator(DIALOG_CONFIRM).first().click({
                timeout: STEP_TIMEOUT,
            });
            await settle(page);
            // Issue #2671 review round 2 MUST-FIX: this capture used to sit
            // AFTER the "2/15" assertion below, so the one remaining throw
            // site in this walk (the sideboard check) left
            // `ctx.lastCreatedDeckName` unset — the one thing `cleanup()`
            // needs to find and delete the row — and `index.ts`'s cleanup
            // call (now always invoked, happy path or not — see the
            // `measure()` fix) had nothing to act on. The name is unrelated
            // to whether the import verifies: it is `nextDeckName()`'s
            // sequential "Deck N", computed client-side from the deck list at
            // MOUNT (`deck-builder.tsx:268`, `src/lib/userDecks.ts`), before
            // this walk ever opens the Import dialog — reading it here, right
            // after the confirm click, is no less accurate than reading it
            // after the sideboard check, and it moves the capture ahead of
            // every throw site that follows the import.
            //
            // The import above just tripped `useDeckWorkspace`'s autosave
            // (`useDeckWorkspace.ts`), which means a real `userDecks` row now
            // exists (or will, once `cleanup()` navigates away and the
            // flush-on-unmount fires).
            ctx.lastCreatedDeckName = await page
                .locator('input[placeholder="Deck name"]')
                .first()
                .inputValue()
                .catch(() => undefined);
            // "2/15" is this walk's own fixed decklist (Shivan Dragon +
            // Circle of Protection: Red) — a specific count, not just any
            // digit, so this fails loudly if the import silently dropped a
            // card instead of leaving the Sideboard genuinely empty.
            if (!(await visible(page, "text=/2\\/15/", STEP_TIMEOUT))) {
                throw new Unreachable(
                    "the Sideboard still reads empty after importing — the fixture card names may no longer resolve"
                );
            }
        },
        async cleanup(page, ctx) {
            const name = ctx.lastCreatedDeckName;
            if (!name) return;
            ctx.lastCreatedDeckName = undefined;
            // Navigating away unmounts the builder, which is what flushes a
            // still-pending autosave (`useDeckWorkspace`'s flush-on-unmount)
            // — the same mechanism that created the row, now guaranteed to
            // have run before the delete below looks for it.
            await goto(page, ctx, "/");
            const menuSelector = `button[aria-label="More actions for ${name}"]`;
            if (!(await visible(page, menuSelector, STEP_TIMEOUT))) {
                // Nothing to clean up — the row never landed (e.g. the
                // autosave lost a race with something else entirely).
                return;
            }
            await page.locator(menuSelector).first().click();
            const deleteItem = '[role="menuitem"]:has-text("Delete")';
            if (!(await clickIfVisible(page, deleteItem, STEP_TIMEOUT))) return;
            const confirmDelete = '[role="dialog"] button:has-text("Delete")';
            if (!(await clickIfVisible(page, confirmDelete, STEP_TIMEOUT))) {
                return;
            }
            await settle(page);
        },
    },
    {
        id: "deck-detail",
        entries: ["src/routes/deck-detail.route.tsx"],
        label: "Deck detail (/decks/mono-red-burn)",
        /**
         * The page's two exits: back to the lobby, and the primary plate that
         * makes this deck the active one (issue #2591's Edit/Play row).
         *
         * The plate is addressed by a SEAM, not by its name, and `visible`
         * rather than `reachable`, because it is the same control in two
         * states: it reads "Play" and is enabled until this deck is the
         * lobby's active one, then reads "Selected" and is `disabled`. Which
         * state this walk finds depends on what an EARLIER surface in the same
         * context selected (`selectPlayableDeck` takes the first selectable
         * tile), so a role+name promise would name an element that exists only
         * half the time and an actionability check would assert the opposite
         * of a legitimate state. `data-deck-detail-play` holds across both.
         *
         * Edit and Delete are deliberately NOT promised: both are `undefined`
         * for a preset viewed by a non-admin (`deck-detail.route.tsx`), and
         * the lane's account is one.
         */
        asserts: [
            {
                label: "back to lobby",
                locator: { role: "button", name: "← Back" },
                check: "reachable",
            },
            {
                label: "primary action: Play",
                locator: { selector: "[data-deck-detail-play]" },
                check: "visible",
            },
            {
                label: "back control contrast",
                locator: { role: "button", name: "← Back" },
                check: "contrast",
            },
        ],
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
        entries: [
            "src/routes/admin/admin-layout.route.tsx",
            "src/routes/design-system.route.tsx",
        ],
        label: "Design system census (/admin/design-system)",
        // The census's own heading (the 404 page also renders a `main`, see
        // the walk) and the specimen openers `design-system-dialog` walks
        // through — the page's one interactive entry point.
        asserts: [
            {
                label: "census heading",
                locator: { role: "heading", name: "Design system census" },
                check: "visible",
            },
            {
                label: "specimen opener: Open live demo",
                locator: { role: "button", name: "Open live demo" },
                check: "reachable",
            },
        ],
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
        entries: [
            "src/routes/admin/admin-layout.route.tsx",
            "src/routes/design-system.route.tsx",
        ],
        label: "GameDialog live demo (/admin/design-system → Open live demo)",
        // The canonical modal language's own anatomy: the named dialog, the
        // footer's primary plate (and its contrast — the one CTA every
        // in-game dialog copies), and the close control.
        asserts: [
            {
                label: "dialog: GameDialog",
                locator: { role: "dialog", name: "GameDialog" },
                check: "visible",
            },
            {
                label: "footer primary: Done",
                locator: { role: "button", name: "Done" },
                check: "reachable",
            },
            {
                label: "footer primary contrast",
                locator: { role: "button", name: "Done" },
                check: "contrast",
            },
            {
                label: "dialog close control",
                locator: { selector: "[data-game-dialog-close]" },
                check: "reachable",
            },
        ],
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
            await settle(page);
        },
    },
    ...BOARD_DIALOG_SPECIMENS.map((spec) =>
        dialogSpecimenSurface(BOARD_DIALOGS_SECTION, spec)
    ),
    ...OVERLAY_SPECIMENS.map((spec) =>
        dialogSpecimenSurface(OVERLAYS_SECTION, spec)
    ),
    ...CAST_PICKER_SPECIMENS.map((spec) =>
        dialogSpecimenSurface(CAST_PICKERS_SECTION, spec)
    ),
    {
        id: "admin-card-profiles",
        entries: [
            "src/routes/admin/admin-layout.route.tsx",
            "src/routes/admin/admin-card-profiles.route.tsx",
        ],
        label: "Card Profile review pass (/admin/card-profiles \u2192 Vintage Cube \u2192 first row)",
        // The review pass's primary controls: the scope it runs over, how far
        // it has got, the list filter, and the expanded row's two write
        // actions — `Mark reviewed & next` is the gesture the whole pass is
        // hundreds of repetitions of.
        asserts: [
            {
                label: "Profile Scope picker",
                locator: { role: "radiogroup", name: "Profile Scope" },
                check: "visible",
            },
            {
                label: "review progress",
                locator: {
                    role: "progressbar",
                    name: "Card Profiles reviewed",
                },
                check: "visible",
            },
            {
                label: "card search",
                locator: { role: "textbox", name: "Search cards" },
                check: "reachable",
            },
            {
                label: "editor primary: Mark reviewed & next",
                locator: { role: "button", name: "Mark reviewed & next" },
                check: "reachable",
            },
            {
                label: "editor primary contrast",
                locator: { role: "button", name: "Mark reviewed & next" },
                check: "contrast",
            },
            {
                label: "editor Save",
                locator: { role: "button", name: "Save" },
                check: "reachable",
            },
        ],
        async walk(page, ctx) {
            // The human review pass over the LLM-seeded Card Profile census
            // (issue #3597). Walked because NO other surface mounts these
            // components: a regression in the editor's layout is invisible to
            // every other row in this file, and the pass it exists for is
            // hundreds of rows long — a clipped picker or an art slot with no
            // height is exactly the defect this lane was built to catch.
            //
            // Deterministic despite being an admin page over live data: the
            // scope is chosen EXPLICITLY rather than defaulted (the default is
            // whichever Booster Config sorts first, which is a function of
            // what is checked in), and the Vintage Cube is code-guaranteed to
            // be offered — `listDraftableSets` appends it unconditionally,
            // never subject to the per-sheet Draftability gate
            // (`convex/limited/registry.ts`). Its rows come from the
            // checked-in census, not from this deployment's database.
            await goto(page, ctx, "/admin/card-profiles");
            if (
                !(await visible(page, "h1:has-text('Card Profiles')", 10_000))
            ) {
                throw new Unreachable(
                    "/admin/card-profiles did not render the page heading — is this account still an admin?"
                );
            }
            const cube = page
                .getByRole("radiogroup", { name: "Profile Scope" })
                .getByRole("radio", { name: "Vintage Cube" });
            try {
                await cube.waitFor({ state: "visible", timeout: STEP_TIMEOUT });
            } catch {
                throw new Unreachable(
                    "the Profile Scope picker offered no `Vintage Cube` scope"
                );
            }
            await cube.click({ timeout: STEP_TIMEOUT });
            if (
                !(await visible(
                    page,
                    "[role=progressbar][aria-label='Card Profiles reviewed']",
                    STEP_TIMEOUT
                ))
            ) {
                throw new Unreachable(
                    "the Vintage Cube scope rendered no review-progress bar"
                );
            }
            // The COLLAPSED list is half the surface; the other half is one
            // expanded row — the card's rules text plus three
            // closed-vocabulary pickers, which is where this editor's height
            // and its wrapping actually live.
            const edit = page.getByRole("button", { name: "Edit" }).first();
            try {
                await edit.waitFor({ state: "visible", timeout: STEP_TIMEOUT });
            } catch {
                throw new Unreachable(
                    "the Vintage Cube scope listed no editable Card Profile rows"
                );
            }
            await edit.scrollIntoViewIfNeeded({ timeout: STEP_TIMEOUT });
            await edit.click({ timeout: STEP_TIMEOUT });
            if (!(await visible(page, "[role=group]", STEP_TIMEOUT))) {
                throw new Unreachable(
                    "`Edit` did not expand a Card Profile editing panel within 8s"
                );
            }
            await settle(page);
        },
    },
    {
        id: "admin-verdicts",
        entries: [
            "src/routes/admin/admin-layout.route.tsx",
            "src/routes/admin/admin-verdicts.route.tsx",
        ],
        label: "Verdict review (/admin/verdicts → the lane's contested position)",
        // The open position's anatomy: the rebuilt board, the resolution form
        // and one of its answers, and the way back to the list. `Record
        // resolution` is VISIBLE, not reachable — it is disabled until an
        // answer is picked, and the walk never picks one (a resolution row
        // would outlive the account).
        asserts: [
            {
                label: "position board",
                locator: {
                    selector:
                        "[data-testid=verdict-position-detail] [data-testid=scenario-board]",
                },
                check: "visible",
            },
            {
                label: "resolution form",
                locator: { role: "form", name: "Resolve this position" },
                check: "visible",
            },
            {
                label: "answer: None of them is right",
                locator: { role: "radio", name: "None of them is right" },
                check: "reachable",
            },
            {
                label: "Record resolution",
                locator: { role: "button", name: "Record resolution" },
                check: "visible",
            },
            {
                label: "back to all positions",
                locator: { role: "button", name: "← All positions" },
                check: "reachable",
            },
        ],
        async walk(page, ctx) {
            // The surface where a contested position is rebuilt and resolved
            // (issue #3582). Walked OPEN, because the list alone is the small
            // half: the detail carries the board with the deciding seat's
            // hand, the candidate list and the answers side by side, which is
            // where this page's width and wrapping live.
            //
            // Deterministic over live data: the lane seeds its OWN contested
            // position at bootstrap (`verdictResolutions:
            // seedUiGateContestedPosition`) — two fat outbox rows a local
            // backend never drains — and the walk opens the row naming that
            // fixture's answer, not whichever position sorts first. The walk
            // never resolves it: a resolution row would outlive the account.
            await goto(page, ctx, "/admin/verdicts");
            if (
                !(await visible(page, "h1:has-text('Verdict Review')", 10_000))
            ) {
                throw new Unreachable(
                    "/admin/verdicts did not render the page heading — is this account still an admin?"
                );
            }
            const row = page
                .getByTestId("verdict-position-row")
                .filter({
                    hasText: "Cast Lightning Bolt targeting Grizzly Bears",
                })
                .first();
            try {
                await row.waitFor({ state: "visible", timeout: STEP_TIMEOUT });
            } catch {
                throw new Unreachable(
                    "the review listed no position carrying the lane's seeded answers — did `verdictResolutions:seedUiGateContestedPosition` run?"
                );
            }
            await row.click({ timeout: STEP_TIMEOUT });
            if (
                !(await visible(
                    page,
                    "[data-testid=verdict-position-detail] [data-testid=scenario-board]",
                    STEP_TIMEOUT
                ))
            ) {
                throw new Unreachable(
                    "opening the contested position rendered no board"
                );
            }
            // The resolution form mounts only while the position is
            // UNRESOLVED, and resolutions are read from the shared Verdict
            // Store — not from this account's rows — so a resolution anyone
            // ever recorded on the fixture's fixed position hides the form
            // from every later run (measured 2026-09-25: every full lane run
            // that day failed the three form promises, issue #4423). `Resolve
            // again` opens the same form over a resolved position and records
            // nothing, so pressing it measures the same screen either way.
            const resolveAgain = page
                .getByTestId("verdict-position-detail")
                .getByRole("button", { name: "Resolve again" });
            if (await resolveAgain.isVisible()) {
                await resolveAgain.click({ timeout: STEP_TIMEOUT });
            }
            await settle(page);
        },
    },
    /*
     * The rest of the `/admin` section, plus `/settings` (issue #4418, a slice
     * of the coverage census's debt, issue #4402). Eight route modules the
     * census counted as SCREENS and the lane photographed at no viewport: the
     * gate walked three admin pages out of nine (`design-system`,
     * `admin-card-profiles`, `admin-verdicts`) and every other one was
     * measured by nothing.
     *
     * They share one walk shape — navigate, check the screen's own heading,
     * settle — because each is a page reached by URL with no click sequence in
     * front of it. What differs is the heading each one throws `Unreachable`
     * on, and that heading is deliberately the PAGE's (`h1`), never `main`:
     * `/admin/*` renders inside `AdminLayoutRoute`, whose gate answers a
     * non-admin with the 404 screen — which also renders a `main`, the exact
     * fail-open the `design-system` walk records next door.
     */
    {
        id: "admin-index",
        entries: [
            "src/routes/admin/admin-layout.route.tsx",
            "src/routes/admin/admin-index.route.tsx",
        ],
        label: "Admin index (/admin)",
        // The index is a list of doors and nothing else, so its promises are
        // the doors — addressed by the route each card leads to, because the
        // card's accessible name is its title AND its one-line description.
        asserts: [
            {
                label: "page heading",
                locator: { role: "heading", name: "Admin" },
                check: "visible",
            },
            {
                label: "nav card: Scenarios",
                locator: { selector: '[data-admin-nav="/admin/scenarios"]' },
                check: "reachable",
            },
            {
                label: "nav card: Verdict Review",
                locator: { selector: '[data-admin-nav="/admin/verdicts"]' },
                check: "reachable",
            },
        ],
        async walk(page, ctx) {
            await goto(page, ctx, "/admin");
            if (!(await visible(page, "h1:has-text('Admin')", 10_000))) {
                throw new Unreachable(
                    "/admin did not render the section heading — is this account still an admin?"
                );
            }
        },
    },
    {
        id: "admin-scenarios",
        entries: [
            "src/routes/admin/admin-layout.route.tsx",
            "src/routes/admin/admin-scenarios.route.tsx",
        ],
        label: "Scenario library (/admin/scenarios)",
        // The library's four entry points: the page, the list panel, the
        // filter the list is read through, and the control that opens the
        // editor. `Clean up ephemeral` is deliberately NOT promised — it is
        // disabled on a deployment with no scenarios, so it would be a
        // promise about the fixture rather than about the screen.
        asserts: [
            {
                label: "page heading",
                locator: { role: "heading", name: "Scenarios" },
                check: "visible",
            },
            {
                label: "library panel",
                locator: { role: "heading", name: "Saved scenarios" },
                check: "visible",
            },
            {
                label: "scenario search",
                locator: { role: "textbox", name: "Search scenarios…" },
                check: "reachable",
            },
            {
                label: "New scenario",
                locator: { role: "button", name: "New scenario" },
                check: "reachable",
            },
        ],
        async walk(page, ctx) {
            await goto(page, ctx, "/admin/scenarios");
            if (!(await visible(page, "h1:has-text('Scenarios')", 10_000))) {
                throw new Unreachable(
                    "/admin/scenarios did not render the page heading — is this account still an admin?"
                );
            }
        },
    },
    {
        id: "admin-banlists",
        entries: [
            "src/routes/admin/admin-layout.route.tsx",
            "src/routes/admin/admin-banlists.route.tsx",
        ],
        label: "Banlist sync (/admin/banlists)",
        // The sync page's own controls. `View cards` is promised `visible`
        // rather than `reachable` because it is DISABLED until its format's
        // counts have answered — the settle predicate's socket-wide in-flight
        // count makes that unlikely by the time assertions run, and `visible`
        // is the check that holds either way.
        //
        // Both buttons render once per banlist Format with identical labels,
        // so `.first()` addresses the Premodern row. They are one component
        // under different props — a layout defect in one is a defect in both —
        // which is why this stays a name rather than a per-row seam (review of
        // PR #4425).
        asserts: [
            {
                label: "page heading",
                locator: { role: "heading", name: "Banlists" },
                check: "visible",
            },
            {
                label: "sync panel",
                locator: { role: "heading", name: "Banlist Sync" },
                check: "visible",
            },
            {
                label: "Sync from Scryfall",
                locator: { role: "button", name: "Sync from Scryfall" },
                check: "reachable",
            },
            {
                label: "View cards",
                locator: { role: "button", name: "View cards" },
                check: "visible",
            },
        ],
        async walk(page, ctx) {
            await goto(page, ctx, "/admin/banlists");
            if (!(await visible(page, "h1:has-text('Banlists')", 10_000))) {
                throw new Unreachable(
                    "/admin/banlists did not render the page heading — is this account still an admin?"
                );
            }
        },
    },
    {
        id: "admin-pick-ratings",
        entries: [
            "src/routes/admin/admin-layout.route.tsx",
            "src/routes/admin/admin-pick-ratings.route.tsx",
        ],
        label: "Pick Ratings editor (/admin/pick-ratings)",
        // The editor is a scope picker over a searchable card list, and both
        // halves are promised: the scope decides WHICH ratings are on screen,
        // the search is how a rater finds the card they came for.
        //
        // `Pick Ratings` names TWO headings — the frame's `h1` and the panel's
        // own `h2`, which said the page's name twice before this surface
        // existed — so `.first()` decides between them by DOM order. It takes
        // the frame's, and `walk()` below throws `Unreachable` on that same
        // `h1` independently, so the promise cannot be met by the panel alone
        // (review of PR #4425).
        asserts: [
            {
                label: "page heading",
                locator: { role: "heading", name: "Pick Ratings" },
                check: "visible",
            },
            {
                label: "Rating Scope picker",
                locator: { role: "radiogroup", name: "Rating Scope" },
                check: "visible",
            },
            {
                label: "card search",
                locator: { role: "textbox", name: "Search cards" },
                check: "reachable",
            },
        ],
        async walk(page, ctx) {
            await goto(page, ctx, "/admin/pick-ratings");
            if (!(await visible(page, "h1:has-text('Pick Ratings')", 10_000))) {
                throw new Unreachable(
                    "/admin/pick-ratings did not render the page heading — is this account still an admin?"
                );
            }
        },
    },
    {
        id: "admin-testers",
        entries: [
            "src/routes/admin/admin-layout.route.tsx",
            "src/routes/admin/admin-testers.route.tsx",
        ],
        label: "Tester roles (/admin/testers)",
        // The account list is promised by SEAM, not by its button: the row's
        // control reads `Grant tester` or `Revoke tester` depending on the
        // flag the lane's own account happens to carry, so naming either would
        // be a promise about the deployment. The lane is signed in, so at
        // least one row always exists.
        asserts: [
            {
                label: "page heading",
                locator: { role: "heading", name: "Testers" },
                check: "visible",
            },
            {
                label: "accounts panel",
                locator: { role: "heading", name: "Accounts" },
                check: "visible",
            },
            {
                label: "account row",
                locator: { selector: "[data-tester-row]" },
                check: "visible",
            },
        ],
        async walk(page, ctx) {
            await goto(page, ctx, "/admin/testers");
            if (!(await visible(page, "h1:has-text('Testers')", 10_000))) {
                throw new Unreachable(
                    "/admin/testers did not render the page heading — is this account still an admin?"
                );
            }
        },
    },
    {
        id: "admin-bug-reports",
        entries: [
            "src/routes/admin/admin-layout.route.tsx",
            "src/routes/admin/admin-bug-reports.route.tsx",
        ],
        label: "Bug report evidence (/admin/bug-reports)",
        // Promised WITHOUT a report row: the page is read-only over whatever
        // the deployment has filed, and the lane files none — so the row list
        // is a fixture, while the page, its list panel and the way back out
        // are the screen. The right-hand pane is its empty state until a row
        // is picked, which is the state this surface measures.
        asserts: [
            {
                label: "page heading",
                locator: { role: "heading", name: "Bug Reports" },
                check: "visible",
            },
            {
                label: "reports panel",
                locator: { role: "heading", name: "Reports" },
                check: "visible",
            },
            {
                label: "back to the admin index",
                locator: { role: "link", name: "← Admin" },
                check: "reachable",
            },
        ],
        async walk(page, ctx) {
            await goto(page, ctx, "/admin/bug-reports");
            if (!(await visible(page, "h1:has-text('Bug Reports')", 10_000))) {
                throw new Unreachable(
                    "/admin/bug-reports did not render the page heading — is this account still an admin?"
                );
            }
        },
    },
    {
        id: "draft-lab",
        entries: [
            "src/routes/admin/admin-layout.route.tsx",
            "src/routes/draft-lab.route.tsx",
        ],
        label: "Draft Lab (/admin/draft-lab)",
        // The workbench BEFORE a draft is started: the two mode tabs, the pack
        // source, and the control that would start one. The walk deliberately
        // does not start a draft — an 8-seat bot draft runs in the browser and
        // would put a moving screen under the probe, and the layout this
        // surface exists to measure is the controls bar's, which is on screen
        // either way.
        asserts: [
            {
                label: "page heading",
                locator: { role: "heading", name: "Draft Lab" },
                check: "visible",
            },
            {
                label: "mode tab: Synthetic",
                locator: { role: "button", name: "Synthetic" },
                check: "reachable",
            },
            {
                label: "Pack source",
                locator: { role: "combobox", name: "Pack source" },
                check: "reachable",
            },
            {
                label: "Start draft",
                locator: { role: "button", name: "Start draft" },
                check: "reachable",
            },
        ],
        async walk(page, ctx) {
            await goto(page, ctx, "/admin/draft-lab");
            if (!(await visible(page, "h1:has-text('Draft Lab')", 10_000))) {
                throw new Unreachable(
                    "/admin/draft-lab did not render the page heading — is this account still an admin?"
                );
            }
        },
    },
    {
        id: "settings",
        entries: ["src/routes/settings.route.tsx"],
        label: "Settings (/settings)",
        // The one general-user screen in this group, and the only one under
        // no admin gate. Its sections are `<fieldset>`/`<legend>` groups whose
        // legend is `sr-only` (the Panel title already says it), so each is
        // promised by its GROUP rather than by an option: an option's
        // accessible name is its label AND its description line.
        asserts: [
            {
                label: "page heading",
                locator: { role: "heading", name: "Settings" },
                check: "visible",
            },
            {
                label: "Density group",
                locator: { role: "group", name: "Density" },
                check: "visible",
            },
            {
                label: "Card preview default group",
                locator: { role: "group", name: "Card preview default" },
                check: "visible",
            },
            {
                label: "Reset to defaults",
                locator: { role: "button", name: "Reset to defaults" },
                check: "reachable",
            },
        ],
        async walk(page, ctx) {
            await goto(page, ctx, "/settings");
            if (!(await visible(page, "h1:has-text('Settings')", 10_000))) {
                throw new Unreachable("/settings did not render its heading");
            }
        },
    },
    {
        id: "limited-list",
        entries: ["src/routes/limited-events.route.tsx"],
        // Issue #2822: the list is walked FILTERED to the seeded fixture
        // (`?label=ui-gate/`). Unfiltered, this row measured however many
        // events the deployment happened to hold — 14 at the time, each one
        // adding interactive controls to the `small` count and pushing
        // `<main>` past the starvation threshold — so the ceiling moved
        // without a line of `src/` changing.
        label: "Limited events list (/limited, fixture-filtered)",
        /**
         * The list's own controls plus the fixture row and the action that
         * ENTERS it — the runbook's `/limited` line (status chips, the Mine
         * toggle, `+ Create Event`) and the row's `View`, which every Limited
         * and draft walk below reaches its subject through.
         *
         * `+ Create Event` is promised because `canCreateLimitedEvents` keys
         * on "signed in", not on admin (`src/lib/limitedGating.ts`) — the
         * lane's throwaway account sees it, and a regression that put hosting
         * back behind an admin gate is exactly what this line catches.
         */
        asserts: [
            {
                label: "status filter",
                locator: { role: "group", name: "Filter by status" },
                check: "visible",
            },
            {
                label: "Mine toggle",
                locator: { role: "button", name: "Mine" },
                check: "reachable",
            },
            {
                label: "create event",
                locator: { role: "button", name: "+ Create Event" },
                check: "reachable",
            },
            {
                label: "fixture event row",
                locator: { selector: "[data-limited-event-label]" },
                check: "visible",
            },
            {
                label: "event row: View",
                locator: { role: "button", name: "View" },
                check: "reachable",
            },
            {
                label: "event row View contrast",
                locator: { role: "button", name: "View" },
                check: "contrast",
            },
        ],
        async walk(page, ctx) {
            await reachFixtureList(page, ctx);
        },
    },
    {
        // Issue #4422 — the create-event form, the largest Limited overlay
        // and the first one a would-be host meets. The walk OPENS it and
        // measures it; it never presses `Create Event`, so the lane creates
        // no event it would then have to clean up (the NON-DESTRUCTIVE rule
        // every Limited walk here keeps: the only events the lane touches
        // are the fixtures it seeded, and they go away with its account).
        id: "limited-create-event",
        mounts: ["src/components/limited/create-limited-event-dialog.tsx"],
        entries: ["src/routes/limited-events.route.tsx"],
        label: "Create Limited Event dialog (/limited \u2192 + Create Event)",
        /**
         * The dialog's own name, the Event Type selector that makes it the
         * RIGHT dialog, and its two footer plates. `Create Event` is promised
         * `visible`, not `reachable`: it stays disabled until the Draftable
         * Set query answers with a usable selection (`canSubmit`), and a
         * disabled plate fails Playwright's trial click by design — the
         * promise is that the plate is laid out, not that the deployment's
         * set list has loaded by the time the screen settles.
         */
        asserts: [
            {
                label: "dialog: Create Limited Event",
                locator: { role: "dialog", name: "Create Limited Event" },
                check: "visible",
            },
            {
                label: "Event Type selector",
                locator: { role: "radiogroup", name: "Event Type" },
                check: "visible",
            },
            {
                label: "dialog primary: Create Event",
                locator: { role: "button", name: "Create Event" },
                check: "visible",
            },
            {
                label: "dialog Cancel",
                locator: { role: "button", name: "Cancel" },
                check: "reachable",
            },
        ],
        async walk(page, ctx) {
            await reachFixtureList(page, ctx);
            if (!(await clickIfVisible(page, LIMITED_CREATE_EVENT))) {
                throw new Unreachable(
                    "the fixture-filtered /limited list offered no `+ Create Event` button"
                );
            }
            if (
                !(await visible(
                    page,
                    '[role=dialog] [role=radiogroup][aria-label="Event Type"]'
                ))
            ) {
                throw new Unreachable(
                    "`+ Create Event` did not open the create-event dialog (no Event Type selector in a dialog)"
                );
            }
            await settle(page);
        },
    },
    {
        id: "limited-your-events",
        entries: [
            "src/routes/limited-your-events.route.tsx",
            "src/routes/limited-events.route.tsx",
        ],
        // Issue #2590: `/limited/events` is now a REDIRECT stub to
        // `/limited?mine=1` — the your-events page it used to render was
        // absorbed into the merged list. The walk proves the redirect
        // actually lands somewhere real rather than just checking "a main
        // region exists" (which a stuck redirect's own loading screen would
        // also satisfy).
        label: "Your Limited events redirect (/limited/events → /limited?mine=1)",
        /**
         * This surface's subject is the REDIRECT, and what proves it landed
         * somewhere real is the list it lands on: a seeded row, its Enter
         * action, and the Mine toggle the `?mine=true` target turns on. A
         * redirect that dropped `?label=` lands on the unbounded list, where
         * the fixture row promise still holds — the walk's own
         * `fixtureRowsRendered` check is what covers that, and these are the
         * screen's entry points, not a second copy of it.
         */
        asserts: [
            {
                label: "fixture event row",
                locator: { selector: "[data-limited-event-label]" },
                check: "visible",
            },
            {
                label: "event row: View",
                locator: { role: "button", name: "View" },
                check: "reachable",
            },
            {
                label: "Mine toggle",
                locator: { role: "button", name: "Mine" },
                check: "reachable",
            },
        ],
        async walk(page, ctx) {
            // The `label` param rides through the redirect (issue #2822, see
            // `limited-your-events.route.tsx`) — a redirect that dropped it
            // would land this surface back on the unbounded list, which is the
            // bug.
            await goto(
                page,
                ctx,
                `/limited/events?label=${ctx.fixtureLabels.prefix}`
            );
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
            if (
                !(await fixtureRowsRendered(page, "[data-limited-event-label]"))
            ) {
                throw new Unreachable(
                    `/limited/events redirected, but no seeded fixture row is on the list — either the redirect dropped ?label= or the fixture is missing. ${FIXTURE_SEED_HINT}`
                );
            }
        },
    },
    {
        id: "limited-antechamber",
        entries: [
            "src/routes/limited-events.route.tsx",
            "src/routes/limited-event-detail.route.tsx",
        ],
        // Issue #2590: the event detail page — now a compact avatar row +
        // actions, with the Table Ring wired in as a dialog rather than
        // rendered inline. Lands specifically on the "event" case
        // `openLimitedEvent` reports — a drafting seat that gets redirected
        // straight to the Draft Room is a DIFFERENT surface (`draft-pick`
        // below), not this one.
        label: "Limited event antechamber (/limited/<id>)",
        /**
         * The runbook's antechamber: the way back, the Table Ring's opener,
         * and the phase actions this event makes actionable.
         *
         * WHICH ACTIONS THOSE ARE IS FIXED BY THE FIXTURE, not guessed. The
         * lane seeds `ui-gate/<runId>/open` with itself as `createdBy` AND as
         * the occupant of seat 0 (`convex/limitedFixtures.ts` — `seatViewer`
         * over an event inserted with `user._id`), and the event's seating is
         * still open. So `limited-event-detail.tsx` resolves `canLeave`,
         * `canClose` and `canStart` all true and `canJoin` false: Leave Seat,
         * Cancel Event and Start Event render, Join Event does not. A fixture
         * that stopped seating the viewer would red these three promises,
         * which is the correct outcome — every walk below assumes that seat.
         */
        asserts: [
            {
                label: "back to Limited Events",
                locator: { role: "button", name: "← Back to Limited Events" },
                check: "reachable",
            },
            {
                label: "Table Ring entry",
                locator: { role: "button", name: "View Table" },
                check: "reachable",
            },
            {
                label: "Leave Seat",
                locator: { role: "button", name: "Leave Seat" },
                check: "reachable",
            },
            {
                label: "Start Event",
                locator: { role: "button", name: "Start Event" },
                check: "reachable",
            },
            {
                label: "Cancel Event",
                locator: { role: "button", name: "Cancel Event" },
                check: "reachable",
            },
            {
                label: "Table Ring entry contrast",
                locator: { role: "button", name: "View Table" },
                check: "contrast",
            },
        ],
        async walk(page, ctx) {
            await reachFixtureAntechamber(page, ctx);
        },
    },
    {
        // Issue #4422 — the Table Ring, opened from the antechamber's
        // `View Table` (issue #2590 moved it off the page into a dialog, so
        // `limited-antechamber` measures its OPENER and never the ring).
        // Read-only: the ring lists seats and offers no action.
        id: "limited-table-ring",
        mounts: ["src/components/limited/limited-table-ring.tsx"],
        entries: [
            "src/routes/limited-events.route.tsx",
            "src/routes/limited-event-detail.route.tsx",
        ],
        label: "Table Ring dialog (/limited/<id> \u2192 View Table)",
        /**
         * The dialog by its title and the viewer's own seat row — the
         * `ui-gate/<runId>/open` fixture seats the lane at seat 0 (see
         * `limited-antechamber`), so a ring that rendered no viewer row
         * has lost the one seat every fixture guarantees.
         */
        asserts: [
            {
                label: "dialog: The Table",
                locator: { role: "dialog", name: "The Table" },
                check: "visible",
            },
            {
                label: "viewer's seat row",
                locator: {
                    selector: '[data-slot=table-ring] [data-is-viewer="true"]',
                },
                check: "visible",
            },
        ],
        async walk(page, ctx) {
            await reachFixtureAntechamber(page, ctx);
            if (!(await clickIfVisible(page, LIMITED_VIEW_TABLE))) {
                throw new Unreachable(
                    "the antechamber offered no `View Table` button"
                );
            }
            if (
                !(await visible(page, "[role=dialog] [data-slot=table-ring]"))
            ) {
                throw new Unreachable(
                    "`View Table` did not open the Table Ring dialog (no `[data-slot=table-ring]` in a dialog)"
                );
            }
            await settle(page);
        },
    },
    {
        // Issue #4422 — the antechamber's inline confirm
        // (`limited-event-detail.tsx`'s two `GameDialog`s: Leave Seat and
        // Cancel/Close Event share one shape, so one of them measures the
        // file). The walk opens `Leave this Seat?` and NEVER confirms it:
        // leaving would unseat the lane from the `open` fixture every later
        // Limited walk assumes it holds.
        id: "limited-leave-seat-confirm",
        mounts: ["src/components/limited/limited-event-detail.tsx"],
        entries: [
            "src/routes/limited-events.route.tsx",
            "src/routes/limited-event-detail.route.tsx",
        ],
        label: "Leave Seat confirm (/limited/<id> \u2192 Leave Seat)",
        /**
         * The confirm by its title and its safe exit. The destructive
         * `Leave Seat` plate is deliberately NOT promised: the antechamber
         * button that opened the dialog carries the same accessible name, so
         * the locator would name two elements — the confirm's layout is what
         * this row measures, and `Cancel` is the only plate unique to it.
         */
        asserts: [
            {
                label: "dialog: Leave this Seat?",
                locator: { role: "dialog", name: "Leave this Seat?" },
                check: "visible",
            },
            {
                label: "dialog Cancel",
                locator: { role: "button", name: "Cancel" },
                check: "reachable",
            },
        ],
        async walk(page, ctx) {
            await reachFixtureAntechamber(page, ctx);
            if (!(await clickIfVisible(page, LIMITED_LEAVE_SEAT))) {
                throw new Unreachable(
                    "the antechamber offered no `Leave Seat` button — the `open` fixture should seat the lane"
                );
            }
            if (
                !(await visible(
                    page,
                    '[role=dialog]:has-text("Leave this Seat?")'
                ))
            ) {
                throw new Unreachable(
                    "`Leave Seat` did not open its confirm dialog"
                );
            }
            await settle(page);
        },
    },
    {
        id: "limited-build",
        entries: [
            "src/routes/limited-events.route.tsx",
            "src/routes/limited-event-detail.route.tsx",
            "src/routes/limited-draft-room.route.tsx",
            "src/routes/limited-deck-builder.route.tsx",
        ],
        // Issue #2822 lifted this out of `unwalked`. It used to need "an
        // event whose seat offers Build Deck", which no event on the
        // deployment had; the mid-draft fixture supplies one — the builder
        // route needs only a dealt, non-empty pool
        // (`pool-deck-builder.tsx`), which is exactly what
        // `ui-gate/draft`'s seat 0 carries.
        label: "Limited pool builder (/limited/<id>/build)",
        /**
         * The same shell as the constructed builder (`DeckBuilderShell`, via
         * `PoolDeckBuilderForm`), so the same save-surface promises hold — and
         * for the same reason they are worded against BOTH bottom bars.
         *
         * Two panes, not three: this builder passes no source panel, because
         * its cards come from the seat's dealt Pool rather than from a search.
         * The second pane is `data-deck-pane="sideboard"` whatever its visible
         * label says (the form titles it "Pool"), which is why the seam is
         * promised and the tab label is not.
         *
         * The card tile is the promise that separates a rendered builder from
         * `PoolDeckBuilder`'s "No Pool has been generated for your seat yet"
         * empty state — the same distinction the walk itself draws, and the
         * failure actually worth catching here.
         */
        asserts: [
            {
                label: "Maindeck pane",
                locator: { selector: '[data-deck-pane="maindeck"]' },
                check: "visible",
            },
            {
                label: "Pool pane",
                locator: { selector: '[data-deck-pane="sideboard"]' },
                check: "visible",
            },
            {
                label: "pool card tile",
                locator: { selector: "[data-card-tile]" },
                check: "visible",
            },
            {
                label: "deck name field",
                locator: { role: "textbox", name: "Deck name" },
                check: "reachable",
            },
            {
                label: "primary action: Done",
                locator: { role: "button", name: "Done" },
                check: "reachable",
            },
            {
                label: "Done contrast",
                locator: { role: "button", name: "Done" },
                check: "contrast",
            },
        ],
        async walk(page, ctx) {
            // Reached by URL rather than by a click: mid-draft there is no
            // Build Deck control on the event page (it appears once the pool
            // is FINAL), and the id comes from the fixture's own row, so this
            // is still label-addressed.
            await openFixtureEvent(page, ctx, ctx.fixtureLabels.draft);
            const eventId = currentEventId(page);
            await goto(page, ctx, `/limited/${eventId}/build`);
            // A CARD TILE, not the "Build Limited Deck" heading: on a short
            // viewport `DeckBuilderHeader` hides the whole Back+title band by
            // design (`short-viewport:hidden`), so a title assertion reports
            // the builder unreachable at 844x390 while it is rendering fine.
            // A tile also distinguishes the real builder from
            // `PoolDeckBuilder`'s "No Pool has been generated for your seat
            // yet" empty state, which is the failure actually worth catching.
            if (!(await visible(page, "[data-card-tile]", 10_000))) {
                throw new Unreachable(
                    `/limited/${eventId}/build rendered no card tile — the fixture seat's pool may be empty. ${FIXTURE_SEED_HINT}`
                );
            }
        },
    },
    {
        // WHY NO DECLARED POSITION (ADR 0132 §4, issue #3652). Every GAME
        // surface loads a `ScenarioSpec` so that nothing on screen depends on
        // a deal. The three draft surfaces cannot, and the reason is what a
        // spec IS: a description of a game — zones, phase, turn holder,
        // priority, a stack (`convex/debugScenarioSpec.ts`). A Limited event
        // has none of those; its subject is a pack, a pool and a seat in a
        // `limitedEvents` row, and no loader exists — or should — to push a
        // GameState into one.
        //
        // What plays the declared position's part here is the run's own seeded
        // FIXTURE (`limitedFixtures:seedUiGateFixtures`, issues #2822/#3626):
        // a 15-card pack and a 24-card pool pinned BY NAME, under this run's
        // labels, so the subject is as fixed as a board surface's and no other
        // session's events can reach it. The one thing a fixture cannot pin is
        // a pack mid-ANIMATION, and that is the settle predicate's job (issue
        // #3644): the probe measures only once no measured box has moved for a
        // quiet window.
        id: "draft-pick",
        settleTargets: [DRAFT_PICK_TILE],
        entries: [
            "src/routes/limited-events.route.tsx",
            "src/routes/limited-event-detail.route.tsx",
            "src/routes/limited-draft-room.route.tsx",
        ],
        label: "Draft Room (/limited/<id>/draft)",
        /**
         * The room's own chrome — it is the ONLY chrome, since the route is
         * registered `ownChrome` — plus the pick affordance itself.
         *
         * THE PICK ACTION IS THE TILE, not a CTA. The runbook names
         * `[data-editing-action="Pick"]`, and that control exists on the two
         * PHONE viewports only: issue #2861 retired the desktop Peek rail, so
         * the tablet/desktop bucket reaches the same `handlePick` through a
         * card menu that opens on click. A promise pointed at either half
         * would red three cells or two by construction. The tile is the one
         * element that means "pick" at all five viewports, and issue #3650
         * gave it `data-draft-pick-tile` rather than leaning on its accessible
         * name — which carries the fixture's card name plus a "(selected)"
         * suffix that `pinDraftSelection` itself toggles.
         *
         * Table and Pool are seams for a different reason (see
         * `limited-draft-bar.tsx`): both render `uppercase`, and their
         * accessible name would then depend on whether the engine folds
         * `text-transform` into name-from-content. `More` keeps a role+name
         * promise because its `aria-label` is authoritative either way.
         *
         * The `contrast` promise points at the pack counter: the bar's own
         * text, always present while a pack is in front of the seat, and —
         * unlike every control beside it — not `uppercase`.
         */
        asserts: [
            {
                label: "room bar",
                locator: { selector: "[data-slot=draft-room-bar]" },
                check: "visible",
            },
            {
                label: "pack tile: the pick affordance",
                locator: { selector: "[data-draft-pick-tile]" },
                check: "reachable",
            },
            {
                label: "Table Ring entry",
                locator: { selector: "[data-draft-table-entry]" },
                check: "reachable",
            },
            {
                label: "Pool toggle",
                locator: { selector: "[data-draft-pool-toggle]" },
                check: "reachable",
            },
            {
                label: "overflow menu",
                locator: { role: "button", name: "More" },
                check: "reachable",
            },
            {
                label: "pack counter contrast",
                locator: { selector: "[data-slot=pack-counter]" },
                check: "contrast",
            },
        ],
        async walk(page, ctx) {
            await reachDraftRoom(page, ctx);
            // AC 1/2 of issue #2588 ("exactly two scroll positions are
            // reachable") is a LAYOUT claim, and happy-dom cannot make it.
            // This is the only place it is asserted against a real scroller.
            await assertTwoSnapStops(page);
        },
    },
    {
        // Fixture, not a declared position — see `draft-pick` above for why a
        // `ScenarioSpec` cannot describe a draft (ADR 0132 §4, issue #3652).
        id: "draft-pool-stop",
        settleTargets: [DRAFT_SNAP_SCROLLER, DRAFT_POOL],
        entries: [
            "src/routes/limited-events.route.tsx",
            "src/routes/limited-event-detail.route.tsx",
            "src/routes/limited-draft-room.route.tsx",
        ],
        label: "Draft Room, pool stop (/limited/<id>/draft, swiped)",
        /**
         * The pool stop's subject is the POOL PANE, and the promise that it
         * holds cards is what separates a reached stop from a reached stop
         * over an empty pane — the vacuous green the walk's own fixture guard
         * exists to prevent (`probe.js` has no card-count floor).
         *
         * The pack tile is NOT promised here, though it is still mounted: at
         * this stop the pack pane is scrolled away on a phone, and a
         * `reachable` check scrolls its target back into view — the promise
         * would undo the very gesture this surface measures.
         *
         * `[data-slot=draft-pool]` carries the `contrast` promise because its
         * subtree holds the zone titles; the bar's controls beside it are
         * `uppercase` and its counters are covered by `draft-pick`.
         */
        asserts: [
            {
                label: "room bar",
                locator: { selector: "[data-slot=draft-room-bar]" },
                check: "visible",
            },
            {
                label: "pool pane",
                locator: { selector: "[data-slot=draft-pool]" },
                check: "visible",
            },
            {
                label: "pool card tile",
                locator: {
                    selector: "[data-slot=draft-pool] [data-card-tile]",
                },
                check: "visible",
            },
            {
                label: "Table Ring entry",
                locator: { selector: "[data-draft-table-entry]" },
                check: "reachable",
            },
            {
                label: "Pool toggle",
                locator: { selector: "[data-draft-pool-toggle]" },
                check: "reachable",
            },
            {
                label: "pool pane contrast",
                locator: { selector: "[data-slot=draft-pool]" },
                check: "contrast",
            },
        ],
        async walk(page, ctx) {
            await reachDraftPoolStop(page, ctx);
        },
    },
    {
        // Fixture, not a declared position — see `draft-pick` above for why a
        // `ScenarioSpec` cannot describe a draft (ADR 0132 §4, issue #3652).
        id: "draft-pool-peek",
        // The Pool's `DeckZonePeek` rail, mounted on the two phone viewports
        // this row is viewport-SPLIT across (issue #2861) — the desktop
        // bucket measures the card menu instead, and the rail's own layout is
        // photographed where it exists (issue #3420).
        mounts: ["src/components/deckbuilder/deck-zone-peek.tsx"],
        settleTargets: [DRAFT_PEEK_PANEL],
        entries: [
            "src/routes/limited-events.route.tsx",
            "src/routes/limited-event-detail.route.tsx",
            "src/routes/limited-draft-room.route.tsx",
        ],
        label: "Draft Room, Pool Peek Panel open (/limited/<id>/draft, pool tile selected)",
        /**
         * The pool stop's promises, with the bar's two controls demoted from
         * `reachable` to `visible` — and the rail this surface is named for
         * deliberately absent from the list. Both follow from the same fact:
         * this is the ONE surface whose measured state is viewport-SPLIT by
         * design (issue #2861). On a phone the gesture mounts the Pool's own
         * `DeckZonePeek`; on the tablet/desktop bucket it opens a card menu
         * instead, and the walk asserts the phone's panel and the desktop's
         * menu on their own branches.
         *
         *  - NO RAIL PROMISE. `[data-peek-panel]` exists on two viewports and
         *    `[role=menu] … "Move to…"` on the other three, so either would
         *    red the cells where the app is behaving exactly as designed. The
         *    branch-specific assertion lives in the walk, where it can ask
         *    which regime it is in; an assertion cannot.
         *  - VISIBLE, NOT REACHABLE, for Table and Pool. On the desktop
         *    branch this walk ENDS with that menu open — it is the subject,
         *    so unlike `pinDraftSelection`'s transient popup it is not
         *    dismissed — and an open menu can take the pointer for the
         *    controls behind it. Requiring actionability of the bar here
         *    would assert that the menu is NOT open, which is the opposite of
         *    what this surface measures.
         */
        asserts: [
            {
                label: "room bar",
                locator: { selector: "[data-slot=draft-room-bar]" },
                check: "visible",
            },
            {
                label: "pool pane",
                locator: { selector: "[data-slot=draft-pool]" },
                check: "visible",
            },
            {
                label: "pool card tile",
                locator: {
                    selector: "[data-slot=draft-pool] [data-card-tile]",
                },
                check: "visible",
            },
            {
                label: "Table Ring entry",
                locator: { selector: "[data-draft-table-entry]" },
                check: "visible",
            },
            {
                label: "Pool toggle",
                locator: { selector: "[data-draft-pool-toggle]" },
                check: "visible",
            },
            {
                label: "pool pane contrast",
                locator: { selector: "[data-slot=draft-pool]" },
                check: "contrast",
            },
        ],
        async walk(page, ctx) {
            await selectDraftPoolTile(page, ctx);
            await settle(page);
        },
    },
    {
        // Issue #4422 — the Pool's `Move to…` column-pin sheet. Fixture, not
        // a declared position (see `draft-pick`). `draft-pool-peek` stops at
        // the selection; this row presses `Move to…` and measures the
        // `ActionSheet` it opens, choosing no column — nothing is pinned.
        //
        // PARTIAL CLAIM, viewport-split like `draft-pool-peek` (issue
        // #2861): off a phone the desktop Pool menu's `Move to…` opens
        // `limited-draft-table.tsx`'s OWN sheet, which is the file claimed
        // here; on the two phone viewports the Peek Panel's `Move to…`
        // opens `deck-zone-peek.tsx`'s sheet instead. Both regimes end on
        // an open `[data-action-sheet]`, so every cell measures the same
        // kind of layer, and the claim is honest on three of five.
        id: "draft-pool-move-sheet",
        mounts: ["src/components/limited/limited-draft-table.tsx"],
        settleTargets: [ACTION_SHEET],
        entries: [
            "src/routes/limited-events.route.tsx",
            "src/routes/limited-event-detail.route.tsx",
            "src/routes/limited-draft-room.route.tsx",
        ],
        label: "Draft Room, Pool Move to\u2026 sheet (/limited/<id>/draft, pool tile \u2192 Move to\u2026)",
        asserts: [
            {
                label: "Move to\u2026 sheet",
                locator: { selector: ACTION_SHEET },
                check: "visible",
            },
        ],
        async walk(page, ctx) {
            const regime = await selectDraftPoolTile(page, ctx);
            const moveTo =
                regime === "peek"
                    ? DRAFT_POOL_PEEK_CTA
                    : DRAFT_POOL_MENU_MOVE_ITEM;
            if (!(await clickIfVisible(page, moveTo))) {
                throw new Unreachable(
                    `the Pool selection offered \`Move to…\` a moment ago (${moveTo}) but it could not be pressed`
                );
            }
            if (!(await visible(page, ACTION_SHEET))) {
                throw new Unreachable(
                    "`Move to…` did not open the column-pin sheet (no `[data-action-sheet]`)"
                );
            }
            await settle(page, [ACTION_SHEET]);
        },
    },
    {
        // Issue #4419 — THE PREGAME GATE, the first screen of every match and
        // the census's sharpest `DEBT` row: every other game walk clicks
        // through it (`ensureBoard`'s `button:text-is('Play')`), so the one
        // dialog every player meets before any board was photographed at no
        // viewport. Its own row because it is a different SCREEN and a
        // different moment — there is no board to measure yet, and the choice
        // it offers is gone a click later.
        //
        // FIRST among the game rows on purpose: it needs a game at its
        // pregame, and every row below it leaves one past it.
        id: "game-pregame",
        needsGame: true,
        settleTargets: [PREGAME_GATE_BOX],
        entries: ["src/routes/lobby.route.tsx", "src/routes/game.route.tsx"],
        label: "Pregame gate — coin toss + play/draw (CR 103.1)",
        asserts: [
            {
                label: "dialog: Coin toss",
                locator: { role: "dialog", name: "Coin toss" },
                check: "visible",
            },
            {
                label: "choice: Play",
                locator: { role: "button", name: "Play" },
                check: "reachable",
            },
            {
                label: "choice: Play contrast",
                locator: { role: "button", name: "Play" },
                check: "contrast",
            },
            {
                label: "choice: Draw",
                locator: { role: "button", name: "Draw" },
                check: "reachable",
            },
        ],
        mounts: ["src/components/board/pregame-dialog.tsx"],
        async walk(page, ctx) {
            await ensurePregameGate(page, ctx);
        },
        // Hand the rest of the run the state it has always had: the gate
        // answered and the mulligans kept. `ensureBoard` recovers on its own
        // if this fails (cleanup failures are swallowed) — it clicks the same
        // two prompts — so this is hygiene, not a dependency.
        async cleanup(page) {
            await clickIfVisible(page, PREGAME_PLAY, 6000);
            for (let seat = 0; seat < 2; seat++) {
                if (!(await clickIfVisible(page, MULLIGAN_KEEP, 6000))) break;
                await settle(page);
            }
            await settle(page);
        },
    },
    {
        // The ORDINARY board — the screen a player looks at for most of a game
        // (issue #3695). It loads its own declared position rather than the
        // stress one on purpose: `game-stress` already measures the 55-card
        // extreme, so sharing that payload would print two identical rows and
        // leave the typical board — three lands, a creature or two, a
        // four-card hand — unmeasured. The two rows are complementary.
        id: "game-board",
        needsGame: true,
        settleTargets: [HAND_CARD],
        entries: ["src/routes/lobby.route.tsx", "src/routes/game.route.tsx"],
        label: "Game board — ordinary mid-game position",
        // The controller's two always-present verbs and the hand. The primary
        // slot is the ACTION variant, not the status pill: the declared
        // position parks priority on the viewer, so a pill here means the
        // board stopped offering the viewer a move.
        asserts: [
            {
                label: "controller primary action",
                locator: { selector: '[data-controller-primary="action"]' },
                check: "reachable",
            },
            {
                label: "controller Pass Turn",
                locator: { role: "button", name: "Pass Turn" },
                check: "reachable",
            },
            {
                label: "hand card",
                locator: { selector: "[data-board-hand-card]" },
                check: "visible",
            },
        ],
        async walk(page, ctx) {
            await ensureScenarioBoard(page, ctx, ctx.boardScenarioLabel);
        },
    },
    {
        // Issue #3651, closing `docs/findings/2900-zone-cta-not-in-check-ui-dom.md`:
        // the viewer's GRAVEYARD, open, holding a card whose zone CTA renders.
        // The eight zone CTAs (Flashback, Activate, Play land, Cast from exile
        // or library, Turn face up, Companion) share one recipe
        // (`V4_ZONE_CTA_PLATE`, `src/lib/board-chrome-v4.ts`), and no other
        // row ever put one on screen — which is how the identity-v4
        // ivory-on-white CTA (issues #2900/#3280) shipped with every surface
        // green. One CTA in a real browser is what turns that recipe into a
        // measured promise; the source-text sweep in `design-tokens.test.ts`
        // stays as the offline half.
        //
        // Its own row, not a step inside `game-board`: the open pile is a
        // DIALOG over the board, and folding it in would stop measuring the
        // ordinary board that row exists for. Same declared position, so the
        // two rows cost one scenario payload.
        //
        // The card is Cabal Therapy (`board-scenario.json`): its flashback
        // cost is a creature sacrifice and no mana, so with priority on the
        // viewer in a main phase the CTA is ENABLED — axe's `color-contrast`
        // rule skips a disabled control, and `contrast` fails closed on a
        // subtree it could not judge.
        id: "game-zone-pile",
        // `CardsPile` renders the open pile dialog this row measures
        // (issue #3420).
        mounts: ["src/components/board/cards-pile.tsx"],
        needsGame: true,
        entries: ["src/routes/lobby.route.tsx", "src/routes/game.route.tsx"],
        label: "Zone pile — viewer's graveyard open, Flashback CTA",
        asserts: [
            {
                label: "zone pile dialog",
                locator: { role: "dialog", name: "Graveyard (2)" },
                check: "visible",
            },
            {
                label: "zone CTA: Flashback",
                locator: { role: "button", name: "Flashback" },
                check: "reachable",
            },
            {
                label: "zone CTA contrast",
                locator: { role: "button", name: "Flashback" },
                check: "contrast",
            },
        ],
        async walk(page, ctx) {
            await ensureScenarioBoard(page, ctx, ctx.boardScenarioLabel);
            await openViewerGraveyard(page);
            await settle(page);
        },
        async cleanup(page) {
            await page.keyboard.press("Escape");
            await settle(page);
        },
    },
    {
        // Issue #2704 — the Card Preview overlay's Engine View tree. Its own
        // surface rather than a step inside `game-board`, because it is a
        // different SCREEN: an anchored panel with its own scroll port, its own
        // dense chip cluster and its own tap targets, none of which exist on the
        // board the `game-board` row measures. Folding it in would have averaged
        // the two into one number nobody could attribute.
        //
        // Right-press, not long-press: the mobile overlay needs a real touch
        // sequence, and `CardPreview`'s gesture code ignores the mouse for good
        // once it has seen one (`sawTouchRef`) — a touch walk would therefore
        // measure a different surface at the two touch viewports than at the
        // three others. The anchored pin renders the SAME full slot (header +
        // tree) at every viewport, which is what makes one budget row per
        // viewport comparable.
        id: "game-card-preview",
        needsGame: true,
        settleTargets: [HAND_CARD, PREVIEW_ANCHORED],
        entries: ["src/routes/lobby.route.tsx", "src/routes/game.route.tsx"],
        label: "Card Preview overlay — Engine view (anchored pin)",
        // The pin and the tree it exists to carry — the walk already refuses
        // an EMPTY tree; these keep both promised at every viewport.
        asserts: [
            {
                label: "anchored preview",
                locator: { selector: "[data-card-preview-anchored]" },
                check: "visible",
            },
            {
                label: "Engine View tree",
                locator: { selector: "[data-engine-view-tree]" },
                check: "visible",
            },
        ],
        async walk(page, ctx) {
            // The FIXED stress position, not a dealt solo game — same reason
            // `game-stress` uses it and `game-board` is withdrawn: a preview
            // budget is only meaningful over a card the lane chose.
            await ensureStressBoard(page, ctx);
            // The LAST card in the fan, not the first: hand cards overlap to
            // the right, so every card but the last has a sibling painted over
            // its centre and Playwright's actionability check on it times out
            // (measured — `click: Timeout 8000ms exceeded`). The last card is
            // the one fully on top at every viewport, which is also what makes
            // the measured subject the same one from run to run.
            const card = page.locator(HAND_CARD).last();
            if (!(await visible(page, HAND_CARD, STEP_TIMEOUT))) {
                // Say WHICH of the two failures happened. "No hand card" is
                // ambiguous between an empty hand and a hand that is mounted
                // but not visible (collapsed rail, off-screen fan), and the two
                // have opposite fixes.
                const mounted = await page.locator(HAND_CARD).count();
                throw new Unreachable(
                    `no visible hand card to preview at ${page.url()} — ${mounted} \`${HAND_CARD}\` node(s) mounted. Zero means the seat's hand never dealt; nonzero means the hand is mounted but not visible at this viewport`
                );
            }
            // Right-press at COORDINATES rather than `locator.click()`.
            // `CardPreview` binds the gesture on the card's
            // `[data-card-tilt-root]` ANCESTOR on purpose (a `preserve-3d`
            // wrapper around an `overflow-hidden` box flattens the subtree, so
            // a real right-click hit-tests to that ancestor and never reaches a
            // handler on the card itself — see `card-preview.tsx`). Playwright's
            // actionability check reads that same hit target as an intercepting
            // element and times out, so the lane has to press where a user
            // presses instead of asking the locator's permission.
            const box = await card.boundingBox();
            if (!box) {
                throw new Unreachable(
                    "the topmost hand card has no layout box — it is mounted but occupies no space, so there is nothing to right-press"
                );
            }
            await page.mouse.click(
                box.x + box.width / 2,
                box.y + box.height / 2,
                {
                    button: "right",
                }
            );
            if (!(await visible(page, PREVIEW_ANCHORED, STEP_TIMEOUT))) {
                throw new Unreachable(
                    "right-pressing a hand card opened no anchored preview — the pin gesture is the only one that reaches the FULL Engine View slot at every viewport"
                );
            }
            // A pin that opened without its tree is the #2704 wiring bug, and it
            // is invisible to every offline suite: the panel is on screen, it is
            // just missing the thing this surface exists to measure.
            const tree = page.locator(ENGINE_VIEW_TREE).first();
            if ((await tree.count()) === 0) {
                throw new Unreachable(
                    "the anchored preview mounted without an Engine View slot — issue #2728's `[data-engine-view-tree]` well is absent"
                );
            }
            if ((await tree.locator("> *").count()) === 0) {
                throw new Unreachable(
                    "the Engine View well mounted EMPTY — `buildPreviewBody` is not deriving `engineTree`, or `CardPreviewFace` is not forwarding it (issue #2704)"
                );
            }
            await settle(page);
        },
        // Dismiss the pin once it has been measured. The board's own outside-
        // click handler would close it on the next surface's first click
        // anyway, but "anyway" is how a later walk inherits an overlay it never
        // accounted for — `game-stress` opens the Debug panel immediately after
        // this row.
        async cleanup(page) {
            await page.keyboard.press("Escape");
            await settle(page);
        },
    },
    {
        id: "game-stress",
        needsGame: true,
        settleTargets: [HAND_CARD],
        entries: ["src/routes/lobby.route.tsx", "src/routes/game.route.tsx"],
        label: "Game board — UI stress scenario",
        // The same promises as `game-board`, on the position built to crowd
        // them out: a 55-card board is where a controller row gets pushed
        // under the fold or painted over.
        asserts: [
            {
                label: "controller primary action",
                locator: { selector: '[data-controller-primary="action"]' },
                check: "reachable",
            },
            {
                label: "controller Pass Turn",
                locator: { role: "button", name: "Pass Turn" },
                check: "reachable",
            },
            {
                label: "hand card",
                locator: { selector: "[data-board-hand-card]" },
                check: "visible",
            },
        ],
        async walk(page, ctx) {
            await ensureStressBoard(page, ctx);
        },
    },
    {
        // The tester debug sheet, open, on the scenario surface (issues #3493
        // and #3494). Its own row rather than a step inside `game-stress`
        // because it is a different SCREEN — a 480px column of dense form
        // controls with its own scroll port — AND because it is the only place
        // the lane can measure the thing #3493 actually promises: that the
        // board GIVES UP that width instead of hiding under it.
        //
        // The two assertions below are measurements, not reachability checks,
        // so they throw a plain Error: the receipt then says "walk threw" and
        // names the numbers, which reads as the regression it is rather than
        // as a fixture nobody built.
        id: "game-debug-sheet",
        // The sheet is open at measurement (issue #3420).
        mounts: ["src/components/debug/debug-sheet.tsx"],
        needsGame: true,
        settleTargets: [DEBUG_SHEET, BOARD_AREA],
        entries: ["src/routes/lobby.route.tsx", "src/routes/game.route.tsx"],
        label: "Debug sheet — scenario list + save form",
        // The sheet's toggle, its scenario list (the filter and the lane's own
        // stress row, which `loadScenarioOnBoard` loads through) and the save
        // form's pinned head. `reachable` scrolls each into the sheet's port,
        // so the list promise holds after the walk scrolled the form down.
        asserts: [
            // VISIBLE, not reachable: the open sheet (`z-sheet`) paints over
            // its own edge tab (`z-dev-overlay`) by design — Escape is the
            // documented close (`closeDebugSheet`). What this promises is that
            // the tab stays mounted, and that the sheet it opened is up.
            {
                label: "debug sheet toggle",
                locator: { selector: "[data-debug-sheet-toggle]" },
                check: "visible",
            },
            {
                label: "debug sheet open",
                locator: { selector: "[data-debug-sheet]" },
                check: "visible",
            },
            {
                label: "scenario search",
                locator: { role: "textbox", name: "search scenarios" },
                check: "reachable",
            },
            {
                label: "scenario row: UI stress",
                locator: {
                    role: "button",
                    name: "UI stress — full board, full hand, deep piles",
                },
                check: "reachable",
            },
            {
                label: "save form label",
                locator: { role: "textbox", name: "scenario label" },
                check: "reachable",
            },
            {
                label: "save form primary: Save to DB",
                locator: { role: "button", name: "Save to DB" },
                check: "reachable",
            },
        ],
        async walk(page, ctx) {
            await ensureStressBoard(page, ctx);

            // 1. The push (issue #3493). Closed first — `ensureStressBoard`
            //    leaves it that way — then open, on the SAME board.
            const closed = await boardAreaWidth(page);
            await openDebugSheet(page);
            await settle(page);
            const opened = await boardAreaWidth(page);
            const given = closed - opened;
            const vw = page.viewportSize()?.width ?? 0;
            if (vw >= DEBUG_SHEET_PUSH_MIN_WIDTH) {
                if (
                    Math.abs(given - DEBUG_SHEET_DESKTOP_WIDTH) > PUSH_TOLERANCE
                ) {
                    throw new Error(
                        `at ${vw}px the open debug sheet must take ${DEBUG_SHEET_DESKTOP_WIDTH}px off the board area; measured ${given.toFixed(1)}px (closed ${closed.toFixed(1)}, open ${opened.toFixed(1)})`
                    );
                }
                // The OTHER half, and the half the board's box cannot see (PR
                // #3505 review): the margin is driven by the board area's own
                // class, so a sheet that renders NARROWER than the reserved
                // width leaves a dead gutter and every number above still
                // reads as a pass. The sheet's width is a different selector
                // fighting the primitive's `data-[side=left]:sm:max-w-sm`, and
                // that fight is exactly what this measures.
                const sheet = await page
                    .locator(DEBUG_SHEET)
                    .first()
                    .boundingBox();
                if (!sheet) {
                    throw new Unreachable(
                        `the open sheet has no layout box — \`${DEBUG_SHEET}\` is mounted but occupies no space`
                    );
                }
                if (
                    Math.abs(sheet.width - DEBUG_SHEET_DESKTOP_WIDTH) >
                    PUSH_TOLERANCE
                ) {
                    throw new Error(
                        `at ${vw}px the open debug sheet must BE ${DEBUG_SHEET_DESKTOP_WIDTH}px wide, not just reserve it; measured ${sheet.width.toFixed(1)}px — the board gave up ${given.toFixed(1)}px, so the difference is a dead gutter`
                    );
                }
            } else if (Math.abs(given) > PUSH_TOLERANCE) {
                throw new Error(
                    `below lg (${vw}px) the board width must not depend on the sheet's open flag; measured ${closed.toFixed(1)} closed vs ${opened.toFixed(1)} open`
                );
            }

            // 2. The scenario surface (issue #3494): the two lists, then the
            //    save form with its rare knobs expanded, so the probe measures
            //    the form at its TALLEST rather than at its friendliest.
            if (!(await clickIfVisible(page, "button:has-text('Scenarios')"))) {
                throw new Unreachable(
                    "the open debug sheet offered no Scenarios button — the scenario surface is the subject of this row"
                );
            }
            if (
                !(await visible(page, "input[placeholder*='Search scenarios']"))
            ) {
                throw new Unreachable(
                    "the Scenarios list did not open (listDebugScenarios is admin-gated — is this account an admin?)"
                );
            }
            const label = page.locator("input[aria-label='scenario label']");
            if ((await label.count()) === 0) {
                throw new Unreachable(
                    "the scenario save form never mounted — its pinned head (title + label + Save) is half of what this row measures (issue #3494)"
                );
            }
            if (
                !(await clickIfVisible(
                    page,
                    "button:has-text('Other options')"
                ))
            ) {
                throw new Unreachable(
                    "the save form rendered no `Other options` disclosure — the rare spec knobs would then be unreachable, not merely collapsed (issue #3494)"
                );
            }
            // 3. The aligned grid (issue #3512), measured with "Other options"
            //    open so every per-seat section is on the page: within a
            //    section every `me` input shares one left x, so does every
            //    `opp` input, and `me` / `opp` is printed once as a column
            //    header. happy-dom has no layout, so this is the only place
            //    the alignment the issue exists for can be proven.
            const grid = (await page.evaluate(
                `(() => {
                    const problems = [];
                    let measured = 0;
                    for (const section of document.querySelectorAll("[data-spec-section]")) {
                        const name = section.getAttribute("data-spec-section");
                        const inputs = section.querySelectorAll("[data-seat]");
                        const headers = section.querySelectorAll("[data-seat-header]").length;
                        if (inputs.length > 0 && headers !== 2) {
                            problems.push(name + ": " + headers + " seat column headers, want 2");
                        }
                        const lefts = { me: new Set(), opp: new Set() };
                        for (const el of inputs) {
                            lefts[el.getAttribute("data-seat")].add(
                                Math.round(el.getBoundingClientRect().left)
                            );
                            measured++;
                        }
                        for (const seat of ["me", "opp"]) {
                            if (lefts[seat].size > 1) {
                                problems.push(name + " " + seat + " inputs at x=" + [...lefts[seat]].join("/"));
                            }
                        }
                    }
                    // The card row's placement lines (PR review): one grid
                    // shared by both lines crushed the zone select to 27px at
                    // the phone sheet — no page overflow, so nothing else here
                    // saw it. A line must fit its box and the select stay usable.
                    for (const block of document.querySelectorAll("[data-card-placement]")) {
                        for (const line of block.children) {
                            if (line.scrollWidth > line.clientWidth + 1) {
                                problems.push("card placement line overflows: " + line.scrollWidth + " > " + line.clientWidth);
                            }
                        }
                        const zone = block.querySelector("select[aria-label$=' zone']");
                        const width = zone ? zone.getBoundingClientRect().width : 0;
                        if (width < 80) {
                            problems.push("card zone select " + Math.round(width) + "px wide, want >= 80");
                        }
                        measured++;
                    }
                    return { problems, measured };
                })()`
            )) as { problems: string[]; measured: number };
            if (grid.measured === 0) {
                throw new Unreachable(
                    "the expanded save form rendered no per-seat input to measure — the alignment check below would pass vacuously (issue #3512)"
                );
            }
            if (grid.problems.length > 0) {
                throw new Error(
                    `the scenario form's per-seat columns do not align (issue #3512): ${grid.problems.join("; ")}`
                );
            }

            // The pinned head is the other half: scroll the form's port to the
            // bottom and the title/label/CTA must still be inside it.
            // A STRING body, the idiom the rest of this file uses for
            // browser-side code: `scripts/**` is compiled without `lib.dom`
            // (deliberately — importing a DOM-typed module here drags it into
            // `bun run land`), so a typed callback would red `check:ts` on
            // `document` itself.
            const scrolled = (await page.evaluate(
                `(() => {
                    const el = document.querySelector(${JSON.stringify(DEBUG_SHEET_BODY)});
                    if (!el) return 0;
                    el.scrollTop = el.scrollHeight;
                    return el.scrollTop;
                })()`
            )) as number;
            await settle(page);
            // A port that did not move proves nothing about a pinned head —
            // the head would sit inside it whether `sticky` worked or not (PR
            // #3505 review). The walk expands "Other options" first precisely
            // so there is something to scroll.
            if (scrolled <= PUSH_TOLERANCE) {
                throw new Error(
                    `the debug sheet's scroll port did not move (scrollTop ${scrolled}) — the pinned-head check below would pass vacuously`
                );
            }
            const port = await page
                .locator(DEBUG_SHEET_BODY)
                .first()
                .boundingBox();
            const head = await label.first().boundingBox();
            if (!port || !head) {
                throw new Unreachable(
                    "the debug sheet's scroll port or the form's label input has no layout box"
                );
            }
            if (
                head.y < port.y - PUSH_TOLERANCE ||
                head.y > port.y + port.height
            ) {
                throw new Error(
                    `the scenario form's head scrolled out of the sheet's port: label at y=${head.y.toFixed(1)}, port ${port.y.toFixed(1)}..${(port.y + port.height).toFixed(1)} (issue #3494 pins it)`
                );
            }
            await settle(page);
        },
        // END the solo game this row dealt (issue #3505 fixup). Not hygiene:
        // `game-debug-sheet-ai` below needs the vs-AI setup dialog, and
        // `lobbyActionGate` holds that shut while the account has ANY game in
        // flight — so a solo game left standing here makes the LAST surface in
        // the list unreachable, at every viewport, for a reason its own diff
        // never caused. Measured on the first full run after this row landed.
        //
        // `ctx.createdGame` goes back to false with it, so the next viewport
        // deals its own rather than resuming one that is over.
        async cleanup(page, ctx) {
            await closeDebugSheet(page);
            if (!ctx.createdGame) return;
            const trace: string[] = [];
            if (await concedeLaneGame(page, ctx, trace)) {
                ctx.createdGame = false;
                return;
            }
            throw new Error(
                `could not end the solo game this lane created — \`game-debug-sheet-ai\` will read as unreachable for the rest of this run [${trace.join("; ")}]`
            );
        },
    },
    {
        // Issue #3708 — the COMBAT DECLARATION screen. Its own row because it
        // is a different SCREEN from `game-board`: a dense control cluster the
        // ordinary board never mounts (the block CTA in the command slot, the
        // attack badges, the arrows between the two battlefields), and the one
        // screen whose controls a phone has to fit UNDER an attacked board.
        //
        // Its position is the only declared one whose `activePlayer` is
        // `"opp"`, and that is load-bearing rather than a slip: the block is a
        // turn-based action owed to the DEFENDING player (CR 509.1a), so a
        // combat the human seat is attacking in would render the opponent's
        // half and measure controls the viewer cannot act on. `priority` stays
        // on the human seat and `computeSoloViewerId` steers to the defender
        // through this whole window, so nothing here depends on the coin toss
        // — which is the property ADR 0132 §4 is actually about, and what
        // `ui-gate-game-scenarios.test.ts` now checks directly by rebuilding
        // each position and asking the engine WHO it owes its input to.
        //
        // The walk does not declare a block. It measures the window; playing
        // it would end the window and leave the next viewport a different
        // board.
        id: "game-combat",
        needsGame: true,
        // PLAIN CSS, always: a settle target is handed to `querySelectorAll`
        // inside the page (`settle.ts`'s `sampleSource`), which knows nothing
        // of Playwright's `:has-text()` — a pseudo-class here does not narrow
        // the sample, it throws `SyntaxError` from `evaluate` and reports the
        // surface UNWALKED. The text locators below are for LOCATORS only.
        settleTargets: [BOARD_AREA],
        entries: ["src/routes/lobby.route.tsx", "src/routes/game.route.tsx"],
        label: "Combat — block declaration owed",
        // What a block window promises: the board still on screen under the
        // attack, and the declaration the defending seat owes, in the
        // controller's centre slot. The primary is asserted through the
        // `"action"` mark rather than by name (issue #3651's seam): a STATUS
        // pill in that slot means the board stopped offering the viewer the
        // decision this position exists to pose, and the two are the same
        // element with different marks.
        asserts: [
            {
                label: "controller primary action",
                locator: { selector: '[data-controller-primary="action"]' },
                check: "reachable",
            },
            {
                label: "block declaration CTA",
                locator: { role: "button", name: "No Blockers" },
                check: "reachable",
            },
            {
                label: "board under the attack",
                locator: { selector: "[data-board-area]" },
                check: "visible",
            },
        ],
        async walk(page, ctx) {
            await ensureScenarioBoard(page, ctx, ctx.combatScenarioLabel);
            if (!(await visible(page, BLOCK_DECLARATION_CTA, STEP_TIMEOUT))) {
                throw new Unreachable(
                    `the combat position loaded but no block-declaration control rendered — the position declares three confirmed attackers with the block owed to the human seat (CR 509.1), so either the viewing seat is not the defender or the command slot is off-screen at this viewport (${await topmostAt(page, "[data-controller-command-row], [data-controller-pod], [data-controller-landscape-strip]")})`
                );
            }
            // PARK THE POINTER before measuring. The walk arrives here having
            // clicked through the debug sheet, and Playwright leaves the mouse
            // wherever the last click put it — resting over a battlefield card
            // that is enough to raise a `CardPreview` panel, whose art paints
            // with square corners and broke the `cardsSquare` Floor at
            // 820x1180x2 (measured: one square corner, the preview's own art,
            // on a board whose cards are all rounded). A stray overlay is not
            // what this row measures, and `game-card-preview` owns that panel
            // deliberately.
            //
            // NO `Escape` HERE, and the omission is the whole point: on a board
            // with nothing open, Escape OPENS the Game Menu (a `z-modal` scrim
            // over the whole viewport). Measured — the run that pressed it
            // reported five green viewports for a screen that was the Game Menu
            // over a blurred board: cards `n0`, seven controls occluded, the
            // cleanup click refused by the scrim, and both rows after this one
            // UNWALKED. Escape is for a surface that HAS a dialog open
            // (`game-card-preview`, `game-manage-yields` below); here it would
            // manufacture one.
            await page.mouse.move(0, 0);
            await settle(page, [BOARD_AREA]);
        },
        // END the block window. The walk measures it; leaving it open hands the
        // next row a board mid-turn-based-action, and `ensureBoard`'s resume
        // branch could not raise a board affordance against one (measured: the
        // two rows after this one both read UNWALKED, at every viewport).
        // `No Blockers` is the legal empty declaration (CR 509.1a), so this
        // ends the window without inventing a block the position did not
        // declare.
        async cleanup(page) {
            await clickIfVisible(page, BLOCK_DECLARATION_CTA, STEP_TIMEOUT);
            await settle(page);
        },
    },
    {
        // Issue #3708 — a mid-resolution CARD CHOICE over the board (CR
        // 608.2). Its own row for the reason `game-card-preview` is one: it is
        // a modal with its own scroll port and its own confirm plate, mounted
        // over a board that keeps rendering underneath, and none of that
        // exists on any other row.
        //
        // The pick is from the OTHER seat's hand on purpose. An own-hand pick
        // toggles the cards in the hand fan — a screen `game-board` already
        // measures — while a pick from someone else's hand opens the modal
        // grid (`HandCardPick`), which is the list this row exists to measure.
        // Seven candidates, five of them eligible under the spell's own
        // filter, so the grid has something to scroll at phone width.
        id: "game-choice-prompt",
        // The modal picker IS `CardsPile` under `forceOpen` (issue #3420) —
        // same module as `game-zone-pile`, a different state of it.
        mounts: ["src/components/board/cards-pile.tsx"],
        needsGame: true,
        settleTargets: [CHOICE_PICKER],
        entries: ["src/routes/lobby.route.tsx", "src/routes/game.route.tsx"],
        label: "Card-choice prompt — modal picker over the board",
        // The three things a card choice has to put on screen: the port the
        // candidates scroll in, a candidate, and the plate that commits the
        // pick. The confirm is addressed by its FULL name — `LibrarySearchConfirm`
        // renders `Done (${selected}/${max})`, and at assertion time (after the
        // walk settles, before its cleanup picks anything) the buffer is empty
        // and `max` is 1, so `Done (0/1)` is exact rather than approximate.
        asserts: [
            {
                label: "choice picker scroll port",
                locator: { selector: '[data-slot="game-dialog-column"]' },
                check: "visible",
            },
            {
                label: "choice candidate tile",
                locator: {
                    selector:
                        '[data-slot="game-dialog-column"] [data-card-tilt-root]',
                },
                check: "visible",
            },
            {
                // VISIBLE, not reachable, and the difference is the app being
                // right rather than the lane being lenient: the plate is
                // `disabled` until the buffer holds `min` cards
                // (`LibrarySearchConfirm`'s `canSubmit`), and at assertion time
                // nothing is picked yet — so `reachable`, which trial-clicks,
                // promises something this screen cannot offer and failed at all
                // five viewports with `not actionable`. Same shape as the
                // lobby's `Loadout primary action`, visible for the same
                // reason (it is disabled with no deck).
                label: "choice confirm plate",
                locator: { role: "button", name: "Done (0/1)" },
                check: "visible",
            },
        ],
        async walk(page, ctx) {
            await ensureScenarioBoard(page, ctx, ctx.choiceScenarioLabel);
            // ONE pass resolves the spell: the position banks the other one
            // (CR 117.4, `passCount: 1`), which is what keeps this walk a
            // single click instead of a solo-mode round of two.
            if (
                !(await clickIfVisible(page, PASS_PRIORITY_CTA, STEP_TIMEOUT))
            ) {
                throw new Unreachable(
                    "the choice position loaded but offered the human seat no Pass control — the spell on the stack resolves on one pass, so without it this surface cannot reach its prompt"
                );
            }
            if (!(await visible(page, CHOICE_PICKER, STEP_TIMEOUT))) {
                throw new Unreachable(
                    "passing resolved the spell but no modal picker opened — a `choose-hand-card` choice over ANOTHER seat's hand is what mounts `HandCardPick`; an own-hand pick would toggle in the hand fan instead and this row would be measuring the board again"
                );
            }
            // EXACTLY seven, not "at least five". The position is declared and
            // deterministic, so a grid that renders six is a regression in the
            // very thing this row measures — and a floor of five would let it
            // through while the message below still claimed seven.
            const candidates = await page.locator(CHOICE_PICKER_CARD).count();
            if (candidates !== 7) {
                throw new Unreachable(
                    `the picker opened with ${candidates} candidate(s) — the position declares seven (five of them eligible under the spell's own filter), and this row exists to measure that list scrolling at phone width`
                );
            }
            await settle(page, [CHOICE_PICKER]);
        },
        // ANSWER the choice. A pending choice is not scenery: the modal is
        // `forceOpen`, so it paints over the debug sheet's edge toggle, and the
        // next row's `ensureScenarioBoard` could not open the sheet to load its
        // own position. Loading a scenario clears mid-flight decisions
        // (`buildStateFromScenario`, issue #3515) — but only once it can be
        // reached, which is exactly what this undoes.
        // BOTH clicks are required, and the second is the one that matters.
        // Picking a tile only toggles the shared buffer: `GridCard` does call
        // `onClose()` beside the pick, but `CardsPile`'s `setIsOpen`
        // short-circuits while `forceOpen` is set, so the dialog stays up and
        // nothing submits on its own — `usePendingChoiceBuffer.submit()` has
        // exactly one caller, `LibrarySearchConfirm`'s Done plate. The picker
        // closes when the server resolves the choice and `HandCardPick` goes
        // inactive, which is what the next row needs: its
        // `ensureScenarioBoard` has to reach the debug sheet's edge toggle,
        // and a `forceOpen` modal paints over it.
        async cleanup(page) {
            try {
                await page
                    .locator(CHOICE_PICKER_CARD)
                    .first()
                    .click({ timeout: STEP_TIMEOUT });
                if (await visible(page, CHOICE_PICKER_CONFIRM, 2000)) {
                    await page
                        .locator(CHOICE_PICKER_CONFIRM)
                        .first()
                        .click({ timeout: STEP_TIMEOUT });
                }
            } catch {
                // Cleanup is hygiene — `index.ts`'s `measure()` swallows a
                // failure here, and the next row reports a picker left standing
                // in its own Unreachable reason.
            }
            await settle(page);
        },
    },
    {
        // Issue #3629 — the "Manage yields" box, open over the board. Its own
        // row because it is a different SCREEN (a dialog with its own scroll
        // body and one remove control per entry), and one that only exists
        // while the viewing seat HOLDS a **Yield**.
        //
        // The yield goes on the BOTTOM of a two-object stack, never the top: a
        // yield on the top object makes the seat holding priority pass at once
        // (`shouldAutoPassYield`), which in solo mode hands the view to the
        // other seat — whose store is empty — and the control is gone before
        // the walk can click it.
        //
        // Before `game-debug-sheet-ai`, and — like `game-debug-sheet` above —
        // it ENDS the solo game it loaded its scenario into: that last row
        // refuses to start a vs-AI game over the lane's own standing solo game.
        id: "game-manage-yields",
        // The yields box is open over the board at measurement (issue #3420).
        mounts: ["src/components/board/manage-yields-dialog.tsx"],
        needsGame: true,
        entries: ["src/routes/lobby.route.tsx", "src/routes/game.route.tsx"],
        label: "Manage yields box — one yield held",
        // The box, the row for the yield the walk just held, and that row's
        // remove action — the one verb this box exists for.
        asserts: [
            {
                label: "manage yields box",
                locator: { selector: "[data-manage-yields-box]" },
                check: "visible",
            },
            {
                label: "yield row",
                locator: { selector: "[data-manage-yields-row]" },
                check: "visible",
            },
            {
                label: "yield row remove action",
                locator: { selector: "[data-manage-yields-remove]" },
                check: "reachable",
            },
        ],
        async walk(page, ctx) {
            await ensureScenarioBoard(page, ctx, ctx.yieldsScenarioLabel);
            const toggles = page.locator(STACK_YIELD_TOGGLE);
            if (!(await visible(page, STACK_YIELD_TOGGLE, STEP_TIMEOUT))) {
                throw new Unreachable(
                    "the yields scenario loaded but no stack row offered a yield toggle — is the stack panel collapsed at this viewport?"
                );
            }
            const count = await toggles.count();
            if (count < 2) {
                throw new Unreachable(
                    `the stack panel shows ${count} yield toggle(s) — the walk needs two objects so it can yield the BOTTOM one without auto-passing`
                );
            }
            await toggles.last().click({ timeout: STEP_TIMEOUT });
            if (
                !(await clickIfVisible(page, MANAGE_YIELDS_CTA, STEP_TIMEOUT))
            ) {
                throw new Unreachable(
                    'holding a yield rendered no visible "Manage yields" control in the stack panel header'
                );
            }
            if (!(await visible(page, MANAGE_YIELDS_ROW, STEP_TIMEOUT))) {
                throw new Unreachable(
                    "the Manage yields box opened without a row for the yield just held"
                );
            }
            await settle(page);
        },
        async cleanup(page, ctx) {
            await page.keyboard.press("Escape");
            await settle(page);
            if (!ctx.createdGame) return;
            const trace: string[] = [];
            if (await concedeLaneGame(page, ctx, trace)) {
                ctx.createdGame = false;
                return;
            }
            throw new Error(
                `could not end the solo game this lane created — \`game-debug-sheet-ai\` will read as unreachable for the rest of this run [${trace.join("; ")}]`
            );
        },
    },
    {
        // Issue #3492 — the tester debug sheet with its AI trace box open. Its
        // own surface rather than a step inside a board row, for the same
        // reason `game-card-preview` is: it is a different SCREEN. A left
        // sheet 88% of the viewport wide, with its own scroll port and its own
        // `max-h` trace body inside that port, is not something a budget over
        // the battlefield can say anything about.
        //
        // The one surface here that needs a VS-AI game. The trace box is
        // mounted behind `vsAi` (`debug-sheet.tsx`), so on the solo game every
        // other board row uses, this screen simply does not exist.
        //
        // LAST in the list on purpose: it is the only walk that ends a match,
        // and it ends only matches the lane itself created. Running it after
        // the board rows means the solo game they need is still standing while
        // they need it.
        id: "game-debug-sheet-ai",
        // The sheet is open at measurement, on its AI trace tab (issue #3420).
        mounts: ["src/components/debug/debug-sheet.tsx"],
        needsGame: true,
        settleTargets: [DEBUG_SHEET],
        entries: ["src/routes/lobby.route.tsx", "src/routes/game.route.tsx"],
        label: "Debug sheet — AI trace open (vs-AI game)",
        // The open trace body and the Judge action on the seeded decision —
        // judging is the gesture the trace box is there to invite (issue
        // #3405).
        asserts: [
            // VISIBLE, not reachable: the open sheet (`z-sheet`) paints over
            // its own edge tab (`z-dev-overlay`) by design — Escape is the
            // documented close (`closeDebugSheet`). What this promises is that
            // the tab stays mounted, and that the sheet it opened is up.
            {
                label: "debug sheet toggle",
                locator: { selector: "[data-debug-sheet-toggle]" },
                check: "visible",
            },
            {
                label: "debug sheet open",
                locator: { selector: "[data-debug-sheet]" },
                check: "visible",
            },
            {
                label: "AI trace body",
                locator: { selector: "[data-ai-trace-body]" },
                check: "visible",
            },
            {
                label: "AI trace Judge action",
                locator: { role: "button", name: "Judge this move" },
                check: "reachable",
            },
        ],
        async walk(page, ctx) {
            await ensureVsAiBoard(page, ctx);
            // THE DECLARED POSITION (ADR 0132 §4, issue #3652). The board this
            // surface measures through is a vs-AI game, so until now everything
            // on it — the dealt hand, the turn, which seat the viewer follows —
            // was decided by the coin toss, and the bot kept playing underneath
            // while the probe worked. `ai-trace-scenario.json` parks BOTH
            // `activePlayer` and `priority` on the human seat, so
            // `useVsAiDriver` is never owed an input (`decideBotAction` returns
            // `none`) and the position cannot move while the five viewports are
            // measured.
            if (!ctx.createdVsAiGame) {
                throw new Unreachable(
                    "an active vs-AI game the lane did not create is in progress; loading this surface's declared position would clobber it. Finish or concede it, then re-run"
                );
            }
            await loadScenarioOnBoard(page, ctx.aiTraceScenarioLabel);
            if (!(await visible(page, DEBUG_SHEET_TOGGLE, STEP_TIMEOUT))) {
                throw new Unreachable(
                    "no debug-sheet edge toggle on the board — the route mounts it for a tester or in dev (`canUseDebugSheet`), and this lane runs its own vite dev server, so its absence means the board never finished rendering"
                );
            }
            // Open it only if it is closed: `tolaria:debugSheetOpen` persists
            // per device, so a blind click can just as easily shut it.
            await clickIfVisible(page, DEBUG_SHEET_TOGGLE_CLOSED, 2000);
            if (!(await visible(page, DEBUG_SHEET, STEP_TIMEOUT))) {
                throw new Unreachable(
                    "the edge toggle did not open the debug sheet within 8s"
                );
            }
            // The box is `vsAi`-gated, and its open BODY is the node carrying
            // the height contract this surface measures. Absent means one of
            // two things and the message has to name both: the walk landed on
            // a game that is not vs-AI, or the box mounted collapsed.
            if (!(await visible(page, AI_TRACE_BODY, STEP_TIMEOUT))) {
                const mounted = await page
                    .locator(`${DEBUG_SHEET} :text("AI trace")`)
                    .count();
                throw new Unreachable(
                    mounted
                        ? "the debug sheet's AI trace box is mounted but COLLAPSED — its open body is what carries the `max-h` this surface measures"
                        : "the debug sheet opened without an AI trace box — the box is `vsAi`-gated (`debug-sheet.tsx`), so this walk reached a game that is not vs-AI"
                );
            }
            // SEED THE RING, rather than empty it (issue #3652). The walk used
            // to press every `Clear` in the sheet, because the ring is a live
            // log of a live bot: its ROW COUNT was a function of how long the
            // walk took and of who won the coin toss, and across two runs of
            // one unchanged tree it moved the desktop reading from
            // `ctrls n13 small12` to `ctrls n21 small19`. An EMPTY ring is
            // reproducible, but it measures the box in the one state a tester
            // never opens it in — "No bot decision yet." over two empty logs.
            //
            // The declared position above closes the other half: with priority
            // on the human seat the bot writes nothing here, so whatever the
            // seam puts in the ring is what the probe measures, every run.
            // `window.__tolariaAiTrace.seed()` pushes a CONSTANT trace through
            // `pushAiTrace` — the same function `useVsAiDriver` calls
            // (`src/lib/ai/dev-trace-seam.ts`), so the rows are the rows a real
            // decision renders. Idempotent, because a retried Infra Verdict
            // re-walks this surface.
            //
            // It empties ALL THREE sections of the box first, not just the
            // ring (PR #3697 review). The escalation log and the outcome log
            // are inside the same measured `[data-ai-trace-body]`, and the Bot
            // fills the outcome log on every walk through a window the declared
            // position cannot reach: the pregame mulligan, which it answers
            // directly and during which no scenario may be loaded at all
            // (CR 103.5). Their rows would otherwise ride into the shape
            // readings, moving with whether the deal needed a mulligan.
            //
            // The page function is passed as SOURCE TEXT, like `topmostAt`
            // above: this file compiles under `tsconfig.scripts.json`, which
            // carries no `lib.dom`.
            const seeded = (await page.evaluate(
                `(() => {
                    const seam = window.__tolariaAiTrace;
                    return seam ? seam.seed() : -1;
                })()`
            )) as number;
            if (seeded < 1) {
                throw new Unreachable(
                    seeded === -1
                        ? "the AI trace seam (`window.__tolariaAiTrace`) is not installed — it is gated on `import.meta.env.DEV` and installed by the trace box itself (`src/lib/ai/dev-trace-seam.ts`), so its absence means the lane is measuring a production build or the box never mounted"
                        : `the AI trace seam seeded ${seeded} decision(s) — the ring this surface measures is empty`
                );
            }
            await settle(page);
        },
        // The lane's own vs-AI game, ended so the deployment is left as this
        // surface found it. That matters more here than anywhere else in the
        // file: an active game left behind is exactly what gates the vs-AI
        // setup dialog shut, so a run that skipped this would poison its own
        // next run — and every concurrent session's `lobby-vs-ai` with it.
        async cleanup(page, ctx) {
            if (!ctx.createdVsAiGame) return;
            const trace: string[] = [];
            if (await concedeLaneGame(page, ctx, trace)) {
                ctx.createdVsAiGame = false;
                return;
            }
            // LOUD, even though `index.ts` swallows a cleanup failure into one
            // line: a game left standing is not local hygiene debt, it is the
            // precondition of the NEXT run (and of every concurrent session's
            // `lobby-vs-ai`, whose own budget entry records exactly this).
            const banner = (
                (await page
                    .locator(`[data-slot="banner"], :has(> ${BANNER_RESUME})`)
                    .first()
                    .innerText()
                    .catch(() => "")) || "(no banner text)"
            )
                .replace(/\s+/g, " ")
                .slice(0, 160);
            throw new Error(
                `could not end the vs-AI game this lane created — the lobby banner still reads "${banner}" [${trace.join("; ")}]. Clear it before the next run`
            );
        },
    },
];

export const SURFACE_IDS: readonly string[] = SURFACES.map((s) => s.id);
