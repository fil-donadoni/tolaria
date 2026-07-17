// NCC (Streets of New Capenna Commander) set barrel — re-exports every colour
// module so the registry's `import * as ncc from "./sets/ncc"` resolves here
// unchanged (ADR 0043). Colourless artifacts (no coloured cost) live in
// colorless.ts per the colour-split convention.

export * from "./colorless";
