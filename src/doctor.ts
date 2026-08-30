import { access, mkdir, stat } from "node:fs/promises";
import { chromium } from "playwright";
import { dataDir, loadState, setupMissing } from "./core.js";

export type DoctorCheck = { name: string; status: "pass" | "fail" | "warn"; detail: string };

export async function runDoctor(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  checks.push({ name: "Node.js", status: Number(process.versions.node.split(".")[0]) >= 20 ? "pass" : "fail", detail: process.version });
  const state = await loadState();
  const missing = setupMissing(state);
  checks.push({ name: "Setup", status: missing.length ? "fail" : "pass", detail: missing.length ? `Missing: ${missing.join(", ")}` : "Complete" });
  await mkdir(dataDir(), { recursive: true });
  checks.push({ name: "Data directory", status: "pass", detail: dataDir() });
  if (state.setup?.defaultResume) {
    const readable = await access(state.setup.defaultResume).then(() => true).catch(() => false);
    checks.push({ name: "Default resume", status: readable ? "pass" : "fail", detail: state.setup.defaultResume });
  } else checks.push({ name: "Default resume", status: "fail", detail: "Not configured" });
  for (const source of state.evidence) {
    if (source.kind === "url") continue;
    const readable = await access(source.input).then(() => true).catch(() => false);
    checks.push({ name: `Evidence ${source.id}`, status: readable ? "pass" : "fail", detail: source.input });
  }
  if (state.setup?.reasoning.type === "provider") {
    const configured = Boolean(process.env[state.setup.reasoning.credentialEnv]);
    checks.push({ name: "Provider credential", status: configured ? "pass" : "fail", detail: configured ? state.setup.reasoning.credentialEnv : `Missing ${state.setup.reasoning.credentialEnv}` });
  }
  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    checks.push({ name: "Chromium", status: "pass", detail: "Launch succeeded" });
  } catch (error) {
    checks.push({ name: "Chromium", status: "fail", detail: error instanceof Error ? error.message.split("\n")[0] : String(error) });
  }
  return checks;
}
