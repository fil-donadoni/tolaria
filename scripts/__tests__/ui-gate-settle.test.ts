// The Settled Screen (issue #3644, CONTEXT.md § Surfaces): the pure predicate
// over sampled snapshots, the network instrument that feeds it (run as the
// real source text against a fake socket), and the rule that no fixed sleep is
// left in the surfaces module. The same predicate is checked in a real
// Chromium by `scripts/ui-gate/settle-selfcheck.ts`, which `check:ui` runs
// before it walks anything.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
    NETWORK_INSTRUMENT_SOURCE,
    settleState,
    type SettleSample,
} from "../ui-gate/settle";

const POLICY = { quietMs: 300, timeoutMs: 2_000 };

function sample(at: number, over: Partial<SettleSample> = {}): SettleSample {
    return {
        at,
        ready: true,
        animations: 0,
        inflight: 0,
        boxes: "a",
        ...over,
    };
}

describe("settleState — pure over sampled snapshots", () => {
    it("is waiting before any sample", () => {
        expect(settleState([], 0, POLICY)).toEqual({ kind: "waiting" });
    });

    it("settles only once a quiet run spans the full window", () => {
        const quiet = [sample(0), sample(100), sample(200)];
        expect(settleState(quiet, 0, POLICY)).toEqual({ kind: "waiting" });
        expect(settleState([...quiet, sample(300)], 0, POLICY)).toEqual({
            kind: "settled",
            at: 300,
        });
    });

    it("never settles without the ready marker, and times out naming it", () => {
        const noMarker = [0, 500, 1000, 1500, 2000].map((t) =>
            sample(t, { ready: false })
        );
        expect(settleState(noMarker.slice(0, 4), 0, POLICY)).toEqual({
            kind: "waiting",
        });
        expect(settleState(noMarker, 0, POLICY)).toEqual({
            kind: "unsettled",
            reason: "no [data-surface-ready] marker",
        });
    });

    it("a delayed marker restarts the window from the sample it appeared in", () => {
        const samples = [
            sample(0, { ready: false }),
            sample(400, { ready: false }),
            sample(500),
            sample(700),
        ];
        expect(settleState(samples, 0, POLICY)).toEqual({ kind: "waiting" });
        expect(settleState([...samples, sample(800)], 0, POLICY)).toEqual({
            kind: "settled",
            at: 800,
        });
    });

    it("a running animation holds it back until the animation ends", () => {
        const samples = [
            sample(0, { animations: 1 }),
            sample(300, { animations: 1 }),
            sample(600, { animations: 1 }),
            sample(700),
            sample(900),
        ];
        expect(settleState(samples, 0, POLICY)).toEqual({ kind: "waiting" });
        expect(settleState([...samples, sample(1000)], 0, POLICY)).toEqual({
            kind: "settled",
            at: 1000,
        });
    });

    it("a request in flight holds it back", () => {
        const samples = [
            sample(0, { inflight: 2 }),
            sample(400, { inflight: 1 }),
        ];
        expect(settleState(samples, 0, POLICY)).toEqual({ kind: "waiting" });
    });

    it("a moved box restarts the window even when every other condition held", () => {
        const samples = [sample(0), sample(200), sample(250, { boxes: "b" })];
        expect(
            settleState([...samples, sample(500, { boxes: "b" })], 0, POLICY)
        ).toEqual({
            kind: "waiting",
        });
        expect(
            settleState([...samples, sample(550, { boxes: "b" })], 0, POLICY)
        ).toEqual({
            kind: "settled",
            at: 550,
        });
    });

    it("an unsettled verdict names every blocker, and a box that kept moving", () => {
        const samples = [
            sample(1900, { animations: 2, inflight: 1, boxes: "a" }),
            sample(2000, { animations: 2, inflight: 1, boxes: "b" }),
        ];
        expect(settleState(samples, 0, POLICY)).toEqual({
            kind: "unsettled",
            reason: "2 animation(s) running, 1 backend request(s) in flight, a measured box kept moving",
        });
    });
});

/** Just enough of a WebSocket for the instrument: it wraps `send` and listens
 *  for `message`/`close`. */
