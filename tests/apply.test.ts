import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { loadState, saveState, Setup } from "../src/core.js";
import { addEvidence } from "../src/evidence.js";
import { apply } from "../src/apply.js";
import { continueRun } from "../src/apply.js";

let root: string;
let server: ReturnType<typeof createServer>;
let url: string;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "applylocal-"));
  process.env.APPLYLOCAL_DATA_DIR = root;
  process.env.APPLYLOCAL_HEADLESS = "1";
  process.env.APPLYLOCAL_DISABLE_WORKER = "1";
  process.env.ANTHROPIC_API_KEY ??= "test-key";
  const html = `<!doctype html><title>Fixture AI Engineer</title>
    <form method="post">
      <label>Full name <input name="name" aria-label="Full name" required></label>
      <label>Email <input name="email" type="email" aria-label="Email" required></label>
      <label>Resume <input name="resume" type="file"></label>
      <label>Why do you want this role? <textarea name="why" required></textarea></label>
      <label>Work authorization <select name="authorization" required><option value="">Choose</option><option>Yes</option><option>No</option></select></label>
      <label>Agree to contact <input name="agree" type="checkbox"></label>
      <button type="submit">Submit application</button>
    </form>`;
  const twoQuestions = `<!doctype html><title>Fixture Two Questions</title>
    <form method="post">
      <label>First question <textarea name="q1" required></textarea></label>
      <label>Second question <textarea name="q2" required></textarea></label>
      <button type="submit">Submit application</button>
    </form>`;
  server = createServer((request, response) => {
    if (request.method === "POST") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<h1>Thank you, application submitted</h1>");
      return;
    }
    if (request.url?.endsWith("-two")) {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(twoQuestions);
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not start");
  url = `http://127.0.0.1:${address.port}/job`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("applies to a fixture with explicitly approved evidence", async () => {
  const resume = join(root, "resume.pdf");
  const answers = join(root, "answers.json");
  await writeFile(resume, "fixture resume");
  await writeFile(answers, JSON.stringify({ answers: { "why do you want this role": "I want this role because it matches my verified AI product experience." } }));
  const setup: Setup = {
    complete: true,
    candidate: { name: "Test Candidate", email: "test@example.com" },
    browserProfile: join(root, "browser"),
    defaultResume: resume,
    mode: "auto-apply",
    reasoning: { type: "provider", provider: "anthropic", model: "claude-sonnet-4-5", credentialEnv: "ANTHROPIC_API_KEY" },
    policies: { workAuthorization: "Yes", sponsorship: "No", salary: "pause" },
  };
  const state = await loadState();
  state.setup = setup;
  await saveState(state);
  await addEvidence(answers);
  const evidenceState = await loadState();
  for (const claim of evidenceState.claims) claim.status = "approved";
  await saveState(evidenceState);
  const run = await apply(`${url}?assist=1`);
  assert.equal(run.status, "submitted");
  const finalState = await loadState();
  assert.equal(finalState.applications.length, 1);
  assert.equal(finalState.attention.length, 0);
  assert.ok(finalState.traces.some(({ type }) => type === "submitted"));
});

test("assist mode pauses before submission", async () => {
  const state = await loadState();
  state.setup = { ...state.setup!, mode: "assist" };
  await saveState(state);
  const run = await apply(url);
  assert.equal(run.status, "waiting_for_user");
  assert.match((await loadState()).attention.at(-1)?.reason ?? "", /Assist mode|Required question/);
});

test("continues an assist run after review", async () => {
  const state = await loadState();
  const waiting = state.runs.find((run) => run.url === url && run.status === "waiting_for_user");
  assert.ok(waiting);
  const run = await continueRun(waiting.id);
  assert.equal(run.status, "submitted");
});

test("multi-question forms resolve one attention item per question until submission", async () => {
  const run = await apply(`${url}-two`);
  assert.equal(run.status, "waiting_for_user");
  const state = await loadState();
  const items = state.attention.filter((item) => item.runId === run.id && !item.resolved);
  assert.equal(items.length, 2);
  assert.ok(items.every((item) => item.question));
  for (const item of items) {
    const current = await loadState();
    const runRecord = current.runs.find(({ id }) => id === run.id)!;
    runRecord.answers[item.question!] = `Verified answer for ${item.question}`;
    current.attention.find(({ id }) => id === item.id)!.resolved = true;
    await saveState(current);
  }
  const final = await continueRun(run.id);
  assert.equal(final.status, "submitted");
});
