// Where a Preset Deck seed WRITES (issue #3499).
//
// WHY THIS IS A TEST AND NOT A COMMENT. A Preset Deck is a ROW, and the Card
// Definitions its list names are CODE. A release pushes the code and wrote no
// rows, so production had every Psychatog card live and no Psychatog list to
// pick — for as long as nobody looked. Nothing in the suite could see that:
// the seed tool was correct, it was simply never aimed at production, and the
// only evidence of a wrong aim is a row in a deployment no test can reach.
//
// So the aim itself is asserted here: the target's cwd and deployment-selection
// flags are pure, and the chaining of the deploy-time entry point after
// `convex deploy` is a string in a config file.

import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import {
    DEPLOY_KEY_ENV_VARS,
    resolveSeedTarget,
    seedPresetArgv,
} from "../lib/seed-preset-run";
import { primaryCheckout } from "../lib/primary-checkout";
import { parseArgs } from "../seed-preset-deck";
import type { PresetPayload } from "../lib/preset-deck-seed";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..");

const PAYLOAD: PresetPayload = {
    name: "Psychatog",
    format: "premodern",
    description: "Premodern Tier 1 — list supplied 2026-08-23.",
    colors: ["U", "B"],
    cards: [],
    sideboard: [],
};

describe("resolveSeedTarget (issue #3499)", () => {
    it("refuses the deploy-time target when the environment names no deploy key", () => {
        const plan = resolveSeedTarget("deployment", {}, "/build");
        expect(plan.cwd).toBeUndefined();
        expect(plan.error).toContain(DEPLOY_KEY_ENV_VARS[0]);
    });

    it("runs in the build's own checkout once a deploy key is present", () => {
        // The point of the target: no `.env.local` anywhere near it. A hosting
        // build has one checkout and one key, and the key is the whole
        // deployment selection.
        const plan = resolveSeedTarget(
            "deployment",
            { CONVEX_DEPLOY_KEY: "prod:tolaria|abc" },
            "/build"
        );
        expect(plan.error).toBeUndefined();
        expect(plan.cwd).toBe("/build");
    });

    it("pins production explicitly, because a PROJECT-scoped key defaults to dev", () => {
        // A deployment-scoped key ignores the flag with a log line; a
        // project-scoped key — the shape a hosting provider is usually given —
        // resolves `convex run` with no selection flag to the project's DEV
        // deployment, silently seeding somewhere the deploy never touched.
        const plan = resolveSeedTarget(
            "deployment",
            { CONVEX_DEPLOY_KEY: "project:tolaria|abc" },
            "/build"
        );
        expect(plan.flags).toContain("--prod");
    });

    it("leaves the local target alone even when a deploy key is in the environment", () => {
        const plan = resolveSeedTarget(
            "local",
            { CONVEX_DEPLOY_KEY: "prod:tolaria|abc" },
            "/build"
        );
        expect(plan.cwd).toBe(primaryCheckout());
        expect(plan.flags).toEqual([]);
    });
});

describe("seedPresetArgv (issue #3499)", () => {
    it("puts the selection flags before the function and the payload last", () => {
        const argv = seedPresetArgv("psychatog", PAYLOAD, ["--prod"]);
        expect(argv.slice(0, 3)).toEqual(["convex", "run", "--prod"]);
        expect(argv.at(-2)).toBe("decks:seedPresetDirect");
        expect(JSON.parse(argv.at(-1)!)).toMatchObject({
            expectedSlug: "psychatog",
        });
    });
});

describe("parseArgs --deploy (issue #3499)", () => {
    it("defaults to the developer's own deployment", () => {
        expect(parseArgs(["psychatog"]).target).toBe("local");
    });

    it("switches the sweep to the deploy environment's deployment", () => {
        expect(parseArgs(["--all", "--deploy"]).target).toBe("deployment");
    });
});

describe("the hosting build seeds the presets (issue #3499)", () => {
    it("chains the deploy-time sweep AFTER the Convex deploy", () => {
        // Order is the assertion, not presence: seeding before the deploy
        // would write rows against the previous bundle, which is how a list
        // whose last card just landed stays unseedable for one more release.
        const build = (
            JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as {
                buildCommand: string;
            }
        ).buildCommand;
        const deployAt = build.indexOf("convex deploy");
        const seedAt = build.indexOf("seed:preset:deploy");
        expect(deployAt).toBeGreaterThanOrEqual(0);
        expect(seedAt).toBeGreaterThan(deployAt);
    });

    it("names a script that exists and carries the --deploy flag", () => {
        const pkg = JSON.parse(
            readFileSync(join(ROOT, "package.json"), "utf8")
        ) as { scripts: Record<string, string> };
        expect(pkg.scripts["seed:preset:deploy"]).toContain("--deploy");
        expect(pkg.scripts["seed:preset:deploy"]).toContain("--all");
    });
});