class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = 1;
    sent: string[] = [];
    private listeners: Record<string, ((event: unknown) => void)[]> = {};
    constructor(public url: string) {}
    send(data: string): void {
        this.sent.push(data);
    }
    addEventListener(type: string, fn: (event: unknown) => void): void {
        (this.listeners[type] ??= []).push(fn);
    }
    serverSends(message: object): void {
        for (const fn of this.listeners.message ?? []) {
            fn({ data: JSON.stringify(message) });
        }
    }
    close(): void {
        this.readyState = 3;
        for (const fn of this.listeners.close ?? []) fn({});
    }
}

interface InstrumentedWindow {
    WebSocket: new (url: string) => FakeWebSocket;
    fetch: (...args: unknown[]) => Promise<unknown>;
    __tolariaNet: { inflight(): number };
}

function instrumentedWindow(
    fetchImpl: () => Promise<unknown>
): InstrumentedWindow {
    const win: Record<string, unknown> = {
        WebSocket: FakeWebSocket,
        fetch: fetchImpl,
        atob,
    };
    win.window = win;
    createContext(win);
    runInContext(NETWORK_INSTRUMENT_SOURCE, win);
    return win as unknown as InstrumentedWindow;
}

const SYNC_URL = "ws://127.0.0.1:3210/api/1.31.2/sync";

/** A Convex timestamp on the wire: a base64 little-endian u64. Values past
 *  2^53 so a Number-based decode would lose them. */
function wireTs(value: bigint): string {
    return Buffer.from(BigUint64Array.of(value).buffer).toString("base64");
}
const T1 = (BigInt(1) << BigInt(60)) + BigInt(1);
const T2 = T1 + BigInt(1);

