#!/usr/bin/env python3
"""Group the trigger-head gaps into phrase families and price each family.

Input: the two JSON files `dump-gaps.mjs` and `body-test.mjs` write.

    python3 docs/research/scripts/trigger-head-gaps/families.py /tmp/gaps.json /tmp/body.json /tmp/lines.json

A family is the event phrase left after the subject is peeled off ("a land you
control" + "enters") and normalised by regex. The tier of a family is a hand
list (`EXIST`, `FACTORY`): a first-pass sort, not a proof.
"""
import json, collections, sys, re
rows = json.load(open(sys.argv[1])); body = {(b["i"], b["gi"]): b for b in json.load(open(sys.argv[2]))}
ADJ = r"(?:nontoken|token|legendary|artifact|enchantment|nonland|noncreature|nonartifact|attacking|blocking|tapped|untapped|white|blue|black|red|green|colorless|multicolored|face-down|historic|snow|basic|nonbasic|modified|equipped|enchanted|other)"
NOUN = r"(?:creatures?|lands?|artifacts?|enchantments?|permanents?|planeswalkers?|tokens?|Auras?|Equipment|Vehicles?|[A-Z][a-z']+)"
FILTER = r"(?:%s )*%s(?: or %s)?(?: with (?:power|toughness|mana value) \d+ or (?:greater|less))?" % (ADJ, NOUN, NOUN)
CTRL = r"(?: you control| an opponent controls| your opponents control| you don't control)?"
SELF = r"(?:this [A-Za-z]+|it|SELF)"
SUBJ = [
 ("self+other", SELF + r" or another " + FILTER + CTRL),
 ("self", SELF),
 ("host", r"(?:enchanted|equipped|fortified) (?:creature|land|permanent|artifact|planeswalker|player)"),
 ("batch", r"one or more(?: other)? " + FILTER + CTRL),
 ("one", r"(?:a|an|another) " + FILTER + CTRL),
 ("player", r"(?:you|an opponent|a player|each player|each opponent|that player|one or more players|one or more opponents)"),
]
T3 = {"attack":"attacks","die":"dies","enter":"enters","become":"becomes","deal":"deals","leave":"leaves","are":"is","block":"blocks","transform":"transforms","cast":"casts","draw":"draws","gain":"gains","lose":"loses","discard":"discards","sacrifice":"sacrifices","play":"plays","put":"puts","tap":"taps","activate":"activates","cycle":"cycles","create":"creates","search":"searches","scry":"scries","surveil":"surveils","mill":"mills","expend":"expends","commit":"commits","roll":"rolls","get":"gets","exile":"exiles","do":"does","have":"has"}
def norm_event(e):
    w = e.split(" "); w[0] = T3.get(w[0], w[0]); e = " ".join(w)
    e = re.sub(r"\{[^}]+\}", "{M}", e); e = re.sub(r"\b\d+\b", "N", e)
    e = re.sub(r"\b(first|second|third|fourth)\b", "Nth", e)
    e = re.sub(r"\b(?:an?|another) (?:%s )*(?:instant or sorcery|creature|noncreature|artifact|enchantment|historic|instant|sorcery|Aura|Equipment|[A-Z][a-z']+|multicolored|colorless|white|blue|black|red|green|legendary|kicked)(?: or (?:instant|sorcery|creature|artifact|enchantment|[A-Z][a-z']+|white|blue|black|red|green))? (spell|card|token|counter)" % ADJ, r"a <F> \1", e)
    e = re.sub(r"\b[A-Z][a-z']+\b", "<Sub>", e)
    return e
