# The Rules Consultant is a separate service with a data-only scope; Tolaria is one Issuer, not its host

## Status

accepted — grilled 2026-09-20. The terms it names are defined in `CONTEXT.md`
§ Rules Consultant. The service's own repository does not exist yet; this
record fixes the boundary before it does.

## Context

A rules question at a paper table — a Lair land from Planeshift, whose enters
ability sacrifices it unless you return a non-Lair land you control: may the
land be chosen and then sacrificed in response? — went to a general assistant
and came back unsatisfying. The gap was not reasoning but equipment. This
repository has the vendored Comprehensive Rules with an exact slicer, Oracle
text for the whole corpus, and one discipline above all others: a rule is
printed, never recalled (ADR 0098, ADR 0133). A chat holding those tools
answers better than a chat without them.

The obvious shape for that is a page inside Tolaria. Grilling the scope removed
its justification, because the consultant must **not** read the codebase:

- A chat box open to users is a prompt-injection surface, and generic tools
  behind it — shell, file read, network — are the channel. What sits behind the
  box must be few, typed and read-only.
- The GRE cannot be an oracle about the rules: it is the subject under test. "The
  engine does X", presented as a ruling, is an authoritative-looking wrong
  answer on exactly the cards where the engine has a bug.

With no codebase access the consultant needs only data, and nothing about data
needs to live inside Tolaria. Three things argue against it living there:
Tolaria's Convex deployment holds unrelated secrets (the Verdict Store's GCS
credentials), its code bundle measured 26.2 of 32 MiB on 2026-09-19, and its
gates are sized for an engine.

Then the legal posture. Scryfall serves its data under Wizards' Fan Content
Policy and forbids repackaging, republishing or proxying it; it asks callers to
cache for at least 24 hours and to identify themselves by `User-Agent`. A local
copy of every card's Rulings is more Wizards-owned data at rest than a fan
project needs, and an endpoint serving it is the thing Scryfall forbids.

## Decision

**The Rules Consultant is its own Convex project, and Tolaria is one Issuer
among possible others.**

- **Scope is data, not code.** Six read-only tools: three over the vendored
  Comprehensive Rules (rule by id, keyword search, glossary) and three over
  Scryfall (card by name, a search whose parameters are enumerated and composed
  server-side, Rulings). No codebase, no ADRs, no GRE run. A card the tools
  cannot resolve is answered from Oracle text the user pastes.
- **The Comprehensive Rules are vendored and pinned per deploy**, as they are
  here. Oracle text and Rulings are fetched on demand from a URL the server
  composes from a fixed template, cached at least 24 hours, schema-validated,
  no redirect followed. **The service exposes no data endpoint** — only
  Advisories. Every Ruling carries its source, and a Scryfall-authored note is
  never presented as official.
- **The service owns Consultations, quota and policy.** An Issuer authenticates
  its own users and vouches for them with a short signed token carrying an
  opaque subject and a tier; the consultant applies its limits per Issuer and
  subject. Tolaria contributes login, the page and the token — not the rules of
  use.
- **Every claim is a Rendered Citation.** The model writes handles; the server
  substitutes the printed text and refuses to ship a handle no tool returned in
  that run. One repair pass, after which unresolved handles are marked, never
  dropped.
- **Progress streams; the Advisory does not.** An answer streamed token by token
  cannot be verified before it is read, so what streams is which source is being
  consulted. The verified Advisory arrives whole.

## Considered options

- **A page inside Tolaria.** Rejected once the scope became data-only: the
  integration buys nothing and inherits the blast radius, the bundle ceiling and
  the engine's gates.
- **Retrieval over embeddings.** Rejected. The value is not similarity over
  rules text but an agent that prints its sources; a retrieved passage is still
  a passage the model may paraphrase.
- **A stored corpus of Oracle text and Rulings.** Rejected for the posture
  above — and it costs nothing to reject, because on-demand plus a cache is what
  Scryfall asks for anyway.
- **Letting the consultant run the GRE** to see what happens. Rejected as
  circular.
- **Quota enforced by Tolaria.** Rejected once the service became multi-client:
  every client would reimplement it, and a careless one would skip it.

## Consequences

- Two repositories, two deployments, two sets of secrets. The rules slicer and
  the Scryfall client are duplicated at first and merge on the second
  occurrence, not the first.
- Answers are only as current as the pinned rules document. A scheduled check
  reports a newer revision; taking it is a deploy, so it is a decision. Because
  a Consultation stores handles rather than text, every handle carries the
  revision and a hash of what was printed: an old Advisory shows what it said
  and flags a rule that has since moved, instead of re-rendering into something
  else. The renumbering that `cr:lint` already guards against is the reason.
- Citation provenance is machine-checked; **the correct application of a
  correctly cited rule is not.** That is the residual risk, and it is precisely
  what the Lair question is made of. It is deferred to a growing eval set of
  real questions with known answers, which decides whether a second
  verification pass and a stronger model earn their cost.
- Availability now depends on Scryfall.
