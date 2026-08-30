import assert from "node:assert/strict";
import { test } from "node:test";
import { BrowserObservation, sensitiveFields, validateBrowserAction } from "../src/browser.js";

const observation: BrowserObservation = {
  url: "https://example.com/apply",
  title: "Apply",
  text: "Application",
  canSubmit: true,
  fields: [
    { id: "field-0", role: "textbox", label: "Email", type: "email", required: true, value: "" },
    { id: "field-1", role: "textbox", label: "Resume", type: "file", required: true, value: "" },
  ],
};

test("accepts actions only for observed fields", () => {
  assert.doesNotThrow(() => validateBrowserAction({ type: "fill", fieldId: "field-0", value: "test@example.com" }, observation));
  assert.throws(() => validateBrowserAction({ type: "fill", fieldId: "field-9", value: "x" }, observation), /not present/);
});

test("blocks generic actions from uploading arbitrary files", () => {
  assert.throws(() => validateBrowserAction({ type: "fill", fieldId: "field-1", value: "/tmp/secret" }, observation), /dedicated resume/);
});

test("detects sensitive fields before submission", () => {
  assert.deepEqual(sensitiveFields({ ...observation, fields: [{ id: "field-2", role: "textbox", label: "Legal declaration signature", type: "text", required: true, value: "" }] }), ["Legal declaration signature"]);
});

test("sensitive detection skips hidden, completed, and ticked fields", () => {
  const fields: BrowserObservation["fields"] = [
    { id: "f0", role: "textbox", label: "h-captcha-response", type: "hidden", required: false, value: "" },
    { id: "f1", role: "textbox", label: "I certify the facts are true", type: "checkbox", required: false, value: "certify", checked: true },
    { id: "f2", role: "textbox", label: "Salary expectations", type: "text", required: false, value: "answered by user" },
    { id: "f3", role: "textbox", label: "I certify the facts are true", type: "checkbox", required: false, value: "certify", checked: false },
  ];
  assert.deepEqual(sensitiveFields({ ...observation, fields }), ["I certify the facts are true"]);
});
