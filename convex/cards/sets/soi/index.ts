// SOI (Shadows over Innistrad) set barrel — re-exports every populated colour
// module so the registry's `import * as soi from "./sets/soi"` resolves here
// unchanged (ADR 0043). Only green is scaffolded so far (Tireless Tracker,
// shipped by issue #1191).

export * from "./green";
