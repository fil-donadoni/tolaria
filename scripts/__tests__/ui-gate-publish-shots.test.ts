import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";
import type { FailedCell } from "../ui-gate/failure-shot";
import {
    MAX_ATTACHMENTS,
    commentBody,
    orderCells,
    pickTarget,
    publishEnv,
    publishFailedShots,
    type GhRunner,
} from "../ui-gate/publish-shots";

/**
 * The publish step (issue #6145): one comment with the table and the shots
 * inline, on the branch's PR, else its issue, else nowhere (local paths
 * printed) — and never an exception, so never a change to the walk's exit
 * code. `gh` is a fake that records its calls.
 */

function cell(
    surface: string,
    viewport: string,
    over: Partial<FailedCell> = {}
): FailedCell {
    return {
        surface,
        viewport,
        floors: [{ floor: "cardsZero", reading: 2 }],
        asserts: [],
        file: `${surface}__${viewport}.png`,
        ...over,
    };
}

/** A fake `gh`: `prList` answers `pr list`, `comment` answers the post. */
function fakeGh(opts: {
    prList?: { status: number; stdout: string };
    comment?: { status: number; stdout?: string; stderr?: string };
    throws?: boolean;
}) {
    const calls: {
        args: readonly string[];
        cwd: string;
        env: NodeJS.ProcessEnv;
    }[] = [];
    const gh: GhRunner = (args, o) => {
        calls.push({ args, cwd: o.cwd, env: o.env });
        if (opts.throws) throw new Error("spawn gh ENOENT");
        if (args[0] === "pr" && args[1] === "list")
            return {
                stderr: "",
                ...(opts.prList ?? { status: 0, stdout: "" }),
            };
        return {
            status: opts.comment?.status ?? 0,
            stdout:
                opts.comment?.stdout ??
                "https://github.com/o/r/pull/7#issuecomment-1\n",
            stderr: opts.comment?.stderr ?? "",
        };
    };
    return { gh, calls };
}

let dir: string;
afterEach(() => dir && fs.rmSync(dir, { recursive: true, force: true }));

function publish(
    cells: FailedCell[],
    gh: GhRunner,
    branch: string | null = "feat/issue-6145"
) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-gate-publish-"));
    const logs: string[] = [];
    const outcome = publishFailedShots(cells, {
        dir,
        branch,
        head: "abc1234",
        gh,
        env: {},
        log: (l) => logs.push(l),
    });
    return { outcome, logs };
}

