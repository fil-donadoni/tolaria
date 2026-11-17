// Leak detector for the `dom-shared` project (issue #10106), which runs
// happy-dom with `isolate: false`: one module registry — and one `document`,
// one `globalThis`, one `process.env` — per worker, shared by every file the
// worker runs.
//
// The classifier (`scripts/test-env-split.ts`) keeps out every file that
// carries a spy, a mock or fake timers; it cannot see a file that writes to
// the shared document or the global scope and forgets to take it down. A
// dropped restore is green in the leaking file and wrong in whichever file the
// scheduler runs next — an order-dependent red far from its cause. So after
// every file each piece of shared state is asserted back at its default, and
// the detector puts the default back before throwing, so the red stays with
// the file that caused it instead of cascading into its neighbours.
//
// The state, and its default:
//   - `document.body`        → no children, no attributes beyond the start's
//   - `document.head`        → the nodes it had when the file started
//   - listeners on `window` / `document` → none added and left registered
//   - `setInterval` timers   → none left running
//   - new own keys on `globalThis` → none
//   - `process.env`          → what it was when the file started
//
// This setup runs before every file (after `vitest.setup.ts`), so the
// snapshots are per file. RTL's `cleanup` runs in `vitest.setup.ts`'s
// `afterEach`, before this `afterAll`, so a clean file has an empty body here.
import { afterAll, beforeAll } from "vitest";
import { scrubGitRepoEnv } from "./scripts/lib/git-repo-env";

scrubGitRepoEnv();

type Listener = EventListenerOrEventListenerObject;
interface Registration {
    target: EventTarget;
    type: string;
    listener: Listener;
    capture: boolean;
}

const captureOf = (options?: boolean | AddEventListenerOptions): boolean =>
    typeof options === "boolean" ? options : (options?.capture ?? false);

const registered: Registration[] = [];

/** Wraps `add/removeEventListener` on `target`, recording what stays added. */
function trackListeners(target: EventTarget): () => void {
    const add = target.addEventListener;
    const remove = target.removeEventListener;
    target.addEventListener = function (
        this: EventTarget,
        type: string,
        listener: Listener | null,
        options?: boolean | AddEventListenerOptions
    ) {
        if (listener) {
            const capture = captureOf(options);
            const once = typeof options === "object" && options?.once === true;
            if (
                !once &&
                !registered.some(
                    (r) =>
                        r.target === target &&
                        r.type === type &&
                        r.listener === listener &&
                        r.capture === capture
                )
            )
                registered.push({ target, type, listener, capture });
        }
        return add.call(this, type, listener, options);
    } as typeof target.addEventListener;
    target.removeEventListener = function (
        this: EventTarget,
        type: string,
        listener: Listener | null,
        options?: boolean | EventListenerOptions
    ) {
        const capture = captureOf(options);
        const at = registered.findIndex(
            (r) =>
                r.target === target &&
                r.type === type &&
                r.listener === listener &&
                r.capture === capture
        );
        if (at >= 0) registered.splice(at, 1);
        return remove.call(this, type, listener, options);
    } as typeof target.removeEventListener;
    return () => {
        target.addEventListener = add;
        target.removeEventListener = remove;
    };
}

// The listeners `vitest.setup.ts` itself installed are the file's baseline,
// not a leak: the tracker starts after them.
const untrackWindow = trackListeners(window);
const untrackDocument = trackListeners(document);

const intervals = new Set<unknown>();
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    const id = realSetInterval(...args);
    intervals.add(id);
    return id;
}) as typeof setInterval;
globalThis.clearInterval = ((id?: Parameters<typeof clearInterval>[0]) => {
    intervals.delete(id);
    return realClearInterval(id);
}) as typeof clearInterval;

// Installed by a LIBRARY the first time it loads or renders, once per worker,
// never by a test: React DOM listens for `selectionchange` on the document the
// first time any root mounts and never lets go; testing-library flips the act
// flag at import; framer-motion and radix mark the global scope; tslib spreads
// its `__*` helpers. Taking them down would only make the next file pay to
// install them again. Anything NOT named here is a leak.
const LIBRARY_GLOBALS = new Set<string | symbol>([
    "IS_REACT_ACT_ENVIRONMENT",
    "MotionIsMounted",
    "__SENTRY__",
    Symbol.for("radix-ui"),
]);
const isLibraryGlobal = (k: string | symbol): boolean =>
    LIBRARY_GLOBALS.has(k) ||
    (typeof k === "symbol" && k.description === "radix-ui") ||
    (typeof k === "string" && /^__[a-zA-Z]+$/.test(k));
