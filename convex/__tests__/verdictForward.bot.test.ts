// The forward (issue #3745, ADR 0128 § Amendment): a local backend, which never
// holds the write key, gets its outbox into the Verdict Store through the
// deployment that does — re-validated there, read back there, origin intact.
//
// Both ends are the real code. The local end is the REGISTERED `submit` and
// `markStored` driven through the shared stub ctx (`gameMutationHarness.ts`)
// and the real `drainOutbox`; the writer end is `acceptForward` bound to the
// REGISTERED `forwardAdmissible` and to the direct store over the in-memory
// bucket. Between them the request goes through a JSON round-trip, as it would
// over HTTP; the last describes drive the registered drain action and the
// registered HTTP action themselves.
//
// A `.bot.test.ts` because it derives ids through `convex/gre/ai/verdicts`
// (`bot-suite-boundary.test.ts`).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
    verdictIdOf,
    type VerdictJudgement,
} from "../gre/ai/verdicts/identity";
import { resolutionIdOf } from "../gre/ai/verdicts/resolution";
import { sha256Hex } from "../gre/ai/verdicts/sha256";
import type { VerdictResolution } from "../gre/ai/verdicts/types";
import { forwardAdmissible, markStored, submit } from "../verdicts";
import {
    acceptForward,
    deploymentOfForwardToken,
    forwardOutboxStore,
    forwardResolutionStore,
    parseForwardTokenRegistry,
    type ForwardTransport,
    type ForwardWriterPorts,
} from "../verdictForward";
import { forwardVerdicts } from "../verdictForwardHttp";
import {
    directResolutionStore,
    drainResolutionOutbox,
    type ResolutionOutboxRow,
} from "../verdictResolutionsOutbox";
import {
    attestationObjectName,
    readAttestation,
    readResolution,
    readVerdict,
    verdictObjectName,
    type VerdictStoreWriter,
} from "../verdictStore";
import {
    createMemoryVerdictStore,
    type MemoryVerdictStore,
} from "../verdictStoreMemory";
import { drain } from "../verdictsDrain";
import {
    directOutboxStore,
    drainOutbox,
    storeOutboxRow,
    verdictStampOf,
    type OutboxDrainPorts,
    type OutboxRow,
    type VerdictDeployment,
} from "../verdictsOutbox";
import {
    makeMutationCtx,
    runMutation,
    type MutationStub,
    type Row,
} from "./gameMutationHarness";

type Handler = {
    _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
};

const LOCAL_URL = "http://127.0.0.1:3210";
const LOCAL: VerdictDeployment = { name: "local-3210", kind: "local" };
const WRITER: VerdictDeployment = {
    name: "jovial-guineapig-250",
    kind: "cloud",
};
const WRITER_SITE = "https://jovial-guineapig-250.convex.site";

const TOKEN = "forward-token-of-local-3210-0123456789abcdef";
const REGISTRY = JSON.stringify([
    { deployment: "local-3210", sha256: sha256Hex(TOKEN) },
]);

const TESTER: Row = {
    _id: "u-tester",
    __table: "users",
    nickname: "Tessa",
    email: "tessa@example.com",
    isTester: true,
};

const ARGS = {
    spec: { cards: [{ name: "Mountain", owner: "me" as const }] },
    seat: "me" as const,
    candidates: [
        { key: '{"kind":"pass"}', description: "pass" },
        { key: '{"kind":"cast-spell"}', description: "cast Lightning Bolt" },
    ],
    answer: { kind: "right" as const, rightIndexes: [1] },
    botPickIndex: 0,
    gameId: "game-7",
    seq: 42,
    note: "bolt the blocker first",
};

const JUDGEMENT: VerdictJudgement = {
    spec: ARGS.spec,
    seat: ARGS.seat,
    candidates: ARGS.candidates,
    answer: ARGS.answer,
};
const VERDICT_ID = verdictIdOf(JUDGEMENT);
const LOCAL_AUTHOR = "local-3210:u-tester";

/** The writer, over an in-memory bucket. */
function writerPorts(
    store: VerdictStoreWriter,
    registryText: string = REGISTRY
): ForwardWriterPorts {
    return {
        registry: () => parseForwardTokenRegistry(registryText),
        checkAdmissible: async (judgement) => {
            await (forwardAdmissible as unknown as Handler)._handler(
                {},
                judgement
            );
        },
        storeVerdict: directOutboxStore(store, WRITER),
        storeResolution: directResolutionStore(store),
    };
}

