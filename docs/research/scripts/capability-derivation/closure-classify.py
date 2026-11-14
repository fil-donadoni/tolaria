#!/usr/bin/env python3
"""Classify the hand-written trigger closures by the cheapest rewrite.

Input: the JSON `closure-scan.mjs` writes. Output: one bucket per closure, the
tally, and (optionally) the closures of one bucket.

    bun docs/research/scripts/capability-derivation/closure-scan.mjs /tmp/closures.json
    python3 docs/research/scripts/capability-derivation/closure-classify.py /tmp/closures.json [bucket-prefix]

The buckets are regexes over the closure's source text. They are a first-pass
sort, not a proof: the `6 read by hand` bucket was read by hand, and the
research note says where each of its members went.
"""
import collections
import json
import re
import sys

rows = json.load(open(sys.argv[1]))
# A `condition` outside a trigger factory is a static effect's, not a trigger's.
triggers = [
    r
    for r in rows
    if r["prop"] != "condition" or (r["call"] or "").endswith(("Trigger", "When"))
]


def scope_filter_only(text):
    rest = re.sub(
        r"event\.type|\.id\b|controllerId|ownerId|types\.includes|subtypes|isToken"
        r"|self\b|event\b|===|!==|&&|\|\||return|true|false|=>|[(){};,\"'\s\[\]!.]",
        "",
        text,
    )
    rest = re.sub(
        r"[A-Z_]+|Creature|Land|Artifact|Enchantment|Planeswalker|instance|Instance"
        r"|permanent|Permanent|creature|card|Card|const|if|_|\d",
        "",
        rest,
    )
    return len(rest) < 25


def bucket(r):
    t = r["text"]
    is_matches = r["prop"] == "matches"
    if r["pool"] == "ready":
        return "1 graduation (the card already compiles ready)"
    reads_self_only = (
        not is_matches
        and not re.search(r"event\.|state\.", t)
        and re.search(r"self\.|source\.", t)
    )
    if reads_self_only and "graveyardSize" not in t:
        return "3 conditionOnSelf (decidable gate)"
    if re.search(r"damagedBySources", t):
        return "5 new: died after damage from the source"
    if re.search(r"ThisTurn|thisTurn", t):
        return "5 new: turn history"
    if "BLOCKERS_CONFIRMED" in t and "ATTACKERS_DECLARED" not in t:
        return "5 new: blocks / becomes-blocked head"
    if re.search(r"isCombat === true && event\.target", t):
        return "2 existing head (combat-damage-to-player)"
    if re.search(r"attachedTo", t):
        return "2 existing head + host scope"
    if "PERMANENT_ENTERED" in t and "ATTACKERS_DECLARED" in t:
        return "2 existing head (enters-or-attacks)"
    if is_matches and scope_filter_only(t):
        return "2 existing factory (scope / filter)"
    if re.search(r"activePlayerId", t) and "battlefield" not in t:
        return "2 existing factory (scope / filter)"
    if re.search(r"spellColors|spellTypes|spellCastFromZone|spellManaValue", t):
        return "2 existing head (spell-cast filter)"
    if re.search(r"wasSacrificed", t):
        return "2 existing head (sacrificed)"
    if re.search(r"creatureCardsAboveInGraveyard|cardIsInOwnerGraveyard|graveyardSize", t):
        return "4 existing condition kind / graveyard zone"
    if re.search(r"\.battlefield\b", t):
        if re.search(r"chosenModeId", t):
            return "6 card-shaped"
        return "4 existing condition kind (controls)"
    if re.search(r"wasCast|enteredTapped|enteredFromGraveyard|EffectivePower", t):
        return "5 new: entered modifier"
    return "6 read by hand"


for r in triggers:
    r["bucket"] = bucket(r)

tally = collections.Counter(r["bucket"] for r in triggers)
print(len(triggers), "closures on", len({r["card"] for r in triggers}), "cards")
for name, count in sorted(tally.items()):
    print(f"{count:4d}  {name}")

if len(sys.argv) > 2:
    for r in triggers:
        if r["bucket"].startswith(sys.argv[2]):
            print(r["card"], "|", f'{r["file"]}:{r["line"]}', "|", r["text"][:200])
