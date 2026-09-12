// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  classifyKind,
  extractDocument,
  MAX_FILE_BYTES,
  PDFJS_URL,
  PDFJS_WORKER_URL,
  readDroppedFile,
  SCAN_CHARS_PER_PAGE,
  SHEETJS_URL,
  sha256Hex,
  toBase64,
  type PdfjsLike,
  type PdfTextItem,
  type SheetJsLike,
} from "./extract";
import type { DroppedFile } from "./types";

/* =============================================================================
   THE FILE READ, WITH NO NETWORK AND NO LIBRARIES.

   pdf.js and SheetJS are runtime loads from cdnjs and neither is a dependency
   of this app, so the suite injects a stand-in for each. What is under test is
   OUR half: the classification, the hash, the cap, the scan threshold, the
   grid handling and the warnings, all of which are the parts a banker's file
   actually meets first.
   ============================================================================= */

const bytesOf = (...values: number[]): Uint8Array => new Uint8Array(values);
const textBytes = (text: string): Uint8Array => new TextEncoder().encode(text);

const dropped = (over: Partial<DroppedFile> & { base64: string }): DroppedFile => ({
  id: "f_1",
  name: "statements.pdf",
  mime: "application/pdf",
  bytes: 10,
  sha256: "0".repeat(64),
  kind: "pdf-text",
  ...over,
});

/** A page as pdf.js actually hands it over: spans, with the gap between two
 *  spans as its own " " item. Faithful since 2026-09-12, when a fake that
 *  dropped the gaps hid the fact that the reader joined a whole page onto one
 *  line. `hasEOL` items are handed in directly where a test needs lines. */
const itemsOf = (page: string): PdfTextItem[] =>
  page.split(" ").flatMap((word, i) => (i === 0 ? [{ str: word }] : [{ str: " " }, { str: word }]));

/** A stand-in pdf.js: the pages it was handed, as text content. */
const fakePdfjs = (pages: Array<string | PdfTextItem[]>, fail?: "load" | "open" | "password"): (() => Promise<PdfjsLike>) => {
  if (fail === "load") return () => Promise.reject(new Error("blocked"));
  return () =>
    Promise.resolve({
      GlobalWorkerOptions: { workerSrc: "" },
      getDocument: () => ({
        promise:
          fail === "open"
            ? Promise.reject(new Error("bad header"))
            : fail === "password"
              ? Promise.reject(new Error("No password given"))
              : Promise.resolve({
                  numPages: pages.length,
                  getPage: (n: number) =>
                    Promise.resolve({
                      getTextContent: () => {
                        const page = pages[n - 1];
                        return Promise.resolve({ items: typeof page === "string" ? itemsOf(page) : page });
                      },
                    }),
                }),
      }),
    } as PdfjsLike);
};

/** A stand-in SheetJS: the sheets it was handed, as cell grids. */
const fakeSheetjs = (sheets: Record<string, unknown[][]>): (() => Promise<SheetJsLike>) => () =>
  Promise.resolve({
    read: () => ({ SheetNames: Object.keys(sheets), Sheets: sheets as unknown as Record<string, unknown> }),
    utils: { sheet_to_json: (sheet: unknown) => sheet as unknown[][] },
  } as unknown as SheetJsLike);

