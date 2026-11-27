---
title: The generated vector's leaf cost was measured on self-played boards, not on the field boards issue #10862 names
discoveredBy: 10862
status: draft
confidence: high
---

**What is owed.** Issue #10862 asks for milliseconds per iteration, with the
`generated` term enabled at zero weights, on the field boards of the
rollout-policy bench (`docs/research/rollout-policy-cost.md`). Those boards are
stored rows of production games, pulled by
`docs/research/scripts/brain-bench/field-position.mjs` and kept out of the
repository because they carry player ids. They were on neither runner the two
passes of issue #10862 ran on, and an unattended pass does not pull production
rows. So `docs/research/generated-vector-leaf-cost.md` reports seven
self-played late-game boards and a hosted census of the whole `must` tier, and
says so under § Not measured. The acceptance criterion is met in size, not on
the boards it names.

**Evidence.** `docs/research/generated-vector-leaf-cost.md` § Not measured and
§ Reproduce: the bench already takes a field fixture (`--field <fixture.json>`)
and searches it with the same `runField` as a self-played board.

**What closing it takes.** Owner work, a few minutes on a machine that holds
the fixtures: the second command of § Reproduce, then one table added to the
research note. The self-played boards span 3 to 34 ms per iteration against
the 20.75 ms field target, and read a median of +0.4% per iteration, so a
different verdict on the field boards would be a surprise.

**Why it may not deserve its own issue.** It matters only if PRD issue #10849
continues past the four-gate report (issue #10864); a table fitted there would
be measured again anyway, with non-zero weights and the `need` family read.
