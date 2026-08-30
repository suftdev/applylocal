import assert from "node:assert/strict";
import { test } from "node:test";
import { renderHandoff } from "../src/handoff.js";
import { Run, Attention } from "../src/core.js";
import { BrowserObservation } from "../src/browser.js";

const run: Run = { id: "run_x", url: "https://example.com/job", status: "waiting_for_user", mode: "assist", title: "Test Role", browserSession: "worker", attentionIds: [], answers: {}, createdAt: "now", updatedAt: "now" };

const observation: BrowserObservation = {
  url: "https://example.com/apply",
  title: "Apply",
  text: "",
  fields: [
    { id: "field-0", role: "textbox", label: "Full name", type: "text", required: true, value: "Test User" },
    { id: "field-1", role: "textbox", label: "Phone", type: "text", required: true, value: "" },
    { id: "field-2", role: "textbox", label: "I certify the facts", type: "checkbox", required: false, value: "certify", checked: false },
    { id: "field-3", role: "textbox", label: "Resume/CV", type: "file", required: false, value: "C:\\fakepath\\resume.pdf" },
    { id: "field-4", role: "textbox", label: "h-captcha-response", type: "hidden", required: false, value: "" },
  ],
  links: [],
  canSubmit: true,
};

const attention: Attention[] = [
  { id: "att-1", runId: "run_x", reason: "I certify that the facts set forth are true", createdAt: "now", resolved: false },
  { id: "att-2", runId: "run_x", reason: "h-captcha-response", createdAt: "now", resolved: false },
  { id: "att-3", runId: "run_x", reason: "cards[abc][field0]", createdAt: "now", resolved: false },
];

test("handoff renders a field-state table and concrete steps", () => {
  const text = renderHandoff(run, attention, observation);
  assert.match(text, /## Attention needed for Test Role/);
  assert.match(text, /\| Full name \| ✅ Test User \|/);
  assert.match(text, /\| Phone \| ⬜ Yours to complete \|/);
  assert.match(text, /✅ Uploaded/);
  assert.doesNotMatch(text, /h-captcha-response \|/);
  assert.match(text, /Tick the certification or signature checkbox/);
  assert.match(text, /ApplyLocal never automates captchas/);
  assert.match(text, /applylocal runs continue run_x/);
});

test("handoff without observation still lists steps", () => {
  const text = renderHandoff(run, attention);
  assert.match(text, /3 item\(s\) need you/);
  assert.match(text, /complete the marked form section/i);
});
