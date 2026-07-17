// CN2 set barrel — re-exports every colour module so the registry's
// `import * as cn2 from "./sets/cn2"` resolves here unchanged (ADR 0043).
// Only the white module (Palace Jailer, issue #1199) is populated so far.

export * from "./white";
