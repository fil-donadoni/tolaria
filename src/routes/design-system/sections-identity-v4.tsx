// Identity v4 census (ADR 0103, PRD #2721, issue #2722): the three token
// families that carry "quiet chrome, loud world" on top of the unchanged v3
// system — the display type treatment, the hairline + proportional-card-corner
// frame, and the page-ground grain.
//
// Every value here is read from the typed mirror (`src/lib/design-tokens.ts`),
// which `src/__tests__/design-tokens.test.ts` pins to `src/index.css`. The
// page cannot describe a token the stylesheet no longer declares.
import { Section, Specimen, Sub, TokenRows } from "./lib";
import { V4_TOKEN_GROUPS, PALETTE_TOKENS } from "@/lib/design-tokens";

const hex = (name: string): string =>
    PALETTE_TOKENS.find((t) => t.name === name)!.hex;

/** The proportional corner at three card sizes. The point of the specimen is
 *  that the corner GROWS with the card: a fixed `rounded-md` looks right at
 *  one size and wrong at the other two, which is why ~20 call sites each
 *  guessed their own `rounded-[6%]` / `[7%]` / `[8%]`. */
function CardCornerSpecimen() {
    return (
        <div className="flex flex-wrap items-end gap-4">
            {[
                ["40px", "pile thumb"],
                ["72px", "battlefield"],
                ["120px", "hand / preview"],
            ].map(([w, role]) => (
                <div key={w} className="text-center">
                    <div
                        className="card-corner border border-border-accent bg-surface-elevated"
                        style={{ width: w, aspectRatio: "63 / 88" }}
                    />
                    <p className="mt-1 font-mono text-[10px] text-text">{w}</p>
                    <p className="text-[10px] text-text-disabled">{role}</p>
                </div>
            ))}
        </div>
    );
}

/** The two hairline strengths, over a flat panel and over a colour field —
 *  the second is the case the translucent tokens exist for. */
function HairlineSpecimen() {
    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(
                [
                    ["hairline", "ivory/12 — panels, bars, tiles"],
                    ["hairline-strong", "ivory/30 — rules, dividers"],
                ] as const
            ).map(([cls, role]) => (
                <div key={cls} className="flex flex-col gap-2">
                    <div className={`${cls} rounded-md bg-surface p-3`}>
                        <p className="font-mono text-[11px] text-text">
                            .{cls}
                        </p>
                        <p className="text-[11px] text-text-muted">{role}</p>
                    </div>
                    {/* Over a colour field: the flattened
                        `--color-border-subtle` hex would paint a visible grey
                        line here, which is the whole reason the translucent
                        pair exists beside it. */}
                    <div
                        className={`${cls} rounded-md p-3`}
                        style={{
                            background: `linear-gradient(120deg, ${hex("secondary-accent")}, ${hex("danger")})`,
                        }}
                    >
                        <p className="text-[11px] text-parchment">
                            same edge, over card art
                        </p>
                    </div>
                </div>
            ))}
        </div>
    );
}

/** The grain as it is actually applied: the `<body>` recipe's own three
 *  tokens, on the ground colour, so the page shows the material rather than
 *  describing it. */
function GrainSpecimen() {
    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div
                className="hairline flex h-24 items-end rounded-md p-3"
                style={{ background: hex("surface-base") }}
            >
                <span className="text-[11px] text-text-muted">
                    ground, no grain
                </span>
            </div>
            <div
                className="hairline flex h-24 items-end rounded-md p-3"
                style={{
                    backgroundColor: hex("surface-base"),
                    backgroundImage: "var(--grain-image)",
                    backgroundRepeat: "repeat",
                    backgroundSize: "var(--grain-size) var(--grain-size)",
                    backgroundBlendMode: "var(--grain-blend)",
                }}
            >
                <span className="text-[11px] text-text-muted">
                    ground + grain (what body paints)
                </span>
            </div>
        </div>
    );
}

export function IdentityV4Sections() {
    return (
        <Section
            id="identity-v4"
            index="15"
            title="Identity v4 — quiet chrome, loud world"
            blurb="ADR 0103 supersedes the Antique Bronze VALUES of ADR 0007 and keeps its roles verbatim: a cold graphite ground under monochrome ivory chrome, so the card art and the signal hues carry all the colour. The palette above is already v4; these are the three non-colour families that came with it. The layout (ADR 0101) is untouched."
        >
            <Sub
                title="Display type"
                note="Geist 500 / −0.025em / lining tabular — Beleren reserved for the card domain"
            >
                <TokenRows group={V4_TOKEN_GROUPS[0]} />
            </Sub>

            <Sub
                title="Hairlines"
                note="one width, two strengths, translucent so an edge composites over art"
            >
                <Specimen label="Hairline atoms" tone="plain">
                    <HairlineSpecimen />
                </Specimen>
            </Sub>

            <Sub
                title="Card corner"
                note="--card-radius · 4.8% / 3.45% · the printed corner, as a fraction"
            >
                <Specimen
                    label="Proportional corner at three card sizes"
                    tone="plain"
                    note="every card surface consumes it via .card-corner (and .card-ring, which implies it) since #2724"
                >
                    <CardCornerSpecimen />
                </Specimen>
                <TokenRows group={V4_TOKEN_GROUPS[1]} />
            </Sub>

            <Sub
                title="Page-ground grain"
                note="applied once, on <body>, as a background layer"
            >
                <Specimen label="Ground material" tone="plain">
                    <GrainSpecimen />
                </Specimen>
                <TokenRows group={V4_TOKEN_GROUPS[2]} />
            </Sub>
        </Section>
    );
}
