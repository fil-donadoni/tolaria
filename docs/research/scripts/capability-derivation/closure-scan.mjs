// Extract the source text of every hand-written `matches` / `condition` /
// `interveningIf` closure under convex/cards/sets, with its card, the factory
// call it sits in, and the card's state in the compiled pool.
//
//   bun docs/research/scripts/capability-derivation/closure-scan.mjs /tmp/closures.json
import ts from "typescript";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const files = [];
const walk = (d) => {
    for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) {
            if (f !== "__tests__") walk(p);
        } else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) files.push(p);
    }
};
walk("convex/cards/sets");
const pool = JSON.parse(
    readFileSync("data/oracle-compiled.json", "utf8")
).cards;
const state = new Map(pool.map((c) => [c.name, c]));
const PROPS = new Set(["condition", "interveningIf", "matches"]);
const out = [];
for (const f of files) {
    const src = ts.createSourceFile(
        f,
        readFileSync(f, "utf8"),
        ts.ScriptTarget.Latest,
        true
    );
    const visit = (n, card, call) => {
        if (ts.isObjectLiteralExpression(n)) {
            for (const p of n.properties)
                if (
                    ts.isPropertyAssignment(p) &&
                    p.name.getText() === "name" &&
                    ts.isStringLiteral(p.initializer)
                )
                    card = p.initializer.text;
        }
        if (ts.isCallExpression(n)) call = n.expression.getText();
        if (
            ts.isPropertyAssignment(n) &&
            PROPS.has(n.name.getText()) &&
            (ts.isArrowFunction(n.initializer) ||
                ts.isFunctionExpression(n.initializer) ||
                ts.isIdentifier(n.initializer))
        ) {
            out.push({
                file: f.replace("convex/cards/sets/", ""),
                line: src.getLineAndCharacterOfPosition(n.getStart()).line + 1,
                card,
                call,
                prop: n.name.getText(),
                text: n.initializer.getText().replace(/\s+/g, " "),
            });
        }
        ts.forEachChild(n, (c) => visit(c, card, call));
    };
    visit(src, null, null);
}
for (const o of out) {
    const c = state.get(o.card);
    o.pool = c?.state ?? "absent";
    o.gaps = c?.gaps?.length ?? 0;
}
writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
const C = (k) => {
    const m = {};
    for (const o of out) m[k(o)] = (m[k(o)] ?? 0) + 1;
    return m;
};
console.log(
    out.length,
    C((o) => o.prop),
    C((o) => o.pool),
    C((o) => o.prop + "/" + o.pool)
);
console.log("cards", new Set(out.map((o) => o.card)).size);
