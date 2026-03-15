import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
    resolve: {
        alias: {
            "~": path.resolve(__dirname, "src"),
            "@": path.resolve(__dirname, "src"),
            "@convex": path.resolve(__dirname, "convex"),
        },
    },
    plugins: [
        tailwindcss(),
        react(),
        babel({ presets: [reactCompilerPreset()] } as Parameters<
            typeof babel
        >[0]),
    ],
});
