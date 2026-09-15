/**
 * The Settled Screen (CONTEXT.md § Surfaces, ADR 0132, issue #3644): the state
 * a Walked Surface must reach before anything on it is measured.
 *
 * ONE PREDICATE REPLACES EVERY FIXED SLEEP. A fixed sleep is wrong in both
 * directions: on a loaded machine it measures early (a pack mid-animation reads
 * as zero-size tiles, a list whose query has not answered reads as an empty
 * screen), and on a quiet one it waits for nothing. The screen is settled when
 *
 *   - its ready marker is up — a `[data-surface-ready]` element the surface's
 *     own component renders once its data has arrived
 *     (`src/components/ui/surface-ready-marker.tsx`), so a settled layout over
 *     a list that has not loaded yet is never mistaken for a ready screen; and
 *   - for a quiet window of `quietMs`, no finite document animation runs, no
 *     Convex client request is in flight, and the bounding boxes (and scroll
 *     offsets) of the main region, any open dialog and the walk's own target
 *     elements have not changed.
 *
 * `networkidle` is not an option: Convex holds a websocket open, so it never
 * fires. What the lane counts instead is the sync protocol itself —
 * `NETWORK_INSTRUMENT_SOURCE` wraps the page's `WebSocket` before any app code
 * runs and tracks every `Mutation`/`Action` until its response, and every
 * `ModifyQuerySet` until a `Transition` reaches its version.
 *
 * INFINITE ANIMATIONS ARE IGNORED. A spinner, a pulsing priority ring or a
 * shimmer loops forever by design and never moves a measured box; counting it
 * would make those screens unmeasurable. A loading shimmer is what the ready
 * marker exists for.
 *
 * A screen that does not settle within `timeoutMs` throws an error whose message
 * starts with `UNSETTLED_MESSAGE_PREFIX` — an Infra Verdict with the signature
 * `unsettled` (`infra-verdict.ts`), never a reading.
 *
 * The page-side code is SOURCE TEXT, not closures: this file compiles under
 * `tsconfig.scripts.json`, which carries no `lib.dom` (the reason `probe.js`
 * is plain JS).
 */
import type { Page, Request } from "playwright";
import { UNSETTLED_MESSAGE_PREFIX } from "./infra-verdict.ts";

/** The attribute a surface's component renders once its data has arrived. */
export const SURFACE_READY_ATTRIBUTE = "data-surface-ready";

/** One look at the page. `boxes` is an opaque key: equal keys, unmoved boxes. */
export interface SettleSample {
    /** Milliseconds, on whatever clock the caller samples with. */
    at: number;
    ready: boolean;
    /** Running animations with a finite end. */
    animations: number;
    /** Backend requests in flight, plus a connecting socket or loading fonts. */
    inflight: number;
    /** What `inflight` is made of, for the reason an unsettled screen prints. */
    why?: string;
    boxes: string;
}

export interface SettlePolicy {
    /** How long every condition must hold, unbroken, to call it settled. */
    quietMs: number;
    /** How long to wait before the screen is an `unsettled` Infra Verdict. */
    timeoutMs: number;
    /** Delay between two samples. */
    pollMs: number;
}

export const DEFAULT_SETTLE_POLICY: SettlePolicy = {
    quietMs: 300,
    timeoutMs: 30_000,
    pollMs: 100,
};

export type SettleState =
    | { kind: "settled"; at: number }
    | { kind: "waiting" }
    | { kind: "unsettled"; reason: string };

function quiet(sample: SettleSample): boolean {
    return sample.ready && sample.animations === 0 && sample.inflight === 0;
}

/** What kept the last sample from being quiet, in words a reader can act on. */
export function settleBlockers(sample: SettleSample): string[] {
    const blockers: string[] = [];
    if (!sample.ready) {
        blockers.push(`no [${SURFACE_READY_ATTRIBUTE}] marker`);
    }
    if (sample.animations > 0) {
        blockers.push(`${sample.animations} animation(s) running`);
    }
    if (sample.inflight > 0) {
        blockers.push(
            `${sample.inflight} backend request(s) in flight${sample.why ? ` (${sample.why})` : ""}`
        );
    }
    return blockers;
}

