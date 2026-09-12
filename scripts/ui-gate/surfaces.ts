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
// The fixture's labels come from the leaf module the SEEDING mutation reads
// them from — one definition, so renaming a label cannot leave the lane
// addressing a row that no longer exists (issue #2822 review). It is that
// leaf and never `convex/limitedFixtures.ts` itself: the seeder is a
// registered Convex function module, and importing it here would pull
// gitignored `convex/_generated` into `bun run land` (round 2). Aliased to
// the shorter names the walks read with; see the block above
// `FIXTURE_LIST_PATH` for what they address.
import {
    UI_GATE_DRAFT_LABEL as FIXTURE_DRAFT_LABEL,
    UI_GATE_LABEL_PREFIX as FIXTURE_LABEL_PREFIX,
    UI_GATE_OPEN_LABEL as FIXTURE_OPEN_LABEL,
} from "../../convex/limited/uiGateFixtureLabels";

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
    /** Issue #2671 review H2. The `deck-builder` walk's fixture import trips
     *  `useDeckWorkspace`'s autosave, so a real `userDecks` row exists by the
     *  time `walk()` returns. `walk()` records the auto-assigned name here;
     *  `cleanup()` reads it (on the SAME page, right after the probe has
     *  measured this exact state) to delete that one row by name from the
     *  lobby's My Decks list, then clears the field. `undefined` means
     *  nothing to clean up. */
    lastCreatedDeckName?: string;
    /** Set once the lane has created the VS-AI game itself (issue #3492).
     *  Deliberately NOT `createdGame`: that flag is `ensureStressBoard`'s
     *  licence to load a debug scenario into the active match, and a vs-AI
     *  match is the one board it must never do that to — the bot is driving
     *  the other seat, so the position the probe measures would keep moving
     *  under it. Two flags, two permissions. */
    createdVsAiGame?: boolean;
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
 * fixture is therefore an expected state, and it reports UNWALKED carrying
 * `SEED_FIXTURES_COMMAND` — never a fallback walk of some other event, which
 * is precisely what used to make a PASS mean less than it read.
 *
 * `FIXTURE_LABEL_PREFIX` / `FIXTURE_OPEN_LABEL` / `FIXTURE_DRAFT_LABEL` are
 * imported at the top of this file from `convex/limitedFixtures.ts` — the
 * seeder owns the strings, this file only addresses them.
 */
const SEED_FIXTURES_COMMAND = `bunx convex run limitedFixtures:seedUiGateFixtures '{"email":"<TOLARIA_UI_EMAIL>"}'`;

/** The list, narrowed to the fixture rows by the `?label=` prefix filter
 *  (`src/router.tsx`). This is what makes the two list surfaces' row count a
 *  function of the LANE (two seeded events) instead of the deployment. */
const FIXTURE_LIST_PATH = `/limited?label=${FIXTURE_LABEL_PREFIX}`;

/** The row handle `limited-event-list-item.tsx` renders for a labelled event.
 *  `key={event._id}` is a React key, not an attribute — before this there was
 *  nothing in the DOM to select one specific event with. */
