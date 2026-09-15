// The Verdict payload's schema versions and the upcaster chain between them
// (issue #3578, PRD #3574, ADR 0128 §8).
//
// SCHEMA CHANGE IS AN UPCAST AT READ. A Verdict Store object is immutable and
// named by the hash of its judgement, so a payload format change never
// rewrites it and never renames it: the reader lifts an old payload one
// version at a time, through `VERDICT_UPCASTERS[n]` (version `n` → `n + 1`),
// until it is `VERDICT_SCHEMA_VERSION`. The lock does not move, so a format
// change cannot masquerade as a corpus change, and the weight-fit guard
// verifies the upcaster for free: an upcast that alters meaning shifts the
// Eval Pairs, the committed weights stop reproducing, the suite goes red.
//
// VERSION 1 IS THE FORMAT THAT HAS NO `schemaVersion` FIELD. A payload that
// omits it is version 1; a payload that states it is that version. The field
// is outside the verdict id's projection (`identity.ts`), so a writer that
// starts stamping it renames nothing — and the canonical objects written
// before any writer stamped it stay readable without a rewrite.
//
// AN UPCAST NEVER RENAMES. The reader re-hashes the LIFTED judgement and
// demands the id the payload was stored under, so an upcaster may change only
// what the verdict id does not cover (a candidate's `description`, fields
// outside the judgement) or re-spell what it covers into the SAME canonical
// value. A change to the judgement itself is not a format change: it is a new
// object, or a new canonicalisation (`v2-`), never an upcast.
//
// AN UPCASTER IS A PURE FUNCTION OF THE OLDER PAYLOAD. No engine access (a
// payload's meaning must not depend on which build reads it — that is the
// failure the weight guard would report as a corpus change), no clock, no
// randomness, no I/O. Enforced two ways: this module may hold only
// `import type` lines and no clock/random/global reads
// (`verdictLockSource.bot.test.ts` scans the source), and the reader hands
// every upcaster a deep-FROZEN copy, so mutating the input throws instead of
// leaking into the caller's payload.

/** The payload version this build reads natively. */
export const VERDICT_SCHEMA_VERSION = 1;

/** The version a payload with no `schemaVersion` field has. */
export const VERDICT_BASE_SCHEMA_VERSION = 1;

/** A payload as an upcaster sees it: plain JSON data, read-only. */
export type VerdictPayloadObject = { readonly [key: string]: unknown };

/** Lifts a payload of version `n` to version `n + 1`. */
export type VerdictUpcaster = (older: VerdictPayloadObject) => {
    [key: string]: unknown;
};

/** `VERDICT_UPCASTERS[n]` lifts version `n` to `n + 1`. Empty while the
 *  payload has only ever had one version. */
export const VERDICT_UPCASTERS: Readonly<Record<number, VerdictUpcaster>> = {};
