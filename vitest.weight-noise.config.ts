import { mergeConfig } from "vitest/config";
import base from "./vitest.config";
import {
    FITTED_WEIGHTS_MODULE,
    nudgeWeightsSource,
} from "./scripts/lib/weight-noise";

/**
 * The root config with the fitted weights moved one last digit, for
 * `bun run check:weight-noise` only. A plugin rather than an edit, so a killed
 * run leaves no moved weights in the tree; run it with the module cache off, or
 * the moved transform would be read back by the next ordinary run.
 */
export default mergeConfig(base, {
    plugins: [
        {
            name: "weight-noise",
            enforce: "pre" as const,
            transform(code: string, id: string) {
                if (!FITTED_WEIGHTS_MODULE.test(id)) return null;
                return { code: nudgeWeightsSource(code), map: null };
            },
        },
    ],
});
