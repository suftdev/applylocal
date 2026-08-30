import { mkdir, readFile, rename, writeFile, open, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";

export type Mode = "auto-apply" | "assist";
export type RunStatus = "created" | "job_loaded" | "filling" | "waiting_for_user" | "ready_to_submit" | "submitting" | "submitted" | "failed" | "unknown";
export type ReasoningBackend = { type: "provider"; provider: "gateway" | "anthropic" | "openai" | "google" | "openai-compatible"; model: string; credentialEnv: string; baseUrl?: string };

export type EvidenceSource = { id: string; input: string; kind: "file" | "directory" | "url"; addedAt: string; content?: string };
export type EvidenceClaim = { id: string; sourceId: string; text: string; excerpt: string; location?: string; status: "unreviewed" | "approved" | "rejected" };
export type Setup = {
  complete: boolean;
  candidate: { name: string; email: string; phone?: string };
  browserProfile: string;
  defaultResume?: string;
  mode: Mode;
  reasoning: ReasoningBackend;
  policies: { workAuthorization: string; sponsorship: string; salary: "pause" | "answer"; work?: import("./policy.js").WorkPolicy };
};
export type Attention = { id: string; runId: string; reason: string; question?: string; createdAt: string; resolved: boolean; answer?: string };
export type Run = { id: string; url: string; status: RunStatus; mode: Mode; title?: string; company?: string; browserSession?: "worker"; attentionIds: string[]; answers: Record<string, string>; createdAt: string; updatedAt: string; confirmation?: string };
export type Application = { id: string; runId: string; url: string; title?: string; company?: string; submittedAt: string; confirmation: string };
export type TraceEvent = { runId: string; at: string; type: string; detail: string; evidenceIds?: string[] };
export type State = { schemaVersion: 2; setup?: Setup; evidence: EvidenceSource[]; claims: EvidenceClaim[]; runs: Run[]; attention: Attention[]; applications: Application[]; traces: TraceEvent[] };

const evidenceSchema = z.object({ id: z.string(), input: z.string(), kind: z.enum(["file", "directory", "url"]), addedAt: z.string(), content: z.string().optional() });
const claimSchema = z.object({ id: z.string(), sourceId: z.string(), text: z.string(), excerpt: z.string(), location: z.string().optional(), status: z.enum(["unreviewed", "approved", "rejected"]) });
const runSchema = z.object({ id: z.string(), url: z.string(), status: z.enum(["created", "job_loaded", "filling", "waiting_for_user", "ready_to_submit", "submitting", "submitted", "failed", "unknown"]), mode: z.enum(["auto-apply", "assist"]), title: z.string().optional(), company: z.string().optional(), browserSession: z.literal("worker").optional(), attentionIds: z.array(z.string()), answers: z.record(z.string(), z.string()).default({}), createdAt: z.string(), updatedAt: z.string(), confirmation: z.string().optional() });
const attentionSchema = z.object({ id: z.string(), runId: z.string(), reason: z.string(), question: z.string().optional(), createdAt: z.string(), resolved: z.boolean(), answer: z.string().optional() });
const applicationSchema = z.object({ id: z.string(), runId: z.string(), url: z.string(), title: z.string().optional(), company: z.string().optional(), submittedAt: z.string(), confirmation: z.string() });
const stateSchema = z.object({
  schemaVersion: z.literal(2).default(2),
  setup: z.object({ complete: z.boolean(), candidate: z.object({ name: z.string(), email: z.string(), phone: z.string().optional() }), browserProfile: z.string(), defaultResume: z.string().optional(), mode: z.enum(["auto-apply", "assist"]), reasoning: z.object({ type: z.literal("provider"), provider: z.enum(["gateway", "anthropic", "openai", "google", "openai-compatible"]), model: z.string(), credentialEnv: z.string(), baseUrl: z.string().optional() }), policies: z.object({ workAuthorization: z.string(), sponsorship: z.string(), salary: z.enum(["pause", "answer"]), work: z.any().optional() }) }).optional(),
  evidence: z.array(evidenceSchema).default([]),
  claims: z.array(claimSchema).default([]),
  runs: z.array(runSchema).default([]),
  attention: z.array(attentionSchema).default([]),
  applications: z.array(applicationSchema).default([]),
  traces: z.array(z.object({ runId: z.string(), at: z.string(), type: z.string(), detail: z.string(), evidenceIds: z.array(z.string()).optional() })).default([]),
});

export function emptyState(): State { return { schemaVersion: 2, evidence: [], claims: [], runs: [], attention: [], applications: [], traces: [] }; }

export function dataDir(): string {
  return process.env.APPLYLOCAL_DATA_DIR ? resolve(process.env.APPLYLOCAL_DATA_DIR) : resolve(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "applylocal");
}

const statePath = () => join(dataDir(), "state.json");
const legacyStatePath = () => join(process.cwd(), ".applylocal", "state.json");
const lockPath = () => join(dataDir(), "state.lock");

async function acquireStateLock(): Promise<() => Promise<void>> {
  await mkdir(dirname(statePath()), { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      const handle = await open(lockPath(), "wx", 0o600);
      await handle.writeFile(`${process.pid}\n`);
      await handle.close();
      return async () => { await unlink(lockPath()).catch(() => undefined); };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const lockAge = await readFile(lockPath(), "utf8").then(() => Date.now() - started).catch(() => 0);
      if (lockAge > 30_000) { await unlink(lockPath()).catch(() => undefined); continue; }
      if (Date.now() - started > 10_000) throw new Error("ApplyLocal state is busy. Retry the command shortly.");
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
  }
}

export async function loadState(): Promise<State> {
  try {
    let text: string;
    let fromLegacy = false;
    try {
      text = await readFile(statePath(), "utf8");
    } catch (error) {
      if (process.env.APPLYLOCAL_DATA_DIR || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      text = await readFile(legacyStatePath(), "utf8");
      fromLegacy = true;
    }
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (typeof raw.schemaVersion === "number" && raw.schemaVersion !== 2) throw new Error(`Unsupported ApplyLocal state version: ${raw.schemaVersion}. Re-run applylocal setup.`);
    const state = stateSchema.parse(raw) as State;
    if (fromLegacy) await saveState(state);
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return emptyState();
  }
}

export async function saveState(state: State): Promise<void> {
  const release = await acquireStateLock();
  try {
    await mkdir(dirname(statePath()), { recursive: true });
  const path = statePath();
  const temporary = `${path}.tmp`;
  const valid = stateSchema.parse(state);
  await writeFile(temporary, `${JSON.stringify(valid, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await release();
  }
}

export async function updateState<T>(mutate: (state: State) => T | Promise<T>): Promise<T> {
  const release = await acquireStateLock();
  try {
    const state = await loadState();
    const result = await mutate(state);
  const valid = stateSchema.parse(state);
    const temporary = `${statePath()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(valid, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, statePath());
    return result;
  } finally {
    await release();
  }
}

export function setupMissing(state: State): string[] {
  const setup = state.setup;
  if (!setup) return ["setup"];
  const missing: string[] = [];
  if (!setup.candidate?.name) missing.push("candidate name");
  if (!setup.candidate?.email) missing.push("candidate email");
  if (!setup.browserProfile) missing.push("browser profile");
  if (!setup.defaultResume) missing.push("default resume");
  if (!setup.mode) missing.push("application mode");
  if (!setup.reasoning) missing.push("reasoning provider");
  else if (!process.env[setup.reasoning.credentialEnv]) missing.push(`${setup.reasoning.credentialEnv} environment variable`);
  if (!setup.policies?.workAuthorization) missing.push("work authorization policy");
  if (!setup.policies?.sponsorship) missing.push("sponsorship policy");
  return missing;
}

export function requireSetup(state: State): Setup {
  const missing = setupMissing(state);
  if (missing.length) throw new Error(`ApplyLocal setup is incomplete. Missing: ${missing.join(", ")}. Run: applylocal setup`);
  return state.setup as Setup;
}

export function id(prefix: string): string { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`; }

export async function addAttention(state: State, run: Run, reason: string, question?: string): Promise<Attention> {
  const existing = state.attention.find((item) => item.runId === run.id && !item.resolved && item.reason === reason && item.question === question);
  if (existing) return existing;
  const item = { id: id("att"), runId: run.id, reason, question, createdAt: new Date().toISOString(), resolved: false };
  state.attention.push(item);
  run.attentionIds.push(item.id);
  run.status = "waiting_for_user";
  run.updatedAt = item.createdAt;
  state.traces ??= [];
  state.traces.push({ runId: run.id, at: item.createdAt, type: "attention", detail: reason });
  await saveState(state);
  return item;
}
