import { generateText, gateway, Output } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { EvidenceClaim, EvidenceSource, ReasoningBackend } from "./core.js";
import type { BrowserObservation } from "./browser.js";

export const proposedAnswerSchema = z.object({
  status: z.enum(["supported", "needs_user"]),
  answer: z.string(),
  sourceIds: z.array(z.string()),
  reason: z.string(),
});

export type ProposedAnswer = z.infer<typeof proposedAnswerSchema>;
export type AnswerRequest = { question: string; evidence: EvidenceSource[] };
export interface ReasoningModel { resolveAnswer(request: AnswerRequest): Promise<ProposedAnswer>; }
export const proposedBrowserActionSchema = z.object({
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("fill"), fieldId: z.string(), value: z.string() }),
    z.object({ type: z.literal("select"), fieldId: z.string(), value: z.string() }),
    z.object({ type: z.literal("check"), fieldId: z.string(), value: z.boolean() }),
    z.object({ type: z.literal("visit"), linkId: z.string() }),
    z.object({ type: z.literal("click"), target: z.enum(["next", "submit"]) }),
    z.object({ type: z.literal("pause"), reason: z.string().default("") }),
  ]),
  sourceIds: z.array(z.string()).default([]),
  reason: z.string().default(""),
});
export type ProposedBrowserAction = z.infer<typeof proposedBrowserActionSchema>;
export type BrowserActionRequest = { observation: BrowserObservation; evidence: EvidenceSource[]; allowSubmit: boolean };
export interface BrowserReasoningModel extends ReasoningModel { planBrowserAction(request: BrowserActionRequest): Promise<ProposedBrowserAction>; }

function evidencePrompt(evidence: EvidenceSource[]): string {
  return evidence
    .filter(({ content }) => Boolean(content))
    .map(({ id, input, content }) => `[${id}] ${input}\n${content}`)
    .join("\n\n");
}

export function claimsAsEvidence(claims: EvidenceClaim[]): EvidenceSource[] {
  return claims.map((claim) => ({ id: claim.id, input: claim.sourceId, kind: "file" as const, addedAt: claim.location ?? "claim", content: claim.excerpt }));
}