/**
 * Pure: whether the samples so far show a settled screen. `samples` are in
 * sampling order; `startedAt` is when the wait began, on the samples' clock.
 *
 * Settled when the trailing run of quiet samples with the SAME box key as the
 * last one spans at least `quietMs`. Any break — a request, an animation, a
 * moved box, a marker that dropped — restarts the window.
 */
export function settleState(
    samples: readonly SettleSample[],
    startedAt: number,
    policy: Pick<SettlePolicy, "quietMs" | "timeoutMs">
): SettleState {
    const last = samples.at(-1);
    if (!last) return { kind: "waiting" };
    if (quiet(last)) {
        let first = samples.length - 1;
        while (
            first > 0 &&
            quiet(samples[first - 1]) &&
            samples[first - 1].boxes === last.boxes
        ) {
            first--;
        }
        if (last.at - samples[first].at >= policy.quietMs) {
            return { kind: "settled", at: last.at };
        }
    }
    if (last.at - startedAt >= policy.timeoutMs) {
        const blockers = settleBlockers(last);
        const moving =
            samples.length > 1 && samples.at(-2)!.boxes !== last.boxes;
        if (moving) blockers.push("a measured box kept moving");
        return {
            kind: "unsettled",
            reason:
                blockers.length > 0
                    ? blockers.join(", ")
                    : "never quiet for the full window",
        };
    }
    return { kind: "waiting" };
}

/**
 * Installed with `BrowserContext.addInitScript`, so it runs before any app code
 * on every document. Exposes `window.__tolariaNet.inflight()`.
 *
 * Tracks only the Convex sync socket (`…/api/<version>/sync`): Vite's HMR
 * socket carries no requests the screen waits on. A socket still CONNECTING
 * counts as one request in flight — nothing can answer until it opens. A
 * `Connect` (the reconnect handshake) resets the query-set versions, since the
 * client replays its whole query set from version 0. `TransitionChunk`s are
 * reassembled the way the client does before the version is read.
 *
 * A MUTATION IS NOT DONE AT ITS RESPONSE. The Convex client holds a successful
 * mutation as `Completed` until a `Transition` whose `endVersion.ts` reaches
 * the response's `ts` (`request_manager.ts` `removeCompleted`) — only then do
 * the subscribed queries show the write. So a successful `MutationResponse`
 * stores its `ts` and the request stays in flight until a Transition covers it
 * (or one already had). Timestamps are base64 little-endian u64s, decoded to
 * BigInt as the client's `u64ToLong` does. A failed mutation and an action are
 * done at their response.
 */
