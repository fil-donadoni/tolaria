// The Verdict Store's split credentials (issue #3576, ADR 0128 — two
// credentials, never one). Claims:
//
//  - a development machine's reader refuses the writer's key, and what it
//    returns has no `put`;
//  - the read token is minted with a scope that cannot write;
//  - the GCS writer asks the bucket for create-only and reads 412 as "exists";
//  - nothing under `scripts/` or `src/` can reach the write credential.

import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    VERDICT_STORE_OAUTH_SCOPE,
    parseServiceAccountKey,
} from "../../convex/verdictStoreCredentials";
import { createGcsVerdictStoreWriter } from "../../convex/verdictStoreGcs";
import {
    VERDICT_STORE_READ_KEY_FILE_ENV,
    machineVerdictStoreReader,
} from "../lib/verdict-store";

const REPO = resolve(__dirname, "../..");
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const TOKEN_URI = "https://oauth2.test/token";

function keyText(account: string): string {
    return JSON.stringify({
        type: "service_account",
        client_email: `${account}@proj.iam.gserviceaccount.com`,
        private_key: PEM,
        token_uri: TOKEN_URI,
    });
}

function keyFile(account: string): string {
    const path = join(mkdtempSync(join(tmpdir(), "verdict-store-")), "k.json");
    writeFileSync(path, keyText(account));
    return path;
}

interface Call {
    url: string;
    init: RequestInit | undefined;
}

/** A fetch that answers the token exchange, then `status` for everything else. */
function stubFetch(status: number): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url === TOKEN_URI) {
            return Response.json({ access_token: "tok", expires_in: 3600 });
        }
        return new Response(status === 200 ? "{}" : "", { status });
    });
    return calls;
}

function jwtClaims(call: Call): Record<string, unknown> {
    const assertion = new URLSearchParams(String(call.init?.body)).get(
        "assertion"
    )!;
    return JSON.parse(
        Buffer.from(assertion.split(".")[1], "base64url").toString("utf8")
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("development machine: read-only by construction", () => {
    it("refuses the writer's key, naming both service accounts", () => {
        const env = {
            [VERDICT_STORE_READ_KEY_FILE_ENV]: keyFile("verdict-store-writer"),
        };
        expect(() => machineVerdictStoreReader(env, "/nowhere")).toThrow(
            /verdict-store-writer service account; read access takes verdict-store-reader/
        );
    });

    it("builds from the reader's key a store with no put", () => {
        const env = {
            [VERDICT_STORE_READ_KEY_FILE_ENV]: keyFile("verdict-store-reader"),
        };
        const store = machineVerdictStoreReader(env, "/nowhere");
        expect(typeof store.get).toBe("function");
        expect("put" in store).toBe(false);
    });

    it("names the missing key file and the guide", () => {
        expect(() => machineVerdictStoreReader({}, "/nowhere")).toThrow(
            /\/nowhere\/\.config\/tolaria\/verdict-store-reader\.json.*verdict-store\.md/
        );
    });

    it("mints its token with the read-only scope", async () => {
        const calls = stubFetch(404);
        const env = {
            [VERDICT_STORE_READ_KEY_FILE_ENV]: keyFile("verdict-store-reader"),
        };
        expect(
            await machineVerdictStoreReader(env, "/nowhere").get("verdicts/x")
        ).toBeNull();
        const claims = jwtClaims(calls[0]);
        expect(claims.scope).toBe(
            "https://www.googleapis.com/auth/devstorage.read_only"
        );
        expect(claims.scope).toBe(VERDICT_STORE_OAUTH_SCOPE.read);
    });
});

describe("GCS writer: the bucket enforces no-overwrite", () => {
    const writer = () =>
        createGcsVerdictStoreWriter(
            parseServiceAccountKey(keyText("verdict-store-writer"), "test"),
            "bucket"
        );

    it("uploads create-only (ifGenerationMatch=0)", async () => {
        const calls = stubFetch(200);
        expect(
            await writer().put("verdicts/a", new Uint8Array([1]), "x/y")
        ).toBe("created");
        const upload = new URL(calls[1].url);
        expect(upload.searchParams.get("ifGenerationMatch")).toBe("0");
        expect(upload.searchParams.get("name")).toBe("verdicts/a");
    });

    it("reads the precondition failure of an existing name as 'exists', not an error", async () => {
        stubFetch(412);
        expect(
            await writer().put("verdicts/a", new Uint8Array([1]), "x/y")
        ).toBe("exists");
    });
});

describe("parseServiceAccountKey never echoes the key", () => {
    it("a malformed key's error names the source only", () => {
        const secret = '{"private_key": "-----BEGIN SECRET';
        expect(() => parseServiceAccountKey(secret, "SOURCE")).toThrow(
            /^SOURCE is not a JSON service-account key$/
        );
    });

    it("a key without private_key is refused", () => {
        const text = JSON.stringify({
            type: "service_account",
            client_email: "verdict-store-reader@p.iam.gserviceaccount.com",
        });
        expect(() => parseServiceAccountKey(text, "SOURCE")).toThrow(
            /SOURCE has no private_key/
        );
    });
});

/** Identifiers only a DEPLOYMENT may name: the write key's env var and the
 *  two ways to build a writer. */
const WRITE_PATH = [
    "VERDICT_STORE_WRITE_KEY",
    "createGcsVerdictStoreWriter",
    "verdictStoreWriterFromDeploymentEnv",
];

function sources(dir: string): string[] {
    return readdirSync(dir, { recursive: true, encoding: "utf8" })
        .filter((p) => /\.(ts|tsx|mts|js|mjs|sh)$/.test(p))
        .filter((p) => !p.split(/[\\/]/).includes("node_modules"))
        .map((p) => join(dir, p));
}

describe("the write credential is absent from every development-machine path", () => {
    it("no file under scripts/ or src/ names the write path", () => {
        const self = resolve(__filename);
        const offenders = [
            ...sources(join(REPO, "scripts")),
            ...sources(join(REPO, "src")),
        ]
            .filter((path) => resolve(path) !== self)
            .flatMap((path) => {
                const text = readFileSync(path, "utf8");
                return WRITE_PATH.filter((id) => text.includes(id)).map(
                    (id) => `${relative(REPO, path)}: ${id}`
                );
            });
        expect(offenders).toEqual([]);
    });
});
