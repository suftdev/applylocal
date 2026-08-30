import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, before, test } from "node:test";
import { saveState, Setup, loadState } from "../src/core.js";
import { addEvidence } from "../src/evidence.js";
import { apply } from "../src/apply.js";

let root: string;
let server: ReturnType<typeof createServer>;
let baseUrl: string;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "applylocal-realsite-"));
  process.env.APPLYLOCAL_DATA_DIR = root;
  process.env.APPLYLOCAL_HEADLESS = "1";
  process.env.APPLYLOCAL_DISABLE_WORKER = "1";
  process.env.ANTHROPIC_API_KEY ??= "test-key";
  const setup: Setup = {
    complete: true,
    candidate: { name: "Real Site User", email: "real@example.com", phone: "+2348000000000" },
    browserProfile: join(root, "browser"),
    defaultResume: join(root, "resume.pdf"),
    mode: "assist",
    reasoning: { type: "provider", provider: "anthropic", model: "claude-sonnet-4-5", credentialEnv: "ANTHROPIC_API_KEY" },
    policies: { workAuthorization: "policy", sponsorship: "policy", salary: "pause" },
  };
  await saveState({ schemaVersion: 2, setup, evidence: [], claims: [], runs: [], attention: [], applications: [], traces: [] });
  const resume = join(root, "resume.pdf");
  const answers = join(root, "answers.json");
  await writeFile(resume, "fixture resume");
  await writeFile(answers, JSON.stringify({ answers: {} }));
  await addEvidence(answers);
  const evidenceState = await loadState();
  for (const claim of evidenceState.claims) claim.status = "approved";
  await saveState(evidenceState);

  const html = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title></head><body>${body}</body></html>`;
  server = createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    const path = request.url ?? "/";
    if (path.startsWith("/unlabeled")) return void response.end(html(`<form method="post" action="/confirm"><input name="x1"><input name="email" type="email" value=""><button>Submit application</button></form>`));
    if (path.startsWith("/iframe-host")) return void response.end(html(`<iframe src="/inner-form" width="600" height="400"></iframe>`));
    if (path.startsWith("/inner-form")) return void response.end(html(`<form method="post" action="/confirm"><label>Email <input name="email" type="email" aria-label="Email"></label><button>Submit application</button></form>`));
    if (path.startsWith("/noform")) return void response.end(html("<h1>Machine Learning Engineer</h1><p>Send your CV to jobs@example.com.</p>"));
    if (request.method === "POST") return void response.end(html("<h1>Thank you, application received</h1>"));
    response.end(html("fixture"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not start");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("unlabeled inputs are observed instantly without hangs", async () => {
  const started = Date.now();
  const run = await apply(`${baseUrl}/unlabeled`);
  assert.equal(Date.now() - started < 20000, true);
  assert.equal(run.status, "waiting_for_user");
});

test("forms inside iframes are found and submitted", async () => {
  const state = await loadState();
  state.setup = { ...state.setup!, mode: "auto-apply" };
  await saveState(state);
  const run = await apply(`${baseUrl}/iframe-host`);
  assert.equal(run.status, "submitted");
});

test("pages without an application form pause with a clear reason", async () => {
  const run = await apply(`${baseUrl}/noform`);
  assert.equal(run.status, "waiting_for_user");
  assert.match((await loadState()).attention.at(-1)?.reason ?? "", /No application form/);
});