export const NETWORK_INSTRUMENT_SOURCE = `(() => {
    if (window.__tolariaNet) return;
    const sockets = new Set();
    let fetches = 0;
    Object.defineProperty(window, "__tolariaNet", {
        value: {
            inflight() {
                let n = fetches;
                for (const s of sockets) {
                    n += s.pending.size;
                    if (s.ws.readyState === 0) n++;
                    else if (s.ws.readyState === 1 && s.answered < s.requested) n++;
                }
                return n;
            },
            detail() {
                let requests = 0, awaitingTransition = 0, querySets = 0, connecting = 0;
                for (const s of sockets) {
                    for (const due of s.pending.values()) {
                        if (due === null) requests++;
                        else awaitingTransition++;
                    }
                    if (s.ws.readyState === 0) connecting++;
                    else if (s.ws.readyState === 1 && s.answered < s.requested) querySets++;
                }
                return requests + " convex request(s), " + awaitingTransition + " awaiting a transition, " +
                    querySets + " query set(s), " + connecting + " connecting, " + fetches + " fetch";
            },
        },
    });
    const parse = (data) => {
        if (typeof data !== "string") return null;
        try { return JSON.parse(data); } catch { return null; }
    };
    const u64 = (encoded) => {
        const bytes = atob(encoded);
        let v = BigInt(0);
        for (let i = bytes.length - 1; i >= 0; i--) {
            v = (v << BigInt(8)) | BigInt(bytes.charCodeAt(i));
        }
        return v;
    };
    const NativeWebSocket = window.WebSocket;
    if (NativeWebSocket) {
        const Instrumented = function (url, protocols) {
            const ws = protocols === undefined
                ? new NativeWebSocket(url)
                : new NativeWebSocket(url, protocols);
            if (!/\\/api\\/[^/]+\\/sync$/.test(String(url))) return ws;
            // pending: requestId -> null (no response yet) or the ts a
            // Transition must reach.
            const s = { ws, requested: 0, answered: 0, chunks: [], observed: BigInt(-1), pending: new Map() };
            sockets.add(s);
            const send = ws.send.bind(ws);
            ws.send = (data) => {
                const m = parse(data);
                if (m && (m.type === "Mutation" || m.type === "Action")) {
                    s.pending.set(m.requestId, null);
                } else if (m && m.type === "ModifyQuerySet") {
                    s.requested = m.newVersion;
                } else if (m && m.type === "Connect") {
                    s.requested = 0;
                    s.answered = 0;
                }
                return send(data);
            };
            ws.addEventListener("message", (event) => {
                let m = parse(event.data);
                if (!m) return;
                if (m.type === "TransitionChunk") {
                    if (m.partNumber === 0) s.chunks = [];
                    s.chunks.push(m.chunk);
                    if (s.chunks.length < m.totalParts) return;
                    m = parse(s.chunks.join(""));
                    s.chunks = [];
                    if (!m) return;
                }
                if (m.type === "MutationResponse" && m.success && typeof m.ts === "string") {
                    const ts = u64(m.ts);
                    if (ts <= s.observed) s.pending.delete(m.requestId);
                    else s.pending.set(m.requestId, ts);
                } else if (m.type === "MutationResponse" || m.type === "ActionResponse") {
                    s.pending.delete(m.requestId);
                } else if (m.type === "Transition" && m.endVersion) {
                    s.answered = m.endVersion.querySet;
                    if (typeof m.endVersion.ts === "string") {
                        const ts = u64(m.endVersion.ts);
                        if (ts > s.observed) s.observed = ts;
                        for (const [requestId, due] of [...s.pending]) {
                            if (due !== null && due <= s.observed) s.pending.delete(requestId);
                        }
                    }
                }
            });
            ws.addEventListener("close", () => {
                sockets.delete(s);
            });
            return ws;
        };
        Instrumented.prototype = NativeWebSocket.prototype;
        for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) {
            Instrumented[k] = NativeWebSocket[k];
        }
        window.WebSocket = Instrumented;
    }
    const nativeFetch = window.fetch;
    if (nativeFetch) {
        window.fetch = function (...args) {
            fetches++;
            let settled = false;
            const done = () => { if (!settled) { settled = true; fetches--; } };
            try {
                const p = nativeFetch.apply(this, args);
                p.then(done, done);
                return p;
            } catch (err) {
                done();
                throw err;
            }
        };
    }
})();`;

/** The page-side sampler for `targets` (CSS selectors, beside the main region
 *  and any open dialog). Evaluates to a sample without `at`. */
export function sampleSource(targets: readonly string[]): string {
    return `((targets) => {
        const ready = document.querySelector("[${SURFACE_READY_ATTRIBUTE}]") !== null;
        let animations = 0;
        for (const a of document.getAnimations()) {
            if (a.playState !== "running") continue;
            const timing = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
            if (timing && timing.endTime === Infinity) continue;
            animations++;
        }
        const net = window.__tolariaNet;
        const fonts = document.fonts && document.fonts.status === "loading" ? 1 : 0;
        const inflight = (net ? net.inflight() : 0) + fonts;
        const why = (net ? net.detail() : "no instrument") + ", " + fonts + " font load";
        // The URL first: a client-side navigation still resolving is a
        // screen still moving, even before any box has changed.
        const parts = [location.href, Math.round(window.scrollX), Math.round(window.scrollY)];
        for (const selector of ["main", "[role=dialog]", ...targets]) {
            const els = document.querySelectorAll(selector);
            parts.push(selector + "#" + els.length);
            for (let i = 0; i < Math.min(els.length, 25); i++) {
                const r = els[i].getBoundingClientRect();
                parts.push(
                    Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height),
                    Math.round(els[i].scrollLeft), Math.round(els[i].scrollTop)
                );
            }
        }
        return { ready, animations, inflight, why, boxes: parts.join(",") };
    })(${JSON.stringify(targets)})`;
}

