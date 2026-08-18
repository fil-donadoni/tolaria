# strip-heredoc-bodies.awk — drop heredoc BODIES before deny-guard.sh's rules
# ever see them. Shared by the hook and its test suite
# (scripts/__tests__/hook-policy.test.ts calls this exact file via `awk -f`,
# so the two can never drift into separate implementations).
#
# WHY (issue #2537). Every rule in deny-guard.sh matches text inside a
# `tool_input.command`, and a command routinely CARRIES text it does not run:
# a commit message, a PR body, an issue body, a patch script written with
# `python3 - <<'PY'`. Those bodies are data — the shell hands them to a
# process on stdin and never executes them — but they are indistinguishable
# from commands to a substring scanner. The header of deny-guard.sh already
# records three false denials from exactly this confusion, closed then by
# splitting into segments; heredoc bodies are the shape that survived, and it
# bites harder now that §1 denies `gh pr merge` machine-wide rather than only
# inside an issue worktree: a patch script that MENTIONS the merge (this
# repo's own tests do) was denied while it edited a test file.
#
# Dropping a body can only remove matchable surface from text the shell was
# never going to run, so the failure direction is a missed DENY on a command
# that was never a command. The detection below is deliberately strict so
# that surface stays as small as possible.
#
# DETECTED: `<<WORD`, `<<'WORD'`, `<<"WORD"`, and the `<<-` tab-stripping
# variant, when the introducer is the LAST thing on its line (trailing
# whitespace aside). That covers every real shape in this repo
# (`gh pr create --body-file - <<'EOF'`, `git commit -F - <<'MSG'`,
# `python3 - <<'PY'`) while refusing to fire on `<<` buried mid-line, where a
# quoted string ("echo 'a << b'") could otherwise be read as an introducer and
# swallow the real commands that follow it — a false ALLOW, the one direction
# that matters.
#
# NOT detected, on purpose:
#   * `<<<` here-strings — no body, so nothing to strip; matching them would
#     drop the following line for nothing.
#   * a second heredoc on the same line (`cmd <<A <<B`) — only the last
#     introducer is tracked. Vanishingly rare, and the cost is a body scanned
#     for the wrong terminator.
#   * quoting/escaping INSIDE the introducer beyond the simple quoted-word
#     form. Anything unrecognised is simply not treated as a heredoc, which
#     leaves the old behaviour (the body is scanned) — fail-closed.
#
# An unterminated heredoc drops everything to EOF. That is not a hole: the
# shell would refuse the whole command with "unexpected end of file", so
# nothing after it runs either.
#
# Byte-identity: a line that neither introduces nor sits inside a heredoc is
# printed back exactly as read, `\r` and all, so this filter is transparent to
# join-continued-lines.awk downstream (which depends on that guarantee).

function isWordChar(c) {
    return index("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_", c) > 0
}

{
    line = $0

    body = line
    L = length(body)
    if (L > 0 && substr(body, L, 1) == "\r") {
        body = substr(body, 1, L - 1)
        L = L - 1
    }

    if (inHeredoc) {
        # The terminator is the delimiter ALONE on its line; `<<-` also
        # accepts leading tabs before it (and only tabs — that is what the
        # shell strips).
        t = body
        if (allowIndent) {
            i = 1
            while (i <= length(t) && substr(t, i, 1) == "\t") i++
            t = substr(t, i)
        }
        if (t == delim) inHeredoc = 0
        # Body lines AND the terminator are dropped: neither is a command.
        next
    }

    print line

    # ── does this line OPEN a heredoc? parse the tail backwards ────────────
    # substr/index only, never a dynamic regex: these are untrusted command
    # bytes, and a locale-aware regex can throw on invalid UTF-8 (the
    # `awk: towc: multibyte conversion failure` this machine's awk produces —
    # same reason join-continued-lines.awk parses by hand).
    t = body
    tl = length(t)
    while (tl > 0) {
        c = substr(t, tl, 1)
        if (c == " " || c == "\t") tl--
        else break
    }
    if (tl == 0) next

    q = ""
    c = substr(t, tl, 1)
    if (c == "'" || c == "\"") { q = c; tl-- }

    e = tl
    while (tl > 0 && isWordChar(substr(t, tl, 1))) tl--
    if (e == tl) next                       # no delimiter word
    d = substr(t, tl + 1, e - tl)

    if (q != "") {
        if (tl == 0 || substr(t, tl, 1) != q) next
        tl--
    }

    while (tl > 0) {
        c = substr(t, tl, 1)
        if (c == " " || c == "\t") tl--
        else break
    }

    indent = 0
    if (tl > 0 && substr(t, tl, 1) == "-") { indent = 1; tl-- }

    if (tl < 2 || substr(t, tl - 1, 2) != "<<") next
    if (tl >= 3 && substr(t, tl - 2, 1) == "<") next    # `<<<` here-string

    inHeredoc = 1
    delim = d
    allowIndent = indent
}