// Listeners a library parks on the global scope for the worker's life (dnd-kit
// sensors on `touchmove`, the router on `popstate`/`beforeunload`/`pagehide`,
// floating-ui on `resize`/`scroll`). Input listeners (`click`, `key*`,
// `pointer*`, `mouse*`, `focus*`, …) are NOT here: a test's own handler on
// those is the leak that changes the next file's behaviour.
const LIBRARY_LISTENERS = new Set([
    "document.selectionchange",
    "document.scroll",
    "window.touchmove",
    "window.resize",
    "window.popstate",
    "window.beforeunload",
    "window.pagehide",
]);

// Module imports run before `beforeAll`, so a global a file's imports install
// is part of the baseline; only what the TESTS add is a leak.
let globalKeysAtStart = new Set(Reflect.ownKeys(globalThis));
beforeAll(() => {
    globalKeysAtStart = new Set(Reflect.ownKeys(globalThis));
});
const headAtStart = new Set<Node>(Array.from(document.head.childNodes));
const bodyAttrsAtStart = Object.fromEntries(
    Array.from(document.body.attributes).map((a) => [a.name, a.value])
);
const envAtStart = { ...process.env };

/** The keys whose value differs between two env snapshots, each named once. */
function envDrift(
    before: Record<string, string | undefined>,
    after: Record<string, string | undefined>
): string[] {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].filter((k) => before[k] !== after[k]).sort();
}

afterAll(() => {
    const leaks: string[] = [];

    if (document.body.childNodes.length > 0) {
        leaks.push(
            `document.body still holds ${document.body.childNodes.length} ` +
                `node(s) after cleanup — unmount or remove them`
        );
        document.body.replaceChildren();
    }
    const bodyAttrs = Object.fromEntries(
        Array.from(document.body.attributes).map((a) => [a.name, a.value])
    );
    if (JSON.stringify(bodyAttrs) !== JSON.stringify(bodyAttrsAtStart)) {
        leaks.push(
            `document.body attributes changed and were not restored (${JSON.stringify(bodyAttrs)} vs ${JSON.stringify(bodyAttrsAtStart)})`
        );
        for (const a of Array.from(document.body.attributes))
            document.body.removeAttribute(a.name);
        for (const [k, v] of Object.entries(bodyAttrsAtStart))
            document.body.setAttribute(k, v);
    }
    const strayHead = Array.from(document.head.childNodes).filter(
        (n) => !headAtStart.has(n)
    );
    if (strayHead.length > 0) {
        leaks.push(
            `document.head gained ${strayHead.length} node(s) and kept them: ${strayHead
                .map((n) => (n as Element).outerHTML ?? n.nodeName)
                .join(" ")
                .slice(0, 120)}`
        );
        for (const n of strayHead) n.parentNode?.removeChild(n);
    }

    const nameOf = (r: Registration): string =>
        `${r.target === window ? "window" : "document"}.${r.type}`;
    const ownListeners = registered.filter(
        (r) => !LIBRARY_LISTENERS.has(nameOf(r))
    );
    if (ownListeners.length > 0) {
        const named = ownListeners.map(nameOf).sort();
        leaks.push(
            `listener(s) still registered: ${[...new Set(named)].join(", ")} — ` +
                `removeEventListener in the cleanup`
        );
        for (const r of ownListeners)
            r.target.removeEventListener(r.type, r.listener, r.capture);
    }
    if (intervals.size > 0) {
        leaks.push(
            `${intervals.size} setInterval timer(s) still running — clearInterval it`
        );
        for (const id of intervals) realClearInterval(id as never);
        intervals.clear();
    }

    const stray = Reflect.ownKeys(globalThis).filter(
        (k) => !globalKeysAtStart.has(k) && !isLibraryGlobal(k)
    );
    if (stray.length > 0) {
        leaks.push(
            `new globals on globalThis: ${stray.map(String).join(", ")}`
        );
        for (const k of stray) Reflect.deleteProperty(globalThis, k);
    }
    const drift = envDrift(envAtStart, process.env);
    if (drift.length > 0) {
        leaks.push(`process.env changed: ${drift.join(", ")}`);
        for (const key of Object.keys(process.env)) {
            if (!(key in envAtStart)) delete process.env[key];
        }
        Object.assign(process.env, envAtStart);
    }

    untrackWindow();
    untrackDocument();
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;

    if (leaks.length > 0) {
        throw new Error(
            `This file left shared state behind in a dom-shared worker ` +
                `(isolate: false) — the next file the worker runs would ` +
                `inherit it. Restore it where it was set:\n  - ` +
                leaks.join("\n  - ")
        );
    }
});
