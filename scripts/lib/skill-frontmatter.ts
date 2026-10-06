import * as fs from "fs";
import * as path from "path";

/**
 * Project-skill frontmatter, read without a YAML dependency: the manifests use
 * flat `key: value` lines, a quoted scalar, or a value folded onto indented
 * continuation lines (the vendored Convex skills).
 */
export interface SkillFrontmatter {
    name: string;
    description: string;
    /** `disable-model-invocation: true` — the description never reaches the model. */
    userInvokedOnly: boolean;
    /** `user-invocable: false` — the skill cannot be typed as `/name`. */
    notUserInvocable: boolean;
}

function unquote(raw: string): string {
    const v = raw.trim();
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"'))
        return v.slice(1, -1).replace(/\\"/g, '"');
    if (v.length >= 2 && v.startsWith("'") && v.endsWith("'"))
        return v.slice(1, -1).replace(/''/g, "'");
    return v;
}

export function parseSkillFrontmatter(manifest: string): SkillFrontmatter {
    const block = /^---\n([\s\S]*?)\n---/.exec(manifest);
    if (!block) throw new Error("manifest has no frontmatter");
    const fields = new Map<string, string>();
    let key: string | null = null;
    for (const line of block[1].split("\n")) {
        const kv = /^([\w-]+):\s*(.*)$/.exec(line);
        if (kv) {
            key = kv[1];
            fields.set(key, kv[2]);
        } else if (key && /^\s+\S/.test(line)) {
            fields.set(key, `${fields.get(key)} ${line.trim()}`);
        }
    }
    return {
        name: unquote(fields.get("name") ?? ""),
        description: unquote(fields.get("description") ?? ""),
        userInvokedOnly: fields.get("disable-model-invocation") === "true",
        notUserInvocable: fields.get("user-invocable") === "false",
    };
}

/**
 * Every project skill manifest, keyed by skill (directory) name. Read from the
 * directory, not `git ls-files`: the vendored Convex skills are symlinks the
 * installer regenerates, and the harness lists them all the same.
 */
export function trackedSkills(repoRoot: string): Map<string, SkillFrontmatter> {
    const dir = path.join(repoRoot, ".claude", "skills");
    return new Map(
        fs
            .readdirSync(dir)
            .sort()
            .filter((s) => fs.existsSync(path.join(dir, s, "SKILL.md")))
            .map((s) => [
                s,
                parseSkillFrontmatter(
                    fs.readFileSync(path.join(dir, s, "SKILL.md"), "utf8")
                ),
            ])
    );
}

/** Skills the committed settings collapse or hide, by override value. */
export function committedSkillOverrides(
    repoRoot: string
): Record<string, string> {
    const settings = JSON.parse(
        fs.readFileSync(path.join(repoRoot, ".claude", "settings.json"), "utf8")
    ) as { skillOverrides?: Record<string, string> };
    return settings.skillOverrides ?? {};
}

/**
 * The characters of skill description the harness lists into every session:
 * a skill that disables model invocation, or that settings override to
 * anything but `on` (`name-only`, `off`, `user-invocable-only`), contributes
 * no description.
 */
export function modelFacingDescriptions(repoRoot: string): Map<string, string> {
    const overrides = committedSkillOverrides(repoRoot);
    const out = new Map<string, string>();
    for (const [skill, fm] of trackedSkills(repoRoot)) {
        if (fm.userInvokedOnly) continue;
        const override = overrides[skill];
        if (override && override !== "on") continue;
        out.set(skill, fm.description);
    }
    return out;
}
