# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## The queue labels are mutually exclusive

`ready-for-agent` and `needs-triage` answer opposite questions and **must never
appear on the same issue**. `ready-for-agent` asserts the issue is executable
as written — an implement-subagent could pick it up and `/process-gh-issues`
will drain it. `needs-triage` asserts a human still has to decide something
(unconfirmed repro, product call, unbounded scope). An issue carrying both
claims to be executable AND blocked, which is not a state: it lands in the AFK
queue while reading as un-evaluated.

Rule when filing: if an agent could execute it without asking anyone, apply
**only** `ready-for-agent`; otherwise apply **only** `needs-triage`. Never hedge
by applying both. The same exclusivity holds for `needs-info` and
`ready-for-human` against `ready-for-agent` — anything that says "a human is
still involved" excludes the AFK queue label.

Edit the right-hand column to match whatever vocabulary you actually use.
