// The Verdict outbox (issue #3580, ADR 0128 §4/§5): a submitted row becomes a
// verdict object and an attestation in the Verdict Store, and the row forgets
// its judgement only after both are read back.
//
// The store is the in-memory fake (`verdictStoreMemory.ts`); the mutations are
// the REGISTERED `submit` / `markStored` bindings driven through the shared stub
// ctx (`gameMutationHarness.fixture.ts`), so the path under test is the one deployed:
// submit's stamps → the drain's upload and re-read → markStored's slimming.
//
// A `.bot.test.ts` because it derives the expected ids through
// `convex/gre/ai/verdicts/identity` (`bot-suite-boundary.test.ts`).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
    canonicalJson as canonicalJsonOf,
    positionKeyOf,
    verdictIdOf,
    type VerdictJudgement,
} from "../gre/ai/verdicts/identity";
import {
    VerdictStoreIntegrityError,
    attestationObjectName,
    decodeAttestationObject,
    encodeAttestationObject,
    encodeVerdictObject,
    readAttestation,
    readStoredCorpus,
    readVerdict,
    verdictAuthorOf,
    verdictObjectName,
    type VerdictStoreWriter,
} from "../verdictStore";
import { createMemoryVerdictStore } from "../verdictStoreMemory";
import { quarantineContestedPositions } from "../gre/ai/verdicts/quarantine";
import type { AttestedReading } from "../gre/ai/verdicts/reading";
import { markStored, submit } from "../verdicts";
import {
    directOutboxStore,
    drainOutbox,
    storeOutboxRow,
    verdictDeploymentOf,
    type OutboxDrainPorts,
    type OutboxRow,
    type VerdictDeployment,
} from "../verdictsOutbox";
import {
    makeMutationCtx,
    runMutation,
    type MutationStub,
    type Row,
} from "./gameMutationHarness.fixture";

const CLOUD_URL = "https://jovial-guineapig-250.convex.cloud";
const HERE: VerdictDeployment = { name: "jovial-guineapig-250", kind: "cloud" };

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

/** A fat, stamped row as `submit` on `deployment` writes it. */
function fatRow(
    id: string,
    deployment: VerdictDeployment,
    userId: string
): OutboxRow {
    return {
        _id: id,
        ...JUDGEMENT,
        botPickIndex: 0,
        author: "Tessa",
        authorId: userId,
        createdAt: 1_700_000_000_000,
        verdictHash: VERDICT_ID,
        positionKey: positionKeyOf(JUDGEMENT),
        attestationAuthor: verdictAuthorOf(deployment.name, userId),
        deployment: deployment.name,
        deploymentKind: deployment.kind,
    };
}

/** Submit through the registered mutation; return the stub and the row id. */
async function submitted(): Promise<{ stub: MutationStub; id: string }> {
    const stub = makeMutationCtx("u-tester", [TESTER]);
    const id = await runMutation<typeof ARGS, Id<"verdicts">>(
        submit,
        stub.ctx,
        ARGS
    );
    return { stub, id: id as unknown as string };
}

/** Drain ports over ONE harness row and the registered `markStored`. */
function harnessPorts(
    stub: MutationStub,
    id: string,
    store: VerdictStoreWriter
): OutboxDrainPorts {
    return {
        storeRow: directOutboxStore(store, HERE),
        now: () => 1_800_000_000_000,
        pendingPage: async () => ({
            rows:
                stub.doc(id).storedAt === undefined
                    ? [stub.doc(id) as unknown as OutboxRow]
                    : [],
            cursor: "",
            isDone: true,
        }),
        markStored: (args) => runMutation(markStored, stub.ctx, args),
    };
}

/** A store whose `put` answers as `put` does but never writes the objects
 *  whose names start with `prefix` — an upload that "succeeded" and left
 *  nothing behind. */
function droppingStore(prefix: string): VerdictStoreWriter {
    const inner = createMemoryVerdictStore();
    return {
        get: inner.get,
        list: inner.list,
        put: async (name, bytes, contentType) =>
            name.startsWith(prefix)
                ? "created"
                : inner.put(name, bytes, contentType),
    };
}

