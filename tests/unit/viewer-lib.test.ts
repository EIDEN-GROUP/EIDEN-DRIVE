// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { decodeText, detectDelimiter, extractStrings, looksLikeText, parseCsv, parseTar, rtfToText, sanitizeHtml, sniff } from "@/components/viewer/lib";
import { mdToHtml, viewKind } from "@/components/drive/filetext";

const buf = (b: number[] | Uint8Array) => new Uint8Array(b).buffer as ArrayBuffer;
const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe("viewKind", () => {
  it.each([
    ["a.docx", "docx"], ["a.xlsx", "sheet"], ["a.xls", "sheet"], ["a.ods", "sheet"], ["a.pptx", "slides"], ["a.odt", "odf"], ["a.epub", "ebook"],
    ["a.csv", "csv"], ["a.json", "json"], ["a.ipynb", "notebook"], ["a.rtf", "rtf"], ["a.zip", "archive"], ["a.tar.gz", "archive"], ["a.tgz", "archive"],
    ["a.ttf", "font"], ["a.doc", "legacy"], ["a.svg", "image"], ["a.png", "image"], ["a.pdf", "pdf"], ["a.md", "markdown"], ["a.html", "html"],
    ["a.srt", "code"], ["a.mkv", "video"], ["a.flac", "audio"], ["a.xyz", "unknown"]
  ] as const)("%s → %s", (n, k) => expect(viewKind(n)).toBe(k));
});

describe("text decoding", () => {
  it("handles UTF-8, BOMs, UTF-16 and falls back to Windows-1252", () => {
    expect(decodeText(enc("héllo"))).toBe("héllo");
    expect(decodeText(buf([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toBe("hi");
    expect(decodeText(buf([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]))).toBe("hi");
    expect(decodeText(buf([0x63, 0x61, 0x66, 0xe9]))).toBe("café"); // invalid UTF-8 → cp1252
  });
  it("looksLikeText separates text from binary", () => {
    expect(looksLikeText(enc("plain words\nand lines"))).toBe(true);
    expect(looksLikeText(buf([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 1, 2, 3]))).toBe(false);
  });
});

describe("csv", () => {
  it("detects delimiters even with quoted commas and a trailing newline", () => {
    expect(detectDelimiter('a;b;c\n1;2;3\n"x, y";5;6\n')).toBe(";");
    expect(detectDelimiter("a,b,c\n1,2,3\n")).toBe(",");
    expect(detectDelimiter("a\tb\n1\t2\n")).toBe("\t");
  });
  it("parses quotes, escaped quotes, CRLF and embedded newlines", () => {
    expect(parseCsv('a,b\r\n"x ""q"" y","l1\nl2"\r\n')).toEqual([["a", "b"], ['x "q" y', "l1\nl2"]]);
  });
});

describe("rtf", () => {
  it("keeps the words, drops the control codes", () => {
    const t = rtfToText("{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\pard One \\b two\\b0  three.\\par caf\\'e9 \\u8364? end\\par}");
    expect(t).toContain("One two three.");
    expect(t).toContain("café € end");
    expect(t).not.toContain("Arial");
  });
});

describe("sniff", () => {
  it("identifies common formats from their first bytes", () => {
    expect(sniff(enc("%PDF-1.7"))?.kind).toBe("pdf");
    expect(sniff(buf([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))?.kind).toBe("image");
    expect(sniff(buf([0x50, 0x4b, 0x03, 0x04]))?.kind).toBe("archive");
    expect(sniff(buf([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))?.kind).toBe("legacy");
    expect(sniff(enc("just text"))).toBeNull();
  });
});

describe("tar", () => {
  it("lists entries with sizes", () => {
    const hdr = new Uint8Array(512); const w = (o: number, s: string) => hdr.set(new TextEncoder().encode(s), o);
    w(0, "dir/file.txt"); w(124, "00000000005\0"); w(156, "0");
    const data = new Uint8Array(512); data.set(new TextEncoder().encode("hello"));
    const all = new Uint8Array(512 * 4); all.set(hdr, 0); all.set(data, 512);
    expect(parseTar(all.buffer as ArrayBuffer)).toEqual([expect.objectContaining({ name: "dir/file.txt", size: 5, dir: false })]);
  });
});

describe("strings extraction", () => {
  it("pulls UTF-16 text out of an OLE-style blob", () => {
    const head = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0, 0, 0]);
    const txt = new Uint8Array(new TextEncoder().encode("Budget approved for the Agadir office").length * 2);
    [...("Budget approved for the Agadir office")].forEach((c, i) => { txt[i * 2] = c.charCodeAt(0); });
    const all = new Uint8Array([...head, ...txt]);
    expect(extractStrings(all.buffer as ArrayBuffer)).toContain("Budget approved for the Agadir office");
  });
});

describe("security: untrusted documents can't run script", () => {
  it("sanitizer strips scripts, handlers, javascript: links, forms and remote loads", () => {
    const out = sanitizeHtml(`<p onclick="x()">hi</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a><a href="https://ok.example">ok</a><form><input></form><iframe src="https://evil"></iframe><img src="https://tracker.example/p.png"><img src="data:image/png;base64,AAAA">`);
    expect(out).not.toMatch(/script|onclick|javascript:|<form|<iframe|tracker\.example/i);
    expect(out).toContain('href="https://ok.example"');
    expect(out).toContain("rel=\"noopener noreferrer nofollow\"");
    expect(out).toContain("data:image/png;base64");
  });
  it("turns GFM checkboxes into glyphs instead of dropping them", () => {
    expect(sanitizeHtml('<input type="checkbox" checked disabled> done')).toContain("☑");
    expect(sanitizeHtml('<input type="checkbox" disabled> todo')).toContain("☐");
  });
  it("legacy mdToHtml can no longer be attribute-injected through a link", () => {
    const html = mdToHtml('[click](https://a"onmouseover="alert`1`)');
    expect(html).not.toMatch(/"onmouseover=|" onmouseover=/);
    expect(html).toContain("&quot;");
  });
});