describe("check:ui publish — the comment body", () => {
    it("carries one table row per broken floor and failed assertion, and one image per cell", () => {
        const body = commentBody(
            [
                cell("lobby", "390x844x3"),
                cell("deck-builder", "1440x900x2", {
                    floors: [
                        { floor: "hOverflow", reading: 12 },
                        { floor: "axeSerious", reading: 1 },
                    ],
                    asserts: ["pile | reachable"],
                }),
            ],
            "abc1234"
        );
        expect(body).toContain("### check:ui — 2 failing cell(s) at abc1234");
        expect(body).toContain("| surface | viewport | floor | reading |");
        expect(body).toContain("| lobby | 390x844x3 | cardsZero | 2 |");
        expect(body).toContain(
            "| deck-builder | 1440x900x2 | hOverflow | 12 |"
        );
        expect(body).toContain(
            "| deck-builder | 1440x900x2 | axeSerious | 1 |"
        );
        expect(body).toContain(
            "| deck-builder | 1440x900x2 | assert pile \\| reachable | failed |"
        );
        expect(body).toContain("![lobby @ 390x844x3](./lobby__390x844x3.png)");
        expect(body).toContain(
            "![deck-builder @ 1440x900x2](./deck-builder__1440x900x2.png)"
        );
    });

    it("says nothing about the machine: no absolute path, no host", () => {
        const body = commentBody([cell("lobby", "390x844x3")], null);
        expect(body).not.toMatch(/\/home\/|\/tmp\/|\.claude|telemetry|load/);
    });

    it(`references at most ${MAX_ATTACHMENTS} images and says how many it left out`, () => {
        const many = Array.from({ length: MAX_ATTACHMENTS + 3 }, (_, i) =>
            cell(`s${i}`, "390x844x3")
        );
        const body = commentBody(many, null);
        expect(body.match(/!\[/g)).toHaveLength(MAX_ATTACHMENTS);
        expect(body).toContain("3 more shot(s) not attached");
    });

    it("orders cells by Viewport Matrix, then surface order", () => {
        const ordered = orderCells(
            [cell("b", "v2"), cell("a", "v2"), cell("b", "v1")],
            ["v1", "v2"],
            ["a", "b"]
        );
        expect(ordered.map((c) => `${c.surface}@${c.viewport}`)).toEqual([
            "b@v1",
            "a@v2",
            "b@v2",
        ]);
    });
});

describe("check:ui publish — where the comment goes", () => {
    const opts = { cwd: "/x", env: {} };

    it("the branch's open PR first", () => {
        const { gh } = fakeGh({ prList: { status: 0, stdout: "6200\n" } });
        expect(pickTarget("feat/issue-6145", gh, opts)).toEqual({
            kind: "pr",
            number: 6200,
        });
    });

    it("the issue the branch names when there is no PR", () => {
        const { gh } = fakeGh({ prList: { status: 0, stdout: "" } });
        expect(pickTarget("fix/issue-6145", gh, opts)).toEqual({
            kind: "issue",
            number: 6145,
        });
    });

    it("the issue when the PR lookup itself fails", () => {
        const { gh } = fakeGh({ prList: { status: 1, stdout: "" } });
        expect(pickTarget("feat/issue-6145", gh, opts)).toEqual({
            kind: "issue",
            number: 6145,
        });
    });

    it("nowhere for a branch with neither (batch health walks the base)", () => {
        const { gh } = fakeGh({});
        expect(pickTarget("staging", gh, opts).kind).toBe("local");
        expect(pickTarget(null, gh, opts).kind).toBe("local");
        expect(pickTarget("HEAD", gh, opts).kind).toBe("local");
    });
});

describe("check:ui publish — posting", () => {
    it("posts ONE comment on the PR, attaching every shot it references, from the run's directory", () => {
        const { gh, calls } = fakeGh({ prList: { status: 0, stdout: "6200" } });
        const { outcome, logs } = publish(
            [cell("lobby", "390x844x3"), cell("lobby", "844x390x3")],
            gh
        );
        expect(outcome).toBe("posted");
        const posts = calls.filter((c) => c.args[1] === "comment");
        expect(posts).toHaveLength(1);
        expect(posts[0].cwd).toBe(dir);
        expect(posts[0].args.slice(0, 5)).toEqual([
            "pr",
            "comment",
            "6200",
            "--body-file",
            "check-ui-comment.md",
        ]);
        expect(posts[0].args.slice(5)).toEqual([
            "--attach",
            "./lobby__390x844x3.png",
            "--attach",
            "./lobby__844x390x3.png",
        ]);
        expect(
            fs.readFileSync(path.join(dir, "check-ui-comment.md"), "utf8")
        ).toContain("| lobby | 844x390x3 | cardsZero | 2 |");
        expect(logs.join("\n")).toContain("posted on PR #6200");
    });

    it("posts on the issue when there is no PR", () => {
        const { gh, calls } = fakeGh({});
        expect(publish([cell("lobby", "390x844x3")], gh).outcome).toBe(
            "posted"
        );
        expect(calls.at(-1)!.args.slice(0, 3)).toEqual([
            "issue",
            "comment",
            "6145",
        ]);
    });

    it("prints the local paths when there is nowhere to post", () => {
        const { gh, calls } = fakeGh({});
        const { outcome, logs } = publish(
            [cell("lobby", "390x844x3")],
            gh,
            "staging"
        );
        expect(outcome).toBe("local");
        expect(calls.some((c) => c.args[1] === "comment")).toBe(false);
        expect(logs.at(-1)).toBe(`  ${path.join(dir, "lobby__390x844x3.png")}`);
    });

    it("a rejected upload says so and prints the paths — never throws", () => {
        const { gh } = fakeGh({
            comment: { status: 1, stderr: "HTTP 403: upload rejected\nmore" },
        });
        const { outcome, logs } = publish([cell("lobby", "390x844x3")], gh);
        expect(outcome).toBe("failed");
        expect(logs[0]).toContain(
            "could not post 1 failure shot(s) on issue #6145 (HTTP 403: upload rejected)"
        );
        expect(logs[1]).toContain("lobby__390x844x3.png");
    });

    it("a gh that cannot even start is a printed failure, not an exception", () => {
        const { gh } = fakeGh({ throws: true });
        expect(() => publish([cell("lobby", "390x844x3")], gh)).not.toThrow();
        expect(publish([cell("lobby", "390x844x3")], gh).outcome).toBe(
            "failed"
        );
    });

    it("a run with no failing cell calls nothing", () => {
        const { gh, calls } = fakeGh({});
        expect(publish([], gh).outcome).toBe("none");
        expect(calls).toEqual([]);
    });

    it("--no-publish keeps the shots local", () => {
        const { gh, calls } = fakeGh({});
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-gate-publish-"));
        const outcome = publishFailedShots([cell("lobby", "390x844x3")], {
            dir,
            branch: "feat/issue-6145",
            head: null,
            gh,
            env: {},
            log: () => {},
            disabled: true,
        });
        expect(outcome).toBe("local");
        expect(calls).toEqual([]);
    });
});

describe("check:ui publish — the token", () => {
    it("drops the bug-report PAT everywhere", () => {
        const env = publishEnv({
            GITHUB_TOKEN: "pat",
            GH_TOKEN: "mine",
            PATH: "/bin",
        });
        expect(env.GITHUB_TOKEN).toBeUndefined();
        expect(env.GH_TOKEN).toBe("mine");
        expect(env.PATH).toBe("/bin");
    });

    it("drops the Actions token on a runner, so gh uses the keyring login", () => {
        const env = publishEnv({
            GITHUB_ACTIONS: "true",
            GH_TOKEN: "ghs_actions",
            GITHUB_TOKEN: "x",
        });
        expect(env.GH_TOKEN).toBeUndefined();
        expect(env.GITHUB_TOKEN).toBeUndefined();
    });
});