const FAT_FIELDS = [
    "spec",
    "seat",
    "candidates",
    "answer",
    "botPickIndex",
    "seq",
];

beforeEach(() => {
    vi.stubEnv("CONVEX_CLOUD_URL", CLOUD_URL);
});
afterEach(() => {
    vi.unstubAllEnvs();
});

describe("submit stamps both hashes server-side (issue #3580)", () => {
    it("stamps the verdict id and position key of the judgement it stored", async () => {
        const { stub, id } = await submitted();
        const row = stub.doc(id);
        expect(row.verdictHash).toBe(VERDICT_ID);
        expect(row.positionKey).toBe(positionKeyOf(JUDGEMENT));
    });

    it("ignores a hash the client tries to pass, and declares no such argument", async () => {
        const stub = makeMutationCtx("u-tester", [TESTER]);
        const forged = `v1-${"0".repeat(64)}`;
        const id = await runMutation<Record<string, unknown>, string>(
            submit,
            stub.ctx,
            { ...ARGS, verdictHash: forged, positionKey: forged }
        );
        expect(stub.doc(id).verdictHash).toBe(VERDICT_ID);
        expect(stub.doc(id).positionKey).toBe(positionKeyOf(JUDGEMENT));
        // The deployed validator is what refuses the extra argument outright.
        const declared = Object.keys(
            JSON.parse(
                (submit as unknown as { exportArgs(): string }).exportArgs()
            ).value
        );
        for (const stamped of [
            "verdictHash",
            "positionKey",
            "attestationAuthor",
            "deployment",
            "deploymentKind",
            "author",
            "authorId",
            "createdAt",
        ]) {
            expect(declared).not.toContain(stamped);
        }
    });
});