function fixtureRow(label: string): string {
    return `[data-limited-event-label="${label}"]`;
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
    const landed = await openFixtureEvent(page, ctx, FIXTURE_DRAFT_LABEL);
    if (landed === "event") {
        if (
            !(await clickIfVisible(
                page,
                "a:has-text('Enter the Draft Room')",
                4000
            ))
        ) {
            throw new Unreachable(
                `the "${FIXTURE_DRAFT_LABEL}" fixture's event page offered no "Enter the Draft Room" — its seat has no live pack. Re-seed it: ${SEED_FIXTURES_COMMAND}`
            );
        }
        await page
            .waitForURL(/\/draft$/, { timeout: NAV_TIMEOUT })
            .catch(() => {});
        await settle(page);
    }
    if (!page.url().endsWith("/draft")) {
        throw new Unreachable(
            `the "${FIXTURE_DRAFT_LABEL}" fixture did not land in the Draft Room — the page is at ${page.url()}`
        );
    }
    // The room renders for a Sealed seat too (reveal mode), so reaching the
    // URL is not enough: the surface these rows budget is the PICK screen, and
    // its tiles are the proof.
    if (!(await visible(page, DRAFT_PICK_TILE, 4000))) {
        throw new Unreachable(
            `the "${FIXTURE_DRAFT_LABEL}" fixture's Draft Room rendered no pack tile for this seat. Re-seed it: ${SEED_FIXTURES_COMMAND}`
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
    // that viewport and the `knownDebt` note has to say so.
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
    await page.waitForTimeout(400);
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
    await goto(page, ctx, FIXTURE_LIST_PATH);
    if (!(await visible(page, "main, [role=main]", 10_000))) {
        throw new Unreachable("/limited rendered no main region");
    }
    const rows = await page.locator("[data-limited-event-label]").count();
    if (rows === 0) {
        throw new Unreachable(
            `no seeded Limited fixture on this deployment — seed it with: ${SEED_FIXTURES_COMMAND}`
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
    if ((await row.count()) === 0) {
        throw new Unreachable(
            `the seeded Limited fixture "${label}" is not on this deployment — seed it with: ${SEED_FIXTURES_COMMAND}`
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
        //    `game-stress`, both below), which shares the context and so the
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
            await page.waitForTimeout(400);
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

/** The board with the FIXED stress position loaded (`stress-scenario.json`).
 *
 *  Two surfaces need it and both need it for the same reason `game-board`
 *  itself is declared unwalked in `budgets.json`: a dealt solo game lands on a
 *  position nobody chose, and two runs of the same tree gave different card
 *  counts. A ceiling over a position that flaps is worse than no ceiling. This
 *  is the one board a budget row can mean something about. */
async function ensureStressBoard(page: Page, ctx: WalkContext): Promise<void> {
    await ensureBoard(page, ctx);
    if (!ctx.createdGame) {
        throw new Unreachable(
            "an active game the lane did not create is in progress; loading a scenario would clobber it. Finish or concede it, then re-run"
        );
    }
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
const DEBUG_SHEET_TOGGLE = "[data-debug-sheet-toggle]";
const DEBUG_SHEET_TOGGLE_CLOSED =
    '[data-debug-sheet-toggle][aria-expanded="false"]';
const DEBUG_SHEET = "[data-debug-sheet]";
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
    await page.waitForTimeout(450);
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
    await page.waitForTimeout(450);
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
        await page.waitForTimeout(2000);
        await settle(page);
        if (!(await visible(page, BANNER_RESUME, 3000))) {
            trace.push(`pass${pass}: banner gone`);
            return true;
        }
        trace.push(`pass${pass}: banner still standing`);
    }
    return false;
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
        await page.waitForTimeout(600);
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
 * `game-stress` are budgeted against, from the tail of every viewport pass.
 * Those three rows are `unwalked` today and the collision is therefore
 * unreachable; it is reported rather than resolved so that re-enabling them
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
        if (await clickTransient(page, PREGAME_PLAY, 1200)) {
            await page.waitForTimeout(600);
            continue;
        }
        // The mulligan prompt is a draggable panel, not a dialog, so it never
        // blocks the toggle — but leaving it up leaves the board in a position
        // nobody chose, which is the flapping `game-board` was withdrawn for.
        if (await clickTransient(page, MULLIGAN_KEEP, 1200)) {
            await page.waitForTimeout(600);
            continue;
        }
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
        await page.waitForTimeout(500);
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
        id: "lobby-vs-ai",
        label: "vs-AI setup dialog (/ \u2192 Play vs Bot \u2192 primary)",
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
                await page.waitForTimeout(400);
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
            await page.waitForTimeout(400);
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
            await page.waitForTimeout(600);
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
            await page.waitForTimeout(400);
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
        // Issue #2822: the list is walked FILTERED to the seeded fixture
        // (`?label=ui-gate/`). Unfiltered, this row measured however many
        // events the deployment happened to hold — 14 at the time, each one
        // adding interactive controls to the `small` count and pushing
        // `<main>` past the starvation threshold — so the ceiling moved
        // without a line of `src/` changing.
        label: "Limited events list (/limited, fixture-filtered)",
        async walk(page, ctx) {
            await reachFixtureList(page, ctx);
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
            // The `label` param rides through the redirect (issue #2822, see
            // `limited-your-events.route.tsx`) — a redirect that dropped it
            // would land this surface back on the unbounded list, which is the
            // bug.
            await goto(
                page,
                ctx,
                `/limited/events?label=${FIXTURE_LABEL_PREFIX}`
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
                (await page.locator("[data-limited-event-label]").count()) === 0
            ) {
                throw new Unreachable(
                    `/limited/events redirected, but no seeded fixture row is on the list — either the redirect dropped ?label= or the fixture is missing. Seed it with: ${SEED_FIXTURES_COMMAND}`
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
            // The `ui-gate/open` fixture, specifically (issue #2822): seating
            // still open is the one event state whose detail page neither
            // redirects into the Draft Room (`useDraftRoomRedirect` needs a
            // pending pick) nor auto-opens the deck builder
            // (`useAutoOpenLimitedBuilder` needs a final pool). Both of those
            // are ONE-SHOT PER TAB, so a fixture that tripped either would
            // measure the antechamber at some viewports and a different screen
            // at others.
            if (
                (await openFixtureEvent(page, ctx, FIXTURE_OPEN_LABEL)) !==
                "event"
            ) {
                throw new Unreachable(
                    `the "${FIXTURE_OPEN_LABEL}" fixture did not land on its antechamber — it should still be OPEN (no pool, no pending pick). Re-seed it: ${SEED_FIXTURES_COMMAND}`
                );
            }
            if (!(await visible(page, "main, [role=main]", 10_000))) {
                throw new Unreachable(
                    "the Limited event antechamber rendered no main region"
                );
            }
        },
    },
    {
        id: "limited-build",
        // Issue #2822 lifted this out of `unwalked`. It used to need "an
        // event whose seat offers Build Deck", which no event on the
        // deployment had; the mid-draft fixture supplies one — the builder
        // route needs only a dealt, non-empty pool
        // (`pool-deck-builder.tsx`), which is exactly what
        // `ui-gate/draft`'s seat 0 carries.
        label: "Limited pool builder (/limited/<id>/build)",
        async walk(page, ctx) {
            // Reached by URL rather than by a click: mid-draft there is no
            // Build Deck control on the event page (it appears once the pool
            // is FINAL), and the id comes from the fixture's own row, so this
            // is still label-addressed.
            await openFixtureEvent(page, ctx, FIXTURE_DRAFT_LABEL);
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
                    `/limited/${eventId}/build rendered no card tile — the fixture seat's pool may be empty. Re-seed it: ${SEED_FIXTURES_COMMAND}`
                );
            }
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
            await reachDraftPoolStop(page, ctx);
        },
    },
    {
        id: "draft-pool-peek",
        label: "Draft Room, Pool Peek Panel open (/limited/<id>/draft, pool tile selected)",
        async walk(page, ctx) {
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
                await page.waitForTimeout(300);
                return;
            }

            // The menu opens on a delay so a double click can still cancel it
            // (`openDesktopPoolMenu`) — `visible()`'s own polling absorbs
            // that, no extra wait needed.
            if (
                !(await visible(page, DRAFT_POOL_MENU_MOVE_ITEM, STEP_TIMEOUT))
            ) {
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
            await page.waitForTimeout(300);
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
        label: "Card Preview overlay — Engine view (anchored pin)",
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
            await page.waitForTimeout(200);
        },
    },
    {
        id: "game-stress",
        label: "Game board — UI stress scenario",
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
        label: "Debug sheet — scenario list + save form",
        async walk(page, ctx) {
            await ensureStressBoard(page, ctx);

            // 1. The push (issue #3493). Closed first — `ensureStressBoard`
            //    leaves it that way — then open, on the SAME board.
            const closed = await boardAreaWidth(page);
            await openDebugSheet(page);
            await page.waitForTimeout(400);
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
            // The pinned head is the other half: scroll the form's port to the
            // bottom and the title/label/CTA must still be inside it.
            await page
                .locator(DEBUG_SHEET_BODY)
                .first()
                .evaluate((el) => {
                    el.scrollTop = el.scrollHeight;
                });
            await page.waitForTimeout(300);
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
        // Leave the board as the next viewport's walk expects to find it.
        async cleanup(page) {
            await closeDebugSheet(page);
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
        label: "Debug sheet — AI trace open (vs-AI game)",
        async walk(page, ctx) {
            await ensureVsAiBoard(page, ctx);
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
            // CLEAR THE RING BEFORE PROBING, and keep clearing until it stays
            // cleared. The ring is a live log of a live bot, so its ROW COUNT
            // is a function of how long the walk took and of who won the coin
            // toss — measured across two runs of the same tree it moved the
            // desktop reading from `ctrls n13 small12` to `ctrls n21 small19`.
            // That is the same "a ceiling that flaps is worse than no ceiling"
            // finding that withdrew `game-board` (`budgets.json`), and the fix
            // here is the same in spirit as `game-stress`'s fixed position: the
            // surface measures the sheet's SHAPE at five viewports, and the
            // content it happens to be holding is not part of that. Section
            // ORDER is asserted offline, where it is a DOM fact and not a race
            // (`ai-decision-trace-box.bot.test.tsx`).
            for (let pass = 0; pass < 4; pass++) {
                const clears = page.locator(
                    `${DEBUG_SHEET} button:text-is("Clear")`
                );
                if ((await clears.count()) === 0) break;
                // Front of the list every time: clearing one section unmounts
                // its own button, so a stale index would address a gone node.
                await clears
                    .first()
                    .click({ timeout: STEP_TIMEOUT })
                    .catch(() => {});
                await page.waitForTimeout(700);
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
