// KTK set barrel — re-exports every colour module so the registry's
// `import * as ktk from "./sets/ktk"` resolves here unchanged (ADR 0043).
// Only blue.ts exists so far (Treasure Cruise, the Delve capability card for
// issue #1336 / PRD #702).

export * from "./blue";
