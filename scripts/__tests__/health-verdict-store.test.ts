import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    DESCRIPTION_MAX,
    decodeStatus,
    encodeDescription,
    failedTestFiles,
    githubVerdictStore,
    lineageBlocks,
    lineageOf,
    readVerdictLineage,
    repoFromRemote,
    verdictAgeMs,
    type GhRunner,
    type Verdict,
    type VerdictStore,
} from "../lib/health-verdict-store";
import { readHealthMarker, readHealthInfra } from "../queue-plan";
import { redRefusal } from "../lib/queue-plan";
import {
    buildLockedCommand,
    landHealthLineage,
    markAmberStep,
    repairProofOf,
    repairProofStep,
} from "../land";
import { redLandGate } from "../lib/red-land-gate";
import { readRedFromStore, spawnDecision } from "../health-fix";

/**
 * The health verdict as shared state (issue #5462): one store interface over
 * GitHub commit statuses (the local-file backend went with issue #5655), every
 * consumer reading through it. The backend is driven here by a FAKE
 * `gh` — an in-memory commit-status table over an ordered base history — so
 * what is pinned is the store's own semantics: round-trip, last writer wins,
 * infra never overwrites, the latest gated tip and its age, and AMBER.
 */

const sha = (c: string): string => c.repeat(40).slice(0, 40);
const T1 = sha("1"); // oldest
const T2 = sha("2");
const T3 = sha("3");
const T4 = sha("4"); // newest
const REPO = "owner/tolaria";

interface FakeStatus {
    context: string;
    state: string;
    description: string;
    target_url: string | null;
    created_at: string;
}

/** A fake `gh`: the three calls the backend makes, over an in-memory table.
 *  `history` is the base branch, NEWEST FIRST. `down` makes every call fail
 *  the way a GitHub 502 does. */
function fakeGh(history: string[] = [T4, T3, T2, T1]) {
    const statuses = new Map<string, FakeStatus[]>();
    let clock = Date.parse("2026-10-11T10:00:00Z");
    const calls: string[][] = [];
    const state = { down: false };
    const field = (args: string[], name: string): string | null => {
        for (let i = 0; i < args.length - 1; i++)
            if (
                (args[i] === "-f" || args[i] === "-F") &&
                args[i + 1].startsWith(`${name}=`)
            )
                return args[i + 1].slice(name.length + 1);
        return null;
    };
    const run: GhRunner = (args) => {
        calls.push(args);
        if (state.down)
            return { status: 1, stdout: "", stderr: "HTTP 502: Bad Gateway" };
        if (args[1] === "-X" && args[2] === "POST") {
            const m = /^repos\/[^/]+\/[^/]+\/statuses\/([0-9a-f]{40})$/.exec(
                args[3]
            );
            if (!m) return { status: 1, stdout: "", stderr: "bad path" };
            const description = field(args, "description") ?? "";
            if (description.length > DESCRIPTION_MAX)
                return {
                    status: 1,
                    stdout: "",
                    stderr: "description is too long (maximum is 140 characters)",
                };
            clock += 60_000;
            const list = statuses.get(m[1]) ?? [];
            list.unshift({
                context: field(args, "context") ?? "default",
                state: field(args, "state") ?? "",
                description,
                target_url: field(args, "target_url"),
                created_at: new Date(clock).toISOString(),
            });
            statuses.set(m[1], list);
            return { status: 0, stdout: "{}", stderr: "" };
        }
        if (args[1] === "graphql") {
            const n = Number(field(args, "n"));
            const nodes = history.slice(0, n).map((oid) => {
                const s = (statuses.get(oid) ?? []).find(
                    (x) => x.context === "health"
                );
                return {
                    oid,
                    status: s
                        ? {
                              context: {
                                  state: s.state.toUpperCase(),
                                  description: s.description,
                                  targetUrl: s.target_url,
                                  createdAt: s.created_at,
                              },
                          }
                        : null,
                };
            });
            return {
                status: 0,
                stdout: JSON.stringify({
                    data: {
                        repository: {
                            ref: { target: { history: { nodes } } },
                        },
                    },
                }),
                stderr: "",
            };
        }
        const m =
            /^repos\/[^/]+\/[^/]+\/commits\/([0-9a-f]{40})\/statuses/.exec(
                args[1]
            );
        if (m)
            return {
                status: 0,
                stdout: JSON.stringify(statuses.get(m[1]) ?? []),
                stderr: "",
            };
        return { status: 1, stdout: "", stderr: `unknown call ${args[1]}` };
    };
    return { run, calls, statuses, state };
}

