// SOI (Shadows over Innistrad) set barrel — re-exports every populated colour
// module so the registry's `import * as soi from "./sets/soi"` resolves here
// unchanged (ADR 0043). Green (Tireless Tracker, issue #1191) and white
// (Thraben Inspector, issue #1531) are scaffolded so far.

export * from "./green";
export * from "./white";
