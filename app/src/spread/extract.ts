/* =============================================================================
   THE FILE, READ ON THE BANKER'S OWN MACHINE.

   Nothing here reaches a network except the two library loads, and those are
   script tags pointed at cdnjs, which is the one origin the artifact's CSP
   allows. The statement itself never leaves the page from this module: the
   bytes go to Boom later, through the adapter, as part of a plan the banker
   confirmed.

   TWO STEPS, DELIBERATELY SEPARATE.
   `readDroppedFile` is bytes, hash, kind and size, and it is instant: the room
   paints a card from it on the first frame of a drop.
   `extractDocument` is the slow half, the one that needs a library, and the
   card fills in place when it lands.

   THE LIBRARIES ARE RUNTIME LOADS, NEVER IMPORTS. pdf.js and SheetJS are
   fetched from cdnjs on the first drop that needs them, once per view, and
   cached as a promise. Neither is a dependency of this app and neither enters
   the bundle. Both are injectable, so the suite runs in Node with no network
   and the production path has no test seam in it.
   ============================================================================= */

import type { DroppedFile, ExtractedDocument, SourceKind } from "./types";

/* ------------------------------------------------------------ the pinned CDN

   EXACT VERSIONS, PINNED. A floating "latest" would change what a banker's
   statement parses into between two sessions with no change on our side.     */

export const PDFJS_VERSION = "3.11.174";
export const PDFJS_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
export const PDFJS_WORKER_URL = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;

export const SHEETJS_VERSION = "0.18.5";
export const SHEETJS_URL = `https://cdnjs.cloudflare.com/ajax/libs/xlsx/${SHEETJS_VERSION}/xlsx.full.min.js`;

/** The per-file cap the upload contract carries (BOOM-UPLOAD-SPEC section 3,
 *  "File handling"): the artifact to connector bridge is fragile on very large
 *  machine-shaped payloads, so a file over this is refused here rather than
 *  half-sent later. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * WHEN A PDF IS A SCAN.
 *
 * A typed financial statement page carries hundreds of characters in its text
 * layer: a single line of a balance sheet is already about forty. A scanned
 * page carries either nothing at all or the handful of characters a stamp, a
 * fax header or a page number contributes. Eighty characters a page sits well
 * clear of both: no real statement page falls under it, and no stamp reaches
 * it. Under the threshold the file goes to Boom for OCR and the room asks the
 * banker the three facts instead of guessing them.
 */
export const SCAN_CHARS_PER_PAGE = 80;

/** Rows and columns kept per sheet. A workbook with a hundred thousand rows is
 *  a ledger export, not a statement, and the pre-read only needs the face of
 *  it; the clip is reported as a warning rather than applied silently. */
export const MAX_SHEET_ROWS = 2000;
export const MAX_SHEET_COLS = 64;

/* ------------------------------------------------------- the injected libraries */

export interface PdfPageLike {
  getTextContent(): Promise<{ items: Array<PdfTextItem> }>;
}

/** One text item as pdf.js hands it over: the span's own characters, and
 *  whether that span ends the printed line. */
export interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}

export interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}

export interface PdfjsLike {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(args: { data: Uint8Array }): { promise: Promise<PdfDocumentLike> };
}

export interface SheetJsLike {
  read(data: Uint8Array, opts: { type: "array" }): { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: { sheet_to_json(sheet: unknown, opts: { header: 1; raw: false; defval: string }): unknown[][] };
}

export interface ExtractDeps {
  /** Injected in the suite; loaded from cdnjs in the room. */
  pdfjs?: () => Promise<PdfjsLike>;
  sheetjs?: () => Promise<SheetJsLike>;
}

/* ------------------------------------------------------------- the loaders */

let pdfjsOnce: Promise<PdfjsLike> | undefined;
let sheetjsOnce: Promise<SheetJsLike> | undefined;

function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("no document to load a library into"));
      return;
    }
    const held = document.querySelector<HTMLScriptElement>(`script[data-spread-lib="${url}"]`);
    if (held) {
      held.addEventListener("load", () => resolve());
      held.addEventListener("error", () => reject(new Error(`the library at ${url} did not load`)));
      return;
    }
    const el = document.createElement("script");
    el.src = url;
    el.async = true;
    el.dataset.spreadLib = url;
    el.addEventListener("load", () => resolve());
    el.addEventListener("error", () => reject(new Error(`the library at ${url} did not load`)));
    document.head.appendChild(el);
  });
}