const ghStore = (fake = fakeGh()) =>
    githubVerdictStore({ repo: REPO, branch: "staging", run: fake.run });

const v = (
    s: string,
    status: Verdict["status"],
    extra: Partial<Verdict> = {}
) => ({ sha: s, status, machine: "huawei", ...extra }) as Verdict;

describe("GitHub backend — write then read (issue #5462)", () => {
    it("round-trips a RED: status, step, machine, the failing tests and the log path", () => {
        const store = ghStore();
        store.write(
            v(T2, "red", {
                step: "test:app",
                log: "/home/fil/health/2222.log",
                tests: ["scripts/__tests__/a.test.ts", "convex/b.test.ts"],
            })
        );
        expect(store.read(T2)).toMatchObject({
            sha: T2,
            status: "red",
            step: "test:app",
            machine: "huawei",
            log: "/home/fil/health/2222.log",
            tests: ["scripts/__tests__/a.test.ts", "convex/b.test.ts"],
        });
        expect(store.read(T2)?.at).toMatch(/^2026-10-11T/);
    });

    it("writes context=health with the GitHub state for each verdict, and a URL log as target_url", () => {
        const fake = fakeGh();
        const store = ghStore(fake);
        store.write(v(T1, "green", { log: "https://example.test/log/1" }));
        store.write(v(T2, "red", { step: "test:bot" }));
        store.write(v(T3, "infra", { step: "preflight:convex" }));
        store.write(v(T4, "amber", { repairOf: T2 }));
        const top = (s: string) => fake.statuses.get(s)?.[0];
        expect(top(T1)).toMatchObject({
            context: "health",
            state: "success",
            target_url: "https://example.test/log/1",
        });
        expect(top(T2)?.state).toBe("failure");
        expect(top(T3)?.state).toBe("error");
        expect(top(T4)?.state).toBe("pending");
        expect(store.read(T4)).toMatchObject({ status: "amber", repairOf: T2 });
        expect(store.read(T1)?.log).toBe("https://example.test/log/1");
    });

    it("reads null for a sha nobody gated, and ignores other contexts", () => {
        const fake = fakeGh();
        fake.statuses.set(T1, [
            {
                context: "ci/other",
                state: "failure",
                description: "x",
                target_url: null,
                created_at: "2026-10-11T00:00:00Z",
            },
        ]);
        expect(ghStore(fake).read(T1)).toBeNull();
        expect(ghStore(fake).read(T2)).toBeNull();
    });

    it("the last writer per sha wins", () => {
        const store = ghStore();
        store.write(v(T3, "red", { step: "test:app" }));
        store.write(v(T3, "green"));
        expect(store.read(T3)?.status).toBe("green");
        store.write(v(T3, "red", { step: "lint" }));
        expect(store.read(T3)).toMatchObject({ status: "red", step: "lint" });
    });

    it("infra never overwrites a RED or a GREEN for the same sha", () => {
        const store = ghStore();
        store.write(v(T3, "red", { step: "test:app" }));
        expect(store.write(v(T3, "infra", { step: "check:ui" }))).toMatchObject(
            {
                written: false,
            }
        );
        expect(store.read(T3)).toMatchObject({
            status: "red",
            step: "test:app",
        });
        store.write(v(T2, "green"));
        store.write(v(T2, "infra"));
        expect(store.read(T2)?.status).toBe("green");
    });

    it("infra is written on a sha with no verdict, and over another infra", () => {
        const store = ghStore();
        expect(store.write(v(T3, "infra", { step: "a" })).written).toBe(true);
        expect(store.write(v(T3, "infra", { step: "b" })).written).toBe(true);
        expect(store.read(T3)).toMatchObject({ status: "infra", step: "b" });
    });

    it("the latest gated tip is the newest commit carrying a verdict, with its age", () => {
        const store = ghStore();
        expect(store.latest()).toBeNull();
        store.write(v(T1, "green"));
        store.write(v(T3, "infra"));
        const latest = store.latest();
        expect(latest).toMatchObject({ sha: T3, status: "infra" });
        const at = Date.parse(latest?.at ?? "");
        expect(verdictAgeMs(latest, at + 90_000)).toBe(90_000);
        expect(verdictAgeMs(null, at)).toBeNull();
    });

    it("throws when GitHub does not answer — and the total reader names the error instead", () => {
        const fake = fakeGh();
        fake.state.down = true;
        const store = ghStore(fake);
        expect(() => store.lineage()).toThrow(/502/);
        expect(readVerdictLineage(() => store)).toMatchObject({
            kind: "none",
            error: expect.stringMatching(/502/),
        });
    });
});

