// The blade robustness audit runs AFTER the health verdict and cannot change
// it (issue #5079).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
    existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    AUDIT_RECORD_FILE,
    AUDIT_REQUEST_FILE,
    claimAuditRequest,
    describeAuditRecord,
    readAuditRecord,
    readOwedAudit,
    runAudit,
    writeAuditRequest,
} from "../lib/health-robustness-audit";
import { ROBUSTNESS_FINDING_PREFIX } from "../lib/health-robustness-drift";
import { HEALTH_SCRIPTS, splitHealthGates } from "../lib/health-step";

const SHA = "c43c4b5a3c58aaaa";
const FULL = { kind: "full", reason: "search changed" } as const;
const SPEC = "convex/gre/ai/blade/__tests__/robustness.shard-0.spec.ts";

const LAST = JSON.stringify({ sha: SHA, status: "green", offline: "green" });

function finding(kind: string, label: string): string {
    const test = label;
    return [
        ` stdout | ${SPEC} > blade robustness audit — shard 1/4 > ${test}`,
        `[blade:robustness] NOISE-PINNED ${label} — own 1/1 @200 · default 9/10`,
        `${ROBUSTNESS_FINDING_PREFIX} ${JSON.stringify({ kind, label, test })}`,
        ` FAIL  |blade| ${SPEC} > blade robustness audit — shard 1/4 > ${test}`,
    ].join("\n");
}

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "robustness-audit-"));
    mkdirSync(dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the offline phase no longer contains the audit", () => {
    it("is not a health gate, whatever the batch owes", () => {
        const { offline, walk } = splitHealthGates(HEALTH_SCRIPTS);
        expect([...offline, ...walk]).not.toContain("blade:robustness");
    });
});

describe("the audit request", () => {
    it("is written for an owed mode, with the incremental labels as env", () => {
        writeAuditRequest(
            dir,
            SHA,
            { kind: "incremental", reason: "entries", labels: ["a", "b"] },
            true
        );
        const request = JSON.parse(
            readFileSync(join(dir, AUDIT_REQUEST_FILE), "utf8")
        );
        expect(request.sha).toBe(SHA);
        expect(request.env).toEqual({
            BLADE_ROBUSTNESS_LABELS: JSON.stringify(["a", "b"]),
        });
    });

    it("a batch that owes nothing removes the previous request", () => {
        writeAuditRequest(dir, SHA, FULL, true);
        writeAuditRequest(dir, "later", { kind: "none", reason: "x" }, false);
        expect(existsSync(join(dir, AUDIT_REQUEST_FILE))).toBe(false);
    });

    it("is owed only once the verdict for the SAME tip is green or red", () => {
        writeAuditRequest(dir, SHA, FULL, true);
        expect(readOwedAudit(dir, null)).toBeNull();
        expect(readOwedAudit(dir, { sha: SHA, status: "running" })).toBeNull();
        expect(readOwedAudit(dir, { sha: SHA, status: "infra" })).toBeNull();
        expect(
            readOwedAudit(dir, { sha: "other", status: "green" })
        ).toBeNull();
        expect(readOwedAudit(dir, { sha: SHA, status: "green" })?.sha).toBe(
            SHA
        );
        expect(readOwedAudit(dir, { sha: SHA, status: "red" })?.sha).toBe(SHA);
    });

    it("is claimed once", () => {
        writeAuditRequest(dir, SHA, FULL, true);
        const last = { sha: SHA, status: "green" };
        expect(claimAuditRequest(dir, last)?.sha).toBe(SHA);
        expect(claimAuditRequest(dir, last)).toBeNull();
    });
});

describe("runAudit leaves the verdict alone", () => {
    const request = { sha: SHA, mode: "full — search changed" };

    function seedVerdict(): { last: string; red: string } {
        writeFileSync(join(dir, "last.json"), LAST);
        writeFileSync(join(dir, "RED"), "staging @ red\n");
        return { last: LAST, red: "staging @ red\n" };
    }

    it("a noise-pinned drift files the issue; last.json and RED are byte-identical", async () => {
        const before = seedVerdict();
        const filed: string[] = [];
        const record = await runAudit({
            dir,
            request,
            log: "/log",
            run: async () => ({
                ok: false,
                excused: false,
                output: finding("unlisted", "entry-a"),
            }),
            file: (issues) => {
                filed.push(...issues.map((i) => i.title));
                return issues.map((i) => `filed: ${i.title}`);
            },
        });
        expect(record.status).toBe("drift");
        expect(filed).toEqual(['Blade robustness: "entry-a" is noise-pinned']);
        expect(readFileSync(join(dir, "last.json"), "utf8")).toBe(before.last);
        expect(readFileSync(join(dir, "RED"), "utf8")).toBe(before.red);
        expect(readAuditRecord(dir)?.status).toBe("drift");
    });

    it("a `wrong` is reported, not filed, and never writes or clears RED", async () => {
        const before = seedVerdict();
        const record = await runAudit({
            dir,
            request,
            log: "/log",
            run: async () => ({
                ok: false,
                excused: false,
                output: finding("wrong", "entry-w"),
            }),
            file: () => {
                throw new Error("a wrong files nothing");
            },
        });
        expect(record).toMatchObject({ status: "wrong", wrong: ["entry-w"] });
        expect(readFileSync(join(dir, "last.json"), "utf8")).toBe(before.last);
        expect(readFileSync(join(dir, "RED"), "utf8")).toBe(before.red);
    });

    it("a clean run, and a machine-excused one, file nothing", async () => {
        const never = () => {
            throw new Error("nothing to file");
        };
        const clean = await runAudit({
            dir,
            request,
            log: "/log",
            run: async () => ({ ok: true, excused: false, output: "" }),
            file: never,
        });
        expect(clean.status).toBe("clean");
        const infra = await runAudit({
            dir,
            request,
            log: "/log",
            run: async () => ({ ok: false, excused: true, output: "" }),
            file: never,
        });
        expect(infra.status).toBe("infra");
        expect(existsSync(join(dir, "last.json"))).toBe(false);
    });

    it("the record is written before the run starts, and status shows it", async () => {
        let during: string | undefined;
        const record = await runAudit({
            dir,
            request,
            log: "/log",
            run: async () => {
                during = readAuditRecord(dir)?.status;
                return { ok: true, excused: false, output: "" };
            },
        });
        expect(during).toBe("running");
        expect(AUDIT_RECORD_FILE).toBe("robustness-audit.json");
        expect(describeAuditRecord(record)).toContain("clean @ c43c4b5a");
    });
});

describe("the audit module cannot touch the verdict", () => {
    it("never writes last.json or the RED marker", () => {
        for (const file of [
            "scripts/lib/health-robustness-audit.ts",
            "scripts/health-robustness-audit.ts",
        ]) {
            const code = readFileSync(join(__dirname, "..", "..", file), "utf8")
                .split("\n")
                .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
                .join("\n");
            expect(code, file).not.toMatch(/writeLast|["']RED["']/);
        }
    });
});
