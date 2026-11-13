// The wire-state adapter lives in the engine (`convex/gre/ai/stateAdapter.ts`)
// beside the Brain's request handler, which the server's game-end Verdict
// Proposal judge shares with the Brain Worker. This re-export keeps the
// client's import sites where they were.
export * from "@convex/gre/ai/stateAdapter";