describe("the commit-status description (140 characters)", () => {
    it("keeps whole test paths only, as many as fit", () => {
        const tests = Array.from(
            { length: 8 },
            (_, i) => `scripts/__tests__/a-rather-long-test-name-${i}.test.ts`
        );
        const d = encodeDescription(
            v(T1, "red", { step: "test:app", log: "/h/1.log", tests })
        );
        expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
        const back = decodeStatus({
            sha: T1,
            state: "failure",
            description: d,
            targetUrl: null,
            createdAt: null,
        });
        expect(back?.tests?.length).toBeGreaterThan(0);
        for (const t of back?.tests ?? []) expect(tests).toContain(t);
    });

    it("decodes a step that has a space in it", () => {
        const d = encodeDescription(v(T1, "red", { step: "check:ui --all" }));
        expect(
            decodeStatus({
                sha: T1,
                state: "FAILURE",
                description: d,
                targetUrl: null,
                createdAt: null,
            })
        ).toMatchObject({ step: "check:ui --all", machine: "huawei" });
    });
});

describe("review fixes — AMBER must be reachable on the github backend", () => {
    it("a long LOCAL log path never crowds the failing test out of the description", () => {
        const d = encodeDescription(
            v(T1, "red", {
                step: "test:app",
                machine: "huawei-matebook",
                log: "/home/fil/code/mtg/tolaria/.claude/telemetry/health/3ca4a4a0a1b2.log",
                tests: ["scripts/__tests__/health-verdict-store.test.ts"],
            })
        );
        expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
        expect(
            decodeStatus({
                sha: T1,
                state: "failure",
                description: d,
                targetUrl: null,
                createdAt: null,
            })?.tests
        ).toEqual(["scripts/__tests__/health-verdict-store.test.ts"]);
    });

    it("infra never overwrites an AMBER — a saturated confirming run must not bring the RED back", () => {
        const store = ghStore();
        store.write(v(T2, "red", { step: "test:app" }));
        store.write(v(T3, "amber", { repairOf: T2 }));
        expect(store.write(v(T3, "infra")).written).toBe(false);
        expect(store.lineage().kind).toBe("amber");
    });

    it("the repair proof runs *.test.* files only — a blade *.spec.ts is not the default config's", () => {
        const lineage = lineageOf([
            v(T2, "red", {
                tests: ["convex/gre/ai/blade/__tests__/x.spec.ts"],
            }),
        ]);
        expect(repairProofOf(lineage, "repair")).toBeUndefined();
    });
});