/** The wire: the request and the answer each cross a JSON round-trip, as they
 *  would over HTTP. `null` sends no token at all. */
function wire(
    ports: ForwardWriterPorts,
    token: string | null = TOKEN
): ForwardTransport {
    return async (request) => {
        const answer = await acceptForward(
            ports,
            token === null ? null : `Bearer ${token}`,
            JSON.parse(JSON.stringify(request))
        );
        return JSON.parse(JSON.stringify(answer));
    };
}

/** Submit through the registered mutation, on the local backend. */
async function submittedLocally(
    seeds: Row[] = []
): Promise<{ stub: MutationStub; id: string }> {
    const stub = makeMutationCtx("u-tester", [TESTER, ...seeds]);
    const id = await runMutation<typeof ARGS, Id<"verdicts">>(
        submit,
        stub.ctx,
        ARGS
    );
    return { stub, id: id as unknown as string };
}

/** The local drain over the stub table, forwarding through `transport`. */
function localDrainPorts(
    stub: MutationStub,
    ids: string[],
    transport: ForwardTransport
): OutboxDrainPorts {
    return {
        storeRow: forwardOutboxStore(transport, LOCAL),
        now: () => 1_800_000_000_000,
        pendingPage: async () => ({
            rows: ids
                .map((id) => stub.doc(id))
                .filter((row) => row.storedAt === undefined)
                .map((row) => row as unknown as OutboxRow),
            cursor: "",
            isDone: true,
        }),
        markStored: (args) => runMutation(markStored, stub.ctx, args),
    };
}

/** A fat row as a local backend holds it, stamped for its own judgement. */
function localRow(
    id: string,
    judgement: VerdictJudgement,
    origin: { attestationAuthor: string; deployment: string }
): OutboxRow {
    return {
        _id: id,
        ...judgement,
        author: "Tessa",
        authorId: "u-tester",
        createdAt: 1_700_000_000_000,
        ...verdictStampOf(judgement),
        ...origin,
        deploymentKind: "local",
    };
}

/** A bucket whose `put` answers `created` but keeps nothing under `prefix`. */
function droppingStore(prefix: string): MemoryVerdictStore {
    const inner = createMemoryVerdictStore();
    return {
        ...inner,
        put: async (name, bytes, contentType) =>
            name.startsWith(prefix)
                ? "created"
                : inner.put(name, bytes, contentType),
    };
}

