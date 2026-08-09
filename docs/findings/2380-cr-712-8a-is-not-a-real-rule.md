---
title: '"CR 712.8a" is cited 12 times for the transform toggle and is not a real rule'
discoveredBy: 2380
status: draft
confidence: medium
---

**What is wrong.** Twelve code comments cite **CR 712.8a** as the authority for
"transform is a toggle — the SAME primitive flips either direction". There is no
712.8a in the Comprehensive Rules. **712.8** is the modal-DFC **land** rule ("A
player playing a modal double-faced card as a land chooses one of its faces
that's a land before putting it onto the battlefield"), and it has no subrules.
The toggle the comments describe is CR **701.28a** ("To transform a permanent,
turn it over so that its other face is up") together with CR **712.14** ("When a
transforming double-faced permanent transforms, it doesn't become a new
object"), and the "front face off the battlefield" default is CR **712.4a**.

**Evidence.** `git grep -c '712\.8a' -- '*.ts'` on `main` → 12 occurrences,
introduced by #1210 and copied forward since:
`convex/gre/transform.ts:29`, `:158`, `:205`; `convex/gre/state.ts:12000`;
`convex/cards/types.ts:2583`, `:2598`, `:11489`, `:11519`;
`convex/cards/mechanicsRegistry.ts:3033` (the `transform` Op note) and the
`exileAndReturnTransformed` note; `convex/gre/effects/interpreter.ts:3738`;
`convex/gre/__tests__/transform.test.ts:123` (a test NAME, so it prints in the
suite output). Verified the real numbering against the CR section 712 text
(712.4a / 712.4b–e / 712.5 … 712.10a / 712.14) while fixing the
`exileAndReturnTransformed` registry row's `cr` field in PR #2425 — that row now
carries `712.10a`, the rule that actually covers putting a DFC onto the
battlefield "transformed".

Nothing is behaviourally wrong: every one of the twelve is a comment or a test
name, and the described behaviour matches the real rules. The cost is that
`.claude/rules/gre-development.md` makes CR references the audit trail for
mechanics work ("Every mechanic MUST reference its CR section"), so a wrong
number is a wrong audit trail — the next agent verifying "is the toggle
CR-correct?" looks up 712.8, finds modal DFC lands, and either relitigates
correct code or copies the bad citation into card #13.

**Why it may not deserve its own issue.** It is a pure comment sweep with zero
behaviour change — twelve string edits and one test rename — so it is a good
line on a docs/hygiene tracker rather than a ticket of its own. It is also
possible some older CR printing did number the toggle 712.8a, in which case the
right fix is a repoint to the CURRENT numbering rather than a "bug" framing.