/** pdf.js from cdnjs, once per view. The worker is set to the cdnjs worker file
 *  of the same pinned version: a worker from a different build is the one way
 *  this library fails silently. */
export function loadPdfjs(): Promise<PdfjsLike> {
  pdfjsOnce ??= (async () => {
    await loadScript(PDFJS_URL);
    const lib = (window as unknown as { pdfjsLib?: PdfjsLike }).pdfjsLib;
    if (!lib) throw new Error("pdf.js loaded without exposing itself");
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    return lib;
  })();
  return pdfjsOnce;
}

/** SheetJS from cdnjs, once per view. */
export function loadSheetJs(): Promise<SheetJsLike> {
  sheetjsOnce ??= (async () => {
    await loadScript(SHEETJS_URL);
    const lib = (window as unknown as { XLSX?: SheetJsLike }).XLSX;
    if (!lib) throw new Error("SheetJS loaded without exposing itself");
    return lib;
  })();
  return sheetjsOnce;
}

/* ---------------------------------------------------------------- the drop */

const MAGIC: Array<{ kind: SourceKind; bytes: number[] }> = [
  { kind: "pdf-text", bytes: [0x25, 0x50, 0x44, 0x46] },
  { kind: "image", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { kind: "image", bytes: [0xff, 0xd8, 0xff] },
  { kind: "image", bytes: [0x47, 0x49, 0x46, 0x38] },
  { kind: "image", bytes: [0x42, 0x4d] },
  { kind: "image", bytes: [0x49, 0x49, 0x2a, 0x00] },
  { kind: "image", bytes: [0x4d, 0x4d, 0x00, 0x2a] },
  // A workbook is a zip; so is a .docx, which the mime and the extension
  // separate below. The legacy .xls container is the compound file magic.
  { kind: "xlsx", bytes: [0x50, 0x4b, 0x03, 0x04] },
  { kind: "xlsx", bytes: [0xd0, 0xcf, 0x11, 0xe0] },
];

const startsWith = (bytes: Uint8Array, magic: number[]): boolean =>
  magic.every((b, i) => bytes[i] === b);

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
};

/**
 * WHAT THIS FILE IS, from the three things a drop actually carries.
 *
 * The magic bytes lead, because a mime type is whatever the operating system
 * decided and an extension is whatever the borrower's bookkeeper typed. A PDF
 * is classified `pdf-text` here and downgraded to `pdf-scan` by
 * {@link extractDocument} once its text layer has been counted; at drop time
 * nothing on the page knows yet which of the two it is.
 */
export function classifyKind(args: { name: string; mime: string; bytes: Uint8Array }): SourceKind {
  const ext = extensionOf(args.name);
  const mime = args.mime.toLowerCase();

  // CSV and TSV have no magic at all: they are text, and only the extension or
  // the mime says what the text means.
  if (ext === "csv" || ext === "tsv" || mime === "text/csv" || mime === "text/tab-separated-values") return "csv";

  for (const m of MAGIC) {
    if (!startsWith(args.bytes, m.bytes)) continue;
    if (m.kind === "xlsx") {
      const workbook = ext === "xlsx" || ext === "xlsm" || ext === "xls" || ext === "xlsb" || mime.includes("spreadsheet") || mime.includes("excel");
      return workbook ? "xlsx" : "unknown";
    }
    return m.kind;
  }

  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf-text";
  if (ext === "xlsx" || ext === "xlsm" || ext === "xls") return "xlsx";
  return "unknown";
}

/** Bytes to base64, in chunks: one spread of a String.fromCharCode over a five
 *  megabyte array blows the argument limit in every browser. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

const HEX = "0123456789abcdef";

function toHex(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer);
  let out = "";
  for (const b of view) out += HEX[b >> 4] + HEX[b & 15];
  return out;
}

/** The file's sha256, lower-case hex. It is the idempotency key on the Boom
 *  upload (`File.externalUniqueId`), so re-dropping the same statement can
 *  never fork a second period. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}

/** The bytes of a dropped file. FileReader is the contract every browser
 *  honours for a File; `arrayBuffer` is used where the runtime offers it,
 *  which is every current browser and the suite. */
