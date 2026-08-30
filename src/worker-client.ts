import { BrowserAction, BrowserObservation } from "./browser.js";
import { readFile } from "node:fs/promises";
import { dataDir } from "./core.js";
import { spawn } from "node:child_process";

export class WorkerClient {
  constructor(private readonly baseUrl = process.env.APPLYLOCAL_WORKER_URL ?? "http://127.0.0.1:4317") {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = process.env.APPLYLOCAL_WORKER_TOKEN ?? await readFile(`${dataDir()}/worker.token`, "utf8").then((value) => value.trim()).catch(() => { throw new Error("ApplyLocal browser worker is not initialized. Start it with: applylocal worker"); });
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { "content-type": "application/json", "x-applylocal-token": token, ...init?.headers } });
    } catch {
      throw new Error("ApplyLocal browser worker is not reachable. Start it with: applylocal worker");
    }
    const value = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(value.error ?? `Worker returned ${response.status}`);
    return value;
  }

  async ensureRunning(): Promise<void> {
    if (await this.health().then(() => true).catch(() => false)) return;
    const cli = process.argv[1];
    if (!cli) throw new Error("Cannot locate the ApplyLocal CLI to start the browser worker");
    const child = spawn(process.execPath, [cli, "worker"], { detached: true, stdio: "ignore", env: process.env });
    child.unref();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (await this.health().then(() => true).catch(() => false)) return;
    }
    throw new Error("ApplyLocal browser worker did not start");
  }
  attach(runId: string, url: string): Promise<{ runId: string; observation: BrowserObservation; questions?: string[]; notices?: string[]; noForm?: boolean; authRequired?: boolean; title?: string; company?: string }> { return this.request("/sessions", { method: "POST", body: JSON.stringify({ runId, url }) }); }
  rescan(runId: string, url?: string): Promise<{ runId: string; observation: BrowserObservation; questions?: string[]; notices?: string[]; noForm?: boolean; authRequired?: boolean; title?: string; company?: string; url?: string }> { return this.request(`/sessions/${runId}/rescan`, { method: "POST", body: JSON.stringify({ url }) }); }
  health(): Promise<{ status: string; sessions: number }> { return this.request("/health"); }
  finalize(runId: string): Promise<{ status: "submitted" | "unknown" | "waiting_for_user"; confirmation?: string; reason?: string; questions?: string[]; notices?: string[] }> { return this.request(`/sessions/${runId}/finalize`, { method: "POST" }); }
  observe(runId: string): Promise<BrowserObservation> { return this.request(`/sessions/${runId}/observe`); }
  act(runId: string, action: BrowserAction): Promise<BrowserObservation> { return this.request(`/sessions/${runId}/act`, { method: "POST", body: JSON.stringify({ action }) }); }
  close(runId: string): Promise<{ closed: boolean; runId: string }> { return this.request(`/sessions/${runId}`, { method: "DELETE" }); }
}
