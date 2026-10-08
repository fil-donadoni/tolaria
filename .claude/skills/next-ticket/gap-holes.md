# Gap issue — every hole has an owner, verified

Read when: the ticket refused a member, left a key live, or filed a Grammar,
Op/mechanic or Bot Gap (any `/next-ticket` on a gap issue).

A ticket is not reported done until each such hole is **checked, never
assumed from `gaps:sync`'s log**:

1. an open issue exists for it (`gh issue list --search "<key or card>"`, or
   its row in `data/grammar-gaps.json`);
2. `gh issue view N --json parent` names the parent umbrella;
3. the band is the parent's board `Priority` (the child's own field stays
   empty, issue #4371) — read it with
   `gh project item-list 2 --owner fil-donadoni --limit 2000 --format json`.

Name the new issue numbers and the band in the §6 report as `#new (band)`.
A hole with no issue, no parent or the wrong band is fixed first
(`issue:inherit-band`). History: issue #4554 reported "re-homed" unchecked.
