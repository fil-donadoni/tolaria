// The blade registry cut into entries by source text (issue #5078): which
// `must` entries a batch added or changed, and the fail-closed paths.
import { describe, expect, it } from "vitest";
import {
    entryTier,
    parseRegistryEntries,
    registryChange,
} from "../lib/blade-registry-entries";

const entry = (label: string, tier = "must", extra = "") =>
    `    {\n        // a comment with a "quote", a {brace and a \`tick\`\n        label: "${label}",\n        tier: "${tier}",${extra}\n        note: \`n ${"${1 + 1}"} }\`,\n    },\n`;

const registry = (...entries: string[]) =>
    `import x from "y";\nconst SHARED = { a: 1 };\nexport const BLADE_SCENARIOS: BladeScenario[] = [\n${entries.join("")}];\nexport function find() { return 1; }\n`;

describe("parseRegistryEntries", () => {
    it("cuts literal-labelled entries and leaves everything else as residue", () => {
        const parsed = parseRegistryEntries(
            registry(entry("A"), entry("B", "stretch"))
        )!;
        expect([...parsed.blocks.keys()]).toEqual(["A", "B"]);
        expect(entryTier(parsed.blocks.get("B")!)).toBe("stretch");
        expect(parsed.residue).toContain("const SHARED");
        expect(parsed.residue).not.toContain('label: "A"');
    });

    it("is null when the array or a closing bracket is missing", () => {
        expect(parseRegistryEntries("const x = 1;")).toBeNull();
        expect(
            parseRegistryEntries(
                "export const BLADE_SCENARIOS: BladeScenario[] = [ {"
            )
        ).toBeNull();
    });

    it("keeps a spread or generated element in the residue", () => {
        const src = `export const BLADE_SCENARIOS: BladeScenario[] = [\n${entry("A")}    ...make(),\n];`;
        const parsed = parseRegistryEntries(src)!;
        expect([...parsed.blocks.keys()]).toEqual(["A"]);
        expect(parsed.residue).toContain("...make()");
    });
});

describe("entryTier", () => {
    it("reads the entry's own tier, not one named in a comment or a nested object", () => {
        const block = `// tier: "stretch" in a comment\n{\n    label: "A",\n    spec: { tier: "stretch" },\n    tier: "must",\n}`;
        expect(entryTier(block)).toBe("must");
    });

    it("is null when the tier is not a literal", () => {
        expect(entryTier(`{ label: "A", tier: pick() }`)).toBeNull();
    });
});

describe("registryChange", () => {
    const base = registry(entry("A"), entry("B"));

    it("an added must entry is the one label", () => {
        expect(
            registryChange(base, registry(entry("A"), entry("B"), entry("C")))
        ).toEqual({
            kind: "entries",
            labels: ["C"],
        });
    });

    it("a changed must entry is listed, an untouched one is not", () => {
        const after = registry(
            entry("A", "must", "\n        budget: 1,"),
            entry("B")
        );
        expect(registryChange(base, after)).toEqual({
            kind: "entries",
            labels: ["A"],
        });
    });

    it("a retitle is a delete plus an add: only the new label is audited", () => {
        expect(registryChange(base, registry(entry("A"), entry("B2")))).toEqual(
            {
                kind: "entries",
                labels: ["B2"],
            }
        );
    });

    it("a stretch entry, a removed entry and an identical file owe nothing", () => {
        expect(
            registryChange(
                base,
                registry(entry("A"), entry("B"), entry("S", "stretch"))
            )
        ).toEqual({ kind: "entries", labels: [] });
        expect(registryChange(base, registry(entry("A")))).toEqual({
            kind: "entries",
            labels: [],
        });
        expect(registryChange(base, base)).toEqual({
            kind: "entries",
            labels: [],
        });
    });

    it("stretch → must is an add", () => {
        expect(
            registryChange(
                registry(entry("A", "stretch")),
                registry(entry("A"))
            )
        ).toEqual({
            kind: "entries",
            labels: ["A"],
        });
    });

    it("a change outside the entries (a helper, a shared constant) is not an entries-only change", () => {
        const after = base.replace("{ a: 1 }", "{ a: 2 }");
        expect(registryChange(base, after).kind).toBe("other");
    });

    it("an unreadable revision is not an entries-only change", () => {
        expect(registryChange(null, base).kind).toBe("other");
        expect(registryChange(base, "garbage").kind).toBe("other");
    });
});