# events whose head kind already exists (pure scope/filter permutation, option P)
EXIST = {"enters","dies","attacks","deals combat damage to a player","leaves the battlefield","becomes tapped","is put into a graveyard from the battlefield","is put into your graveyard from the battlefield","is dealt damage","deals damage","becomes the target of a spell or ability","is turned face up","transforms","attacks or blocks","enters or attacks","enters or dies","enters or leaves the battlefield","dies or is put into exile","enters the battlefield","deals damage to a player","deals damage to an opponent","deals combat damage to an opponent","attacks and isn't blocked","casts a <F> spell","casts a spell","cycles a card","sacrifices a <Sub>","sacrifices a creature","sacrifices a permanent","sacrifices another permanent"}
# events with a hand-written factory but no compiled head kind
FACTORY = {"draws a card","discards a card","loses life","becomes untapped","puts one or more +N/+N counters on","creates a token","discards one or more cards","creates one or more tokens","becomes monstrous"}
L = []; cardGaps = {}; pool = {}
for r in rows:
    cardGaps[r["i"]] = len(r["gaps"]); pool[r["i"]] = r["poolIn"]
    name = r["name"].split(" // ")[0]; short = re.split(r"[, ]", name)[0]
    for gi, g in enumerate(r["gaps"]):
        a = g["a"]
        if not a or a["slot"] != "triggered" or a["path"][0] != "trigger head": continue
        span = a["span"].replace("{self}", "SELF").replace(name, "SELF")
        m = re.match(r"^(When|Whenever|At) (.+)$", span); sc = "none"
        if not m: key = "?? " + span[:40]
        elif m.group(1) == "At": key = "AT " + norm_event(m.group(2)); sc = "phase"
        else:
            rest = m.group(2)
            if rest.startswith(short + " ") and len(short) > 2: rest = "SELF" + rest[len(short):]
            key = None
            for cls, rx in SUBJ:
                mm = re.match(r"^(" + rx + r") (.+)$", rest)
                if mm: sc = cls; key = norm_event(mm.groups()[-1]); break
            if key is None: key = "?? " + norm_event(rest)
        tier = "1 existing kind" if key in EXIST else "2 factory, no kind" if key in FACTORY else "2 phase variant" if sc == "phase" else "3 new"
        b = body[(r["i"], gi)]
        L.append(dict(i=r["i"], gi=gi, fam=key, sc=sc, tier=tier, bodyOk=b["bodyOk"], line=g["line"]))
N = len(L); allCards = {l["i"] for l in L}
print("head-gap lines", N, "cards", len(allCards), "bodyOk lines", sum(l["bodyOk"] for l in L))
def measure(sel, label):
    lines = [l for l in L if sel(l)]
    touched = {l["i"] for l in lines}
    lineClosed = {l["i"] for l in lines if l["bodyOk"]}
    closedCount = collections.Counter(l["i"] for l in lines if l["bodyOk"])
    full = {i for i, n in closedCount.items() if n == cardGaps[i]}
    modern = sum(1 for i in full if "modern" in pool[i]); mt = sum(1 for i in touched if "modern" in pool[i])
    print(f"{label:42s} lines {len(lines):5d} | cards head read {len(touched):5d} (modern {mt:4d}) | cards with a whole line closed {len(lineClosed):5d} | fully ready {len(full):5d} (modern {modern})")
    return full
fam = collections.Counter(l["fam"] for l in L); rank = [k for k, _ in fam.most_common()]
print("families", len(fam))
print("\n== by tier ==")
for t in sorted({l["tier"] for l in L}): measure(lambda l, t=t: l["tier"] == t, t)
measure(lambda l: l["tier"][0] in "12", "tiers 1+2")
print("\n== cumulative by family rank ==")
for K in (10, 25, 50, 100, 200, 400, len(rank)):
    s = set(rank[:K]); measure(lambda l, s=s: l["fam"] in s, f"top {K} families")
print("\n== tier 1 by subject class =="); print(collections.Counter(l["sc"] for l in L if l["tier"][0] == "1"))
print("\n== top 45 families ==")
famBody = collections.Counter(l["fam"] for l in L if l["bodyOk"]); famTier = {l["fam"]: l["tier"] for l in L}
for n, (k, v) in enumerate(fam.most_common(45), 1): print(f"{n:3d} {v:4d} bodyOk {famBody[k]:4d} | {famTier[k]:18s} | {k[:75]}")
cnt = collections.Counter(l["i"] for l in L)
print("cards whose every gap is a head gap:", sum(1 for i in allCards if cnt[i] == cardGaps[i]))
json.dump(L, open(sys.argv[3], "w"))
