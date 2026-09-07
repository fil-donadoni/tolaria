import type { Tone } from "./tones";
import type { TermId } from "../glossary";
import type { OriginSource, SessionOrigin } from "./nowPayload";

/**
 * Who started a session, as the page says it (issue #3144).
 *
 * `afk` is the amber one on purpose: an unattended driver pass is the row an
 * operator scans for, the same way `warn` marks a claim old enough to doubt.
 * `interactive` is unremarkable, so it is neutral. A session neither signal
 * could place reads `unknown` — never `manual`, which would be a silent claim
 * that a person is at the keyboard.
 *
 * `originSource` is NOT folded into the word. It is a different question — how
 * SURE the answer is, not what it says — and a six-word vocabulary for two
 * axes is how a badge stops being readable at a glance. It rides as the
 * `confidence` modifier `tones.ts` already defines: a dashed edge, plus the
 * sentence below on hover.
 */
export const ORIGIN: Record<
    SessionOrigin,
    { word: string; tone: Tone; term: TermId }
> = {
    afk: { word: "afk loop", tone: "warn", term: "live.origin.afk" },
    interactive: {
        word: "manual",
        tone: "neutral",
        term: "live.origin.manual",
    },
    unknown: { word: "unknown", tone: "unknown", term: "live.origin.unknown" },
};

/** How the origin was arrived at, as the sentence the badge carries. */
export const ORIGIN_SOURCE_TITLE: Record<OriginSource, string> = {
    ledger: "Recorded by the SessionStart hook inside the session itself — exact.",
    entrypoint:
        "Inferred from the transcript's entrypoint (a headless `claude -p` is the shape the AFK driver launches) — the session started before the hook existed, so nothing recorded it.",
    none: "Neither recorded nor inferable — the session's transcript carries no entrypoint and no hook row exists for it.",
};

/** An answer the server DEDUCED, not one it read. The difference decides
 *  whether "afk loop" is a fact or a guess, and a badge that renders both
 *  identically is the one that gets believed when it is wrong. */
export const isInferredOrigin = (source: OriginSource | undefined): boolean =>
    source === "entrypoint";
