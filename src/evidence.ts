import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import mammoth from "mammoth";
import { EvidenceClaim, EvidenceSource, id, loadState, saveState } from "./core.js";

export async function addEvidence(input: string): Promise<EvidenceSource> {
  const state = await loadState();
  const isUrl = /^https?:\/\//.test(input);
  const kind = isUrl ? "url" : (await stat(input)).isDirectory() ? "directory" : "file";
  let content: string | undefined;
  if (kind === "file") {
    if (/\.pdf$/i.test(input)) content = await extractPdf(input);
    else if (/\.docx$/i.test(input)) content = await extractDocx(input);
    else content = await readFile(input, "utf8").catch(() => undefined);
  }
  if (kind === "url") {
    const response = await fetch(input, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Evidence URL returned ${response.status}: ${input}`);
    content = (await response.text()).slice(0, 200_000);
  }
  if (kind === "directory") {
    const files = await readdir(input, { recursive: true, withFileTypes: true });
    const readable = files.filter((entry) => entry.isFile() && /\.(md|mdx|txt|json|ts|tsx|js|jsx|py|html|css)$/i.test(entry.name) && !/(^|\/)(node_modules|dist|build|\.git)(\/|$)/.test(entry.parentPath ?? ""));
    content = (await Promise.all(readable.map(async (entry) => {
      const path = join(entry.parentPath ?? input, entry.name);
      return `${path}\n${await readFile(path, "utf8").catch(() => "")}`;
    }))).join("\n\n");
  }
  const source: EvidenceSource = { id: id("ev"), input, kind, addedAt: new Date().toISOString(), content };
  const existing = state.evidence.findIndex(({ input: existingInput }) => existingInput === input);
  if (existing >= 0) {
    source.id = state.evidence[existing].id;
    state.evidence[existing] = source;
  } else state.evidence.push(source);
  if (!state.setup?.defaultResume && kind === "file" && /\.(pdf|doc|docx)$/i.test(basename(input))) state.setup = state.setup ? { ...state.setup, defaultResume: input } : state.setup;
  state.claims ??= [];
  state.claims = state.claims.filter((claim) => claim.sourceId !== source.id);
  if (content) {
    for (const excerpt of content.split(/(?<=\.)\s+(?=[A-Z•])/).map((value) => value.trim()).filter(Boolean)) {
      state.claims.push({ id: id("claim"), sourceId: source.id, text: excerpt.replace(/^\[Page \d+\]\s*/, ""), excerpt, location: excerpt.match(/^\[Page \d+\]/)?.[0], status: "unreviewed" });
    }
  }
  await saveState(state);
  return source;
}

export async function extractDocx(input: string): Promise<string> {
  const result = await mammoth.extractRawText({ path: input });
  const text = result.value.replace(/\s+/g, " ").trim().slice(0, 200_000);
  if (!text) throw new Error(`DOCX contains no extractable text: ${input}`);
  return `[Document] ${text}`;
}

export async function extractPdf(input: string): Promise<string> {
  const bytes = new Uint8Array(await readFile(input));
  const document = await getDocument({ data: bytes }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const text = await page.getTextContent();
    const value = text.items.map((item) => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " ").trim();
    if (value) pages.push(`[Page ${pageNumber}] ${value}`);
  }
  if (!pages.length) throw new Error(`PDF contains no extractable text: ${input}. It may be image-only; OCR is not enabled.`);
  return pages.join("\n\n").slice(0, 200_000);
}

export function evidenceText(source: EvidenceSource): string { return source.content ?? source.input; }

export function approvedClaims(state: Awaited<ReturnType<typeof loadState>>, query?: string): EvidenceClaim[] {
  const terms = query?.toLowerCase().split(/[^a-z0-9+#.]+/).filter((term) => term.length > 2) ?? [];
  return state.claims.filter((claim) => claim.status === "approved" && (!terms.length || terms.some((term) => claim.text.toLowerCase().includes(term))));
}

export async function reviewSummary(): Promise<{ sources: number; claims: number; approved: number; unreviewed: number; rejected: number }> {
  const state = await loadState();
  return { sources: state.evidence.length, claims: state.claims.length, approved: state.claims.filter(({ status }) => status === "approved").length, unreviewed: state.claims.filter(({ status }) => status === "unreviewed").length, rejected: state.claims.filter(({ status }) => status === "rejected").length };
}

export async function removeEvidence(sourceId: string): Promise<void> {
  const state = await loadState();
  const before = state.evidence.length;
  state.evidence = state.evidence.filter(({ id }) => id !== sourceId);
  if (state.evidence.length === before) throw new Error(`Evidence source not found: ${sourceId}`);
  await saveState(state);
}

export function approvedAnswer(sources: EvidenceSource[], question: string): string | undefined {
  const normalized = question.trim().toLowerCase();
  for (const source of sources) {
    if (!source.content || !source.input.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(source.content) as { answers?: Record<string, string> };
      const match = Object.entries(parsed.answers ?? {}).find(([key]) => normalized.includes(key.toLowerCase()) || key.toLowerCase().includes(normalized));
      if (match) return match[1];
    } catch {
      continue;
    }
  }
  return undefined;
}