describe("the drain stores, re-reads, and only then slims (issue #3580)", () => {
    it("uploads the verdict object and its attestation, and slims the row to its hashes and provenance", async () => {
        const { stub, id } = await submitted();
        const store = createMemoryVerdictStore();

        const report = await drainOutbox(harnessPorts(stub, id, store));

        expect(report).toEqual({ stored: 1, alreadySlim: 0, pending: [] });
        const author = "jovial-guineapig-250:u-tester";
        expect([...store.objects.keys()].sort()).toEqual([
            attestationObjectName(VERDICT_ID, author),
            verdictObjectName(VERDICT_ID),
        ]);
        expect(await readVerdict(store, VERDICT_ID)).toEqual(JUDGEMENT);
        expect(await readAttestation(store, VERDICT_ID, author)).toEqual({
            verdictId: VERDICT_ID,
            author,
            sourceAxis: "explicit",
            createdAt: stub.doc(id).createdAt,
            note: ARGS.note,
            deployment: "jovial-guineapig-250",
            deploymentKind: "cloud",
            botPickIndex: 0,
            gameId: "game-7",
            seq: 42,
        });

        const row = stub.doc(id);
        const fields = Object.keys(row).filter(
            (key) => key !== "_id" && key !== "__table"
        );
        expect(fields.sort()).toEqual(
            [
                "attestationAuthor",
                "author",
                "authorId",
                "createdAt",
                "deployment",
                "deploymentKind",
                "gameId",
                "note",
                "positionKey",
                "storedAt",
                "verdictHash",
            ].sort()
        );
        expect(row.verdictHash).toBe(VERDICT_ID);
        expect(row.storedAt).toBe(1_800_000_000_000);
    });

    it("a failed upload leaves the row fat and pending", async () => {
        const { stub, id } = await submitted();
        const store: VerdictStoreWriter = {
            ...createMemoryVerdictStore(),
            put: async () => {
                throw new Error("503 Service Unavailable");
            },
        };

        const report = await drainOutbox(harnessPorts(stub, id, store));

        expect(report.stored).toBe(0);
        expect(report.pending).toEqual([
            { rowId: id, reason: "upload failed: 503 Service Unavailable" },
        ]);
        for (const field of FAT_FIELDS)
            expect(stub.doc(id)).toHaveProperty(field);
        expect(stub.doc(id).storedAt).toBeUndefined();
    });

    it("a verdict object the store does not hold on re-read is not confirmed", async () => {
        const { stub, id } = await submitted();
        const report = await drainOutbox(
            harnessPorts(stub, id, droppingStore("verdicts/"))
        );
        expect(report.pending).toHaveLength(1);
        expect(report.pending[0].reason).toContain("is not in the store");
        for (const field of FAT_FIELDS)
            expect(stub.doc(id)).toHaveProperty(field);
    });

    it("an attestation the store does not hold on re-read is not confirmed", async () => {
        const { stub, id } = await submitted();
        const report = await drainOutbox(
            harnessPorts(stub, id, droppingStore("attestations/"))
        );
        expect(report.pending).toHaveLength(1);
        expect(report.pending[0].reason).toContain("attestation");
        for (const field of FAT_FIELDS)
            expect(stub.doc(id)).toHaveProperty(field);
    });

    it("other bytes already under the verdict's name are not a confirmation", async () => {
        const { stub, id } = await submitted();
        const store = createMemoryVerdictStore();
        const other = encodeVerdictObject({
            ...JUDGEMENT,
            answer: { kind: "right", rightIndexes: [0] },
        });
        store.objects.set(verdictObjectName(VERDICT_ID), other.bytes);

        const report = await drainOutbox(harnessPorts(stub, id, store));

        expect(report.pending).toHaveLength(1);
        expect(report.pending[0].reason).toContain("re-read failed");
        for (const field of FAT_FIELDS)
            expect(stub.doc(id)).toHaveProperty(field);
    });

    it("a stamp the judgement no longer hashes to uploads nothing and stays pending", async () => {
        const store = createMemoryVerdictStore();
        const row = {
            ...fatRow("r-1", HERE, "u-tester"),
            verdictHash: `v1-${"0".repeat(64)}`,
        };
        const result = await storeOutboxRow(store, row, HERE);
        expect(result.status).toBe("pending");
        expect(store.objects.size).toBe(0);
    });

    it("markStored re-derives the hash itself and refuses one the row does not hash to", async () => {
        const { stub, id } = await submitted();
        await expect(
            runMutation(markStored, stub.ctx, {
                rowId: id,
                verdictHash: `v1-${"0".repeat(64)}`,
                positionKey: positionKeyOf(JUDGEMENT),
                attestationAuthor: "jovial-guineapig-250:u-tester",
                deployment: "jovial-guineapig-250",
                deploymentKind: "cloud",
                storedAt: 1,
            })
        ).rejects.toThrow("hashes to");
        for (const field of FAT_FIELDS)
            expect(stub.doc(id)).toHaveProperty(field);
    });
});

describe("re-running the drain is idempotent (issue #3580)", () => {
    it("a second upload of a stored row writes no second object and no second attestation", async () => {
        const store = createMemoryVerdictStore();
        const row = fatRow("r-1", HERE, "u-tester");

        const first = await storeOutboxRow(store, row, HERE);
        const snapshot = new Map(
            [...store.objects].map(([name, bytes]) => [name, bytes.slice()])
        );
        // The slimming was lost — the row is drained again, fat.
        const second = await storeOutboxRow(store, row, HERE);

        expect(first).toMatchObject({
            status: "stored",
            verdict: "created",
            attestation: "created",
        });
        expect(second).toMatchObject({
            status: "stored",
            verdict: "exists",
            attestation: "exists",
        });
        expect(store.objects).toEqual(snapshot);
    });

    it("draining a row already slimmed changes nothing", async () => {
        const { stub, id } = await submitted();
        const store = createMemoryVerdictStore();
        await drainOutbox(harnessPorts(stub, id, store));
        const slim = { ...stub.doc(id) };
        const objects = store.objects.size;

        expect(
            await storeOutboxRow(store, slim as unknown as OutboxRow, HERE)
        ).toEqual({ status: "already-slim", rowId: id });
        expect(
            await runMutation(markStored, stub.ctx, {
                rowId: id,
                verdictHash: VERDICT_ID,
                positionKey: positionKeyOf(JUDGEMENT),
                attestationAuthor: "jovial-guineapig-250:u-tester",
                deployment: "jovial-guineapig-250",
                deploymentKind: "cloud",
                storedAt: 2,
            })
        ).toBe("already-slim");
        expect(stub.doc(id)).toEqual(slim);
        expect(store.objects.size).toBe(objects);
    });
});

