// The blade robustness audit runs AFTER the health verdict and cannot change
// it (issue #5079); its record is shared state every machine reads (issue
// #9294).
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
    AUDIT_RECORD_KEY,
    auditRequestFile,
    claimAuditRequest,
    describeAuditRecord,
    readAuditRecord as readRecordFrom,
    readOwedAudit,
    runAudit,
    writeAuditRequest,
    type AuditRecord,
    type AuditRecordStore,
} from "../lib/health-robustness-audit";
import { SharedStateConflict } from "../lib/shared-state";
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

/** The shared ref in memory: one document, a lease that moves on every
 *  write, a conflict when the caller's lease is stale. */
function memoryStore(): AuditRecordStore & {
    raw: string | null;
    sha: string | null;
} {
    let n = 0;
    const store = {
        raw: null as string | null,
        sha: null as string | null,
        read: () => ({ sha: store.sha, raw: store.raw }),
        write: (raw: string, expected: string | null) => {
            if (expected !== store.sha)
                throw new SharedStateConflict(AUDIT_RECORD_KEY, expected);
            store.raw = raw;
            store.sha = `sha-${++n}`;
            return store.sha;
        },
    };
    return store;
}

let dir: string;
let store: ReturnType<typeof memoryStore>;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "robustness-audit-"));
    mkdirSync(dir, { recursive: true });
    store = memoryStore();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function readAuditRecord(d: string): AuditRecord | null {
    return readRecordFrom(store, d).record;
}

