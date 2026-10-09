// Node flags for every vitest worker (`execArgv`), shared by
// `vitest.config.ts` and `vitest.blade.config.ts` (issue #5305).
//
// `--no-experimental-webstorage`: Node ≥ 25 ships Web Storage unflagged —
// `localStorage` / `sessionStorage` are globalThis getters that return
// `undefined` (and emit an ExperimentalWarning) without `--localstorage-file`.
// The getter shadows happy-dom's storage, so every dom test touching it reds
// with "Cannot read properties of undefined (reading 'clear')". The tests
// emulate a browser: the DOM environment owns storage, never Node. This
// spelling is accepted by Node 22 (negates the opt-in flag) and Node 26 (alias
// of `--no-webstorage`) alike.
export const VITEST_NODE_ARGV = ["--no-experimental-webstorage"];