describe("one judgement on two deployments (issue #3580, ADR 0128 §3/§4)", () => {
    it("is ONE verdict object and TWO attestations", async () => {
        const store = createMemoryVerdictStore();
        const prod: VerdictDeployment = {
            name: "jovial-guineapig-250",
            kind: "cloud",
        };
        const dev: VerdictDeployment = { name: "local-3210", kind: "local" };

        await storeOutboxRow(store, fatRow("p-1", prod, "k17prod"), prod);
        await storeOutboxRow(store, fatRow("d-1", dev, "j57dev"), dev);

        expect(await store.list("verdicts/")).toEqual([
            verdictObjectName(VERDICT_ID),
        ]);
        expect(await store.list("attestations/")).toEqual([
            attestationObjectName(VERDICT_ID, "jovial-guineapig-250:k17prod"),
            attestationObjectName(VERDICT_ID, "local-3210:j57dev"),
        ]);
        expect(
            (await readAttestation(store, VERDICT_ID, "local-3210:j57dev"))
                ?.deploymentKind
        ).toBe("local");
    });
});

describe("the attestation's author is ${deployment}:${userId} (issue #3580)", () => {
    it("names the deployment and the user id — no email, no nickname in the object", async () => {
        const { stub, id } = await submitted();
        const store = createMemoryVerdictStore();
        await drainOutbox(harnessPorts(stub, id, store));

        const [name] = await store.list("attestations/");
        const text = new TextDecoder().decode(store.objects.get(name)!);
        expect(JSON.parse(text).author).toBe("jovial-guineapig-250:u-tester");
        expect(text).not.toContain("Tessa");
        expect(text).not.toContain("tessa@example.com");
    });

    it("a row from before the outbox is attributed to this deployment and its author id", async () => {
        const store = createMemoryVerdictStore();
        // Written before the outbox: no stamps, no attribution.
        const legacy = fatRow("old-1", HERE, "u-old");
        delete legacy.verdictHash;
        delete legacy.positionKey;
        delete legacy.attestationAuthor;
        delete legacy.deployment;
        delete legacy.deploymentKind;

        const result = await storeOutboxRow(store, legacy, HERE);

        expect(result).toMatchObject({
            status: "stored",
            attestationAuthor: "jovial-guineapig-250:u-old",
        });
    });

    it("refuses an email or a nickname as an author", () => {
        expect(() =>
            verdictAuthorOf("jovial-guineapig-250", "tessa@example.com")
        ).toThrow("Not a verdict author");
        expect(() => attestationObjectName(VERDICT_ID, "Tessa")).toThrow(
            "Not a verdict author"
        );
    });
});

describe("attestation objects are verified against their names (issue #3580)", () => {
    const attestation = {
        verdictId: VERDICT_ID,
        author: "jovial-guineapig-250:u-tester",
        sourceAxis: "explicit" as const,
        createdAt: 1,
    };

    it("round-trips", () => {
        const { name, bytes } = encodeAttestationObject(attestation);
        expect(decodeAttestationObject(name, bytes)).toEqual(attestation);
    });

    it("refuses an attestation stored under another author's name", () => {
        const { bytes } = encodeAttestationObject(attestation);
        const name = attestationObjectName(VERDICT_ID, "local-3210:someone");
        expect(() => decodeAttestationObject(name, bytes)).toThrow(
            VerdictStoreIntegrityError
        );
    });

    it("refuses a field outside the attestation, and non-canonical bytes", () => {
        const { name } = encodeAttestationObject(attestation);
        const extra = new TextEncoder().encode(
            JSON.stringify({ ...attestation, email: "tessa@example.com" })
        );
        expect(() => decodeAttestationObject(name, extra)).toThrow(
            VerdictStoreIntegrityError
        );
        const pretty = new TextEncoder().encode(
            JSON.stringify(attestation, null, 2)
        );
        expect(() => decodeAttestationObject(name, pretty)).toThrow(
            VerdictStoreIntegrityError
        );
    });
});

