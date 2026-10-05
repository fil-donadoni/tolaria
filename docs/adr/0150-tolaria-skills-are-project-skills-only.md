# In Tolaria the only skills are project skills: committed settings hide the rest, an external skill is adopted by copying it in

## Status

accepted — grilled 2026-10-05 (PRD #5096, decisions D1, D3, D11). Extends
PRD #2180 (the workflow skills live in the repo) from six named skills to a
rule.

## Context

Three skill systems overlapped in one repository: the project skills
(versioned, gated), a machine-level install of an external skill set
(unversioned, stale), and a skill plugin that injects a "you MUST invoke a
skill" preamble into every session and ships a worktree skill competing with
`wt:new`. Two project skills depended on a grilling skill that existed only
on the owner's machine, and upstream had changed its behaviour in a way that
contradicts this project's one-question-per-turn rule. The residency guard
named six skills; a seventh dependency escaped it, and two skills still told
sessions to run `/process-gh-issues` (retired by ADR 0110) and a setup skill
that was never ours.

Measured 2026-10-05 with a throwaway project: `skillOverrides` set to `off`
in a project's committed settings hides a skill of that name, including a
machine-level one, and a typed `/name` answers "disabled via skillOverrides";
`enabledPlugins: false` in project settings overrides a user-level `true`.

## Decision

1. **The boundary is committed configuration.** `.claude/settings.json`
   disables the `superpowers` plugin and sets `skillOverrides: "off"` for
   every machine-level skill that is not a project skill. Tool plugins
   (browser devtools, the owner's output-style plugin, Convex) are left alone.
2. **The guard is a rule, not a list.** `scripts/__tests__/project-skills.test.ts`
   derives (a) the skill directories found at machine level and requires each
   to be hidden or to be a project skill, (b) every skill name that a project
   skill, a script prompt, a hook or `CLAUDE.md` instructs a session to run
   and requires it to resolve to a tracked project skill, and (c) that no
   project skill is also present at machine level. A new dead name or an
   un-hidden machine skill reds the lane.
3. **Adoption rule.** An external skill is adopted by copying and adapting it
   into `.claude/skills/` under its own name — never by installing or
   upgrading a machine-level copy. A machine-level skill of the same name
   shadows a project skill, so the adopted copy takes a name the machine does
   not hold (`/grill`, not `grill-with-docs`).
4. **Synced claude.ai skills are out of reach.** Skills synced from the
   owner's claude.ai account cannot be switched off from committed project
   settings. Hiding them is a documented local step
   (`docs/guides/next-issue-flow.md` § 5), not a gate.

## Consequences

- A fresh checkout or a worktree behaves like the primary checkout: the local,
  uncommitted override that disabled the plugin is superseded.
- A new machine-level skill on the owner's machine reds `project-skills.test.ts`
  until it is hidden or adopted; the failure names the row to add.
- Other projects keep their machine-level skills and plugins.
- The guard is a static read of tracked files plus one directory listing;
  measured cost is stated in the PR that introduced it (lane tier, ≤ 10 s).