function bytesOf(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") {
    return file.arrayBuffer().then((b) => new Uint8Array(b));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name} could not be read from disk.`));
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(file);
  });
}

const mb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * READ ONE DROPPED FILE. Rejects, with a sentence the room can print, where the
 * file is over the cap or empty. Everything else about a file is a state the
 * pre-read reports, never a refusal.
 */
export async function readDroppedFile(file: File): Promise<DroppedFile> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `${file.name} is ${mb(file.size)}. This room sends up to ${mb(MAX_FILE_BYTES)} a file, so it was not read. Split the document or export the statements on their own.`,
    );
  }
  if (file.size === 0) throw new Error(`${file.name} is empty, so there is nothing to read.`);

  const bytes = await bytesOf(file);
  const sha256 = await sha256Hex(bytes);
  return {
    // The hash is the identity: the same statement dropped twice is the same
    // card, and the room can say so instead of listing it again.
    id: `f_${sha256.slice(0, 12)}`,
    name: file.name,
    mime: file.type || "application/octet-stream",
    bytes: file.size,
    base64: toBase64(bytes),
    sha256,
    kind: classifyKind({ name: file.name, mime: file.type || "", bytes }),
  };
}

/* ----------------------------------------------------------- the extraction */

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

const nonSpace = (text: string): number => text.replace(/\s/g, "").length;

/**
 * A PAGE'S TEXT ITEMS, BACK ON THEIR OWN LINES.
 *
 * pdf.js does not hand a page over as lines. It hands over spans, with the
 * gaps between them as their own " " items, and marks the LAST span of a
 * printed line `hasEOL`. Joining the whole page on spaces, as this did until
 * 2026-09-12, produced one line per page, and everything downstream reads
 * lines: the company is the line the statement heads itself with, and a row is
 * a label with its figures after it. A one-line page therefore read as no
 * company and one nonsense row.
 *
 * The spans are concatenated, NOT joined on a space, because the spacing is
 * already in the items pdf.js emits and inserting more of it turns
 * "71,200 64,486" into a cell nobody can split.
 */
function linesOfItems(items: PdfTextItem[]): string {
  const lines: string[] = [];
  let line = "";
  for (const item of items) {
    line += item.str ?? "";
    if (item.hasEOL) {
      lines.push(line);
      line = "";
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

async function extractPdf(bytes: Uint8Array, deps: ExtractDeps): Promise<Partial<ExtractedDocument>> {
  const warnings: string[] = [];
  let pdfjs: PdfjsLike;
  try {
    pdfjs = await (deps.pdfjs ?? loadPdfjs)();
  } catch {
    // The library did not load. The file is still a file, and the honest state
    // is the one a scan is in: no text here, ask the banker, let Boom read it.
    return { text: "", tables: [], isScan: true, warnings: ["The PDF reader did not load, so no text was read from this file here."] };
  }

  let doc: PdfDocumentLike;
  try {
    doc = await pdfjs.getDocument({ data: bytes }).promise;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const locked = /password/i.test(message);
    return {
      text: "",
      tables: [],
      isScan: true,
      warnings: [
        locked
          ? "The PDF is password protected, so nothing was read from it here."
          : "The PDF could not be opened for reading here.",
      ],
    };
  }

  const pages = doc.numPages;
  const parts: string[] = [];
  for (let n = 1; n <= pages; n += 1) {
    try {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      parts.push(linesOfItems(content.items));
    } catch {
      warnings.push(`Page ${n} could not be read.`);
    }
  }
  const text = parts.join("\n");
  const perPage = pages > 0 ? nonSpace(text) / pages : 0;
  const isScan = perPage < SCAN_CHARS_PER_PAGE;
  if (isScan) {
    warnings.push(
      pages === 1
        ? "This page carries no text layer, so it reads as a scan."
        : `These ${pages} pages carry little or no text layer, so the file reads as a scan.`,
    );
  }
  return { text, tables: [], pages, isScan, warnings };
}

/** A cell as the pre-read wants it: the printed string, trimmed. */
const cell = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

function gridToRows(grid: unknown[][], warnings: string[], sheetName: string): string[][] {
  let clipped = false;
  const rows: string[][] = [];
  for (const raw of grid.slice(0, MAX_SHEET_ROWS)) {
    const row = (Array.isArray(raw) ? raw : []).slice(0, MAX_SHEET_COLS).map(cell);
    if (row.some((c) => c !== "")) rows.push(row);
  }
  if (grid.length > MAX_SHEET_ROWS || grid.some((r) => Array.isArray(r) && r.length > MAX_SHEET_COLS)) clipped = true;
  if (clipped) warnings.push(`${sheetName} is larger than this room reads, so it was clipped to ${MAX_SHEET_ROWS} rows and ${MAX_SHEET_COLS} columns.`);
  return rows;
}

async function extractWorkbook(bytes: Uint8Array, deps: ExtractDeps): Promise<Partial<ExtractedDocument>> {
  const warnings: string[] = [];
  let sheetjs: SheetJsLike;
  try {
    sheetjs = await (deps.sheetjs ?? loadSheetJs)();
  } catch {
    return { text: "", tables: [], isScan: false, warnings: ["The spreadsheet reader did not load, so no cells were read from this file here."] };
  }

  let book: { SheetNames: string[]; Sheets: Record<string, unknown> };
  try {
    book = sheetjs.read(bytes, { type: "array" });
  } catch {
    return { text: "", tables: [], isScan: false, warnings: ["The workbook could not be opened for reading here."] };
  }

  const tables: ExtractedDocument["tables"] = [];
  const blocks: string[] = [];
  for (const name of book.SheetNames) {
    const grid = sheetjs.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: false, defval: "" });
    const rows = gridToRows(grid, warnings, name);
    if (!rows.length) {
      warnings.push(`${name} is empty.`);
      continue;
    }
    tables.push({ name, rows });
    blocks.push([`# ${name}`, ...rows.map((r) => r.join("\t"))].join("\n"));
  }
  if (!tables.length) warnings.push("The workbook carries no cells this room could read.");
  return { text: blocks.join("\n\n"), tables, isScan: false, warnings };
}

