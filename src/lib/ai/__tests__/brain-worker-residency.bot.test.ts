import { describe, it, expect, vi } from "vitest";
import type { BrainRequest, BrainResponse } from "../brain-request";
import type { BrainWorkerMessage } from "../brain-residency";

/**
 * The Worker's residency order (issue #3053, ADR 0113 §3; per-game since
 * issue #5617, Amendment VII).
 *
 * A Worker gets its own module graph, so the Brain has its OWN registry — and
 * `handleBrainRequest` reads `getDefinition`/`tryGetDefinition`
 * synchronously. Answering before a request's definitions are resident is not
 * a slow start: it is a bot deciding against a half-empty registry, which
 * `.claude/rules/bot-development.md` treats as unshipped, and a search that
 * then finds no legal move is indistinguishable from a bot that chose to pass
 * (issue #2450). Since issue #5617 the worker installs only what it may
 * reason about — its primed Manifest and what each request names — never the
 * whole catalogue.
 *
 * `brain.worker.ts` is a Worker ENTRY POINT — importing it assigns
 * `self.onmessage` as a side effect — so the shell is exercised the only way
 * it can be: import it, then drive `self.onmessage` directly and read what it
 * posts. That side effect is exactly the behaviour under test here, unlike
 * the search itself (`brain-request.ts`) and the residency rule
 * (`src/lib/catalogue/residentFor.ts`), each tested on its own.
 */

let resolveResidency: () => void;
let rejectResidency: (cause: unknown) => void;
const makeResident = vi.fn<
    (
        ids: readonly string[],
        hints: ReadonlyMap<string, string>
    ) => Promise<void>
>(
    () =>
        new Promise<void>((resolve, reject) => {
            resolveResidency = resolve;
            rejectResidency = reject;
        })
);
const hintedShardKeys = vi.fn(
    (
        entries: readonly { definitionId: string; setCode: string }[],
        hints: Map<string, string>
    ) => {
        for (const e of entries) hints.set(e.definitionId, e.setCode);
        return entries.map((e) => `compiled:${e.setCode}`);
    }
);
const installShards = vi.fn<(keys: Iterable<string>) => Promise<void>>(() =>
    Promise.resolve()
);
const hydrateCatalogue = vi.fn(() => Promise.resolve(0));
const handleBrainRequest = vi.fn(
    (request: BrainRequest): BrainResponse => ({
        id: request.id,
        move: null,
        trace: null,
    })
);

vi.mock("../../catalogue/residentFor", () => ({
    hintedShardKeys,
    makeResident,
}));
vi.mock("../../catalogue/definitionShards", () => ({ installShards }));
vi.mock("../../catalogueArtifact", () => ({ hydrateCatalogue }));
vi.mock("../brain-request", () => ({ handleBrainRequest }));

const posted: BrainResponse[] = [];
vi.stubGlobal("postMessage", (response: BrainResponse) =>
    posted.push(response)
);
vi.stubGlobal("console", {
    ...console,
    error: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
});

/** A FRESH worker shell: its hints and its failure cooldown are module
 *  state, so each case loads its own copy. */
async function loadWorker(): Promise<void> {
    vi.resetModules();
    posted.length = 0;
    for (const spy of [
        makeResident,
        hintedShardKeys,
        installShards,
        hydrateCatalogue,
        handleBrainRequest,
    ])
        spy.mockClear();
    await import("../brain.worker");
}

/** A request whose state names one card and whose deck knowledge names
 *  another. */
const request = (id: number) =>
    ({
        id,
        botId: "bot",
        state: {
            players: [
                {
                    battlefield: [{ card: { id: "on-board" } }],
                    graveyard: [],
                    exile: [],
                    hand: [],
                    library: { count: 0 },
                },
            ],
            stack: [],
        },
        deckKnowledge: [{ playerId: "bot", cardIds: ["in-deck"] }],
    }) as unknown as BrainRequest;

function post(message: BrainWorkerMessage): void {
    (self.onmessage as (e: MessageEvent<BrainWorkerMessage>) => void)({
        data: message,
    } as MessageEvent<BrainWorkerMessage>);
}
const send = (id: number) => post(request(id));

