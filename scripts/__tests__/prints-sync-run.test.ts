// Bootstrap planning for `prints:sync` (issue #5414): empty Card Prints tables
// make every token render the placeholder, silently.
import { describe, expect, it } from "vitest";
import {
    emptyPrintTables,
    emptyTablesMessage,
    parsePrintsSyncArgs,
    printsSyncTarget,
} from "../lib/prints-sync-run";

describe("emptyPrintTables", () => {
    it("names both tables when the deployment is fresh", () => {
        expect(
            emptyPrintTables({
                cardPrints: false,
                definitionTokenPrints: false,
            })
        ).toEqual(["cardPrints", "definitionTokenPrints"]);
    });

    it("names only the table still empty", () => {
        expect(
            emptyPrintTables({
                cardPrints: true,
                definitionTokenPrints: false,
            })
        ).toEqual(["definitionTokenPrints"]);
    });

    it("owes nothing once both are filled", () => {
        expect(
            emptyPrintTables({
                cardPrints: true,
                definitionTokenPrints: true,
            })
        ).toEqual([]);
    });

    it("warning names the command that fixes it", () => {
        expect(emptyTablesMessage(["cardPrints"])).toContain(
            "bun run prints:sync"
        );
    });
});

describe("printsSyncTarget", () => {
    it("--deploy without a deploy key is an error, never a local write", () => {
        const plan = printsSyncTarget(
            parsePrintsSyncArgs(["--deploy", "--if-empty"]),
            {}
        );
        expect(plan.error).toMatch(/CONVEX_DEPLOY_KEY/);
        expect(plan.cwd).toBeUndefined();
    });

    it("--deploy with a key selects the deployment with --prod", () => {
        const plan = printsSyncTarget(parsePrintsSyncArgs(["--deploy"]), {
            CONVEX_DEPLOY_KEY: "k",
        });
        expect(plan.flags).toEqual(["--prod"]);
    });

    it("no flag targets the local deployment", () => {
        const plan = printsSyncTarget(parsePrintsSyncArgs([]), {});
        expect(plan.flags).toEqual([]);
        expect(plan.error).toBeUndefined();
    });
});

describe("parsePrintsSyncArgs", () => {
    it("reads every flag", () => {
        expect(
            parsePrintsSyncArgs(["--dry-run", "--if-empty", "--warn-only"])
        ).toEqual({
            dryRun: true,
            deploy: false,
            ifEmpty: true,
            warnOnly: true,
        });
    });
});
