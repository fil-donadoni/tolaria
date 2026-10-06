import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { claudeArgs } from "../health-fix";
import {
    parseSkillFrontmatter,
    trackedSkills,
    committedSkillOverrides,
} from "../lib/skill-frontmatter";

/**
 * Skill invocation follows who actually reaches the skill (PRD #5096 D8,
 * issue #5101).
 *
 * The rule: reached only by the owner typing it or by the driver's pass
 * prompt -> user-invoked-only (`disable-model-invocation: true`, no listing
 * cost); named in another skill's steps, in a ticket, or reached by a session
 * on its own judgement -> model-reachable. A headless `claude -p "/<skill>"`
 * still resolves a user-invoked-only skill (measured 2026-10-05), so the
 * driver is unaffected.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Skills only the owner or a driver pass prompt reaches. */
const USER_INVOKED_ONLY = [
    "audit-tracker",
    "explain",
    "health-fix",
    "new-set",
    "next-ticket",
    "retro",
];

/**
 * Skill -> skills its steps invoke (or its tickets/rules route a session to).
 * Each callee must stay model-reachable, or the chain silently severs.
 */
const INVOKES: Record<string, string[]> = {
    "new-set": ["grill", "cluster-gaps", "rules-check", "grammar-rule"],
    "audit-tracker": ["grill", "to-tickets", "rules-check", "create-ticket"],
    "next-ticket": ["bot-change", "new-op", "create-ticket"],
    "new-card": ["new-op", "grammar-rule"],
    "grammar-rule": ["new-op"],
    "new-op": ["create-ticket"],
    "bot-change": ["new-op"],
    grill: ["to-prd", "to-tickets"],
    "to-prd": ["to-tickets"],
    "cluster-gaps": [],
};

const skills = trackedSkills(REPO_ROOT);

function manifestText(skill: string): string {
    return fs.readFileSync(
        path.join(REPO_ROOT, ".claude", "skills", skill, "SKILL.md"),
        "utf8"
    );
}

describe("skill invocation follows who reaches the skill (issue #5101)", () => {
    it("user-invoked-only skills are exactly the classified set", () => {
        const actual = [...skills]
            .filter(([, fm]) => fm.userInvokedOnly)
            .map(([s]) => s)
            .sort();
        expect(actual).toEqual([...USER_INVOKED_ONLY].sort());
    });

    it("user-invoked-only skills carry a one-line description with no trigger list", () => {
        for (const s of USER_INVOKED_ONLY) {
            const d = skills.get(s)!.description;
            expect(d, s).not.toMatch(/\bUse (when|whenever)\b/);
            expect(d.length, s).toBeLessThan(140);
        }
    });

    it("no chain is severed: every callee of another skill is model-reachable", () => {
        for (const [caller, callees] of Object.entries(INVOKES)) {
            for (const callee of callees) {
                expect(skills.has(callee), `${callee} exists`).toBe(true);
                expect(
                    skills.get(callee)!.userInvokedOnly,
                    `${caller} invokes /${callee}, which is user-invoked-only`
                ).toBe(false);
            }
        }
    });

    it("the INVOKES table stays honest: each caller still names its callee", () => {
        for (const [caller, callees] of Object.entries(INVOKES)) {
            const text = fs
                .readdirSync(path.join(REPO_ROOT, ".claude/skills", caller))
                .filter((f) => f.endsWith(".md"))
                .map((f) =>
                    fs.readFileSync(
                        path.join(REPO_ROOT, ".claude/skills", caller, f),
                        "utf8"
                    )
                )
                .join("\n");
            for (const callee of callees)
                expect(text, `${caller} -> /${callee}`).toMatch(
                    new RegExp(`/${callee}\\b`)
                );
        }
    });

    it("the driver's pass prompts name a user-invocable skill", () => {
        const drain = fs.readFileSync(
            path.join(REPO_ROOT, "scripts", "loop-drain.sh"),
            "utf8"
        );
        const prompts = [
            /^PASS_PROMPT="\/([\w-]+)/m.exec(drain)?.[1],
            /^\/([\w-]+)/.exec(claudeArgs("abc")[0])?.[1],
        ];
        expect(prompts.every(Boolean), "a pass prompt names a skill").toBe(
            true
        );
        for (const name of prompts as string[]) {
            expect(skills.has(name), `/${name} exists`).toBe(true);
            expect(
                skills.get(name)!.notUserInvocable,
                `/${name} must stay user-invocable`
            ).toBe(false);
        }
    });

    it("vendored Convex skills keep their shipped frontmatter; the listing is decided in settings", () => {
        const overrides = committedSkillOverrides(REPO_ROOT);
        for (const s of [
            "convex-create-component",
            "convex-migration-helper",
            "convex-performance-audit",
            "convex-quickstart",
            "convex-setup-auth",
        ]) {
            expect(skills.get(s)!.userInvokedOnly, s).toBe(false);
            expect(overrides[s], s).toBe("name-only");
        }
    });

    it("parses folded, quoted and plain descriptions", () => {
        const fm = parseSkillFrontmatter(
            "---\nname: x\ndescription:\n    one two\n    three.\ndisable-model-invocation: true\n---\n"
        );
        expect(fm.description).toBe("one two three.");
        expect(fm.userInvokedOnly).toBe(true);
        expect(
            parseSkillFrontmatter("---\nname: x\ndescription: 'a: b'\n---\n")
                .description
        ).toBe("a: b");
        expect(manifestText("next-ticket")).toMatch(/^---\n/);
    });
});
