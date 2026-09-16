// A local deployment reviews the whole Verdict Store (issue #3746, ADR 0128 §6):
// with the READER key in its environment, the registered `review` action reads
// the bucket plus its own rows not yet forwarded, deduplicated by verdict id;
// without it, the outbox alone, as before.
//
// The action is driven through `_handler` with a stub ctx. The bucket is the
// in-memory store behind a fetch that speaks the GCS JSON API: the OAuth token
// exchange, `list`, `get ?alt=media`. So the path under test is the deployed
// one — env → key → role check → token → listing → decode → merge.
//
// A `.bot.test.ts` because it derives ids through `convex/gre/ai/verdicts`.

import { generateKeyPairSync } from "node:crypto";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    positionKeyOf,
    verdictIdOf,
    type VerdictJudgement,
} from "../gre/ai/verdicts/identity";
import {
    VERDICT_STORE_BUCKET,
    VERDICT_STORE_OAUTH_SCOPE,
} from "../verdictStoreCredentials";
import { putAttestation, putVerdict } from "../verdictStore";
import {
    createMemoryVerdictStore,
    type MemoryVerdictStore,
} from "../verdictStoreMemory";
import type { VerdictReview } from "../verdictReview";
import { review } from "../verdictReviewActions";
import type { OutboxRow } from "../verdictsOutbox";

type Handler = {
    _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
};

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const TOKEN_URI = "https://oauth2.test/token";
const API = `https://storage.googleapis.com/storage/v1/b/${VERDICT_STORE_BUCKET}/o`;

const keyText = (account: string) =>
    JSON.stringify({
        type: "service_account",
        client_email: `${account}@proj.iam.gserviceaccount.com`,
        private_key: PEM,
        token_uri: TOKEN_URI,
    });

const POSITION: Omit<VerdictJudgement, "answer"> = {
    spec: { cards: [{ name: "Mountain", owner: "me" }] },
    seat: "me",
    candidates: [
        { key: '{"kind":"pass"}', description: "pass" },
        { key: '{"kind":"cast-spell"}', description: "cast Lightning Bolt" },
    ],
};
const PASS: VerdictJudgement = {
    ...POSITION,
    answer: { kind: "right", rightIndexes: [0] },
};
const BOLT: VerdictJudgement = {
    ...POSITION,
    answer: { kind: "right", rightIndexes: [1] },
};

/** A production tester's PASS, already in the bucket. */
async function bucketWithProductionPass(): Promise<MemoryVerdictStore> {
    const store = createMemoryVerdictStore();
    await putVerdict(store, PASS);
    await putAttestation(store, {
        verdictId: verdictIdOf(PASS),
        author: "jovial-guineapig-250:u-prod",
        sourceAxis: "explicit",
        createdAt: 10,
        deployment: "jovial-guineapig-250",
        deploymentKind: "cloud",
    });
    return store;
}

/** A fat local row, not yet forwarded. */
const localRow = (id: string, judgement: VerdictJudgement): OutboxRow => ({
    _id: id,
    ...judgement,
    author: "Owner",
    authorId: "u-owner",
    attestationAuthor: "local-3210:u-owner",
    deployment: "local-3210",
    deploymentKind: "local",
    createdAt: 20,
    verdictHash: verdictIdOf(judgement),
    positionKey: positionKeyOf(judgement),
});

/** GCS over `store`, recording every URL and the token's requested scope. */
function stubGcs(store: MemoryVerdictStore) {
    const urls: string[] = [];
    const scopes: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
        urls.push(url);
        if (url === TOKEN_URI) {
            const assertion = new URLSearchParams(String(init?.body)).get(
                "assertion"
            )!;
            const claims = JSON.parse(
                Buffer.from(assertion.split(".")[1], "base64url").toString()
            ) as { scope: string };
            scopes.push(claims.scope);
            return Response.json({ access_token: "tok", expires_in: 3600 });
        }
        const parsed = new URL(url);
        if (parsed.searchParams.get("alt") === "media") {
            const name = decodeURIComponent(
                parsed.pathname.split("/o/")[1] ?? ""
            );
            const bytes = await store.get(name);
            return bytes === null
                ? new Response("", { status: 404 })
                : new Response(bytes.slice());
        }
        if (`${parsed.origin}${parsed.pathname}` === API) {
            const names = await store.list(
                parsed.searchParams.get("prefix") ?? ""
            );
            return Response.json({ items: names.map((name) => ({ name })) });
        }
        return new Response("unexpected", { status: 500 });
    });
    return { urls, scopes };
}

