# join-continued-lines.awk — the single-pass, per-record line joiner shared
# by .claude/hooks/deny-guard.sh and its test suite
# (scripts/__tests__/hook-policy.test.ts calls this exact file via
# `awk -f`, so the hook and the test can never drift into two
# implementations of the same rule).
#
# A `tool_input.command` is a script, not one line: `&&`, `||`, `;` and
# newlines separate independent commands downstream in deny-guard.sh's
# segment splitter — EXCEPT when a newline sits INSIDE a still-open
# pipeline. Two shapes mean "this pipeline keeps going on the next physical
# line", and both have to be joined into one record before the segment
# splitter ever sees them, or a gate and its pager land in different
# segments (the incident that started this file, PR #2527):
#
#   1. A trailing backslash, ODD count only — classic shell line
#      continuation. `\\` (even count) is one escaped, LITERAL backslash and
#      does NOT continue the line. `\<CR><LF>` joins exactly like `\<LF>` —
#      a CRLF-saved continuation is still a continuation.
#   2. A trailing shell operator — `|`, `||`, `&&` or `&` — one shape over
#      from the backslash hole, closed in the same pass rather than a
#      second one (round 3 review, #2527).
#
# `&&`/`||` joining is a deliberate no-op for the rules downstream: the
# segment splitter re-splits on `&&`/`||` immediately afterward regardless
# of whether this joiner glued the line back together first. Joining them
# anyway costs nothing and keeps this rule uniform across all four
# operators, rather than carving out "three of the four".
#
# A trailing BARE `|` is the shape that actually matters: joining is what
# puts a piped pager back in the SAME segment as the gate command feeding
# it — `bun run test |` + newline + `tail -20` has to become one record, or
# the pager-guard (deny-guard.sh §3) never sees the two halves together.
#
# A trailing bare `&` (backgrounding — NOT `&&`) is not really a line
# continuation in real shell semantics: the command before it truly does
# end there. Joining it anyway can only ever ADD matchable surface to a
# segment (two backgrounded commands merged into one), never remove any, so
# the worst outcome is a false DENY — never a false ALLOW. Accepted on
# purpose, stated here rather than left as a silent side effect of treating
# all four operators uniformly.
#
# Deliberately NOT joined: a trailing `;` genuinely terminates a command —
# joining across it would hide a real command boundary instead of
# restoring one that was never broken.
#
# No last-record special case (unlike the BSD `sed -e :a -e '/\\$/N; ...'`
# this replaced, whose `N` quit silently on the final line with nothing to
# append and emptied the ENTIRE joined output — the exact bug PR #2527
# round 2 fixed, turning a fail-closed guard fully fail-open on a single
# trailing backslash). Every record decides its own fate independently; a
# continuation on the truly last line, with nothing left to join to, still
# prints its content (minus the marker backslash, for the backslash case)
# rather than vanishing.
#
# Byte-identity for anything that matches NEITHER shape: `line` — never a
# recomputed or trimmed copy — is what gets printed back out, `\r` and all,
# so a command with no trailing continuation of either kind survives this
# script unchanged.
{
    line = $0
    hadCR = 0
    L = length(line)
    if (L > 0 && substr(line, L, 1) == "\r") {
        hadCR = 1
        line = substr(line, 1, L - 1)
        L = L - 1
    }

    # Trailing backslash run — parity decides continuation vs. literal.
    n = 0
    while (n < L && substr(line, L - n, 1) == "\\") n++

    if (n % 2 == 1) {
        # Odd: genuine continuation. Drop the one marker backslash, join
        # with a space (never a newline), keep any escaped pairs before it.
        printf "%s ", substr(line, 1, L - 1)
        next
    }

    # Trailing shell operator. Detection trims trailing spaces/tabs from a
    # SCRATCH copy only — `line` itself, whitespace included, is still what
    # gets printed on every branch below, so this check never disturbs
    # byte-identity for a line with no trailing operator. Trimmed by hand
    # (substr/length, never a regex `sub()`), matching the backslash-parity
    # loop above: a dynamic regex against arbitrary command bytes can invoke
    # a locale-aware multibyte conversion that throws on invalid UTF-8 (an
    # `awk: towc: multibyte conversion failure` observed on this machine's
    # awk under invalid input) — substr/length stay byte-wise regardless of
    # locale, which is what the whole corpus of untrusted command bytes
    # this script processes actually needs.
    t = line
    tl = length(t)
    while (tl > 0) {
        c = substr(t, tl, 1)
        if (c == " " || c == "\t") tl--
        else break
    }
    t = substr(t, 1, tl)
    isOp = 0
    if (tl >= 2 && substr(t, tl - 1, 2) == "&&") isOp = 1
    else if (tl >= 2 && substr(t, tl - 1, 2) == "||") isOp = 1
    else if (tl >= 1 && substr(t, tl, 1) == "|") isOp = 1
    else if (tl >= 1 && substr(t, tl, 1) == "&") isOp = 1

    if (isOp) {
        printf "%s ", line
        next
    }

    if (hadCR) {
        printf "%s\r\n", line
    } else {
        printf "%s\n", line
    }
}