beforeEach(() => {
    vi.stubEnv("CONVEX_CLOUD_URL", LOCAL_URL);
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe("a local judgement reaches the bucket through the writer (issue #3745)", () => {
    it("is stored, attested to local-<port>:<userId> with its origin intact, and only then slimmed", async () => {
        const { stub, id } = await submittedLocally();
        const store = createMemoryVerdictStore();

        const report = await drainOutbox(
            localDrainPorts(stub, [id], wire(writerPorts(store)))
        );

        expect(report).toEqual({ stored: 1, alreadySlim: 0, pending: [] });
        expect([...store.objects.keys()].sort()).toEqual([
            attestationObjectName(VERDICT_ID, LOCAL_AUTHOR),
            verdictObjectName(VERDICT_ID),
        ]);
        expect(await readVerdict(store, VERDICT_ID)).toEqual(JUDGEMENT);
        // Origin preserved, never rewritten to the writer.
        expect(await readAttestation(store, VERDICT_ID, LOCAL_AUTHOR)).toEqual({
            verdictId: VERDICT_ID,
            author: LOCAL_AUTHOR,
            sourceAxis: "explicit",
            createdAt: stub.doc(id).createdAt,
            note: ARGS.note,
            deployment: "local-3210",
            deploymentKind: "local",
            botPickIndex: 0,
            gameId: "game-7",
            seq: 42,
        });
        const row = stub.doc(id);
        expect(row.spec).toBeUndefined();
        expect(row.storedAt).toBe(1_800_000_000_000);
        expect(row.deployment).toBe("local-3210");
    });

    it("a legacy row — no stamps, authorId only — forwards and slims the same way", async () => {
        const legacy: Row = {
            _id: "old-1",
            __table: "verdicts",
            ...JUDGEMENT,
            author: "Tessa",
            authorId: "u-old",
            createdAt: 1_600_000_000_000,
        };
        const stub = makeMutationCtx("u-tester", [TESTER, legacy]);
        const store = createMemoryVerdictStore();

        const report = await drainOutbox(
            localDrainPorts(stub, ["old-1"], wire(writerPorts(store)))
        );

        expect(report).toEqual({ stored: 1, alreadySlim: 0, pending: [] });
        expect(
            await readAttestation(store, VERDICT_ID, "local-3210:u-old")
        ).toMatchObject({
            author: "local-3210:u-old",
            deployment: "local-3210",
            deploymentKind: "local",
            createdAt: 1_600_000_000_000,
        });
        expect(stub.doc("old-1")).toMatchObject({
            verdictHash: VERDICT_ID,
            attestationAuthor: "local-3210:u-old",
            storedAt: 1_800_000_000_000,
        });
        expect(stub.doc("old-1").spec).toBeUndefined();
    });

    it("a re-send of a stored row writes nothing new and still confirms", async () => {
        const store = createMemoryVerdictStore();
        const transport = wire(writerPorts(store));
        const row = localRow("r-1", JUDGEMENT, {
            attestationAuthor: LOCAL_AUTHOR,
            deployment: "local-3210",
        });
        const storeRow = forwardOutboxStore(transport, LOCAL);

        expect(await storeRow(row)).toMatchObject({
            status: "stored",
            verdict: "created",
            attestation: "created",
        });
        expect(await storeRow(row)).toMatchObject({
            status: "stored",
            verdict: "exists",
            attestation: "exists",
        });
        expect(store.objects.size).toBe(2);
    });
});

describe("a local resolution forwards the same way (issue #3745)", () => {
    const RESOLUTION: VerdictResolution = {
        positionKey: verdictStampOf(JUDGEMENT).positionKey,
        acceptedVerdictId: VERDICT_ID,
        rejected: [
            {
                verdictId: verdictIdOf({
                    ...JUDGEMENT,
                    answer: { kind: "right", rightIndexes: [0] },
                }),
                reason: "passing loses the blocker",
            },
        ],
        author: "local-3210:u-admin",
        createdAt: 1_700,
        note: "checked the life totals",
        deployment: "local-3210",
        deploymentKind: "local",
    };
    const row = (resolution: VerdictResolution): ResolutionOutboxRow => ({
        _id: "res-1",
        positionKey: resolution.positionKey,
        resolutionId: resolutionIdOf(resolution),
        acceptedVerdictId: resolution.acceptedVerdictId,
        rejected: resolution.rejected,
        resolverAuthor: resolution.author,
        createdAt: resolution.createdAt as number,
        note: resolution.note,
        deployment: resolution.deployment as string,
        deploymentKind: "local",
    });

    it("is stored with its origin and marked only after the writer's read-back", async () => {
        const store = createMemoryVerdictStore();
        const marked: unknown[] = [];

        const report = await drainResolutionOutbox({
            storeRow: forwardResolutionStore(wire(writerPorts(store))),
            now: () => 42,
            pendingResolutions: async () => [row(RESOLUTION)],
            markResolutionStored: async (args) => {
                marked.push(args);
            },
        });

        expect(report).toEqual({ stored: 1, pending: [] });
        expect(marked).toEqual([
            {
                rowId: "res-1",
                resolutionId: resolutionIdOf(RESOLUTION),
                storedAt: 42,
            },
        ]);
        expect(
            await readResolution(
                store,
                RESOLUTION.positionKey,
                resolutionIdOf(RESOLUTION)
            )
        ).toEqual(RESOLUTION);
    });

    it("the writer refuses a resolver outside the token's deployment", async () => {
        const store = createMemoryVerdictStore();
        const foreign = {
            ...RESOLUTION,
            author: "jovial-guineapig-250:u-admin",
            deployment: "jovial-guineapig-250",
            deploymentKind: "cloud" as const,
        };
        const marked: unknown[] = [];

        const report = await drainResolutionOutbox({
            storeRow: forwardResolutionStore(wire(writerPorts(store))),
            now: () => 42,
            pendingResolutions: async () => [row(foreign)],
            markResolutionStored: async (args) => {
                marked.push(args);
            },
        });

        expect(report.stored).toBe(0);
        expect(report.pending[0].reason).toMatch(
            /^forward refused \(403\): author "jovial-guineapig-250:u-admin" is outside local-3210/
        );
        expect(marked).toEqual([]);
        expect(store.objects.size).toBe(0);
    });
});

describe("the writer refuses, and the local row stays fat with the reason (issue #3745)", () => {
    const UNKNOWN_CARD: VerdictJudgement = {
        ...JUDGEMENT,
        spec: { cards: [{ name: "Not A Real Card Name", owner: "me" }] },
    };
    const OUT_OF_RANGE: VerdictJudgement = {
        ...JUDGEMENT,
        answer: { kind: "right", rightIndexes: [7] },
    };

    it.each([
        {
            refusal: "no token",
            token: null,
            row: localRow("r-1", JUDGEMENT, {
                attestationAuthor: LOCAL_AUTHOR,
                deployment: "local-3210",
            }),
            reason: "forward refused (401): no forward token was presented",
        },
        {
            refusal: "a wrong token",
            token: "not-the-token",
            row: localRow("r-1", JUDGEMENT, {
                attestationAuthor: LOCAL_AUTHOR,
                deployment: "local-3210",
            }),
            reason: "forward refused (401): this deployment does not accept that forward token",
        },
        {
            refusal: "an author on another deployment",
            token: TOKEN,
            row: localRow("r-1", JUDGEMENT, {
                attestationAuthor: "jovial-guineapig-250:u-someone",
                deployment: "local-3210",
            }),
            reason: 'forward refused (403): author "jovial-guineapig-250:u-someone" is outside local-3210',
        },
        {
            refusal: "an origin naming another deployment",
            token: TOKEN,
            row: localRow("r-1", JUDGEMENT, {
                attestationAuthor: LOCAL_AUTHOR,
                deployment: "local-3211",
            }),
            reason: 'forward refused (403): deployment "local-3211" is not local-3210',
        },
        {
            refusal: "an unknown card name",
            token: TOKEN,
            row: localRow("r-1", UNKNOWN_CARD, {
                attestationAuthor: LOCAL_AUTHOR,
                deployment: "local-3210",
            }),
            reason: "forward refused (422): inadmissible judgement: unknown card name(s) in the position: Not A Real Card Name",
        },
        {
            refusal: "an index outside the candidates",
            token: TOKEN,
            row: localRow("r-1", OUT_OF_RANGE, {
                attestationAuthor: LOCAL_AUTHOR,
                deployment: "local-3210",
            }),
            reason: "forward refused (422): inadmissible judgement: candidate index 7 is outside the 2-candidate list",
        },
    ])("$refusal", async ({ token, row, reason }) => {
        const store = createMemoryVerdictStore();
        const markStoredSpy = vi.fn();

        const report = await drainOutbox({
            storeRow: forwardOutboxStore(
                wire(writerPorts(store), token),
                LOCAL
            ),
            now: () => 1,
            pendingPage: async () => ({
                rows: [row],
                cursor: "",
                isDone: true,
            }),
            markStored: markStoredSpy,
        });

        expect(report.stored).toBe(0);
        expect(report.pending).toHaveLength(1);
        expect(report.pending[0].rowId).toBe("r-1");
        expect(report.pending[0].reason.startsWith(reason)).toBe(true);
        expect(markStoredSpy).not.toHaveBeenCalled();
        expect(store.objects.size).toBe(0);
    });
});

describe("a row slims only on the writer's confirmed read-back (issue #3745)", () => {
    it("an attestation the writer's bucket does not hold after upload leaves the row fat", async () => {
        const { stub, id } = await submittedLocally();
        const store = droppingStore("attestations/");

        const report = await drainOutbox(
            localDrainPorts(stub, [id], wire(writerPorts(store)))
        );

        expect(report.stored).toBe(0);
        expect(report.pending).toEqual([
            {
                rowId: id,
                reason: `forward pending (503): the attestation of ${VERDICT_ID} by ${LOCAL_AUTHOR} is not in the store after its upload`,
            },
        ]);
        expect(stub.doc(id).spec).toEqual(ARGS.spec);
        expect(stub.doc(id).storedAt).toBeUndefined();
    });

    it("a writer outage leaves the row fat, and the next drain stores it", async () => {
        const { stub, id } = await submittedLocally();
        const store = createMemoryVerdictStore();
        const down: ForwardTransport = async () => {
            throw new Error("fetch failed");
        };

        const first = await drainOutbox(localDrainPorts(stub, [id], down));
        expect(first.pending).toEqual([
            { rowId: id, reason: "forward failed: fetch failed" },
        ]);
        expect(stub.doc(id).storedAt).toBeUndefined();

        const retry = await drainOutbox(
            localDrainPorts(stub, [id], wire(writerPorts(store)))
        );
        expect(retry).toEqual({ stored: 1, alreadySlim: 0, pending: [] });
        expect(stub.doc(id).storedAt).toBe(1_800_000_000_000);
    });

    it("an answer confirming another verdict is not a confirmation", async () => {
        const { stub, id } = await submittedLocally();
        const lying: ForwardTransport = async () => ({
            httpStatus: 200,
            response: {
                status: "stored",
                kind: "verdict",
                verdictId: "v1-" + "0".repeat(64),
                positionKey: verdictStampOf(JUDGEMENT).positionKey,
                attestationAuthor: LOCAL_AUTHOR,
                verdict: "created",
                attestation: "created",
            },
        });

        const report = await drainOutbox(localDrainPorts(stub, [id], lying));

        expect(report.stored).toBe(0);
        expect(stub.doc(id).storedAt).toBeUndefined();
    });
});

describe("the forward token registry (issue #3745)", () => {
    it("binds a token to its deployment, and nothing else to anything", () => {
        const registry = parseForwardTokenRegistry(REGISTRY);
        expect(deploymentOfForwardToken(registry, TOKEN)).toBe("local-3210");
        expect(deploymentOfForwardToken(registry, TOKEN + "x")).toBeNull();
        expect(deploymentOfForwardToken(registry, "")).toBeNull();
        expect(parseForwardTokenRegistry(undefined)).toEqual([]);
    });

    it("refuses a malformed registry without echoing it", () => {
        expect(() =>
            parseForwardTokenRegistry(
                JSON.stringify([{ deployment: "local-3210", sha256: TOKEN }])
            )
        ).toThrow(/^VERDICT_STORE_FORWARD_TOKENS is not a JSON array/);
        try {
            parseForwardTokenRegistry(`{"secret-${TOKEN}"`);
        } catch (error) {
            expect(String(error)).not.toContain(TOKEN);
        }
    });
});

describe("the registered drain picks its way by credential (issue #3745)", () => {
    /** A drain ctx over one row, recording what was slimmed. */
    function drainCtx(row: OutboxRow) {
        const slimmed: unknown[] = [];
        return {
            slimmed,
            ctx: {
                runQuery: vi.fn(async (_ref: unknown, args: unknown) =>
                    args !== null &&
                    typeof args === "object" &&
                    "cursor" in args
                        ? { rows: [row], cursor: "", isDone: true }
                        : []
                ),
                runMutation: vi.fn(async (_ref: unknown, args: unknown) => {
                    slimmed.push(args);
                    return "slimmed";
                }),
            },
        };
    }
    const ROW = localRow("r-1", JUDGEMENT, {
        attestationAuthor: LOCAL_AUTHOR,
        deployment: "local-3210",
    });

    it("with a forward token and no write key it forwards over HTTP, bearing the token", async () => {
        const store = createMemoryVerdictStore();
        vi.stubEnv("VERDICT_STORE_WRITE_KEY", "");
        vi.stubEnv("VERDICT_STORE_FORWARD_TOKEN", TOKEN);
        vi.stubEnv("VERDICT_STORE_FORWARD_URL", `${WRITER_SITE}/`);
        const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
            const headers = init.headers as Record<string, string>;
            const answer = await acceptForward(
                writerPorts(store),
                headers.authorization,
                JSON.parse(init.body as string)
            );
            return new Response(JSON.stringify(answer.response), {
                status: answer.httpStatus,
            });
        });
        vi.stubGlobal("fetch", fetchSpy);
        const { ctx, slimmed } = drainCtx(ROW);

        const report = await (drain as unknown as Handler)._handler(ctx, {});

        expect(report).toMatchObject({
            stored: 1,
            pending: [],
            resolutions: { stored: 0, pending: [] },
        });
        expect(fetchSpy).toHaveBeenCalledWith(
            `${WRITER_SITE}/verdicts/forward`,
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({
                    authorization: `Bearer ${TOKEN}`,
                }),
            })
        );
        expect(slimmed).toEqual([
            expect.objectContaining({
                rowId: "r-1",
                verdictHash: VERDICT_ID,
                attestationAuthor: LOCAL_AUTHOR,
                deploymentKind: "local",
            }),
        ]);
        expect(
            await readAttestation(store, VERDICT_ID, LOCAL_AUTHOR)
        ).not.toBeNull();
    });

    it("with the write key it drains directly, even beside a forward token", async () => {
        vi.stubEnv(
            "CONVEX_CLOUD_URL",
            "https://jovial-guineapig-250.convex.cloud"
        );
        vi.stubEnv(
            "VERDICT_STORE_WRITE_KEY",
            JSON.stringify({
                type: "service_account",
                client_email:
                    "verdict-store-writer@tolaria.iam.gserviceaccount.com",
                private_key: "not a key",
            })
        );
        vi.stubEnv("VERDICT_STORE_FORWARD_TOKEN", TOKEN);
        vi.stubEnv("VERDICT_STORE_FORWARD_URL", WRITER_SITE);
        const fetchSpy = vi.fn(async () => new Response("{}", { status: 500 }));
        vi.stubGlobal("fetch", fetchSpy);
        const { ctx } = drainCtx(ROW);

        const report = (await (drain as unknown as Handler)._handler(
            ctx,
            {}
        )) as { pending: { reason: string }[] };

        expect(report.pending).toHaveLength(1);
        expect(report.pending[0].reason).toMatch(/^upload failed: /);
        expect(
            fetchSpy.mock.calls.some((call: unknown[]) =>
                String(call[0]).includes("/verdicts/forward")
            )
        ).toBe(false);
    });

    it("with neither credential it answers skipped, naming both", async () => {
        vi.stubEnv("VERDICT_STORE_WRITE_KEY", "");
        vi.stubEnv("VERDICT_STORE_FORWARD_TOKEN", "");
        const { ctx } = drainCtx(ROW);

        const report = await (drain as unknown as Handler)._handler(ctx, {});

        expect(report).toMatchObject({
            stored: 0,
            skipped: expect.stringMatching(
                /VERDICT_STORE_WRITE_KEY.*VERDICT_STORE_FORWARD_TOKEN.*VERDICT_STORE_FORWARD_URL/
            ),
        });
        expect(ctx.runQuery).not.toHaveBeenCalled();
    });
});