function reviewCtx(rows: OutboxRow[]) {
    return {
        runQuery: async (ref: never) => {
            const name = getFunctionName(ref);
            if (name === "verdictResolutions:reviewOutbox") {
                return { verdictRows: rows, resolutionRows: [] };
            }
            if (name === "verdictResolutions:authorNicknames") {
                return [{ userId: "u-owner", nickname: "Owner" }];
            }
            throw new Error(`unexpected query ${name}`);
        },
        runMutation: async () => {
            throw new Error("review writes nothing");
        },
    };
}

const runReview = async (rows: OutboxRow[]) =>
    (await (review as unknown as Handler)._handler(
        reviewCtx(rows),
        {}
    )) as VerdictReview;

beforeEach(() => {
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    vi.stubEnv("VERDICT_STORE_WRITE_KEY", "");
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe("a local deployment's review with the reader key (issue #3746)", () => {
    it("lists a position contested between the bucket and its own outbox, deduplicated by verdict id", async () => {
        vi.stubEnv("VERDICT_STORE_READ_KEY", keyText("verdict-store-reader"));
        const { scopes } = stubGcs(await bucketWithProductionPass());

        // The owner judged PASS too (the same verdict id the bucket holds)
        // and BOLT: one position, two verdicts, PASS attested twice.
        const result = await runReview([
            localRow("r-pass", PASS),
            localRow("r-bolt", BOLT),
        ]);

        expect(result.storeRead).toBe(true);
        expect(scopes).toEqual([VERDICT_STORE_OAUTH_SCOPE.read]);
        expect(result.positions).toHaveLength(1);
        const [position] = result.positions;
        expect(position.status).toBe("contested");
        expect(position.verdicts.map((v) => v.verdictId).sort()).toEqual(
            [verdictIdOf(PASS), verdictIdOf(BOLT)].sort()
        );
        const pass = position.verdicts.find(
            (v) => v.verdictId === verdictIdOf(PASS)
        )!;
        expect(pass.attestations.map((a) => a.author).sort()).toEqual([
            "jovial-guineapig-250:u-prod",
            "local-3210:u-owner",
        ]);
    });

    it("sees a production contest the local outbox has no part in", async () => {
        vi.stubEnv("VERDICT_STORE_READ_KEY", keyText("verdict-store-reader"));
        const store = await bucketWithProductionPass();
        await putVerdict(store, BOLT);
        await putAttestation(store, {
            verdictId: verdictIdOf(BOLT),
            author: "jovial-guineapig-250:u-other",
            sourceAxis: "explicit",
        });
        stubGcs(store);

        const result = await runReview([]);

        expect(result.positions.map((p) => p.status)).toEqual(["contested"]);
    });

    it("reads with the write key when a deployment holds both", async () => {
        vi.stubEnv("VERDICT_STORE_WRITE_KEY", keyText("verdict-store-writer"));
        vi.stubEnv("VERDICT_STORE_READ_KEY", keyText("verdict-store-reader"));
        const { scopes } = stubGcs(await bucketWithProductionPass());

        const result = await runReview([localRow("r-bolt", BOLT)]);

        expect(result.storeRead).toBe(true);
        expect(scopes).toEqual([VERDICT_STORE_OAUTH_SCOPE.write]);
        expect(result.positions).toHaveLength(1);
    });

    it("refuses the writer's key presented as the reader's, by service-account name", async () => {
        vi.stubEnv("VERDICT_STORE_READ_KEY", keyText("verdict-store-writer"));
        const { urls } = stubGcs(createMemoryVerdictStore());

        await expect(runReview([])).rejects.toThrow(
            "VERDICT_STORE_READ_KEY holds the verdict-store-writer service account; read access takes verdict-store-reader"
        );
        expect(urls).toEqual([]);
    });
});

describe("a local deployment's review without the reader key (issue #3746)", () => {
    it("reads its own outbox alone and says so, touching no network", async () => {
        const { urls } = stubGcs(await bucketWithProductionPass());

        const result = await runReview([
            localRow("r-pass", PASS),
            localRow("r-bolt", BOLT),
        ]);

        expect(result.storeRead).toBe(false);
        expect(urls).toEqual([]);
        const [position] = result.positions;
        const pass = position.verdicts.find(
            (v) => v.verdictId === verdictIdOf(PASS)
        )!;
        expect(pass.attestations.map((a) => a.author)).toEqual([
            "local-3210:u-owner",
        ]);
    });
});
