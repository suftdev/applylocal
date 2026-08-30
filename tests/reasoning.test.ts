import assert from "node:assert/strict";
import { test } from "node:test";
import { EvidenceSource } from "../src/core.js";
import { listModels, reasoningModel, selectEvidence, testProvider, validateProposedAnswer } from "../src/reasoning.js";

const evidence: EvidenceSource[] = [{ id: "ev_resume", input: "resume.txt", kind: "file", addedAt: "now", content: "Built an AI product." }];

test("accepts supported answers only when they cite registered evidence", () => {
  const answer = validateProposedAnswer({ status: "supported", answer: "I built an AI product.", sourceIds: ["ev_resume"], reason: "direct evidence" }, evidence);
  assert.equal(answer.status, "supported");
});

test("downgrades fabricated or uncited model output", () => {
  const fabricated = validateProposedAnswer({ status: "supported", answer: "I led a team of 50.", sourceIds: ["missing"], reason: "" }, evidence);
  assert.deepEqual(fabricated, { status: "needs_user", answer: "", sourceIds: [], reason: "The answer is not supported by registered evidence" });
});

test("selects relevant evidence instead of sending every source", () => {
  const unrelated: EvidenceSource = { id: "ev_private", input: "private.txt", kind: "file", addedAt: "now", content: "Unrelated medical information" };
  assert.deepEqual(selectEvidence([...evidence, unrelated], "AI product experience").map(({ id }) => id), ["ev_resume"]);
});

test("creates direct provider adapters and rejects missing credentials", async () => {
  for (const provider of ["anthropic", "openai", "google", "gateway"]) {
    const backend = { type: "provider" as const, provider, model: "synthetic-model", credentialEnv: `MISSING_${provider.toUpperCase()}_KEY` };
    assert.ok(reasoningModel(backend));
    await assert.rejects(() => testProvider(backend), new RegExp(backend.credentialEnv));
  }
});

test("supports OpenAI-compatible providers and rejects missing credentials", async () => {
  const backend = { type: "provider" as const, provider: "openai-compatible", model: "synthetic-model", credentialEnv: "MISSING_CUSTOM_KEY", baseUrl: "https://api.example.test/v1" };
  assert.ok(reasoningModel(backend));
  await assert.rejects(() => testProvider(backend), /MISSING_CUSTOM_KEY/);
  await assert.rejects(() => listModels(backend), /MISSING_CUSTOM_KEY/);
});
