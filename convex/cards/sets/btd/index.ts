// BTD set barrel — re-exports every colour module so the registry's
// `import * as beatdown from "./sets/btd"` resolves here unchanged (ADR 0043).
// BTD is a reprint-only box set; only the colour modules with CardPrint
// entries exist.

export * from "./red";
