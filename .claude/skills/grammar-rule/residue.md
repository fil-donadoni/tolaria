# /grammar-rule — the residue ledger (issue #5222)

A rule that closes a head gap often UNMASKS the body gap behind it, so cards
the ticket considered can stay `unparsed`. `land` runs
`bun run grammar:residue <issue> --pr <PR>` right after `gaps:sync`: it lists
every card the cluster's keys refused BEFORE the merge, which are `ready` now,
and for each still `unparsed` its residual gaps → the OPEN issue that will
resolve it, posted as a comment on the cluster issue. A residual gap on a
card of an enforced Target with **no open issue** (or a claim on a closed
one) is a HOLE: the script runs `gaps:sync` once more to file it and, if it
survives, `land` warns loudly. You do nothing by hand; read the ledger in
`land`'s log, quote its hole count in the §6 report, and file any surviving
hole with `/create-ticket` before ending the session. Gaps of cards outside
every enforced Target are listed as long tail, not holes (ADR 0137 floor).
