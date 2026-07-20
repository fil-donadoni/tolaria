# AGENTS.md

Tolaria — MTG gameplay engine (React + Convex). Full reference: `CLAUDE.md`.

## Commands

```bash
bun run dev                 # start dev server
bun run check:all           # format + lint + type-check + id checks + index + stubs — PRE-MERGE GATE
bun run test                # full vitest suite
bun run test <path>         # focused tests — use this mid-iteration, NOT the full suite
bun run check:ts            # tsc -b --noEmit
bun run lint                # ESLint
bunx convex codegen --typecheck disable   # generate Convex types (CI runs this before typecheck)
```

**Cadence**: iterate with focused tests only. Full `check:all` + `bun run test` once before marking done. Zero-red is absolute — never branch off red, never merge on red.

Auto-formatting via husky + lint-staged on commit. Never run `prettier` manually.

## Architecture boundaries (violating these breaks things silently)

1. **Frontend NEVER imports from `convex/gre/`.** Talks to backend only via public mutations in `convex/game.ts`. The `.opencode/rules/frontend-components.md` auto-loads for `src/components/**`.

2. **Card definitions import through the registry seam** (`getDefinition`/`tryGetDefinition` from `convex/cards`), NOT from set modules. Enforced by an ESLint `no-restricted-imports` rule. Test files are exempt.

3. **`players[].id` is `v.string()`, not `Id<"users">`.** Solo mode suffixes it with `-p1`/`-p2`. Don't tighten the type.

## Testing quirks

- Vitest has **two projects** in `vitest.config.ts`: `node` (convex/scripts, `isolate: false`) and `jsdom` (src/, default isolation). The split is by runtime need — don't combine them.
- `isolate: false` on the node project speeds up imports ~4-5x but is safe only because those tests use zero vi.mock/vi.spyOn/fake timers. Don't add mocking to node-project tests.
- **Wire-format tests are mandatory for visible effects.** The `projectPublicState` projection strips fat fields — GRE unit tests pass but the UI sees nothing. Pattern: re-run assertion after `projectPublicState`. See `.opencode/rules/gre-development.md` § Wire format test.
- Every new `TargetRequirement.type` needs tests at GRE + backend + frontend layers — two pieces passing separately but failing together is a shipped bug.

## Card authoring rules (`.opencode/rules/gre-development.md` auto-loads for `convex/gre/**`, `convex/cards/**`)

- **DSL-first**: new cards use `effects: EffectOp[]` (Effect Script). `resolve()` needs an explicit justification.
- **Mechanics Registry** (`convex/cards/mechanicsRegistry.ts`) is the single authority on keyword and Op names. An uncensused mechanic stops the line — open an issue, don't invent a name.
- A DSL card reusing already-exercised Ops needs no hand-written test (catalogue-wide sweep + smoke test cover it). A card introducing a new Op gets that Op its permanent test.
- **New `GameState` optional fields** must be added to `PERSISTED_OPTIONAL_KEYS` in `convex/gre/serialize.ts`. The drift guard test catches omissions.
- **Frontend wiring**: every new card/mechanic must walk the client-side reducers (`buildTriggerStateView`, `projectPublicState`, `getStackAbilities`) — a card correct in the GRE is routinely dead in the UI because a view reducer drops a field.

## Architecture notes

- GRE is **server-side only** in Convex mutations. Client never validates rules.
- State saved only at stable points (waiting for human input).
- ADRs live in `docs/adr/` — index is `docs/adr/README.md`. ADRs are NOT auto-loaded. New ADRs must add an index row.
- Generated code: `convex/_generated/` — never edit. The `@convex` path alias resolves to `convex/`.
- Deploy: Vercel runs `bunx convex codegen` before build. CI `.github/workflows/lint.yml` does the same.
- `/prototype/*` routes are excluded from lint (throwaway spikes, e.g. the old `prototype-board*` WebGL one). Fold the winner into real code, then delete the route.
