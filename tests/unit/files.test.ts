import { describe, expect, it } from "vitest";
import { classify, badge, formatBytes } from "../../lib/files";

describe("classify", () => {
  it("detects office + media + design kinds", () => {
    expect(classify("proposal.pdf")).toBe("PDF");
    expect(classify("sheet.XLSX")).toBe("XLSX");
    expect(classify("deck.pptx")).toBe("PPTX");
    expect(classify("doc.DOCX")).toBe("DOCX");
    expect(classify("photo.jpeg")).toBe("IMAGE");
    expect(classify("clip.mp4")).toBe("VIDEO");
    expect(classify("art.psd")).toBe("DESIGN");
    expect(classify("art.ai")).toBe("DESIGN");
    expect(classify("backup.zip")).toBe("ARCHIVE");
    expect(classify("page.html")).toBe("HTML");
    expect(classify("notes.txt")).toBe("FILE");
  });
  it("falls back to mime when extension is unknown", () => {
    expect(classify("blob", "image/png")).toBe("IMAGE");
    expect(classify("blob", "video/mp4")).toBe("VIDEO");
    expect(classify("blob", "application/octet-stream")).toBe("FILE");
  });
});

describe("badge", () => {
  it("lists every backend present", () => {
    expect(badge(["google"])).toContain("Google");
    const both = badge(["google", "local", "backup"]);
    expect(both).toContain("Google");
    expect(both).toContain("Local");
    expect(both).toContain("Backup");
  });
});

describe("formatBytes", () => {
  it("formats human sizes and guards nulls", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(0)).toContain("B");
    expect(formatBytes(1536)).toContain("KB");
    expect(formatBytes(2 * 1024 ** 3)).toContain("GB");
  });
});