describe("the pinned cdnjs loads", () => {
  it("pins an exact version and points the worker at the same build", () => {
    expect(PDFJS_URL).toBe("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
    expect(PDFJS_WORKER_URL).toBe("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js");
    expect(SHEETJS_URL).toBe("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    for (const url of [PDFJS_URL, PDFJS_WORKER_URL, SHEETJS_URL]) {
      expect(url.startsWith("https://cdnjs.cloudflare.com/")).toBe(true);
    }
  });
});

describe("classifyKind", () => {
  it("reads the magic bytes before the mime and the extension", () => {
    expect(classifyKind({ name: "anything.txt", mime: "text/plain", bytes: bytesOf(0x25, 0x50, 0x44, 0x46) })).toBe("pdf-text");
    expect(classifyKind({ name: "scan.bin", mime: "", bytes: bytesOf(0x89, 0x50, 0x4e, 0x47) })).toBe("image");
    expect(classifyKind({ name: "scan.bin", mime: "", bytes: bytesOf(0xff, 0xd8, 0xff) })).toBe("image");
  });

  it("separates a workbook from any other zip by name and mime", () => {
    const zip = bytesOf(0x50, 0x4b, 0x03, 0x04);
    expect(classifyKind({ name: "fy2025.xlsx", mime: "", bytes: zip })).toBe("xlsx");
    expect(classifyKind({ name: "letter.docx", mime: "", bytes: zip })).toBe("unknown");
  });

  it("reads a delimited text file from its extension, which is all it has", () => {
    expect(classifyKind({ name: "trial-balance.csv", mime: "", bytes: textBytes("a,b\n1,2") })).toBe("csv");
    expect(classifyKind({ name: "export", mime: "text/csv", bytes: textBytes("a,b") })).toBe("csv");
  });

  it("falls back to the mime and then to the extension", () => {
    expect(classifyKind({ name: "x", mime: "image/heic", bytes: bytesOf(1, 2, 3) })).toBe("image");
    expect(classifyKind({ name: "x.pdf", mime: "", bytes: bytesOf(1, 2, 3) })).toBe("pdf-text");
    expect(classifyKind({ name: "x.zip", mime: "", bytes: bytesOf(1, 2, 3) })).toBe("unknown");
  });
});

describe("sha256Hex", () => {
  it("matches the published vector for abc", async () => {
    expect(await sha256Hex(textBytes("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("matches the published vector for the empty input", async () => {
    expect(await sha256Hex(new Uint8Array(0))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("readDroppedFile", () => {
  it("reads a small file into bytes, hash and kind", async () => {
    const file = new File([textBytes("%PDF-1.7 statements")], "piedmont.pdf", { type: "application/pdf" });
    const read = await readDroppedFile(file);
    expect(read.kind).toBe("pdf-text");
    expect(read.name).toBe("piedmont.pdf");
    expect(read.sha256).toHaveLength(64);
    expect(read.id).toBe(`f_${read.sha256.slice(0, 12)}`);
    expect(read.base64).toBe(toBase64(textBytes("%PDF-1.7 statements")));
  });

  it("refuses a file over the cap, in a sentence the room can print", async () => {
    const file = new File([new Uint8Array(MAX_FILE_BYTES + 1)], "annual-report.pdf", { type: "application/pdf" });
    await expect(readDroppedFile(file)).rejects.toThrow(/annual-report\.pdf is 5\.0 MB\..*5\.0 MB a file/s);
    await expect(readDroppedFile(file)).rejects.toThrow(/Split the document/);
  });

  it("refuses an empty file", async () => {
    await expect(readDroppedFile(new File([], "empty.pdf"))).rejects.toThrow(/empty/);
  });
});

describe("extractDocument, PDF", () => {
  const page = "Piedmont Precision Components, Inc. Statements of Income for the year ended December 31, 2025 Net Sales 64,486 Cost of Sales 50,422 Gross Profit 14,064";

  it("reads the text layer and keeps the page count", async () => {
    const doc = await extractDocument(dropped({ base64: toBase64(textBytes("%PDF")) }), { pdfjs: fakePdfjs([page, page]) });
    expect(doc.pages).toBe(2);
    expect(doc.isScan).toBe(false);
    expect(doc.kind).toBe("pdf-text");
    expect(doc.text).toContain("Net Sales");
    expect(doc.warnings).toEqual([]);
  });

  it("puts each printed line on a line of its own, off the items pdf.js marks", async () => {
    // The gaps inside a line arrive as their own items and the LAST item of a
    // line carries hasEOL, often an empty span that ends the line and nothing
    // more. Both together are what makes a label and its figures one row, and
    // the company its own line.
    const items: PdfTextItem[] = [
      { str: "Piedmont Precision Components, Inc." },
      { str: "", hasEOL: true },
      { str: "Net Sales" },
      { str: " " },
      { str: "71,200 64,486", hasEOL: true },
    ];
    const doc = await extractDocument(dropped({ base64: toBase64(textBytes("%PDF")) }), { pdfjs: fakePdfjs([items]) });
    expect(doc.text.split("\n")).toEqual(["Piedmont Precision Components, Inc.", "Net Sales 71,200 64,486"]);
  });

  it("calls a PDF with almost no text layer a scan, and says so", async () => {
    const thin = "x".repeat(SCAN_CHARS_PER_PAGE - 10);
    const doc = await extractDocument(dropped({ base64: toBase64(textBytes("%PDF")) }), { pdfjs: fakePdfjs([thin]) });
    expect(doc.isScan).toBe(true);
    expect(doc.kind).toBe("pdf-scan");
    expect(doc.warnings[0]).toMatch(/no text layer/);
  });

  it("keeps a file above the threshold on the text path", async () => {
    const thick = "y".repeat(SCAN_CHARS_PER_PAGE + 10);
    const doc = await extractDocument(dropped({ base64: toBase64(textBytes("%PDF")) }), { pdfjs: fakePdfjs([thick]) });
    expect(doc.isScan).toBe(false);
  });

  it("degrades honestly when the library does not load", async () => {
    const doc = await extractDocument(dropped({ base64: toBase64(textBytes("%PDF")) }), { pdfjs: fakePdfjs([], "load") });
    expect(doc.text).toBe("");
    expect(doc.isScan).toBe(true);
    expect(doc.warnings).toEqual(["The PDF reader did not load, so no text was read from this file here."]);
  });

  it("names a password protected file rather than failing silently", async () => {
    const doc = await extractDocument(dropped({ base64: toBase64(textBytes("%PDF")) }), { pdfjs: fakePdfjs([], "password") });
    expect(doc.warnings[0]).toMatch(/password protected/);
    expect(doc.isScan).toBe(true);
  });

  it("names a file it could not open at all", async () => {
    const doc = await extractDocument(dropped({ base64: toBase64(textBytes("%PDF")) }), { pdfjs: fakePdfjs([], "open") });
    expect(doc.warnings[0]).toMatch(/could not be opened/);
  });
});

describe("extractDocument, workbook", () => {
  it("renders every sheet to a table and to tab separated text", async () => {
    const doc = await extractDocument(dropped({ name: "fy2025.xlsx", mime: "", kind: "xlsx", base64: toBase64(textBytes("PK")) }), {
      sheetjs: fakeSheetjs({
        "Income Statement": [["", "FY2025"], ["Net Sales", "64,486"]],
        "Balance Sheet": [["", "FY2025"], ["Total Assets", "46,761"]],
      }),
    });
    expect(doc.tables.map((t) => t.name)).toEqual(["Income Statement", "Balance Sheet"]);
    expect(doc.tables[0].rows).toEqual([["", "FY2025"], ["Net Sales", "64,486"]]);
    expect(doc.text).toContain("# Income Statement");
    expect(doc.text).toContain("Net Sales\t64,486");
    expect(doc.isScan).toBe(false);
  });

  it("names an empty sheet instead of dropping it in silence", async () => {
    const doc = await extractDocument(dropped({ kind: "xlsx", base64: toBase64(textBytes("PK")) }), {
      sheetjs: fakeSheetjs({ Sheet1: [["Net Sales", "1"]], Notes: [] }),
    });
    expect(doc.warnings).toContain("Notes is empty.");
    expect(doc.tables).toHaveLength(1);
  });

  it("clips a grid that is larger than this room reads, and says it clipped it", async () => {
    const rows = Array.from({ length: 2100 }, (_, i) => [`row ${i}`, "1"]);
    const doc = await extractDocument(dropped({ kind: "xlsx", base64: toBase64(textBytes("PK")) }), {
      sheetjs: fakeSheetjs({ Ledger: rows }),
    });
    expect(doc.tables[0].rows).toHaveLength(2000);
    expect(doc.warnings[0]).toMatch(/clipped to 2000 rows/);
  });

  it("degrades honestly when the library does not load", async () => {
    const doc = await extractDocument(dropped({ kind: "xlsx", base64: toBase64(textBytes("PK")) }), {
      sheetjs: () => Promise.reject(new Error("blocked")),
    });
    expect(doc.warnings).toEqual(["The spreadsheet reader did not load, so no cells were read from this file here."]);
  });
});

describe("extractDocument, delimited text", () => {
  it("reads a CSV with quoted fields and needs no library at all", async () => {
    const csv = 'Line,FY2025\n"Sales, net",64486\nCost of Sales,50422\n';
    const doc = await extractDocument(dropped({ name: "is.csv", kind: "csv", base64: toBase64(textBytes(csv)) }));
    expect(doc.tables[0].rows).toEqual([
      ["Line", "FY2025"],
      ["Sales, net", "64486"],
      ["Cost of Sales", "50422"],
    ]);
    expect(doc.text).toContain("Sales, net\t64486");
  });

  it("reads a tab separated export", async () => {
    const doc = await extractDocument(dropped({ name: "is.tsv", kind: "csv", base64: toBase64(textBytes("Line\tFY2025\nNet Sales\t64486\n")) }));
    expect(doc.tables[0].rows[1]).toEqual(["Net Sales", "64486"]);
  });
});

describe("extractDocument, everything else", () => {
  it("treats an image as a scan with no text", async () => {
    const doc = await extractDocument(dropped({ name: "photo.jpg", kind: "image", base64: toBase64(textBytes("jpeg")) }));
    expect(doc.isScan).toBe(true);
    expect(doc.text).toBe("");
    expect(doc.warnings[0]).toMatch(/Boom reads it/);
  });

  it("says plainly that it does not recognise a file type", async () => {
    const doc = await extractDocument(dropped({ name: "x.bin", kind: "unknown", base64: toBase64(textBytes("??")) }));
    expect(doc.warnings[0]).toMatch(/does not recognise the file type/);
    expect(doc.isScan).toBe(true);
  });
});