// ── The judge's reading (issue #10086, PRD #10083) ────────────────────────────

const SECOND_TESTER: Row = {
    _id: "u-second",
    __table: "users",
    nickname: "Sam",
    email: "sam@example.com",
    isTester: true,
};

/** A reading with every field filled: Plan, words, grade, alternatives. */
const READING: AttestedReading = {
    plan: { text: "race: burn face every turn, hold nothing back", seq: 40 },
    rationale: "the blocker is the only thing between me and lethal",
    grade: "preferred",
    acceptedIndexes: [0],
};

/** Drain ports over EVERY verdict row of one harness stub. */
function allRowsPorts(
    stub: MutationStub,
    ids: string[],
    store: VerdictStoreWriter
): OutboxDrainPorts {
    return {
        ...harnessPorts(stub, ids[0], store),
        pendingPage: async () => ({
            rows: ids
                .map((id) => stub.doc(id))
                .filter((row) => row.storedAt === undefined)
                .map((row) => row as unknown as OutboxRow),
            cursor: "",
            isDone: true,
        }),
    };
}

describe("the judge's reading travels with the attestation (issue #10086)", () => {
    it("arrives intact from submit through the outbox into the store, and back", async () => {
        const stub = makeMutationCtx("u-tester", [TESTER]);
        const id = (await runMutation(submit, stub.ctx, {
            ...ARGS,
            ...READING,
        })) as unknown as string;
        const store = createMemoryVerdictStore();

        expect(await drainOutbox(harnessPorts(stub, id, store))).toEqual({
            stored: 1,
            alreadySlim: 0,
            pending: [],
        });

        const author = "jovial-guineapig-250:u-tester";
        const stored = await readAttestation(store, VERDICT_ID, author);
        expect(stored).toMatchObject(READING);
        expect({
            plan: stored?.plan,
            rationale: stored?.rationale,
            grade: stored?.grade,
            acceptedIndexes: stored?.acceptedIndexes,
        }).toEqual(READING);
        // The answer is the judgement; an accepted alternative never joins it.
        expect(await readVerdict(store, VERDICT_ID)).toEqual(JUDGEMENT);
        // Read back as the review surface reads the whole store.
        const corpus = await readStoredCorpus(store);
        expect(corpus.attestations).toHaveLength(1);
        expect(corpus.attestations[0]).toMatchObject(READING);
    });

    it("two testers grading one position differently are ONE verdict with two attestations, never contested", async () => {
        const stub = makeMutationCtx("u-tester", [TESTER, SECOND_TESTER]);
        const first = (await runMutation(submit, stub.ctx, {
            ...ARGS,
            ...READING,
        })) as unknown as string;
        const second = (await runMutation(submit, stub.asUser("u-second"), {
            ...ARGS,
            plan: { text: "stabilise first" },
            rationale: "close call either way",
            grade: "indifferent",
        })) as unknown as string;
        expect(stub.doc(second).verdictHash).toBe(stub.doc(first).verdictHash);
        expect(stub.doc(second).positionKey).toBe(stub.doc(first).positionKey);

        const store = createMemoryVerdictStore();
        await drainOutbox(allRowsPorts(stub, [first, second], store));

        expect(await store.list("verdicts/")).toEqual([
            verdictObjectName(VERDICT_ID),
        ]);
        const corpus = await readStoredCorpus(store);
        expect(corpus.attestations.map((a) => a.grade).sort()).toEqual([
            "indifferent",
            "preferred",
        ]);
        const quarantine = quarantineContestedPositions(
            corpus.verdicts,
            corpus.attestations,
            corpus.resolutions
        );
        expect(quarantine.contested).toEqual([]);
        expect(quarantine.promotable.map((v) => v.verdictId)).toEqual([
            VERDICT_ID,
        ]);
        expect(quarantine.promotable[0].attestations).toHaveLength(2);
    });

    it("the outbox row drops the reading with the judgement once stored", async () => {
        const stub = makeMutationCtx("u-tester", [TESTER]);
        const id = (await runMutation(submit, stub.ctx, {
            ...ARGS,
            ...READING,
        })) as unknown as string;
        expect(stub.doc(id)).toMatchObject(READING);
        await drainOutbox(harnessPorts(stub, id, createMemoryVerdictStore()));
        for (const field of Object.keys(READING)) {
            expect(stub.doc(id), field).not.toHaveProperty(field);
        }
    });
});

