// A CSS-recipe contract the type system cannot express, and the one that
// already shipped a silent regression (issue #2724 review round 1).
//
// `.card-ring` paints through an `::after` pseudo-element (see the recipe in
// `src/index.css` for why it is not a Tailwind `ring-inset`). A REPLACED
// element — `<img>`, `<video>`, `<canvas>`, `<input>`, `<iframe>`, `<embed>`,
// `<object>` — generates NO `::before`/`::after` box: its content box is the
// replaced content itself, so the pseudo-element never exists and the ring is
// simply not painted.
//
// What makes this worth a catalogue guard rather than a code comment is HOW it
// fails. `.card-ring` also carries `border-radius: var(--card-radius)`, and
// `border-radius` DOES apply to a replaced element. So migrating
// `rounded-[6%] ring-2 ring-accent` on an `<img>` to `card-ring
// card-ring-selected` keeps the printed corner, keeps the class name in the
// diff, keeps every test green, keeps the ui-gate probe green (it measures the
// CORNER) — and deletes the ring. It reads as done in review because the only
// visible evidence is a ring that is not there.
//
// The fix at every site is the same and is already the shipped pattern
// elsewhere: put the recipe on a wrapper or an overlay `<div>` and leave
// `.card-corner` on the image (`drag-ghost.tsx`,
// `limited-draft-pack-card.tsx`, `deck-card-tile.tsx`).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

/** Elements whose box is the replaced content, so they generate no
 *  `::before`/`::after`. `<input>` is here for the same reason `<img>` is —
 *  it is the shape a future "card picker" checkbox would take. */
const REPLACED = [
    "img",
    "video",
    "canvas",
    "input",
    "iframe",
    "embed",
    "object",
];

/** Anything that puts the `.card-ring` recipe on an element: the literal
 *  class, or one of the two helpers that emit it
 *  (`src/lib/card-ring.ts`, `src/lib/picker-ring.ts`). */
const RING_APPLICATIONS = /\bcard-ring\b|cardRingClass|pickerRingClass/;

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "_generated") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) sourceFiles(full, out);
        else if (/\.tsx$/.test(entry)) out.push(full);
    }
    return out;
}

/** The text of every JSX opening tag for a replaced element in `src`.
 *
 *  Brace-aware rather than `/<img[^>]*>/`: an attribute value may hold an
 *  arrow function (`onLoad={() => …}`), whose `>` would end the match early
 *  and hide whatever came after it — exactly the half of a tag a `className`
 *  tends to sit in. */
function replacedElementTags(source: string): string[] {
    const tags: string[] = [];
    const open = new RegExp(`<(${REPLACED.join("|")})(?=[\\s/>])`, "g");
    let m: RegExpExecArray | null;
    while ((m = open.exec(source))) {
        let depth = 0;
        let i = m.index + m[0].length;
        for (; i < source.length; i++) {
            const c = source[i];
            if (c === "{") depth++;
            else if (c === "}") depth--;
            else if (c === ">" && depth === 0) break;
        }
        tags.push(source.slice(m.index, i + 1));
    }
    return tags;
}

describe("card rings never ride on a replaced element (issue #2724)", () => {
    it("no <img>/<video>/<canvas>/<input> in src/ carries the .card-ring recipe", () => {
        const offenders: string[] = [];
        for (const file of sourceFiles(resolve(process.cwd(), "src"))) {
            for (const tag of replacedElementTags(readFileSync(file, "utf8"))) {
                if (RING_APPLICATIONS.test(tag))
                    offenders.push(
                        `${relative(process.cwd(), file)}: ${tag
                            .replace(/\s+/g, " ")
                            .slice(0, 120)}`
                    );
            }
        }
        expect(
            offenders,
            "A replaced element generates no ::before/::after box (CSS Display 3 §3.1), " +
                "so `.card-ring` paints NOTHING on it — while `border-radius` still applies, " +
                "which is why the corner survives and the missing ring passes review. " +
                "Move the recipe to a wrapper or overlay <div> and leave `.card-corner` on " +
                "the image. Offenders:\n" +
                offenders.join("\n")
        ).toEqual([]);
    });

    it("the tag scanner actually reads past an arrow function in an attribute", () => {
        // Guards the guard: with a naive `[^>]*` the `=>` below ends the tag
        // and the className is never seen, so the check above would report
        // clean on the very shape it exists to catch.
        const tags = replacedElementTags(
            `<img onLoad={() => setReady(true)} className="card-ring" />`
        );
        expect(tags).toHaveLength(1);
        expect(RING_APPLICATIONS.test(tags[0]!)).toBe(true);
    });

    it("a non-replaced element carrying the recipe is not an offender", () => {
        expect(
            replacedElementTags(
                `<div className="card-ring card-ring-selected">`
            )
        ).toEqual([]);
    });
});
