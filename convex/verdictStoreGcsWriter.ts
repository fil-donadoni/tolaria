"use node";

// The Verdict Store over Google Cloud Storage, WRITE side (issue #3576, ADR
// 0128 — two credentials, never one). Constructed only inside a Convex action,
// from the deployment's own environment. Nothing under `scripts/` or `src/`
// imports this module or names what it exports
// (`scripts/__tests__/verdict-store-credentials.test.ts`) — a tripwire, not a
// boundary: the boundary is that a development machine never holds the
// writer's key (`docs/guides/verdict-store.md`).
//
// No-overwrite is enforced by the bucket, not by a read-then-write race: the
// upload carries `ifGenerationMatch=0` ("only if no live object has this
// name"), and GCS answers 412 when one does. The writer's IAM grant has no
// delete permission, which an overwrite would need; should GCS answer that
// with 403 before evaluating the precondition, a `get` that finds the object
// reads it as "exists" too — and a 403 on a name that is NOT there stays an
// error.

import type {
    VerdictStorePutOutcome,
    VerdictStoreWriter,
} from "./verdictStore";
import {
    VERDICT_STORE_BUCKET,
    assertCredentialRole,
    parseServiceAccountKey,
    type ServiceAccountKey,
} from "./verdictStoreCredentials";
import { gcsFail, gcsReader, gcsTokenSource } from "./verdictStoreGcs";

/** The deployment env var holding the writer's JSON key. Set on CLOUD Convex
 *  deployments only — never in a `.env*` file, never on a local backend. */
export const VERDICT_STORE_WRITE_KEY_ENV = "VERDICT_STORE_WRITE_KEY";

const UPLOAD_API = "https://storage.googleapis.com/upload/storage/v1/b";

/** The writing store. Construct it only inside a Convex action. */
export function createGcsVerdictStoreWriter(
    key: ServiceAccountKey,
    bucket: string = VERDICT_STORE_BUCKET
): VerdictStoreWriter {
    const token = gcsTokenSource(key, "write");
    const read = gcsReader(bucket, token);
    return {
        ...read,
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
            if (response.status === 403 && (await read.get(name)) !== null) {
                return "exists";
            }
            if (!response.ok) await gcsFail(`put ${name}`, response);
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
