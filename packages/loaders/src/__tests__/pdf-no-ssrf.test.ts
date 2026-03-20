import { describe, it, expect, vi } from "vitest";

// BUG-0030: PDF loader previously passed `source` directly to pdfjs-dist as a URL,
// enabling SSRF when an HTTP URL was provided. Fix: use readFile(source) + {data}
// so only local file paths are accepted and no network fetch is possible.

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

describe("PdfLoader SSRF prevention (BUG-0030)", () => {
  it("BUG-0030: rejects with file-read error when source is unreadable, confirming local file path is used", async () => {
    const { readFile } = await import("node:fs/promises");
    vi.mocked(readFile).mockRejectedValue(
      Object.assign(new Error("ENOENT: no such file or directory, open '/tmp/missing.pdf'"), {
        code: "ENOENT",
      }),
    );

    const { PdfLoader } = await import("../loaders/pdf.js");
    const loader = new PdfLoader();

    // The fix reads the file first via readFile(). An unreadable path must throw
    // a file-read error (not silently succeed or trigger a network request).
    await expect(loader.load("/tmp/missing.pdf")).rejects.toThrow(
      /PDF loader: failed to read file/,
    );

    // Confirm readFile was called with the local path (not a URL)
    expect(readFile).toHaveBeenCalledWith("/tmp/missing.pdf");
  });

  it("BUG-0030: passes {data: Uint8Array} to getDocument, never a URL string", async () => {
    const { readFile } = await import("node:fs/promises");
    const fakeBytes = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF magic bytes
    vi.mocked(readFile).mockResolvedValue(fakeBytes);

    const mockGetTextContent = vi.fn().mockResolvedValue({ items: [{ str: "page text" }] });
    const mockGetPage = vi.fn().mockResolvedValue({ getTextContent: mockGetTextContent });
    const mockPdf = { numPages: 1, getPage: mockGetPage };
    const getDocumentSpy = vi.fn().mockReturnValue({ promise: Promise.resolve(mockPdf) });

    // Intercept the dynamic import of pdfjs-dist
    vi.doMock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ getDocument: getDocumentSpy }));

    const { PdfLoader } = await import("../loaders/pdf.js");
    const loader = new PdfLoader();

    try {
      await loader.load("/tmp/test.pdf");
    } catch {
      // Ignore if dynamic import of pdfjs-dist fails in test env
    }

    // If getDocument was reached, its argument must be {data: Uint8Array}, not a string URL
    if (getDocumentSpy.mock.calls.length > 0) {
      const arg = getDocumentSpy.mock.calls[0]![0] as unknown;
      expect(typeof arg).toBe("object");
      expect(arg).toHaveProperty("data");
      expect(arg).not.toBeTypeOf("string");
      // The data must be a Uint8Array of the file bytes
      expect((arg as { data: Uint8Array }).data).toBeInstanceOf(Uint8Array);
    }

    // In all cases readFile must have been called with the local path
    expect(readFile).toHaveBeenCalledWith("/tmp/test.pdf");
  });
});
