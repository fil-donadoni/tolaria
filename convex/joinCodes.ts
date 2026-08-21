// Short, human-typeable join codes for open Arena tables (issue #2649).
//
// The whole point of a code is that one player reads it out loud and the other
// types it, so the alphabet is chosen for the EAR and the EYE, not for entropy:
// Crockford Base32 drops the four glyphs that get confused (I, L, O, U) and its
// normalization folds the two confusions that still happen anyway (O→0, I/L→1).
// Anything else fails closed — an unknown glyph is never "helpfully" mapped to
// a neighbour, because a code that silently resolves to SOMEONE ELSE'S table is
// worse than a code that does not resolve at all.
//
// Randomness lives at the MUTATION call site, never here: `generateJoinCode`
// takes an RNG closure exactly the way `pickCoinTossWinner` takes a roll
// (`convex/game.ts`), so every rule in this file is deterministically testable.
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

/** Crockford Base32 — 32 glyphs, no I/L/O/U. */
export const JOIN_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 32^6 ≈ 1.07e9 codes. Only codes on CURRENTLY-OPEN tables are live (the
 *  field is cleared the moment a table is joined and the row is deleted when
 *  it is abandoned), so the occupied fraction of that space is the number of
 *  tables open right now — a birthday collision at 1,000 concurrent tables is
 *  ~5e-4, and `mintJoinCode` re-rolls against the index anyway, making it 0. */
export const JOIN_CODE_LENGTH = 6;

/** Glyphs a human types for a glyph the alphabet excludes. Deliberately only
 *  the visual confusions; `U` is NOT folded (see the header). */
const FOLD: Record<string, string> = { O: "0", I: "1", L: "1" };

/** Separators a user may paste or type between groups — stripped, not folded. */
const SEPARATORS = /[\s\-–—_.]/g;

/** One code from `rand`, which must yield floats in `[0, 1)`. Pure. */
export function generateJoinCode(rand: () => number): string {
    let code = "";
    for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
        // `Math.min` guards a degenerate RNG returning exactly 1 — without it
        // the index runs off the end and the code silently contains
        // "undefined". Cheap, and the failure it prevents is unreviewable.
        const idx = Math.min(
            JOIN_CODE_ALPHABET.length - 1,
            Math.floor(rand() * JOIN_CODE_ALPHABET.length)
        );
        code += JOIN_CODE_ALPHABET[idx];
    }
    return code;
}

/** Canonical storage form of whatever the user typed, or `null` when it is not
 *  a join code at all. FAIL-CLOSED: every rejection returns `null`, and every
 *  caller turns `null` into the same "not joinable" outcome as an unknown
 *  code — so a malformed code is indistinguishable from a wrong one. */
export function normalizeJoinCode(raw: string): string | null {
    const stripped = raw.replace(SEPARATORS, "").toUpperCase();
    if (stripped.length !== JOIN_CODE_LENGTH) return null;
    let out = "";
    for (const ch of stripped) {
        const folded = FOLD[ch] ?? ch;
        if (!JOIN_CODE_ALPHABET.includes(folded)) return null;
        out += folded;
    }
    return out;
}

/** Display form: grouped in threes so it can be read aloud without losing the
 *  place. Returns the input unchanged when it is not a valid code — a broken
 *  value must look broken, not be dressed up as a real one. */
export function formatJoinCode(raw: string): string {
    const code = normalizeJoinCode(raw);
    if (!code) return raw;
    return `${code.slice(0, 3)}-${code.slice(3)}`;
}

/** The ONE class of game a join code may ever resolve to: a public,
 *  human-vs-human, engine-mode Arena table still waiting for its second seat.
 *
 *  Written as an allowlist of `undefined`s rather than `mode !== "manual"` on
 *  purpose (subagent brief § producer census, point 5): a future game class —
 *  a new `mode`, a new event binding — is rejected by default until someone
 *  deliberately opts it in here, instead of falling through the gap. */
export function isCodeJoinableGame(game: Doc<"games">): boolean {
    return (
        // "Open" is exactly this pair (`convex/schema.ts` § games).
        game.status === "waiting" &&
        game.players.length < 2 &&
        // Solo / vs-AI tables have no second seat to sell.
        game.solo !== true &&
        game.vsAi !== true &&
        // Tabletop (Manual Mode, ADR 0080) has its own action set and its own
        // join mutation with its own guards — a code must not cross that seam.
        game.mode === undefined &&
        // Limited challenges and round pairings are ADDRESSED to one seat
        // (issue #1577 / #1645); they are private by construction and never
        // appear in the public lobby either (`listOpenGames`).
        game.limitedChallenge === undefined &&
        game.limitedPairing === undefined &&
        game.limitedEventId === undefined
    );
}

/** How many re-rolls before we give up. Each collision is ~1e-6 at any plausible
 *  table count, so reaching the end means something is structurally wrong (a
 *  broken RNG) and throwing is the right answer — never returning a duplicate. */
const MINT_ATTEMPTS = 10;

/** A code no live table currently holds. Uniqueness is enforced against the
 *  `by_join_code` index rather than assumed from the code space. */
export async function mintJoinCode(
    ctx: Pick<QueryCtx, "db">,
    rand: () => number
): Promise<string> {
    for (let i = 0; i < MINT_ATTEMPTS; i++) {
        const code = generateJoinCode(rand);
        const taken = await ctx.db
            .query("games")
            .withIndex("by_join_code", (q) => q.eq("joinCode", code))
            .first();
        if (!taken) return code;
    }
    throw new Error("Could not allocate a join code. Please try again.");
}

/** What every failed code resolution says, whatever the reason: unknown,
 *  malformed, stale, already started, already full, or pointing at a class of
 *  game codes are not issued for. One message so the code space cannot be
 *  probed for what a game WAS. */
export const JOIN_CODE_REJECTED =
    "That join code doesn't match a table that's open right now.";

/** Resolves a user-typed code to the open table it names, or `null`.
 *
 *  This is the ONLY place a code becomes a game id. There is deliberately no
 *  query that hands a client a game id for a code: a lookup query would turn a
 *  6-character space into an enumerable oracle for game and host names, and it
 *  would mean the join then trusted a client-supplied id. */
export async function findGameByJoinCode(
    ctx: Pick<QueryCtx, "db">,
    rawCode: string
): Promise<Doc<"games"> | null> {
    const code = normalizeJoinCode(rawCode);
    if (!code) return null;
    const game = await ctx.db
        .query("games")
        .withIndex("by_join_code", (q) => q.eq("joinCode", code))
        .first();
    if (!game) return null;
    return isCodeJoinableGame(game) ? game : null;
}