/** Let the microtask chain the shell builds drain. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("the Brain's Worker shell", () => {
    it("installs nothing at module load — no whole-catalogue hydration, ever", async () => {
        await loadWorker();
        send(1);
        await settle();
        resolveResidency();
        await settle();

        expect(hydrateCatalogue).not.toHaveBeenCalled();
        expect(installShards).not.toHaveBeenCalled();
        expect(posted.map((r) => r.id)).toEqual([1]);
    });

    it("installs a primed Manifest's shards at once, answering nothing for it", async () => {
        await loadWorker();
        post({
            kind: "prime",
            entries: [{ definitionId: "in-deck", setCode: "mm3" }],
        });
        await settle();

        expect(installShards).toHaveBeenCalledWith(["compiled:mm3"]);
        expect(posted).toEqual([]);
    });

    it("makes every card a request names resident — its state's and its deck knowledge's — with the primed hints, before it answers", async () => {
        await loadWorker();
        post({
            kind: "prime",
            entries: [{ definitionId: "in-deck", setCode: "mm3" }],
        });
        send(2);
        await settle();

        const [ids, hints] = makeResident.mock.calls[0]!;
        expect([...ids].sort()).toEqual(["in-deck", "on-board"]);
        expect(hints.get("in-deck")).toBe("mm3");
        expect(handleBrainRequest).not.toHaveBeenCalled();
        expect(posted).toEqual([]);

        resolveResidency();
        await settle();
        expect(posted.map((r) => r.id)).toEqual([2]);
    });

    it("answers in arrival order, each request behind its own residency", async () => {
        await loadWorker();
        send(3);
        send(4);
        await settle();
        expect(makeResident).toHaveBeenCalledTimes(1);

        resolveResidency();
        await settle();
        expect(posted.map((r) => r.id)).toEqual([3]);
        expect(makeResident).toHaveBeenCalledTimes(2);

        resolveResidency();
        await settle();
        expect(posted.map((r) => r.id)).toEqual([3, 4]);
    });

    it("answers an install FAILURE with a named error, and retries once the cooldown has passed", async () => {
        const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
        try {
            await loadWorker();
            send(5);
            await settle();
            rejectResidency(new Error("HTTP 503"));
            await settle();

            expect(handleBrainRequest).not.toHaveBeenCalled();
            expect(posted).toEqual([
                {
                    id: 5,
                    move: null,
                    trace: null,
                    error: { name: "Error", message: "HTTP 503" },
                },
            ]);

            // Inside the cooldown: a named answer at once, no new fetch —
            // the driver re-consults on every state change.
            posted.length = 0;
            for (const id of [6, 7]) send(id);
            await settle();
            expect(makeResident).toHaveBeenCalledTimes(1);
            expect(posted.map((r) => r.error?.message)).toEqual([
                "HTTP 503",
                "HTTP 503",
            ]);

            // Past it: a fresh attempt, and an answer once it lands.
            now.mockReturnValue(1_000_000 + 5_000);
            posted.length = 0;
            send(8);
            await settle();
            expect(makeResident).toHaveBeenCalledTimes(2);
            resolveResidency();
            await settle();
            expect(posted.map((r) => r.id)).toEqual([8]);
            expect(posted[0]!.error).toBeUndefined();
        } finally {
            now.mockRestore();
        }
    });

    it("survives a throw out of the handler — it answers, and keeps answering", async () => {
        // The realistic throw is `postMessage` refusing a value the structured
        // clone cannot carry. Without a terminal `.catch` the request chain
        // stays rejected and the Worker goes silent for the rest of the
        // session — the same frozen game as never becoming resident.
        await loadWorker();
        handleBrainRequest.mockImplementationOnce(() => {
            throw new Error("DataCloneError");
        });

        send(9);
        await settle();
        resolveResidency();
        await settle();
        expect(posted).toEqual([
            {
                id: 9,
                move: null,
                trace: null,
                error: { name: "Error", message: "DataCloneError" },
            },
        ]);

        posted.length = 0;
        send(10);
        await settle();
        resolveResidency();
        await settle();
        expect(posted.map((r) => r.id)).toEqual([10]);
        expect(posted[0]!.error).toBeUndefined();
    });
});
