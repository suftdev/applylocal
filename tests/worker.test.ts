import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, before, test } from "node:test";
import { saveState, Setup } from "../src/core.js";
import { startWorker } from "../src/worker.js";
import { WorkerClient } from "../src/worker-client.js";

let server: ReturnType<typeof createServer>;
let worker: ReturnType<typeof startWorker>;
let url: string;

before(async () => {
  const root = await mkdtemp(join(tmpdir(), "applylocal-worker-"));
  process.env.APPLYLOCAL_DATA_DIR = join(root, "state");
  delete process.env.APPLYLOCAL_WORKER_TOKEN;
  process.env.APPLYLOCAL_HEADLESS = "1";
  process.env.ANTHROPIC_API_KEY ??= "test-key";
  const setup: Setup = { complete: true, candidate: { name: "Worker User", email: "worker@example.com" }, browserProfile: join(root, "browser"), defaultResume: join(root, "resume.pdf"), mode: "assist", reasoning: { type: "provider", provider: "anthropic", model: "claude-sonnet-4-5", credentialEnv: "ANTHROPIC_API_KEY" }, policies: { workAuthorization: "Yes", sponsorship: "No", salary: "pause" } };
  await saveState({ schemaVersion: 2, setup, evidence: [], runs: [{ id: "worker-run", url: "", status: "created", mode: "assist", attentionIds: [], answers: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }], attention: [], applications: [], traces: [] });
  server = createServer((_request, response) => { response.setHeader("content-type", "text/html"); response.end('<form><label>Email <input aria-label="Email"></label></form>'); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture did not start");
  url = `http://127.0.0.1:${address.port}`;
  worker = startWorker(0);
  await new Promise<void>((resolve) => worker.once("listening", resolve));
});

after(async () => {
  for (const session of ["worker-run"]) await new WorkerClient(`http://127.0.0.1:${(worker.address() as { port: number }).port}`).close(session).catch(() => undefined);
  await new Promise<void>((resolve) => worker.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("attaches, observes, acts, and closes a persistent browser session", async () => {
  const client = new WorkerClient(`http://127.0.0.1:${(worker.address() as { port: number }).port}`);
  assert.deepEqual(await client.health(), { status: "ok", sessions: 0 });
  const attached = await client.attach("worker-run", url);
  assert.equal(attached.runId, "worker-run");
  assert.equal(attached.observation.fields[0]?.label, "Email");
  const observed = await client.act("worker-run", { type: "fill", fieldId: "field-0", value: "worker@example.com" });
  assert.equal(observed.fields[0]?.value, "worker@example.com");
  await assert.rejects(() => client.act("worker-run", { type: "click", target: "submit" }), /forbidden/);
  assert.deepEqual(await client.close("worker-run"), { closed: true, runId: "worker-run" });
});
