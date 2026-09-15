// The Verdict Store as a development machine sees it: READ-ONLY (issue #3576,
// ADR 0128 — two credentials, never one).
//
// A machine holds the reader service account's JSON key in a file OUTSIDE
// every checkout — `~/.config/tolaria/verdict-store-reader.json` by default,
// or wherever `VERDICT_STORE_READ_KEY_FILE` points — so no worktree, `.env*`
// file or `land` teardown ever carries it. The write credential has no path
// here at all: this module can only build a `VerdictStoreReader`, and it
// refuses a key that belongs to the writer service account
// (`assertCredentialRole`), so a machine handed the wrong key fails at
// construction rather than holding it quietly.
//
// Provisioning: `docs/guides/verdict-store.md`.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { VerdictStoreReader } from "../../convex/verdictStore";
import {
    assertCredentialRole,
    parseServiceAccountKey,
} from "../../convex/verdictStoreCredentials";
import { createGcsVerdictStoreReader } from "../../convex/verdictStoreGcs";

/** Overrides where the read key file is looked for. */
export const VERDICT_STORE_READ_KEY_FILE_ENV = "VERDICT_STORE_READ_KEY_FILE";

/** Where this machine's read key is expected. */
export function verdictStoreReadKeyPath(
    env: NodeJS.ProcessEnv,
    home: string
): string {
    const override = env[VERDICT_STORE_READ_KEY_FILE_ENV];
    return override !== undefined && override !== ""
        ? override
        : join(home, ".config", "tolaria", "verdict-store-reader.json");
}

/** The read-only Verdict Store for this machine. Throws, naming the path and
 *  the guide, when no read key is there or the key is not the reader's. */
export function machineVerdictStoreReader(
    env: NodeJS.ProcessEnv = process.env,
    home: string = homedir()
): VerdictStoreReader {
    const path = verdictStoreReadKeyPath(env, home);
    if (!existsSync(path)) {
        throw new Error(
            `No Verdict Store read key at ${path} ` +
                "(docs/guides/verdict-store.md § Development machine)"
        );
    }
    const key = parseServiceAccountKey(readFileSync(path, "utf8"), path);
    assertCredentialRole(key, "read", path);
    return createGcsVerdictStoreReader(key);
}
