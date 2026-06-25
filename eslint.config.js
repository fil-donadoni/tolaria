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
]);