describe("AMBER — a proved repair resumes picks and landings (issue #5462)", () => {
    it("RED blocks; AMBER on the repair's tip does not; the next GREEN clears it", () => {
        const store = ghStore();
        store.write(v(T2, "red", { step: "test:app" }));
        expect(store.lineage().kind).toBe("red");
        expect(lineageBlocks(store.lineage().kind)).toBe(true);
        store.write(v(T3, "amber", { repairOf: T2 }));
        expect(store.lineage()).toMatchObject({
            kind: "amber",
            verdict: { sha: T3, repairOf: T2 },
        });
        expect(lineageBlocks(store.lineage().kind)).toBe(false);
        store.write(v(T4, "green"));
        expect(store.lineage().kind).toBe("green");
    });

    it("a RED on an AMBER lineage is the SECOND RED", () => {
        const store = ghStore();
        store.write(v(T2, "red", { step: "test:app" }));
        store.write(v(T3, "amber", { repairOf: T2 }));
        store.write(v(T4, "red", { step: "test:app" }));
        expect(store.lineage()).toMatchObject({
            kind: "second-red",
            verdict: { sha: T4 },
        });
        expect(lineageBlocks("second-red")).toBe(true);
    });

    it("a late RED about a tip OLDER than the repair is not a second red", () => {
        // A health run on T2 that started before the repair landed at T3
        // and finished after it: commit order, not write order, decides.
        const store = ghStore();
        store.write(v(T1, "red", { step: "test:app" }));
        store.write(v(T3, "amber", { repairOf: T1 }));
        store.write(v(T2, "red", { step: "test:app" }));
        expect(store.lineage().kind).toBe("amber");
    });

    it("two REDs with no repair between them are one red, not a second", () => {
        expect(
            lineageOf([
                v(T4, "red"),
                v(T3, "infra"),
                v(T2, "red"),
                v(T1, "green"),
            ]).kind
        ).toBe("red");
    });

    it("an AMBER older than the last GREEN does not make a later red second", () => {
        expect(
            lineageOf([
                v(T4, "red"),
                v(T3, "green"),
                v(T2, "amber"),
                v(T1, "red"),
            ]).kind
        ).toBe("red");
    });

    it("infra alone is infra; nothing is none", () => {
        expect(lineageOf([v(T2, "infra"), v(T1, "infra")]).kind).toBe("infra");
        expect(lineageOf([]).kind).toBe("none");
    });
});

/** A primary checkout with the file layout under it. */
function withRoot(fn: (root: string, dir: string) => void): void {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "verdict-store-"));
    const dir = path.join(root, ".claude", "telemetry", "health");
    fs.mkdirSync(dir, { recursive: true });
    try {
        fn(root, dir);
    } finally {
        fs.rmSync(root, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 100,
        });
    }
}

describe("the repository named by the origin remote", () => {
    it("reads owner/name from either origin URL form", () => {
        expect(repoFromRemote("git@github.com:fil-donadoni/tolaria.git")).toBe(
            "fil-donadoni/tolaria"
        );
        expect(
            repoFromRemote("https://github.com/fil-donadoni/tolaria\n")
        ).toBe("fil-donadoni/tolaria");
        expect(repoFromRemote("https://example.com/x/y")).toBeNull();
    });
});

