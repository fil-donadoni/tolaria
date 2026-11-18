// The Brain consult's timeout, derived from the search cap (issue #10115).
//
// Pure — no Worker, no channel — so `useVsAiDriver` derives `BOT_WATCHDOG_MS`
// from it without loading `brain-client`, which its tests stub whole.

import { HARDEST_SEARCH_TIME_MS } from "@convex/gre/difficulty";

/** How far past its wall-clock cap a search may legitimately run (issue
 *  #10115). The search reads the clock BETWEEN iterations, so the iteration in
 *  flight when the cap passes always completes. The field's worst consult
 *  overran its 3300 ms cap by 1358 ms (Gecko, late game, ~1 s per iteration:
 *  `docs/research/expert-think-longer.md` § 2, `brain-search-in-the-field.md`
 *  § 1); this margin covers it with headroom. */
export const BRAIN_CONSULT_OVERRUN_MARGIN_MS = 1500;

/** The Worker round-trip around the search (issue #10115): `postMessage` of
 *  the projected state and its reply, the state adapter, installing any shard
 *  the consult's state names that `primeBrain` had not sent yet. */
export const BRAIN_CONSULT_TRANSPORT_MARGIN_MS = 500;

/** How long a Worker consult may run before the client gives up on it and
 *  resolves the same "no move" answer `worker.onerror` already resolves.
 *
 *  Without it a Worker that never replies — a wedged search, a message lost
 *  across a tab suspend — left the driver's in-flight guard set forever, and an
 *  in-flight guard the driver cannot clear is a latch its watchdog cannot walk
 *  past (the watchdog will not interleave a rung into a live submission). The
 *  timeout turns "never replies" into the ordinary `move: null` outcome the
 *  escalation ladder already handles.
 *
 *  DERIVED, never a literal: the hardest preset's cap
 *  ({@link HARDEST_SEARCH_TIME_MS}) plus {@link BRAIN_CONSULT_OVERRUN_MARGIN_MS}
 *  plus {@link BRAIN_CONSULT_TRANSPORT_MARGIN_MS}. Raising a cap in
 *  `convex/gre/difficulty.ts` carries this timeout — and `BOT_WATCHDOG_MS`,
 *  derived from it — along, so a longer think can never turn into a failed
 *  consult. It stays BELOW `BOT_WATCHDOG_MS`, so a wedged consult settles in
 *  time for the watchdog's first deadline to escalate rather than to find a
 *  still-in-flight dispatch. `brain-client-timeout.bot.test.ts` asserts the
 *  chain against the real constants.
 *
 *  Those relations only bound the CONSULT. The Worker also makes its
 *  Manifest's card shards resident, from the page's HTTP cache, before it
 *  answers — and that is deliberately kept OUT of this budget by `warmBrain` and
 *  `primeBrain`, which `useVsAiDriver` calls ahead of the first consult.
 *  Without them the first consult on a cold cache would be a ~1.4 MB download
 *  inside the search's own budget. */
export const BRAIN_CONSULT_TIMEOUT_MS =
    HARDEST_SEARCH_TIME_MS +
    BRAIN_CONSULT_OVERRUN_MARGIN_MS +
    BRAIN_CONSULT_TRANSPORT_MARGIN_MS;
