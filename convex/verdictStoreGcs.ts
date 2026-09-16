"use node";

// The Verdict Store over Google Cloud Storage, READ side (issue #3576, ADR
// 0128) — the THIN half of the port. It turns `get` / `list` into JSON-API
// calls and decides nothing: names, bytes, verification and which credential
// is acceptable are all above it (`verdictStore.ts`,
// `verdictStoreCredentials.ts`), exercised against the in-memory fake. By the
// convention `scripts/lib/seed-scenario-run.ts` documents it carries no branch
// worth a test of its own; `scripts/__tests__/verdict-store-credentials.test.ts`
// pins only the request shape the credential split depends on (the token's
// scope).
//
// The WRITE side is `verdictStoreGcsWriter.ts`, a separate module nothing under
// `scripts/` or `src/` imports, so a development machine's import graph does
// not contain the code that writes at all.
//
// `"use node"` because signing a service-account JWT needs `node:crypto`. The
// module imports no engine code, keeping its separate esbuild graph small
// (`scripts/__tests__/convex-node-bundle-seam.test.ts`).

import { createSign } from "node:crypto";
import type { VerdictStoreReader } from "./verdictStore";
import {
    VERDICT_STORE_BUCKET,
    VERDICT_STORE_OAUTH_SCOPE,
    VERDICT_STORE_READ_KEY_ENV,
    assertCredentialRole,
    parseServiceAccountKey,
    type ServiceAccountKey,
    type VerdictStoreAccess,
} from "./verdictStoreCredentials";

const API = "https://storage.googleapis.com/storage/v1/b";

export type GcsTokenSource = () => Promise<string>;

function base64url(text: string): string {
    return Buffer.from(text, "utf8").toString("base64url");
}

/** OAuth2 JWT-bearer flow for a service account, minted with the scope of
 *  `access` and cached until a minute before expiry. */
export function gcsTokenSource(
    key: ServiceAccountKey,
    access: VerdictStoreAccess
): GcsTokenSource {
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
        if (!response.ok) await gcsFail("token exchange", response);
        const body = (await response.json()) as {
            access_token: string;
            expires_in: number;
        };
        cached = { token: body.access_token, expiresAt: now + body.expires_in };
        return cached.token;
    };
}

export async function gcsFail(
    what: string,
    response: Response
): Promise<never> {
    const text = (await response.text()).slice(0, 500);
    throw new Error(
        `Verdict Store ${what} failed: HTTP ${response.status} ${text}`
    );
}

/** `get` / `list` against `bucket`, authorised by `token`. */
export function gcsReader(
    bucket: string,
    token: GcsTokenSource
): VerdictStoreReader {
    return {
        async get(name) {
            const response = await fetch(
                `${API}/${bucket}/o/${encodeURIComponent(name)}?alt=media`,
                { headers: { authorization: `Bearer ${await token()}` } }
            );
            if (response.status === 404) return null;
            if (!response.ok) await gcsFail(`get ${name}`, response);
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
                if (!response.ok) await gcsFail(`list ${prefix}`, response);
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
    return gcsReader(bucket, gcsTokenSource(key, "read"));
}

/** The reader, from THIS deployment's environment (issue #3746), or `null`
 *  when the deployment holds no reader key. A key that is present but is not
 *  the reader's throws — the writer's key is refused by its service-account
 *  name, exactly as the machine reader refuses it. */
export function verdictStoreReaderFromDeploymentEnv(
    env: Record<string, string | undefined> = process.env
): VerdictStoreReader | null {
    const text = env[VERDICT_STORE_READ_KEY_ENV];
    if (text === undefined || text === "") return null;
    const key = parseServiceAccountKey(text, VERDICT_STORE_READ_KEY_ENV);
    assertCredentialRole(key, "read", VERDICT_STORE_READ_KEY_ENV);
    return createGcsVerdictStoreReader(key);
}
