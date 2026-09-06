import { describe, it, expect, vi } from "vitest";
import type { BrainRequest, BrainResponse } from "../brain-request";

/**
 * The Worker's hydration order (issue #3053, ADR 0113 §3).
 *
 * A Worker gets its own module graph, so the Brain has its OWN registry and
 * its own copy of the catalogue fetch — and `handleBrainRequest` reads
 * `getDefinition`/`tryGetDefinition` synchronously. Answering before the
 * artifact has landed is not a slow start: it is a bot deciding against a
 * half-empty registry, which `.claude/rules/bot-development.md` treats as
 * unshipped, and a search that then finds no legal move is
 * indistinguishable from a bot that chose to pass (issue #2450).
 *
 * `brain.worker.ts` is a Worker ENTRY POINT — importing it assigns
 * `self.onmessage` as a side effect — so the shell is exercised the only way
 * it can be: import it, then drive `self.onmessage` directly and read what it
 * posts. That side effect is exactly the behaviour under test here, unlike
 * the search itself, which lives in `brain-request.ts` and is tested there.
 */

let resolveHydration: (rows: number) => void;
let rejectHydration: (cause: unknown) => void;
const hydrateCatalogue = vi.fn(
    () =>
        new Promise<number>((resolve, reject) => {
            resolveHydration = resolve;
            rejectHydration = reject;
        })
);
const handleBrainRequest = vi.fn(
    (request: BrainRequest): BrainResponse => ({
        id: request.id,
        move: null,
        trace: null,
    })
);

vi.mock("../../catalogueArtifact", () => ({ hydrateCatalogue }));
vi.mock("../brain-request", () => ({ handleBrainRequest }));

const posted: BrainResponse[] = [];
vi.stubGlobal("postMessage", (response: BrainResponse) =>
    posted.push(response)
);
vi.stubGlobal("console", { ...console, error: vi.fn(), log: vi.fn() });

/** A FRESH worker shell. The module's hydration promise is created once, at
 *  module load, so a test that needs it to REJECT cannot run after one that
 *  resolved it — each case loads its own copy. */
async function loadWorker(): Promise<void> {
    vi.resetModules();
    posted.length = 0;
    hydrateCatalogue.mockClear();
    handleBrainRequest.mockClear();
    await import("../brain.worker");
}

const request = (id: number) =>
    ({ id, state: {}, botId: "bot" }) as unknown as BrainRequest;

function send(id: number): void {
    (self.onmessage as (e: MessageEvent<BrainRequest>) => void)({
        data: request(id),
    } as MessageEvent<BrainRequest>);
}

/** Let the microtask chain the shell builds drain. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("the Brain's Worker shell", () => {
    it("starts the catalogue fetch at module load, before any request", async () => {
        await loadWorker();
        expect(hydrateCatalogue).toHaveBeenCalledTimes(1);
    });

    it("answers nothing until the registry is hydrated, then answers in order", async () => {
        await loadWorker();
        send(1);
        send(2);
        await settle();

        expect(handleBrainRequest).not.toHaveBeenCalled();
        expect(posted).toEqual([]);

        resolveHydration(2278);
        await settle();

        expect(posted.map((r) => r.id)).toEqual([1, 2]);
    });

    it("answers a hydration FAILURE with a named error, and re-arms the fetch", async () => {
        await loadWorker();
        send(3);
        rejectHydration(new Error("HTTP 503"));
        await settle();

        expect(handleBrainRequest).not.toHaveBeenCalled();
        expect(posted).toEqual([
            {
                id: 3,
                move: null,
                trace: null,
                error: { name: "Error", message: "HTTP 503" },
            },
        ]);
        // Re-armed: the next request awaits a NEW fetch rather than
        // inheriting a permanently rejected promise (a bot frozen for the
        // rest of the game).
        expect(hydrateCatalogue).toHaveBeenCalledTimes(2);

        posted.length = 0;
        send(4);
        await settle();
        expect(posted).toEqual([]);

        resolveHydration(2278);
        await settle();
        expect(posted.map((r) => r.id)).toEqual([4]);
    });
});