export function selectEvidence(evidence: EvidenceSource[], query: string, limit = 4): EvidenceSource[] {
  const terms = query.toLowerCase().split(/[^a-z0-9+#.]+/).filter((term) => term.length > 2);
  return evidence
    .map((source) => ({ source, score: terms.reduce((score, term) => score + ((source.content ?? source.input).toLowerCase().includes(term) ? 1 : 0), 0) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ source }) => source);
}

export function validateProposedAnswer(answer: ProposedAnswer, evidence: EvidenceSource[]): ProposedAnswer {
  const available = new Set(evidence.map(({ id }) => id));
  const sourcesValid = answer.sourceIds.length > 0 && answer.sourceIds.every((sourceId) => available.has(sourceId));
  if (answer.status !== "supported" || !answer.answer.trim() || !sourcesValid) {
    return { status: "needs_user", answer: "", sourceIds: [], reason: answer.reason || "The answer is not supported by registered evidence" };
  }
  return answer;
}

export class GatewayReasoningModel implements ReasoningModel {
  constructor(private readonly modelId: string, private readonly credentialEnv: string, private readonly provider: ReasoningBackend["provider"] = "gateway", private readonly baseUrl?: string) {}

  private model() {
    if (this.provider === "anthropic") return anthropic(this.modelId);
    if (this.provider === "openai") return openai(this.modelId);
    if (this.provider === "google") return google(this.modelId);
    if (this.provider === "openai-compatible") {
      if (!this.baseUrl) throw new Error("OpenAI-compatible providers require an API base URL");
      const custom = createOpenAICompatible({ name: "applylocal-custom", baseURL: this.baseUrl, apiKey: process.env[this.credentialEnv] ?? "" });
      return custom(this.modelId);
    }
    return gateway(this.modelId);
  }

  private async ask<T>(schema: z.ZodType<T>, system: string, prompt: string, jsonShape: string): Promise<T> {
    const manualRequest = `${prompt}\n\nThe JSON object must have exactly this shape:\n${jsonShape}`;
    try {
      const { output } = await generateText({ model: this.model(), output: Output.object({ schema }), system, prompt });
      return output;
    } catch {
      const manualSystem = `${system} Respond with ONLY a single JSON object, no prose, no code fences.`;
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { text } = await generateText({ model: this.model(), system: manualSystem, prompt: attempt === 0 ? manualRequest : `${manualRequest}\n\nYour previous response failed validation: ${String(lastError).slice(0, 200)}. Correct it and respond again with only the JSON object.` });
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) { lastError = new Error("The provider did not return a JSON object"); continue; }
        let parsedJson: unknown;
        try { parsedJson = JSON.parse(match[0]); } catch { lastError = new Error("The provider returned malformed JSON"); continue; }
        const parsed = schema.safeParse(parsedJson);
        if (parsed.success) return parsed.data;
        lastError = new Error(parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; "));
      }
      throw lastError instanceof Error ? lastError : new Error("The provider response did not match the required JSON shape");
    }
  }

  async resolveAnswer({ question, evidence }: AnswerRequest): Promise<ProposedAnswer> {
    if (!process.env[this.credentialEnv]) throw new Error(`Missing model credential: ${this.credentialEnv}`);
    const selected = selectEvidence(evidence, question);
    const sourceText = evidencePrompt(selected);
    if (!sourceText) return { status: "needs_user", answer: "", sourceIds: [], reason: "No readable registered evidence is available" };
    const output = await this.ask(proposedAnswerSchema, "You answer job application questions using only the supplied candidate evidence. Never infer or invent facts. Return needs_user when the evidence is insufficient. A supported answer must cite one or more exact source IDs.", `Question:\n${question}\n\nRegistered evidence:\n${sourceText}`, `{"status": "supported" | "needs_user", "answer": string, "sourceIds": string[], "reason": string}`);
    return validateProposedAnswer(output, selected);
  }

  async planBrowserAction({ observation, evidence, allowSubmit }: BrowserActionRequest): Promise<ProposedBrowserAction> {
    if (!process.env[this.credentialEnv]) throw new Error(`Missing model credential: ${this.credentialEnv}`);
    const selected = selectEvidence(evidence, `${observation.title} ${observation.fields.map(({ label }) => label).join(" ")}`);
    const output = await this.ask(proposedBrowserActionSchema, "Navigate job forms conservatively. Use only observed field IDs and link IDs. To reach an application form behind an Apply or similar link, use a visit action with a same-origin link ID. Use only registered evidence for factual answers. Never submit unless allowSubmit is true. Pause when unsure, when login or registration is required, or when a link leaves the current site.", `Allow submit: ${allowSubmit}\nObservation:\n${JSON.stringify(observation)}\nEvidence:\n${evidencePrompt(selected)}`, `{"action": {"type": "fill"|"select"|"check"|"visit"|"click"|"pause", ...}, "sourceIds": string[], "reason": string}`);
    if (output.action.type === "click" && output.action.target === "submit" && !allowSubmit) return { ...output, action: { type: "pause", reason: "Submission is not allowed yet" } };
    return output;
  }
}

export function reasoningModel(backend: ReasoningBackend): BrowserReasoningModel {
  return new GatewayReasoningModel(backend.model, backend.credentialEnv, backend.provider, backend.baseUrl);
}

export async function listModels(backend: ReasoningBackend): Promise<string[]> {
  if (!process.env[backend.credentialEnv]) throw new Error(`Missing model credential: ${backend.credentialEnv}`);
  const fetchModels = async (url: string, headers: Record<string, string>, pick: (value: unknown) => string[]): Promise<string[]> => {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Model listing failed: ${response.status} ${await response.text().catch(() => "")}`.slice(0, 200));
    return pick(await response.json()).sort();
  };
  if (backend.provider === "anthropic") {
    return fetchModels("https://api.anthropic.com/v1/models?limit=100", { "x-api-key": process.env[backend.credentialEnv]!, "anthropic-version": "2023-06-01" }, (value) => (value as { data?: { id?: string }[] }).data?.map((entry) => entry.id).filter((id): id is string => Boolean(id)) ?? []);
  }
  if (backend.provider === "openai") {
    return fetchModels("https://api.openai.com/v1/models", { authorization: `Bearer ${process.env[backend.credentialEnv]}` }, (value) => (value as { data?: { id?: string }[] }).data?.map((entry) => entry.id).filter((id): id is string => Boolean(id)) ?? []);
  }
  if (backend.provider === "google") {
    return fetchModels("https://generativelanguage.googleapis.com/v1beta/models", { "x-goog-api-key": process.env[backend.credentialEnv]! }, (value) => (value as { models?: { name?: string }[] }).models?.map((entry) => (entry.name ?? "").replace(/^models\//, "")).filter(Boolean) ?? []);
  }
  if (backend.provider === "openai-compatible") {
    if (!backend.baseUrl) throw new Error("OpenAI-compatible providers require an API base URL");
    const base = backend.baseUrl.replace(/\/$/, "");
    return fetchModels(`${base}/models`, { authorization: `Bearer ${process.env[backend.credentialEnv]}` }, (value) => (value as { data?: { id?: string }[] }).data?.map((entry) => entry.id).filter((id): id is string => Boolean(id)) ?? []);
  }
  return [];
}

export async function testProvider(backend: ReasoningBackend): Promise<{ ok: true; provider: string; model: string }> {
  const model = reasoningModel(backend);
  if (!process.env[backend.credentialEnv]) throw new Error(`Missing model credential: ${backend.credentialEnv}`);
  await model.resolveAnswer({ question: "What is the candidate's verified role?", evidence: [{ id: "synthetic", input: "synthetic fixture", kind: "file", addedAt: "test", content: "The candidate is a software engineer." }] });
  return { ok: true, provider: backend.provider, model: backend.model };
}
