import assert from "node:assert/strict";
import { test } from "node:test";
import { BrowserObservation, sensitiveFields, unresolvedRequiredControls } from "../src/browser.js";

test("sensitive fixture labels are classified before submission", () => {
  const labels = ["Legal declaration", "Gender", "Race or ethnicity", "CAPTCHA", "MFA verification code", "Salary expectation", "Willing to relocate", "National ID"];
  const observation: BrowserObservation = { url: "fixture", title: "Safety", text: labels.join(" "), canSubmit: true, fields: labels.map((label, index) => ({ id: `field-${index}`, role: "textbox", label, type: "text", required: true, value: "" })) };
  assert.deepEqual(sensitiveFields(observation), labels);
});