/** A CSV split without a library: the delimiter is whichever of comma, tab or
 *  semicolon the file uses most on its first lines, and quoted fields keep
 *  their separators. */
function splitDelimited(text: string): string[][] {
  const head = text.slice(0, 4000);
  const counts: Array<[string, number]> = [
    [",", (head.match(/,/g) ?? []).length],
    ["\t", (head.match(/\t/g) ?? []).length],
    [";", (head.match(/;/g) ?? []).length],
  ];
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; continue; }
      if (ch === '"') { quoted = false; continue; }
      field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === delimiter) { row.push(field.trim()); field = ""; continue; }
    if (ch === "\n") {
      row.push(field.trim());
      field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      continue;
    }
    if (ch === "\r") continue;
    field += ch;
  }
  row.push(field.trim());
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

function extractCsv(bytes: Uint8Array): Partial<ExtractedDocument> {
  const warnings: string[] = [];
  const text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
  const rows = splitDelimited(text);
  if (!rows.length) warnings.push("The file carries no rows this room could read.");
  const clipped = rows.slice(0, MAX_SHEET_ROWS).map((r) => r.slice(0, MAX_SHEET_COLS));
  if (rows.length > MAX_SHEET_ROWS) warnings.push(`The file is longer than this room reads, so it was clipped to ${MAX_SHEET_ROWS} rows.`);
  return {
    text: clipped.map((r) => r.join("\t")).join("\n"),
    tables: clipped.length ? [{ rows: clipped }] : [],
    isScan: false,
    warnings,
  };
}

/**
 * READ WHAT THE FILE SAYS, deterministically. No model, no judgement: a text
 * layer, a cell grid, a page count, and the warnings that say what this read
 * could not do. Everything downstream, the pre-read included, works from this.
 */
export async function extractDocument(dropped: DroppedFile, deps: ExtractDeps = {}): Promise<ExtractedDocument> {
  const base: ExtractedDocument = {
    fileId: dropped.id,
    kind: dropped.kind,
    text: "",
    tables: [],
    isScan: false,
    warnings: [],
  };

  const bytes = fromBase64(dropped.base64);
  let part: Partial<ExtractedDocument>;
  switch (dropped.kind) {
    case "pdf-text":
    case "pdf-scan":
      part = await extractPdf(bytes, deps);
      break;
    case "xlsx":
      part = await extractWorkbook(bytes, deps);
      break;
    case "csv":
      part = extractCsv(bytes);
      break;
    case "image":
      // An image has no text layer by construction. Boom OCRs it; the room asks
      // the banker for the type, the period and the quality.
      part = { text: "", tables: [], isScan: true, warnings: ["An image carries no text to read here, so Boom reads it."] };
      break;
    default:
      part = { text: "", tables: [], isScan: true, warnings: ["This room does not recognise the file type, so nothing was read from it here."] };
  }

  const merged = { ...base, ...part };
  // The drop could not know which kind of PDF this is; the text layer does.
  if ((dropped.kind === "pdf-text" || dropped.kind === "pdf-scan") && merged.isScan) merged.kind = "pdf-scan";
  return merged;
}
