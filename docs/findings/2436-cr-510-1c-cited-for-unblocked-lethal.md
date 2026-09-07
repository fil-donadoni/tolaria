---
title: CR 510.1c is cited across the blade registry for damage it does not govern
discoveredBy: 2436
status: draft
confidence: high
---

**What is wrong.** Five notes and comments in `convex/gre/ai/blade/registry.ts`
cite `CR 510.1c` for a claim that rule does not make. Printed
(`bun run cr 510.1c`), 510.1c is _"A blocked creature assigns its combat damage
to the creatures blocking it"_ — the BLOCKED attacker's assignment, and nothing
else. The citations use it for two other things:

| Line      | Claim as written                          | The rule that actually says it                                           |
| --------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| 989, 1063 | 24 unblocked power is lethal into 20 life | unblocked assignment (CR 510.1h) + `CR 704.5a` (already cited alongside) |
| 1180      | a held-back flyer's damage is lethal      | same                                                                     |
| 2048      | "the 1/1 Raiders is lethal to a 3/1 Elf"  | `CR 704.5g` (already cited alongside)                                    |
| 2913      | 24 unblocked power into 20 life           | as above                                                                 |

Issue #2436 corrected the one instance it introduced (a chump-block entry, now
`CR 510.1d` for the blockers' own assignment plus `CR 704.5g` for lethal damage)
and left the five pre-existing ones alone as out of scope.

**Why it matters.** This is precisely the blind spot `bun run cr:lint` cannot
see: the scanner asks whether an id RESOLVES, and 510.1c resolves. Only reading
the printed text catches a resolvable-but-wrong id, which is what
`CLAUDE.md` § Rules Implementation Process means by "the correction must come
from `bun run cr <id>` printing text that matches the claim". The citations are
load-bearing prose in a registry whose entries are read as the rationale for a
blocking `must` assertion.

**Why it may not deserve its own issue.** It is five comment lines and changes
no behaviour; a sweep of `CR 510.1` across the whole repo (not only the blade
registry) would be the defensible unit of work, and that is bigger than what was
observed here.
