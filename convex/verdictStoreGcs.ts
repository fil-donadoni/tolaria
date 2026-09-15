"use node";

// The Verdict Store over Google Cloud Storage (issue #3576, ADR 0128) — the
// THIN half of the port. It turns `get` / `put` / `list` into JSON-API calls
// and decides nothing: names, bytes, verification and which credential is
// acceptable are all above it (`verdictStore.ts`, `verdictStoreCredentials.ts`),
// exercised against the in-memory fake. Nothing here is tested, by the
// convention `scripts/lib/seed-scenario-run.ts` documents, and so nothing here
// may grow a branch worth testing.
//
// `"use node"` because signing a service-account JWT needs `node:crypto`. The
// module imports no engine code, keeping its separate esbuild graph small
// (`scripts/__tests__/convex-node-bundle-seam.test.ts`). Scripts on a
// development machine import it too, for the READER only.
//
// No-overwrite is enforced by the bucket, not by a read-then-write race: the
// upload carries `ifGenerationMatch=0` ("only if no live object has this
// name"), and GCS answers 412 when one does. The writer's IAM grant has no
// delete permission either, which an overwrite would need.

import { createSign } from "node:crypto";
import type {
    VerdictStorePutOutcome,
    VerdictStoreReader,
    VerdictStoreWriter,
} from "./verdictStore";
import {
    VERDICT_STORE_BUCKET,
    VERDICT_STORE_OAUTH_SCOPE,
    assertCredentialRole,
    parseServiceAccountKey,
    type ServiceAccountKey,
    type VerdictStoreAccess,
} from "./verdictStoreCredentials";

/** The deployment env var holding the writer's JSON key. Set on Convex
 *  deployments ONLY — never in a `.env*` file, never on a machine
 *  (`scripts/__tests__/verdict-store-credentials.test.ts` keeps it out of
 *  `scripts/` and `src/`). */
export const VERDICT_STORE_WRITE_KEY_ENV = "VERDICT_STORE_WRITE_KEY";

const API = "https://storage.googleapis.com/storage/v1/b";
const UPLOAD_API = "https://storage.googleapis.com/upload/storage/v1/b";

type TokenSource = () => Promise<string>;

function base64url(text: string): string {
    return Buffer.from(text, "utf8").toString("base64url");
}

/** OAuth2 JWT-bearer flow for a service account, cached until a minute
 *  before expiry. */
function tokenSource(
    key: ServiceAccountKey,
    access: VerdictStoreAccess
): TokenSource {
    let cached: { token: string; expiresAt: number } | null = null;
    return async () => {
        const now = Math.floor(Date.now() / 1000);
        if (cached !== null && cached.expiresAt - 60 > now) return cached.token;
        const unsigned = `${base64url(
            JSON.stringify({ alg: "RS256", typ: "JWT" })
        )}.${base64url(
            JSON.stringify({
                iss: key.clientEmail,
                scope: VERDICT_STORE_OAUTH_SCOPE[access],
                aud: key.tokenUri,
                iat: now,
                exp: now + 3600,
            })
        )}`;
        const signature = createSign("RSA-SHA256")
            .update(unsigned)
            .sign(key.privateKey)
            .toString("base64url");
        const response = await fetch(key.tokenUri, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
                assertion: `${unsigned}.${signature}`,
            }),
        });
        if (!response.ok) await fail("token exchange", response);
        const body = (await response.json()) as {
            access_token: string;
            expires_in: number;
        };
        cached = { token: body.access_token, expiresAt: now + body.expires_in };
        return cached.token;
    };
}

async function fail(what: string, response: Response): Promise<never> {
    const text = (await response.text()).slice(0, 500);
    throw new Error(
        `Verdict Store ${what} failed: HTTP ${response.status} ${text}`
    );
}

function objectUrl(bucket: string, name: string): string {
    return `${API}/${bucket}/o/${encodeURIComponent(name)}?alt=media`;
}

function reader(bucket: string, token: TokenSource): VerdictStoreReader {
    return {
        async get(name) {
            const response = await fetch(objectUrl(bucket, name), {
                headers: { authorization: `Bearer ${await token()}` },
            });
            if (response.status === 404) return null;
            if (!response.ok) await fail(`get ${name}`, response);
            return new Uint8Array(await response.arrayBuffer());
        },
        async list(prefix) {
            const names: string[] = [];
            let pageToken: string | undefined;
            do {
                const query = new URLSearchParams({
                    prefix,
                    fields: "items(name),nextPageToken",
                    ...(pageToken !== undefined ? { pageToken } : {}),
                });
                const response = await fetch(`${API}/${bucket}/o?${query}`, {
                    headers: { authorization: `Bearer ${await token()}` },
                });
                if (!response.ok) await fail(`list ${prefix}`, response);
                const page = (await response.json()) as {
                    items?: { name: string }[];
                    nextPageToken?: string;
                };
                for (const item of page.items ?? []) names.push(item.name);
                pageToken = page.nextPageToken;
            } while (pageToken !== undefined);
            return names.sort();
        },
    };
}

/** A read-only store. The token it mints cannot write, and the object it
 *  returns has no `put`. */
export function createGcsVerdictStoreReader(
    key: ServiceAccountKey,
    bucket: string = VERDICT_STORE_BUCKET
): VerdictStoreReader {
    return reader(bucket, tokenSource(key, "read"));
}

/** The writing store. Construct it only inside a Convex action. */
export function createGcsVerdictStoreWriter(
    key: ServiceAccountKey,
    bucket: string = VERDICT_STORE_BUCKET
): VerdictStoreWriter {
    const token = tokenSource(key, "write");
    return {
        ...reader(bucket, token),
        async put(name, bytes, contentType): Promise<VerdictStorePutOutcome> {
            const query = new URLSearchParams({
                uploadType: "media",
                name,
                ifGenerationMatch: "0",
            });
            const response = await fetch(`${UPLOAD_API}/${bucket}/o?${query}`, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${await token()}`,
                    "content-type": contentType,
                },
                // `slice()` narrows the buffer to a plain ArrayBuffer,
                // which is what `BlobPart` accepts.
                body: new Blob([bytes.slice()]),
            });
            if (response.status === 412) return "exists";
            if (!response.ok) await fail(`put ${name}`, response);
            return "created";
        },
    };
}

/** The writer, from THIS deployment's environment. Throws when the key is
 *  absent or is not the writer's. */
export function verdictStoreWriterFromDeploymentEnv(): VerdictStoreWriter {
    const text = process.env[VERDICT_STORE_WRITE_KEY_ENV];
    if (text === undefined || text === "") {
        throw new Error(
            `${VERDICT_STORE_WRITE_KEY_ENV} is not set on this deployment ` +
                "(docs/guides/verdict-store.md)"
        );
    }
    const key = parseServiceAccountKey(text, VERDICT_STORE_WRITE_KEY_ENV);
    assertCredentialRole(key, "write", VERDICT_STORE_WRITE_KEY_ENV);
    return createGcsVerdictStoreWriter(key);
}
