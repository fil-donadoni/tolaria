/**
 * The generated Quarantine, Bot Gap and Migration issues declare a file set
 * (issue #8055), so the planner stops scheduling each one solo — and a narrow
 * one, so solo does not just become overlap with every issue in the family's
 * neighbourhood.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    BOT_CAUSE_FILES,
    botGapTargetFiles,
    catalogueMatchOf,
    handTailTargetFiles,
    keywordModule,
    migrationTargetFiles,
    MODULE_NOT_FOUND,
    QUARANTINE_REASON_FILES,
    quarantineTargetFiles,
    renderTargetFilesSection,
    setFilePath,
} from "../lib/gap-target-files";
import { botGapKey } from "../lib/oracle-bot-reach";
import { pathsOverlap, parseTargetFiles } from "../lib/queue-plan";
import { declaresTargetFiles } from "../lib/queue-lint";

describe("every row names a file that exists", () => {
    it.each(Object.entries(BOT_CAUSE_FILES))(
        "Bot Gap cause `%s`",
        (_cause, files) => {
            for (const file of files)
                expect(existsSync(file), `${file} is gone`).toBe(true);
        }
    );

    it.each(
        Object.entries(QUARANTINE_REASON_FILES).filter(
            ([, files]) => files !== null
        )
    )("Quarantine reason `%s`", (_reason, files) => {
        for (const file of files!)
            expect(existsSync(file), `${file} is gone`).toBe(true);
    });

    it("a shipped keyword's module is where `keywordModule` looks", () => {
        // A real keyword-named module, so the spelling cannot drift from the
        // directory's and silently stop naming anything.
        expect(existsSync(keywordModule("level up"))).toBe(true);
    });
});

describe("a Bot Gap key's Target files", () => {
    it("reads the cause out of `botGapKey`'s own output, for every cause", () => {
        for (const cause of Object.keys(BOT_CAUSE_FILES) as Array<
            keyof typeof BOT_CAUSE_FILES
        >) {
            const key = botGapKey(
                { outcome: "ignored", cause, form: "Sorcery" },
                ["draw"]
            )!;
            expect(botGapTargetFiles(key)).toEqual(BOT_CAUSE_FILES[cause]);
        }
    });

    it("declares nothing for a cause with no row", () => {
        expect(botGapTargetFiles("brand-new-cause › Sorcery")).toBeNull();
    });
});

describe("a Quarantine key's Target files", () => {
    it("routes a scenario class to the gate that refused it", () => {
        expect(
            quarantineTargetFiles(
                'smoke-scenario › Op "mill" reads a runtime "count" amount'
            )
        ).toEqual(["convex/gre/effects/scenarioGenerator.ts"]);
        expect(
            quarantineTargetFiles(
                'validate-effect-script › effects[0]: ref "$source" references undefined binding'
            )
        ).toEqual(["convex/gre/effects/validate.ts"]);
    });

    it("gives each keyword its own module, so two keywords never overlap", () => {
        const [cipher] = quarantineTargetFiles(
            'planned-mechanic › keyword "cipher" is not implemented in the Mechanics Registry'
        )!;
        const [melee] = quarantineTargetFiles(
            'planned-mechanic › keyword "melee" is not implemented in the Mechanics Registry'
        )!;
        expect(cipher).toBe("convex/cards/abilities/cipher.ts");
        expect(pathsOverlap(cipher!, melee!)).toBe(false);
    });

    it("spells a multi-word or punctuated keyword as the directory does", () => {
        expect(keywordModule("split second")).toBe(
            "convex/cards/abilities/splitSecond.ts"
        );
        expect(keywordModule("jump-start")).toBe(
            "convex/cards/abilities/jumpStart.ts"
        );
        expect(keywordModule("start your engines!")).toBe(
            "convex/cards/abilities/startYourEngines.ts"
        );
    });

    it("the two classes one keyword can carry declare the same module", () => {
        expect(
            quarantineTargetFiles(
                'ungrantable-keyword › keyword "exalted" is implemented by definition-level expansion'
            )
        ).toEqual(
            quarantineTargetFiles(
                'planned-mechanic › keyword "exalted" is not implemented in the Mechanics Registry'
            )
        );
    });

    it("declares nothing when the key names no file", () => {
        expect(quarantineTargetFiles("brand-new-reason › a detail")).toBeNull();
        expect(
            quarantineTargetFiles("planned-mechanic › no keyword quoted here")
        ).toBeNull();
    });
});

describe("a Migration cluster's Target files", () => {
    it("are its members' modules: distinct, sorted, no placeholder", () => {
        expect(
            migrationTargetFiles([
                "convex/cards/sets/lea/white.cards.ts",
                MODULE_NOT_FOUND,
                "convex/cards/sets/lea/black.cards.ts",
                "convex/cards/sets/lea/white.cards.ts",
            ])
        ).toEqual([
            "convex/cards/sets/lea/black.cards.ts",
            "convex/cards/sets/lea/white.cards.ts",
        ]);
    });
});

describe("a Hand Tail card's Target files (issue #8997)", () => {
    it("is the module its hand-written definition already lives in", () => {
        expect(
            handTailTargetFiles("convex/cards/sets/lea/blue.cards.ts", {
                set: "ice",
                colour: "red",
            })
        ).toEqual(["convex/cards/sets/lea/blue.cards.ts"]);
    });

    it("else the set file its catalogue match names — an existing ADR 0043 path", () => {
        const files = handTailTargetFiles(undefined, {
            set: "LEA",
            colour: "multicolor",
        });
        expect(files).toEqual(["convex/cards/sets/lea/multicolor.cards.ts"]);
        // The spelling cannot drift from the tree's and silently name nothing.
        expect(existsSync(files![0]!)).toBe(true);
        expect(
            handTailTargetFiles(MODULE_NOT_FOUND, {
                set: "lea",
                colour: "blue",
            })
        ).toEqual([setFilePath({ set: "lea", colour: "blue" })]);
    });

    it("finds a double-faced card under its front face, a split card whole", () => {
        const matches = new Map([
            ["Ral, Monsoon Mage", { set: "mh3", colour: "red" as const }],
            ["Fire // Ice", { set: "apc", colour: "multicolor" as const }],
            ["Fire", { set: "zzz", colour: "red" as const }],
        ]);
        expect(
            catalogueMatchOf(
                matches,
                "Ral, Monsoon Mage // Ral, Leyline Prodigy"
            )
        ).toEqual({ set: "mh3", colour: "red" });
        expect(catalogueMatchOf(matches, "Fire // Ice")).toEqual({
            set: "apc",
            colour: "multicolor",
        });
        expect(catalogueMatchOf(matches, "Nowhere")).toBeUndefined();
    });

    it("else nothing — unknown is scheduled solo, never guessed", () => {
        expect(handTailTargetFiles(undefined, undefined)).toBeNull();
    });
});

describe("the rendered section", () => {
    it("is what the planner reads back and the lint accepts", () => {
        const body = [
            "Some prose.",
            ...renderTargetFilesSection(BOT_CAUSE_FILES["never-chosen"]),
        ].join("\n");
        expect(parseTargetFiles(body)).toEqual([
            ...BOT_CAUSE_FILES["never-chosen"],
        ]);
        expect(declaresTargetFiles(body)).toBe(true);
    });

    it("renders no section for no files — an empty list would read as `touches nothing`", () => {
        expect(renderTargetFilesSection(null)).toEqual([]);
        expect(renderTargetFilesSection([])).toEqual([]);
    });
});
