// The Brain's request protocol and handler live in the engine
// (`convex/gre/ai/brainRequest.ts`) because the server's game-end Verdict
// Proposal judge runs the same handler the Brain Worker does, and a `convex/`
// module never imports from `src/`. This re-export keeps the client's import
// sites — and the module path tests mock — where they were.
export * from "@convex/gre/ai/brainRequest";