describe("failedTestFiles — what a repair's lane must run", () => {
    it("reads FAIL lines with and without a project tag and colour, unique and sorted", () => {
        const out = [
            "\u001b[31m FAIL \u001b[39m |node-engine| scripts/__tests__/land.test.ts > land > x",
            " FAIL  |node-engine| scripts/__tests__/land.test.ts > land > y",
            " FAIL  convex/gre/__tests__/stack.test.ts [ convex/gre/__tests__/stack.test.ts ]",
            " ✓ |app| src/ok.test.tsx",
            "FAIL is a word in prose too",
        ].join("\n");
        expect(failedTestFiles(out)).toEqual([
            "convex/gre/__tests__/stack.test.ts",
            "scripts/__tests__/land.test.ts",
        ]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Every consumer reads through the store: a RED in it is refused / stopped.
// ─────────────────────────────────────────────────────────────────────────────

/** A GitHub store holding RED @ T2 — a red the OTHER machine found: no local
 *  marker exists anywhere. */
function remoteRed(): { store: VerdictStore; fake: ReturnType<typeof fakeGh> } {
    const fake = fakeGh();
    const store = ghStore(fake);
    store.write(
        v(T2, "red", {
            step: "test:app",
            tests: ["scripts/__tests__/a.test.ts"],
        })
    );
    return { store, fake };
}

describe("consumers — queue:plan refuses a RED in the store", () => {
    it("refuses the pick on a remote RED, with no marker on this machine", () => {
        withRoot((root) => {
            const { store } = remoteRed();
            const marker = readHealthMarker(root, () => store);
            expect(marker).toMatchObject({ sha: T2, failedStep: "test:app" });
            expect(redRefusal(marker)).toMatchObject({
                admitted: false,
                refusal: "red",
            });
        });
    });

    it("picks again once the lineage is AMBER", () => {
        withRoot((root) => {
            const { store } = remoteRed();
            store.write(v(T3, "amber", { repairOf: T2 }));
            expect(redRefusal(readHealthMarker(root, () => store))).toEqual({
                admitted: true,
            });
        });
    });

    it("an unreadable store refuses nothing", () => {
        withRoot((root) => {
            const fake = fakeGh();
            fake.state.down = true;
            expect(readHealthMarker(root, () => ghStore(fake))).toBeNull();
        });
    });

    it("prints an INFRA latest verdict from the store", () => {
        withRoot((root) => {
            const store = ghStore();
            store.write(v(T4, "infra", { step: "preflight:convex" }));
            expect(readHealthInfra(root, () => store)).toMatchObject({
                sha: T4,
                failedStep: "preflight:convex",
            });
        });
    });
});

describe("consumers — land refuses a non-repair PR on a RED in the store", () => {
    it("refuses on a remote RED; AMBER lets it through", () => {
        const { store } = remoteRed();
        const gate = (red: boolean) =>
            redLandGate({
                red,
                prBody: "Closes #1",
                repairIssues: [],
                repairFlag: false,
                redOkFlag: false,
            });
        expect(
            gate(lineageBlocks(landHealthLineage(() => store).kind)).kind
        ).toBe("refuse");
        store.write(v(T3, "amber", { repairOf: T2 }));
        expect(
            gate(lineageBlocks(landHealthLineage(() => store).kind)).kind
        ).toBe("proceed");
    });

    it("a declared repair owes the proof: the RED's failing tests, after the lane, before the push", () => {
        const { store } = remoteRed();
        const proof = repairProofOf(store.lineage(), "repair");
        expect(proof).toEqual({
            redSha: T2,
            tests: ["scripts/__tests__/a.test.ts"],
        });
        expect(repairProofOf(store.lineage(), "red-ok")).toBeUndefined();
        expect(repairProofOf(store.lineage(), undefined)).toBeUndefined();
        const cmd = buildLockedCommand({
            branch: "feat/issue-9",
            pr: 9,
            primaryCheckout: "/p",
            worktree: null,
            teardown: false,
            landingKind: "repair",
            repairProof: proof,
            gatedGreen: [],
            laneRecordDir: null,
            merge: true,
        });
        const lane = cmd.indexOf("check:lane");
        const run = cmd.indexOf("repair proof: $*");
        const push = cmd.indexOf("git push --force-with-lease");
        const record = cmd.indexOf(`--repair-of=${T2}`);
        expect(lane).toBeGreaterThan(-1);
        expect(run).toBeGreaterThan(lane);
        expect(push).toBeGreaterThan(run);
        expect(record).toBeGreaterThan(push);
    });

    it("no repair, no proof, no AMBER step", () => {
        expect(markAmberStep("/p", "red-ok", T2)).toBe("");
        expect(markAmberStep("/p", "repair")).toBe("");
    });

    it("the proof step sets REPAIR_PROVED only when the named tests ran and passed", () => {
        withRoot((root) => {
            const bin = path.join(root, "bin");
            fs.mkdirSync(bin);
            fs.writeFileSync(
                path.join(bin, "bunx"),
                `#!/bin/sh\necho "$@" >> "${root}/bunx.calls"\nexit \${FAKE_VITEST_EXIT:-0}\n`,
                { mode: 0o755 }
            );
            fs.mkdirSync(path.join(root, "t"));
            fs.writeFileSync(path.join(root, "t", "a.test.ts"), "");
            const step = repairProofStep(["t/a.test.ts", "t/gone.test.ts"]);
            const sh = (exit: string) =>
                spawnSync(
                    "sh",
                    ["-c", `${step} && echo "proved=\${REPAIR_PROVED:-no}"`],
                    {
                        cwd: root,
                        encoding: "utf8",
                        env: {
                            ...process.env,
                            PATH: `${bin}:${process.env.PATH}`,
                            FAKE_VITEST_EXIT: exit,
                        },
                    }
                );
            const green = sh("0");
            expect(green.status).toBe(0);
            expect(green.stdout).toMatch(/proved=1/);
            // Only the file that still exists is run, explicitly.
            expect(fs.readFileSync(path.join(root, "bunx.calls"), "utf8")).toBe(
                "vitest run t/a.test.ts\n"
            );
            const red = sh("1");
            expect(red.status).not.toBe(0);
            expect(red.stdout).not.toMatch(/proved=/);
            const none = spawnSync(
                "sh",
                [
                    "-c",
                    `${repairProofStep(["t/gone.test.ts"])} && echo "proved=\${REPAIR_PROVED:-no}"`,
                ],
                { cwd: root, encoding: "utf8" }
            );
            expect(none.status).toBe(0);
            expect(none.stdout).toMatch(/proved=no/);
        });
    });

    it("a repair of a two-culprit RED lands on its share, without AMBER (issue #7448)", () => {
        withRoot((root) => {
            const bin = path.join(root, "bin");
            fs.mkdirSync(bin);
            // The fake vitest fails exactly the file named in FAKE_RED.
            fs.writeFileSync(
                path.join(bin, "bunx"),
                `#!/bin/sh\necho "$@" >> "${root}/bunx.calls"\n[ "$3" = "\${FAKE_RED:-}" ] && exit 1\nexit 0\n`,
                { mode: 0o755 }
            );
            fs.mkdirSync(path.join(root, "t"));
            fs.writeFileSync(path.join(root, "t", "a.test.ts"), "");
            fs.writeFileSync(path.join(root, "t", "b.test.ts"), "");
            const step = repairProofStep(["t/a.test.ts", "t/b.test.ts"]);
            const sh = (red: string) =>
                spawnSync(
                    "sh",
                    ["-c", `${step} && echo "proved=\${REPAIR_PROVED:-no}"`],
                    {
                        cwd: root,
                        encoding: "utf8",
                        env: {
                            ...process.env,
                            PATH: `${bin}:${process.env.PATH}`,
                            FAKE_RED: red,
                        },
                    }
                );
            const share = sh("t/b.test.ts");
            expect(share.status).toBe(0);
            expect(share.stdout).toMatch(/still red: t\/b\.test\.ts/);
            expect(share.stdout).toMatch(/proved=no/);
            // One vitest run per file, so one culprit's red never masks the other's green.
            expect(fs.readFileSync(path.join(root, "bunx.calls"), "utf8")).toBe(
                "vitest run t/a.test.ts\nvitest run t/b.test.ts\n"
            );
            expect(sh("").stdout).toMatch(/proved=1/);
        });
    });
});

describe("consumers — health:fix acts on a RED in the store", () => {
    it("spawns a fixer for a remote RED on the tip, and finds nothing to fix once AMBER", () => {
        const { store } = remoteRed();
        const red = readRedFromStore(() => store);
        expect(
            spawnDecision({ ...red, tip: T2, interactive: true })
        ).toMatchObject({ kind: "spawn", sha: T2, failedStep: "test:app" });
        store.write(v(T3, "amber", { repairOf: T2 }));
        expect(
            spawnDecision({
                ...readRedFromStore(() => store),
                tip: T3,
                interactive: true,
            })
        ).toMatchObject({ kind: "refuse", nothingToFix: true });
    });
});