describe("NETWORK_INSTRUMENT_SOURCE — Convex requests in flight", () => {
    it("an action and a failed mutation are done at their response", () => {
        const win = instrumentedWindow(() => Promise.resolve());
        const ws = new win.WebSocket(SYNC_URL);
        ws.send(JSON.stringify({ type: "Mutation", requestId: 0 }));
        ws.send(JSON.stringify({ type: "Action", requestId: 1 }));
        expect(win.__tolariaNet.inflight()).toBe(2);
        ws.serverSends({
            type: "MutationResponse",
            requestId: 0,
            success: false,
            result: "boom",
        });
        expect(win.__tolariaNet.inflight()).toBe(1);
        ws.serverSends({ type: "ActionResponse", requestId: 1, success: true });
        expect(win.__tolariaNet.inflight()).toBe(0);
        // The frames still reach the real socket.
        expect(ws.sent).toHaveLength(2);
    });

    it("a successful mutation stays in flight until a Transition reaches its ts — the client shows the write only then", () => {
        const win = instrumentedWindow(() => Promise.resolve());
        const ws = new win.WebSocket(SYNC_URL);
        ws.send(JSON.stringify({ type: "Mutation", requestId: 0 }));
        ws.serverSends({
            type: "MutationResponse",
            requestId: 0,
            success: true,
            ts: wireTs(T2),
        });
        expect(win.__tolariaNet.inflight()).toBe(1);
        ws.serverSends({
            type: "Transition",
            endVersion: { querySet: 0, ts: wireTs(T1) },
        });
        expect(win.__tolariaNet.inflight()).toBe(1);
        ws.serverSends({
            type: "Transition",
            endVersion: { querySet: 0, ts: wireTs(T2) },
        });
        expect(win.__tolariaNet.inflight()).toBe(0);
    });

    it("a successful mutation whose ts a Transition already reached is done at its response", () => {
        const win = instrumentedWindow(() => Promise.resolve());
        const ws = new win.WebSocket(SYNC_URL);
        ws.send(JSON.stringify({ type: "Mutation", requestId: 3 }));
        ws.serverSends({
            type: "Transition",
            endVersion: { querySet: 0, ts: wireTs(T2) },
        });
        ws.serverSends({
            type: "MutationResponse",
            requestId: 3,
            success: true,
            ts: wireTs(T1),
        });
        expect(win.__tolariaNet.inflight()).toBe(0);
    });

    it("counts a query-set change until a Transition reaches its version", () => {
        const win = instrumentedWindow(() => Promise.resolve());
        const ws = new win.WebSocket(SYNC_URL);
        ws.send(
            JSON.stringify({
                type: "ModifyQuerySet",
                baseVersion: 0,
                newVersion: 2,
            })
        );
        expect(win.__tolariaNet.inflight()).toBe(1);
        ws.serverSends({ type: "Transition", endVersion: { querySet: 1 } });
        expect(win.__tolariaNet.inflight()).toBe(1);
        ws.serverSends({ type: "Transition", endVersion: { querySet: 2 } });
        expect(win.__tolariaNet.inflight()).toBe(0);
    });

    it("reassembles a chunked Transition before reading its version", () => {
        const win = instrumentedWindow(() => Promise.resolve());
        const ws = new win.WebSocket(SYNC_URL);
        ws.send(
            JSON.stringify({
                type: "ModifyQuerySet",
                baseVersion: 0,
                newVersion: 1,
            })
        );
        const full = JSON.stringify({
            type: "Transition",
            endVersion: { querySet: 1 },
        });
        const cut = Math.floor(full.length / 2);
        ws.serverSends({
            type: "TransitionChunk",
            partNumber: 0,
            totalParts: 2,
            transitionId: "t",
            chunk: full.slice(0, cut),
        });
        expect(win.__tolariaNet.inflight()).toBe(1);
        ws.serverSends({
            type: "TransitionChunk",
            partNumber: 1,
            totalParts: 2,
            transitionId: "t",
            chunk: full.slice(cut),
        });
        expect(win.__tolariaNet.inflight()).toBe(0);
    });

    it("a reconnect handshake resets the versions, and a closed socket drops its requests", () => {
        const win = instrumentedWindow(() => Promise.resolve());
        const ws = new win.WebSocket(SYNC_URL);
        ws.send(
            JSON.stringify({
                type: "ModifyQuerySet",
                baseVersion: 0,
                newVersion: 5,
            })
        );
        ws.serverSends({ type: "Transition", endVersion: { querySet: 5 } });
        ws.send(JSON.stringify({ type: "Connect" }));
        ws.send(
            JSON.stringify({
                type: "ModifyQuerySet",
                baseVersion: 0,
                newVersion: 1,
            })
        );
        expect(win.__tolariaNet.inflight()).toBe(1);
        ws.send(JSON.stringify({ type: "Mutation", requestId: 7 }));
        ws.close();
        expect(win.__tolariaNet.inflight()).toBe(0);
    });

    it("a sync socket still connecting counts as in flight", () => {
        const win = instrumentedWindow(() => Promise.resolve());
        const ws = new win.WebSocket(SYNC_URL);
        ws.readyState = 0;
        expect(win.__tolariaNet.inflight()).toBe(1);
    });

    it("ignores every socket that is not the Convex sync socket", () => {
        const win = instrumentedWindow(() => Promise.resolve());
        const hmr = new win.WebSocket("ws://127.0.0.1:5173/?token=abc");
        hmr.send(JSON.stringify({ type: "Mutation", requestId: 0 }));
        hmr.readyState = 0;
        expect(win.__tolariaNet.inflight()).toBe(0);
    });

    it("counts a fetch until it settles", async () => {
        let resolveFetch: () => void = () => {};
        const win = instrumentedWindow(
            () => new Promise<void>((resolve) => (resolveFetch = resolve))
        );
        const pending = win.fetch("/catalogue.json.gz");
        expect(win.__tolariaNet.inflight()).toBe(1);
        resolveFetch();
        await pending;
        await Promise.resolve();
        expect(win.__tolariaNet.inflight()).toBe(0);
    });
});

describe("the surfaces module waits on the Settled Screen, never on a clock", () => {
    it("has no fixed sleep left in its code", () => {
        const source = readFileSync(
            path.join(__dirname, "../ui-gate/surfaces.ts"),
            "utf8"
        );
        // Comments may name the retired idiom; code may not.
        const code = source
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/(^|[^:])\/\/.*$/gm, "$1");
        const sleeps = code
            .split("\n")
            .filter((line) => /\bwaitForTimeout\s*\(/.test(line));
        expect(sleeps, "surfaces.ts sleeps instead of settling").toEqual([]);
    });
});
