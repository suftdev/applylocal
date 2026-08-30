import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { saveState, Setup } from "../src/core.js";
import { runDoctor } from "../src/doctor.js";

test("doctor reports setup, resume, credential, and Chromium status", async () => {
  const root = await mkdtemp(join(tmpdir(), "applylocal-doctor-"));
  process.env.APPLYLOCAL_DATA_DIR = join(root, "state");
  process.env.ANTHROPIC_API_KEY ??= "test-key";
  const resume = join(root, "resume.pdf");
  await writeFile(resume, "resume");
  const setup: Setup = { complete: true, candidate: { name: "Doctor User", email: "doctor@example.com" }, browserProfile: join(root, "browser"), defaultResume: resume, mode: "assist", reasoning: { type: "provider", provider: "anthropic", model: "claude-sonnet-4-5", credentialEnv: "ANTHROPIC_API_KEY" }, policies: { workAuthorization: "pause", sponsorship: "pause", salary: "pause" } };
  await saveState({ schemaVersion: 2, setup, evidence: [], runs: [], attention: [], applications: [], traces: [] });
  const checks = await runDoctor();
  assert.equal(checks.find(({ name }) => name === "Setup")?.status, "pass");
  assert.equal(checks.find(({ name }) => name === "Default resume")?.status, "pass");
  assert.equal(checks.find(({ name }) => name === "Chromium")?.status, "pass");
});
