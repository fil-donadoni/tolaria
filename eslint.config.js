import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
    globalIgnores([
        "dist",
        "convex/_generated",
        // Worklist importer staging output (ADR 0041): regenerable `.ts` files
        // emitted by `list-to-cards.mjs` into `data/worklists/*.out/`. They are
        // gitignored staging (capability cards are commented-out stubs, so the
        // `CardDefinition` import reads as unused) — wired into real set files
        // by hand, not linted in place.
        "data/worklists/*.out",
        // Throwaway exploration code (PRD #249): the WebGL/FX prototype boards
        // were spikes to validate the DOM-only direction and are slated for
        // removal once the new board (#250+) is proven. They predate the
        // current react-hooks immutability rule and are not production code, so
        // they are excluded from lint rather than retrofitted.
        "src/routes/prototype-board",
        // Nested git worktrees (`.opencode/worktrees/*`) ship their own copy of
        // the repo — including a `tsconfig.json`. typescript-eslint's project
        // service auto-detects them as a second candidate `tsconfigRootDir`,
        // which aborts parsing ("multiple candidate TSConfigRootDirs are
        // present"). They are throwaway working copies, never linted in place.
        ".opencode",
        "src/routes/prototype-board.route.tsx",
        "src/routes/prototype-board-full.route.tsx",
    ]),
    {
        files: ["**/*.{ts,tsx}"],
        extends: [
            js.configs.recommended,
            tseslint.configs.recommended,
            reactHooks.configs.flat.recommended,
            reactRefresh.configs.vite,
        ],
        languageOptions: {
            ecmaVersion: 2020,
            globals: globals.browser,
        },
    },
    {
        // ADR 0046 — registry seam guard. Production code (engine, mutations,
        // projections, frontend) must resolve card definitions exclusively
        // through `getDefinition`/`tryGetDefinition` in `convex/cards` — never
        // by importing a set module directly. Today the registry wraps an
        // in-code map; later it becomes a cache + DB read, and this rule is
        // what lets that swap happen without touching every consumer.
        //
        // Test files are exempt: fixtures legitimately reach for a concrete
        // card (e.g. `import { lightningBolt } from "../../cards/sets/lea"`)
        // to build scenario state — that's an established, repo-wide testing
        // convention (see `.claude/rules/gre-development.md`), not a registry
        // bypass. `convex/cards/sets/**` itself and `convex/cards/index.ts`
        // (the registry module) are exempt because they ARE the set modules /
        // the seam that wraps them.
        files: ["**/*.{ts,tsx}"],
        ignores: [
            "**/__tests__/**",
            "**/*.test.ts",
            "**/*.test.tsx",
            "convex/cards/index.ts",
            "convex/cards/sets/**",
        ],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["**/cards/sets/*", "**/cards/sets/**"],
                            message:
                                "Import card definitions via the registry seam (`getDefinition` / `tryGetDefinition` from `convex/cards`), not directly from set modules (ADR 0046).",
                        },
                    ],
                },
            ],
        },
    },
]);