describe("the offline phase no longer contains the audit", () => {
    it("is not a health gate, whatever the batch owes", () => {
        const { offline, browser } = splitHealthGates(HEALTH_SCRIPTS);
        expect([...offline, ...browser]).not.toContain("blade:robustness");
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
            readFileSync(join(dir, auditRequestFile(SHA)), "utf8")
        );
        expect(request.sha).toBe(SHA);
        expect(request.env).toEqual({
            BLADE_ROBUSTNESS_LABELS: JSON.stringify(["a", "b"]),
        });
    });

    it("a batch that owes nothing removes the previous request", () => {
        writeAuditRequest(dir, SHA, FULL, true);
        writeAuditRequest(dir, SHA, { kind: "none", reason: "x" }, false);
        expect(existsSync(join(dir, auditRequestFile(SHA)))).toBe(false);
    });

    it("a later tip never deletes or overwrites an earlier tip's request", () => {
        writeAuditRequest(dir, SHA, FULL, true);
        writeAuditRequest(dir, "d00dfeed0000bbbb", FULL, true);
        writeAuditRequest(
            dir,
            "feedbead0000cccc",
            { kind: "none", reason: "x" },
            false
        );
        expect(existsSync(join(dir, auditRequestFile(SHA)))).toBe(true);
        expect(
            claimAuditRequest(dir, SHA, { sha: SHA, status: "green" })?.sha
        ).toBe(SHA);
    });

    it("is owed only once the verdict for the SAME tip is green or red", () => {
        writeAuditRequest(dir, SHA, FULL, true);
        expect(readOwedAudit(dir, SHA, null)).toBeNull();
        expect(
            readOwedAudit(dir, SHA, { sha: SHA, status: "running" })
        ).toBeNull();
        expect(
            readOwedAudit(dir, SHA, { sha: SHA, status: "infra" })
        ).toBeNull();
        expect(
            readOwedAudit(dir, SHA, { sha: "other", status: "green" })
        ).toBeNull();
        expect(
            readOwedAudit(dir, SHA, { sha: SHA, status: "green" })?.sha
        ).toBe(SHA);
        expect(readOwedAudit(dir, SHA, { sha: SHA, status: "red" })?.sha).toBe(
            SHA
        );
    });

    it("is claimed once", () => {
        writeAuditRequest(dir, SHA, FULL, true);
        const last = { sha: SHA, status: "green" };
        expect(claimAuditRequest(dir, SHA, last)?.sha).toBe(SHA);
        expect(claimAuditRequest(dir, SHA, last)).toBeNull();
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
            store,
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
            store,
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
            store,
            request,
            log: "/log",
            run: async () => ({ ok: true, excused: false, output: "" }),
            file: never,
        });
        expect(clean.status).toBe("clean");
        const infra = await runAudit({
            dir,
            store,
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
            store,
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

describe("a dead audit is not shown as running", () => {
    it("abandoned when the pid is gone", () => {
        const record = {
            sha: SHA,
            status: "running" as const,
            mode: "full",
            startedAt: "t",
            filed: [],
        };
        expect(describeAuditRecord(record, true)).toContain("running @");
        expect(describeAuditRecord(record, false)).toContain("abandoned @");
    });
});

describe("the record is shared, not machine-local (issue #9294)", () => {
    const request = { sha: SHA, mode: "full — search changed" };
    const clean = async () => ({ ok: true, excused: false, output: "" });

    it("an audit run on one machine is what the other machine reads", async () => {
        const macbook = dir;
        const huawei = mkdtempSync(join(tmpdir(), "robustness-audit-b-"));
        try {
            await runAudit({
                dir: macbook,
                store,
                request,
                log: "/l",
                run: clean,
            });
            expect(existsSync(join(macbook, AUDIT_RECORD_FILE))).toBe(false);
            expect(readRecordFrom(store, huawei).record).toMatchObject({
                sha: SHA,
                status: "clean",
            });
        } finally {
            rmSync(huawei, { recursive: true, force: true });
        }
    });

    it("a local file from before is read only while the ref holds none", async () => {
        const old = {
            sha: "0ld0ld0ld0ld",
            status: "drift",
            mode: "full",
            startedAt: "2026-10-11T00:00:00.000Z",
            filed: [],
        };
        writeFileSync(join(dir, AUDIT_RECORD_FILE), JSON.stringify(old));
        expect(readAuditRecord(dir)?.sha).toBe(old.sha);
        await runAudit({ dir, store, request, log: "/l", run: clean });
        expect(readAuditRecord(dir)?.sha).toBe(SHA);
    });

    it("a conflict keeps a newer audit's record and overwrites an older one", async () => {
        const other = (startedAt: string): string =>
            JSON.stringify({
                sha: "0th3r0th3r00",
                status: "running",
                mode: "full",
                startedAt,
                filed: [],
            });
        // Another machine writes between this audit's read and its final
        // write: the lease is stale on the final write.
        await runAudit({
            dir,
            store,
            request,
            log: "/l",
            now: () => new Date("2026-11-01T00:00:00.000Z"),
            run: async () => {
                store.raw = other("2026-11-02T00:00:00.000Z");
                store.sha = "moved";
                return { ok: true, excused: false, output: "" };
            },
        });
        expect(readAuditRecord(dir)?.sha).toBe("0th3r0th3r00");
        await runAudit({
            dir,
            store,
            request,
            log: "/l",
            now: () => new Date("2026-11-03T00:00:00.000Z"),
            run: async () => {
                store.raw = other("2026-10-01T00:00:00.000Z");
                store.sha = "moved-again";
                return { ok: true, excused: false, output: "" };
            },
        });
        expect(readAuditRecord(dir)).toMatchObject({
            sha: SHA,
            status: "clean",
        });
    });
});

describe("the status line states the record's age (issue #9294)", () => {
    const record: AuditRecord = {
        sha: "c316ed9e0000",
        status: "drift",
        mode: "full",
        startedAt: "2026-10-11T02:00:00.000Z",
        finishedAt: "2026-10-11T03:00:00.000Z",
        machine: "macbook",
        filed: ["already filed as issue #5415"],
    };

    it("a month-old record shows its date and is flagged stale", () => {
        const line = describeAuditRecord(
            record,
            true,
            new Date("2026-11-12T12:00:00.000Z")
        );
        expect(line).toContain("2026-10-11 on macbook, 32 d ago");
        expect(line).toContain("STALE");
    });

    it("a record within the weekly cadence is not stale", () => {
        const line = describeAuditRecord(
            record,
            true,
            new Date("2026-10-19T02:00:00.000Z")
        );
        expect(line).toContain("2026-10-11 on macbook, 7 d ago");
        expect(line).not.toContain("STALE");
    });

    it("8 days and an hour is past the 8-day bound", () => {
        expect(
            describeAuditRecord(
                record,
                true,
                new Date("2026-10-19T04:00:00.000Z")
            )
        ).toContain("STALE");
    });

    it("9 days is past the 8-day bound", () => {
        expect(
            describeAuditRecord(
                record,
                true,
                new Date("2026-10-20T04:00:00.000Z")
            )
        ).toContain("STALE");
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
