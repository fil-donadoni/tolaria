#!/usr/bin/env node
/**
 * ONLINE audit (throwaway diagnostic, not part of `check:all`): does every
 * `CardDefinition.id` name the card's EARLIEST PAPER PRINTING (ADR 0041)?
 *
 * A def whose id points at a reprint renders the wrong frame/art for the card's
 * "first edition" and files the card under the wrong home set. Scryfall's
 * `reprint` flag is the cheap first pass (one /cards/collection call per 75
 * ids); only the flagged ids need the per-oracle prints query.
 *
 * Usage: node scripts/audit-first-printing.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SCRYFALL = "https://api.scryfall.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Printings that are never a card's "first edition" for our purposes. */
const NON_PRINT_SET_TYPES = new Set(["token", "memorabilia", "minigame"]);

async function get(url) {
    for (let a = 1; a <= 5; a++) {
        const res = await fetch(url, {
            headers: {
                Accept: "application/json",
                "User-Agent": "tolaria-audit/1.0",
            },
        });
        await sleep(120);
        if (res.status === 429 || res.status >= 500) {
            await sleep(1500 * a);
            continue;
        }
        if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
        return res.json();
    }
    throw new Error(`${url} → retries exhausted`);
}

async function postCollection(ids) {
    const res = await fetch(`${SCRYFALL}/cards/collection`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "tolaria-audit/1.0",
        },
        body: JSON.stringify({ identifiers: ids.map((id) => ({ id })) }),
    });
    await sleep(120);
    if (!res.ok) throw new Error(`collection → HTTP ${res.status}`);
    return res.json();
}

const lock = JSON.parse(readFileSync(resolve("data/card-index.json"), "utf-8"));
const byId = new Map(lock.map((e) => [e.scryfallId, e]));
const ids = [...byId.keys()];

console.log(`Resolving ${ids.length} print ids…`);
const flagged = [];
for (let i = 0; i < ids.length; i += 75) {
    const chunk = ids.slice(i, i + 75);
    const json = await postCollection(chunk);
    for (const c of json.data) {
        if (c.reprint) {
            flagged.push({
                id: c.id,
                name: c.name,
                set: c.set,
                released: c.released_at,
                oracleId: c.oracle_id,
            });
        }
    }
    for (const missing of json.not_found ?? []) {
        console.warn(`  ! unresolved id ${missing.id}`);
    }
    process.stdout.write(`\r  ${Math.min(i + 75, ids.length)}/${ids.length}`);
}
console.log(`\n${flagged.length} ids marked as reprints — checking prints…`);

const offenders = [];
let n = 0;
for (const f of flagged) {
    const url =
        `${SCRYFALL}/cards/search?order=released&dir=asc&unique=prints` +
        `&include_extras=true&q=${encodeURIComponent(`oracleid:${f.oracleId}`)}`;
    let prints;
    try {
        prints = (await get(url)).data;
    } catch (e) {
        console.warn(`  ! prints lookup failed for ${f.name}: ${e.message}`);
        continue;
    }
    const paper = prints.filter(
        (p) => !p.digital && !NON_PRINT_SET_TYPES.has(p.set_type)
    );
    const earliest = paper[0];
    if (earliest && earliest.id !== f.id) {
        offenders.push({
            name: f.name,
            usedId: f.id,
            usedSet: f.set,
            usedReleased: f.released,
            firstId: earliest.id,
            firstSet: earliest.set,
            firstSetType: earliest.set_type,
            firstReleased: earliest.released_at,
        });
    }
    n += 1;
    process.stdout.write(`\r  ${n}/${flagged.length}`);
}

console.log(`\n\n${offenders.length} card(s) not on their first printing:\n`);
for (const o of offenders) {
    console.log(
        `${o.name}\n` +
            `  used : ${o.usedSet} ${o.usedReleased} ${o.usedId}\n` +
            `  first: ${o.firstSet} (${o.firstSetType}) ${o.firstReleased} ${o.firstId}`
    );
}
