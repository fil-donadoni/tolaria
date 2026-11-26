// ACR set barrel — re-exports every colour module so the registry's
// `import * as acr from "./sets/acr/index.cards"` resolves here (ADR 0043).
// Only colorless.ts exists so far (Abstergo Entertainment, issue #10551).

export * from "./colorless.cards";
