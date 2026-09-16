// The Verdict Store's two credentials, as DECISIONS (issue #3576, ADR 0128).
//
// "Two credentials, never one": the WRITE credential lives only in deployment
// environment variables; development machines hold a READ-ONLY one. Three
// layers keep them apart, and only the first is outside this repository:
//
//  1. IAM — the reader service account holds `roles/storage.objectViewer` and
//     nothing else, so its key cannot write whatever code presents it
//     (`docs/guides/verdict-store.md` provisions it).
//  2. OAuth scope — a token minted for reading asks for `devstorage.read_only`,
//     so even a misgranted reader account yields a token that cannot write.
//  3. Role check — each side refuses the OTHER side's key by the service
//     account's name. A development machine pointed at the writer key fails
//     loudly at construction, instead of quietly holding a key that ADR 0128
//     says must never be there.
//
// Pure and dependency-free: the transport (`verdictStoreGcs.ts`, a `"use
// node"` module) and the machine reader (`scripts/lib/verdict-store.ts`) both
// import it, and neither of them decides anything this file does not.

/** The one bucket (ADR 0128 §1). Not a secret — privacy is IAM's job, and a
 *  constant cannot drift between deployments the way an env var can. */
export const VERDICT_STORE_BUCKET = "tolaria-verdict-store";

export type VerdictStoreAccess = "read" | "write";

/** The OAuth scope a token for each access is minted with. The read scope
 *  cannot create an object even if IAM were to allow it. */
export const VERDICT_STORE_OAUTH_SCOPE: Readonly<
    Record<VerdictStoreAccess, string>
> = {
    read: "https://www.googleapis.com/auth/devstorage.read_only",
    write: "https://www.googleapis.com/auth/devstorage.read_write",
};

/** The service account each access must present, by the local part of its
 *  e-mail (`<name>@<project>.iam.gserviceaccount.com`). */
export const VERDICT_STORE_SERVICE_ACCOUNT: Readonly<
    Record<VerdictStoreAccess, string>
> = {
    read: "verdict-store-reader",
    write: "verdict-store-writer",
};

/** The deployment env var holding the READER's JSON key (issue #3746). A
 *  deployment without the write key — a local backend — reads the whole store
 *  with it, for review. Reading is what development machines already hold
 *  (ADR 0128), so the reader key in a local backend's environment stays inside
 *  the rule; the writer's key there still does not. */
export const VERDICT_STORE_READ_KEY_ENV = "VERDICT_STORE_READ_KEY";

/** The fields of a Google service-account JSON key the transport uses. */
export interface ServiceAccountKey {
    clientEmail: string;
    privateKey: string;
    tokenUri: string;
}

const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

/** Parse a service-account JSON key. `source` names where it came from (an
 *  env var, a file path) for the error — the key text itself is NEVER echoed,
 *  not even a prefix of it. */
export function parseServiceAccountKey(
    text: string,
    source: string
): ServiceAccountKey {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        throw new Error(`${source} is not a JSON service-account key`);
    }
    const key = (raw ?? {}) as Record<string, unknown>;
    if (key.type !== "service_account") {
        throw new Error(`${source} is not a service-account key`);
    }
    for (const field of ["client_email", "private_key"] as const) {
        if (typeof key[field] !== "string" || key[field] === "") {
            throw new Error(`${source} has no ${field}`);
        }
    }
    return {
        clientEmail: key.client_email as string,
        privateKey: key.private_key as string,
        tokenUri:
            typeof key.token_uri === "string" && key.token_uri !== ""
                ? key.token_uri
                : DEFAULT_TOKEN_URI,
    };
}

/** Refuse a key presented for the wrong access. The reader side refusing the
 *  writer's key is what makes "the write credential is absent from every
 *  development-machine path" a check instead of a hope. */
export function assertCredentialRole(
    key: ServiceAccountKey,
    access: VerdictStoreAccess,
    source: string
): void {
    const expected = VERDICT_STORE_SERVICE_ACCOUNT[access];
    const actual = key.clientEmail.split("@")[0];
    if (actual !== expected) {
        throw new Error(
            `${source} holds the ${actual} service account; ${access} access ` +
                `takes ${expected} and nothing else (ADR 0128 — two credentials, never one)`
        );
    }
}