export interface SettleOptions {
    targets?: readonly string[];
    policy?: SettlePolicy;
}

/** HTTP requests in flight per page, counted from the Node side. */
const REQUEST_TRACKERS = new WeakMap<Page, () => number>();

/** The resource types a screen waits on. `eventsource`, `websocket`,
 *  `manifest`, `ping` and `other` are long-lived or fire-and-forget. */
const SETTLE_RESOURCE_TYPES = new Set([
    "document",
    "stylesheet",
    "image",
    "media",
    "font",
    "script",
    "fetch",
    "xhr",
]);

/**
 * A request open longer than this no longer holds the screen. Not every
 * request Playwright reports `request` for reports `requestfinished` or
 * `requestfailed` — measured on this branch: 14 phantom requests leaked early
 * in a run and held every later surface unsettled across full navigations.
 * A bound keeps one such request from making every screen unmeasurable.
 */
const REQUEST_STALE_MS = 15_000;

/**
 * Count the page's HTTP requests in flight from the Node side, so the settle
 * wait sees what `window.fetch` cannot: card images, module imports,
 * stylesheets (issue #3644 review — card art still loading is the known
 * `cardsZero` false red). Main frame only. Idempotent per page.
 */
export function trackPageRequests(page: Page): void {
    if (REQUEST_TRACKERS.has(page)) return;
    const open = new Map<Request, number>();
    REQUEST_TRACKERS.set(page, () => {
        const now = Date.now();
        let n = 0;
        for (const [request, startedAt] of open) {
            if (now - startedAt > REQUEST_STALE_MS) open.delete(request);
            else n++;
        }
        return n;
    });
    page.on("request", (request) => {
        if (!SETTLE_RESOURCE_TYPES.has(request.resourceType())) return;
        try {
            if (request.frame() !== page.mainFrame()) return;
        } catch {
            return; // a service-worker request has no frame
        }
        open.set(request, Date.now());
    });
    const done = (request: Request) => {
        open.delete(request);
    };
    page.on("requestfinished", done);
    page.on("requestfailed", done);
}

/**
 * Wait for a Settled Screen, or throw the `unsettled` Infra Verdict.
 * Returns the milliseconds it took.
 */
export async function waitForSettledScreen(
    page: Page,
    options: SettleOptions = {}
): Promise<number> {
    const policy = options.policy ?? DEFAULT_SETTLE_POLICY;
    const source = sampleSource(options.targets ?? []);
    const httpInflight = REQUEST_TRACKERS.get(page);
    const startedAt = Date.now();
    const samples: SettleSample[] = [];
    for (;;) {
        const raw = (await page.evaluate(source)) as Omit<SettleSample, "at">;
        const http = httpInflight?.() ?? 0;
        samples.push({
            ...raw,
            inflight: raw.inflight + http,
            why: `${raw.why ?? "no instrument"}, ${http} http`,
            at: Date.now(),
        });
        // Only the trailing quiet run is ever read; keep the window bounded.
        if (samples.length > 400) samples.splice(0, samples.length - 400);
        const state = settleState(samples, startedAt, policy);
        if (state.kind === "settled") return state.at - startedAt;
        if (state.kind === "unsettled") {
            // The URL: a screen with no marker is often not the screen the
            // walk meant to be on (an admin gate rendering nothing, a
            // redirect), and the path is what says so.
            let where = "?";
            try {
                where = new URL(page.url()).pathname;
            } catch {
                // an unparsable URL keeps "?"
            }
            throw new Error(
                `${UNSETTLED_MESSAGE_PREFIX} within ${Math.round(policy.timeoutMs / 1000)}s on ${where} — ${state.reason}`
            );
        }
        await new Promise((resolve) => setTimeout(resolve, policy.pollMs));
    }
}
