/**
 * opencode port of `.claude/hooks/spawn-guard.sh` — the deterministic
 * PreToolUse equivalent, via the `tool.execute.before` hook (throwing blocks
 * the tool call, the same way `exit 2` blocks a Claude Code `Agent` spawn).
 *
 * The two rules are carried over verbatim, adapted to how opencode routes
 * subagent models:
 *
 *   Claude Code                        opencode
 *   ---------------------------------- ------------------------------------
 *   Agent spawn has no `model`         (structurally impossible: `task` has
 *                                      no per-spawn `model` field — the tier
 *                                      is pinned per agent in opencode.json)
 *   Agent spawn has no role-prefixed   Rule 1 below — `description` must
 *   description                        start with a role
 *   review work routed to `model:opus` Rule 2 below — a `review` description
 *                                      must use the `reviewer` agent (pinned
 *                                      to the pro tier in opencode.json)
 *
 * Every denial names the fix, matching spawn-guard.sh's contract: a policy
 * that blocks without redirecting just produces a retry loop.
 */

const ROLES = [
    "implement",
    "review",
    "fixup",
    "investigate",
    "research",
    "verify",
    "migrate",
    "audit",
];

// The agent whose `model` is pinned to the pro tier in `opencode.json`.
// Update in lockstep if the reviewer is re-tiered.
const REVIEWER_AGENT = "reviewer";

function roleOf(description: string): string {
    const lowered = description.trim().toLowerCase();
    for (const role of ROLES) {
        if (lowered.startsWith(role)) return role;
    }
    return "";
}

function deny(reason: string): never {
    throw new Error(`spawn-guard: ${reason}`);
}

export const SpawnGuard = async () => {
    return {
        "tool.execute.before": async (input: any, output: any) => {
            if (input.tool !== "task") return;

            const args = output.args ?? {};
            const description: string | undefined = args.description;
            const subagentType: string | undefined = args.subagent_type;

            if (!description) {
                deny(
                    "task spawn has no `description`.\n\n" +
                        "The description is how every downstream report attributes the " +
                        "spawn's tokens to a role. Start it with one of: implement, " +
                        "review, fixup, investigate, research, verify, migrate, audit — " +
                        "then the rest of the sentence as you like:\n\n" +
                        '  "review PR #2211"\n' +
                        '  "investigate where pendingChoices is projected"\n'
                );
            }

            const role = roleOf(description);
            if (!role) {
                deny(
                    `task spawn description does not start with a role.\n\n` +
                        `  got: "${description}"\n\n` +
                        "Start it with one of: implement, review, fixup, investigate, " +
                        "research, verify, migrate, audit — then the rest of the sentence " +
                        "as you like. Without a role, the spawn's tokens land in the " +
                        "scorecard's `unclassified` bucket."
                );
            }

            if (role === "review" && subagentType !== REVIEWER_AGENT) {
                deny(
                    `review spawn must use the \`${REVIEWER_AGENT}\` agent (pro tier).\n\n` +
                        `  got subagent_type: "${subagentType ?? "(none)"}"\n\n` +
                        "The reviewer's model is pinned to the pro tier in opencode.json; " +
                        "routing a review to any other agent silently downgrades it."
                );
            }
        },
    };
};
