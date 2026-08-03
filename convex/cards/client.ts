// Client-safe entry point for `@convex/cards`. Exports only the runtime
// registry — NO catalogue imports. The Vite alias maps `@convex/cards` here,
// so the client bundle drops the full set-module tree (~1.63 MB raw).
//
// Server code imports `convex/cards/index.ts` directly (through `./cards`),
// which re-exports from both `registry` and `catalogue`.
export * from "./registry";
