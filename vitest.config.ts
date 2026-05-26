import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    resolve: {
        alias: {
            "~": path.resolve(__dirname, "src"),
            "@": path.resolve(__dirname, "src"),
            "@convex": path.resolve(__dirname, "convex"),
        },
    },
    test: {
        globals: true,
        environment: "jsdom",
        setupFiles: ["./vitest.setup.ts"],
        exclude: [
            "**/node_modules/**",
            "**/dist/**",
            ".sandcastle/worktrees/**",
        ],
    },
});
