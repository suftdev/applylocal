import { Run, Attention } from "./core.js";
import { BrowserObservation } from "./browser.js";

function stepFor(reason: string): string {
  const lower = reason.toLowerCase();
  if (lower.includes("certify") || lower.includes("signature") || lower.includes("declaration")) return "Tick the certification or signature checkbox in the browser window.";
  if (lower.includes("captcha")) return "Solve the captcha in the browser window. ApplyLocal never automates captchas.";
  if (lower.includes("cards[")) return "Complete the marked form section in the browser window (the site hides its question text internally).";
  if (lower.includes("password")) return "Complete the sign-in or registration in the browser window, then run the continue command again.";
  if (lower.includes("no application form")) return reason;
  if (lower.includes("sign-in") || lower.includes("registration")) return reason;
  return `Resolve: ${reason}`;
}

export function renderHandoff(run: Run, attention: Attention[], observation?: BrowserObservation): string {
  const lines: string[] = [];
  const pending = attention.filter((item) => !item.resolved);
  const where = run.browserSession === "worker" ? "in the visible ApplyLocal browser window" : "in the ApplyLocal browser";
  lines.push(`## Attention needed for ${run.title ?? run.url}`);
  lines.push("");
  if (observation) {
    lines.push(`Current form state for **${run.title ?? run.url}**:`);
    lines.push("");
    lines.push("| Field | State |");
    lines.push("|---|---|");
    for (const field of observation.fields) {
      if (field.type === "hidden") continue;
      const label = field.label.replace(/\s+/g, " ").trim().slice(0, 60) || field.id;
      if (field.type === "file") { if (field.value) lines.push(`| ${label} | ✅ Uploaded |`); continue; }
      if (field.type === "checkbox") { if (field.checked) lines.push(`| ${label.slice(0, 40)}… | ✅ Ticked |`); else if (field.required) lines.push(`| ${label.slice(0, 40)}… | ⬜ Yours to tick |`); continue; }
      if (field.type === "radio") continue;
      if (field.value.trim()) lines.push(`| ${label} | ✅ ${field.value.trim().slice(0, 40)} |`);
      else if (field.required) lines.push(`| ${label} | ⬜ Yours to complete |`);
    }
    lines.push("");
  }
  if (pending.length) {
    lines.push(`**${pending.length} item(s) need you ${where}:**`);
    lines.push("");
    pending.forEach((item, index) => { lines.push(`${index + 1}. ${stepFor(item.reason)}`); });
  } else {
    lines.push(`Nothing is blocking. Review the form ${where}, then continue.`);
  }
  lines.push("");
  lines.push("Do not submit the form manually. When done, run:");
  lines.push("");
  lines.push("```bash");
  lines.push(`applylocal runs continue ${run.id}`);
  lines.push("```");
  return lines.join("\n");
}
