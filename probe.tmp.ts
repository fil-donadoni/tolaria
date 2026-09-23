import { subjectRule } from "./convex/oracle/grammar/shared/effectClause";
const ctx: any = {
    card: { name: "Probe", slug: "probe" },
    targets: { declare: () => 0 },
};
for (const span of [
    "any target",
    "target creature, planeswalker, or player",
    "another target creature, planeswalker, or player",
    "creatures you control",
]) {
    let r: any;
    try {
        r = subjectRule.run(span, ctx);
    } catch (e: any) {
        r = { ok: false, reason: "THREW: " + e.message };
    }
    console.log(span, "=>", JSON.stringify(r).slice(0, 400));
}
