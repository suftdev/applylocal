import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { recoverRun } from "../src/apply.js";
import { saveState, loadState } from "../src/core.js";

test("marks a lost browser run as recoverable and never recovers unknown submission", async () => {
  process.env.APPLYLOCAL_DATA_DIR = await mkdtemp(join(tmpdir(), "applylocal-recovery-"));
  await saveState({ schemaVersion: 2, evidence: [], claims: [], runs: [{ id: "run-1", url: "https://example.test", status: "waiting_for_user", mode: "assist", attentionIds: [], answers: {}, createdAt: "now", updatedAt: "now" }], attention: [], applications: [], traces: [] });
  assert.equal((await recoverRun("run-1")).status, "failed");
  const state = await loadState();
  state.runs[0].status = "unknown";
  await saveState(state);
  await assert.rejects(() => recoverRun("run-1"), /unknown submission status/);
});

test("worker continuation names unresolved attention items instead of pausing silently", async () => {
  process.env.APPLYLOCAL_DATA_DIR = await mkdtemp(join(tmpdir(), "applylocal-continue-"));
  const { continueRun } = await import("../src/apply.js");
  const run = { id: "run-2", url: "https://example.test", status: "waiting_for_user" as const, mode: "assist" as const, browserSession: "worker" as const, attentionIds: ["att-x"], answers: {}, createdAt: "now", updatedAt: "now" };
  await saveState({ schemaVersion: 2, evidence: [], claims: [], runs: [run], attention: [{ id: "att-x", runId: "run-2", reason: "Assist mode requires review before final submission", createdAt: "now", resolved: false }], applications: [], traces: [] });
  await assert.rejects(() => continueRun("run-2"), /Resolve these attention items[\s\S]*att-x/);
});