describe("an attestation written before the reading existed (issue #10086)", () => {
    // Bytes as the store held them before issue #10086, written out by hand:
    // re-encoding with today's code would prove only that today agrees with
    // itself.
    const name = attestationObjectName(
        "v1-" + "a".repeat(64),
        "jovial-guineapig-250:u-tester"
    );
    const legacy =
        '{"author":"jovial-guineapig-250:u-tester","botPickIndex":0,' +
        '"createdAt":1700000000000,"deployment":"jovial-guineapig-250",' +
        '"deploymentKind":"cloud","gameId":"game-7","note":"bolt it",' +
        '"seq":42,"sourceAxis":"explicit","verdictId":"v1-' +
        "a".repeat(64) +
        '"}';

    it("decodes unchanged, with no reading field", () => {
        const decoded = decodeAttestationObject(
            name,
            new TextEncoder().encode(legacy)
        );
        expect(decoded).toEqual(JSON.parse(legacy));
        expect(encodeAttestationObject(decoded).bytes).toEqual(
            new TextEncoder().encode(legacy)
        );
    });
});

describe("a stored reading is verified like every other field (issue #10086)", () => {
    const base = {
        verdictId: VERDICT_ID,
        author: "jovial-guineapig-250:u-tester",
        sourceAxis: "explicit" as const,
        createdAt: 1,
    };

    it("round-trips a full reading", () => {
        const { name, bytes } = encodeAttestationObject({
            ...base,
            ...READING,
        });
        expect(decodeAttestationObject(name, bytes)).toEqual({
            ...base,
            ...READING,
        });
    });

    it.each([
        ["a grade outside the closed set", { grade: "maybe" }],
        [
            "alternatives without a preferred grade",
            { grade: "clear", acceptedIndexes: [0] },
        ],
        [
            "an empty list of alternatives",
            { grade: "preferred", acceptedIndexes: [] },
        ],
        ["a plan with no words", { plan: { text: "  " } }],
        ["a plan that is not an object", { plan: "race" }],
    ])("refuses %s", (_label, reading) => {
        const { name } = encodeAttestationObject(base);
        const bytes = new TextEncoder().encode(
            canonicalJsonOf({ ...base, ...reading })
        );
        expect(() => decodeAttestationObject(name, bytes)).toThrow(
            VerdictStoreIntegrityError
        );
    });
});

describe("verdictDeploymentOf (issue #3580)", () => {
    it("names a cloud deployment by its Convex name", () => {
        expect(verdictDeploymentOf(CLOUD_URL)).toEqual(HERE);
    });

    it("marks a local backend as local", () => {
        expect(verdictDeploymentOf("http://127.0.0.1:3210")).toEqual({
            name: "local-3210",
            kind: "local",
        });
    });

    it("fails closed on a deployment that cannot say where it is", () => {
        expect(() => verdictDeploymentOf(undefined)).toThrow(
            "cannot attribute a verdict"
        );
        expect(() => verdictDeploymentOf("not a url")).toThrow(
            "cannot attribute a verdict"
        );
    });
});
