import { describe, expect, it } from "vitest";
import {
    VITEST_FS_CACHE_ENV,
    defineCacheKeyPlugin,
    fsModuleCacheOptions,
} from "../lib/vitest-fs-cache";

/**
 * vitest's experimental filesystem module cache, behind a manual flag (issue
 * #4488). What must hold: it is off unless the flag names a directory, and a
 * module that reads a `define` constant is never served a transform baked
 * with a previous commit's value.
 */
describe("fsModuleCacheOptions — the flag", () => {
    it("is off by default — a targeted run, check:lane and land never see it", () => {
        expect(fsModuleCacheOptions({})).toEqual({});
        expect(fsModuleCacheOptions({ [VITEST_FS_CACHE_ENV]: "" })).toEqual({});
    });

    it("turns the cache on at the directory the flag names", () => {
        expect(
            fsModuleCacheOptions({ [VITEST_FS_CACHE_ENV]: "/cache/dir" })
        ).toEqual({
            experimental: {
                fsModuleCache: true,
                fsModuleCachePath: "/cache/dir",
            },
        });
    });
});

describe("defineCacheKeyPlugin — define values reach the cache key", () => {
    type Generator = (ctx: { sourceCode: string }) => string | false;

    function generatorFor(define: Record<string, string>): Generator {
        let captured: Generator | undefined;
        const plugin = defineCacheKeyPlugin(define);
        const configure = plugin.configureVitest as unknown as (ctx: {
            experimental_defineCacheKeyGenerator: (g: Generator) => void;
        }) => void;
        configure({
            experimental_defineCacheKeyGenerator: (g) => {
                captured = g;
            },
        });
        if (!captured) throw new Error("no cache-key generator registered");
        return captured;
    }

    const src = "export const commit = __BUILD_COMMIT__;";

    it("keys a module that reads a define constant on the constant's value", () => {
        const a = generatorFor({ __BUILD_COMMIT__: '"aaa"' })({
            sourceCode: src,
        });
        const b = generatorFor({ __BUILD_COMMIT__: '"bbb"' })({
            sourceCode: src,
        });
        expect(a).not.toBe(b);
    });

    it("leaves every other module's key alone, so a new commit keeps its hits", () => {
        const gen = generatorFor({ __BUILD_COMMIT__: '"aaa"' });
        expect(gen({ sourceCode: "export const x = 1;" })).toBe("");
    });
});