describe("the writer's registered HTTP route (issue #3745)", () => {
    function routeCtx(store: VerdictStoreWriter) {
        return {
            runQuery: (_ref: unknown, args: unknown) =>
                (forwardAdmissible as unknown as Handler)._handler({}, args),
            runAction: (_ref: unknown, args: { row: unknown }) =>
                (args.row as { resolutionId?: string }).resolutionId ===
                undefined
                    ? storeOutboxRow(store, args.row as OutboxRow, WRITER)
                    : Promise.reject(new Error("not a verdict")),
        };
    }
    const BODY = () => {
        const row = localRow("r-1", JUDGEMENT, {
            attestationAuthor: LOCAL_AUTHOR,
            deployment: "local-3210",
        });
        let sent: unknown;
        const capture: ForwardTransport = async (request) => {
            sent = request;
            throw new Error("captured");
        };
        return forwardOutboxStore(capture, LOCAL)(row).then(() => sent);
    };

    it("stores a forward bearing an accepted token, and answers 401 to one bearing none", async () => {
        vi.stubEnv("VERDICT_STORE_FORWARD_TOKENS", REGISTRY);
        const store = createMemoryVerdictStore();
        const body = JSON.stringify(await BODY());
        const handler = (forwardVerdicts as unknown as Handler)._handler;

        const anonymous = (await handler(
            routeCtx(store),
            new Request(`${WRITER_SITE}/verdicts/forward`, {
                method: "POST",
                body,
            })
        )) as Response;
        expect(anonymous.status).toBe(401);
        expect(store.objects.size).toBe(0);

        const accepted = (await handler(
            routeCtx(store),
            new Request(`${WRITER_SITE}/verdicts/forward`, {
                method: "POST",
                headers: { authorization: `Bearer ${TOKEN}` },
                body,
            })
        )) as Response;
        expect(accepted.status).toBe(200);
        expect(await accepted.json()).toMatchObject({
            status: "stored",
            verdictId: VERDICT_ID,
            attestationAuthor: LOCAL_AUTHOR,
        });
        expect(
            await readAttestation(store, VERDICT_ID, LOCAL_AUTHOR)
        ).toMatchObject({ deployment: "local-3210", deploymentKind: "local" });
    });
});
