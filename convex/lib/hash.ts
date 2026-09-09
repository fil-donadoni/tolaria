/**
 * Non-cryptographic string hashing, shared.
 *
 * `fnv1a32` was born under `convex/limited/` as the pairing-RNG seed
 * (`matchSim.ts`, PRD #1628) and grew a second consumer with nothing to do
 * with Limited: the Oracle compiler derives a `cast-permission`'s IDENTITY
 * from a digest of the sentence it read (`oracle/castPermissionId.ts`,
 * issue #3268). Reaching one line of arithmetic by importing a play-phase
 * module would make `convex/limited/` a dependency of the grammar, so the
 * helper lives here instead — the same "a shared helper has one home" rule
 * `gre/constants.ts` states for the engine.
 *
 * Nothing here is a security primitive. FNV-1a is chosen for being short,
 * dependency-free and identical on every platform; a value it produces is a
 * STABLE NAME, never a secret and never a integrity check.
 */

/**
 * FNV-1a over a string, coerced to a signed 32-bit integer.
 *
 * `Math.imul` is what makes it exact: the multiply overflows 53-bit float
 * precision on the second byte otherwise, and the result would then differ
 * between two engines that round differently — the one property every consumer
 * here depends on being identical everywhere.
 */
export function fnv1a32(input: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash | 0;
}
