// A WebAssembly object file made instantiable (issue #10471).
//
// `clang -c --target=wasm32` writes a RELOCATABLE object: a valid module whose
// functions are named in a `linking` custom section instead of an export
// section. `wasm-ld` is the tool that turns one into a module, and it is not
// on the bench machine (Homebrew's `llvm@22` ships the compiler without the
// linker). For ONE translation unit with nothing undefined there is nothing
// to link: the function indexes and memory addresses the compiler wrote are
// already the object's own (the relocations only say where a linker would
// patch them if it moved things). So this adds the one thing missing — an
// export section naming every defined, non-local function — and drops the
// `linking` and `reloc.*` sections. The code section is the compiler's,
// byte for byte.
//
// The module keeps the object's one import, `env.__linear_memory`: the caller
// supplies the memory, and the kernel's static arrays sit at the addresses its
// `…Ptr()` exports return.

const SECTION_CUSTOM = 0;
const SECTION_EXPORT = 7;
/** Sections that follow the export section in a module. */
const AFTER_EXPORT = new Set([8, 9, 12, 10, 11]);
const SUBSECTION_SYMBOL_TABLE = 8;
const SYMBOL_FUNCTION = 0;
const SYMBOL_DATA = 1;
const SYMBOL_SECTION = 3;
const FLAG_LOCAL = 0x02;
const FLAG_UNDEFINED = 0x10;
const FLAG_EXPLICIT_NAME = 0x40;

function reader(bytes, start = 0) {
    let p = start;
    const u32 = () => {
        let result = 0;
        let shift = 0;
        for (;;) {
            const b = bytes[p++];
            result |= (b & 0x7f) << shift;
            if (!(b & 0x80)) return result >>> 0;
            shift += 7;
        }
    };
    return {
        u8: () => bytes[p++],
        u32,
        name: () => {
            const n = u32();
            const s = new TextDecoder().decode(bytes.subarray(p, p + n));
            p += n;
            return s;
        },
        skip: (n) => (p += n),
        get at() {
            return p;
        },
    };
}

function leb(n) {
    const out = [];
    do {
        const b = n & 0x7f;
        n >>>= 7;
        out.push(n ? b | 0x80 : b);
    } while (n);
    return out;
}

/** The defined, non-local functions of an object's symbol table. */
function exportedFunctions(linking) {
    const r = reader(linking);
    if (r.u32() !== 2) throw new Error("linking section: version is not 2");
    const out = [];
    while (r.at < linking.length) {
        const type = r.u8();
        const size = r.u32();
        const end = r.at + size;
        if (type !== SUBSECTION_SYMBOL_TABLE) {
            r.skip(size);
            continue;
        }
        const count = r.u32();
        for (let i = 0; i < count; i++) {
            const kind = r.u8();
            const flags = r.u32();
            const defined = (flags & FLAG_UNDEFINED) === 0;
            if (kind === SYMBOL_DATA) {
                r.name();
                if (defined) {
                    r.u32();
                    r.u32();
                    r.u32();
                }
            } else if (kind === SYMBOL_SECTION) {
                r.u32();
            } else {
                const index = r.u32();
                const name =
                    defined || flags & FLAG_EXPLICIT_NAME ? r.name() : null;
                if (
                    kind === SYMBOL_FUNCTION &&
                    defined &&
                    (flags & FLAG_LOCAL) === 0
                ) {
                    out.push({ name, index });
                }
            }
        }
        if (r.at !== end) throw new Error("linking section: bad symbol table");
    }
    return out;
}

/** `object` (a `clang -c` wasm32 object's bytes) as a module's bytes. */
export function linkObject(object) {
    const r = reader(object, 8);
    const sections = [];
    while (r.at < object.length) {
        const start = r.at;
        const id = r.u8();
        const size = r.u32();
        const body = r.at;
        let name = null;
        let content = body;
        if (id === SECTION_CUSTOM) {
            const custom = reader(object, body);
            name = custom.name();
            content = custom.at;
        }
        r.skip(size);
        sections.push({
            id,
            name,
            bytes: object.subarray(start, r.at),
            content: object.subarray(content, r.at),
        });
    }
    const linking = sections.find((s) => s.name === "linking");
    if (!linking) {
        throw new Error("not a relocatable object: no linking section");
    }
    const functions = exportedFunctions(linking.content);
    const entries = functions.flatMap(({ name, index }) => {
        const utf8 = [...new TextEncoder().encode(name)];
        return [...leb(utf8.length), ...utf8, 0x00, ...leb(index)];
    });
    const payload = [...leb(functions.length), ...entries];
    const exportSection = Uint8Array.from([
        SECTION_EXPORT,
        ...leb(payload.length),
        ...payload,
    ]);
    const kept = sections.filter(
        (s) => s.name !== "linking" && !(s.name ?? "").startsWith("reloc.")
    );
    const before = kept.findIndex((s) => AFTER_EXPORT.has(s.id));
    const parts = [
        object.subarray(0, 8),
        ...kept.slice(0, before).map((s) => s.bytes),
        exportSection,
        ...kept.slice(before).map((s) => s.bytes),
    ];
    const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }
    return { bytes: out, exports: functions.map((f) => f.name) };
}
