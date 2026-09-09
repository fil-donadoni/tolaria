// J25 (Foundations Jumpstart) set barrel — re-exports every populated colour
// module so the registry's `import * as j25 from "./sets/j25"` resolves here
// unchanged (ADR 0043). Green (Scythecat Cub) and red (Ivora, Insatiable
// Heir) are scaffolded so far.

export * from "./green";
export * from "./red";
