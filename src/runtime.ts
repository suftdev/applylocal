import type { BrowserAction, BrowserObservation } from "./browser.js";
import { BrowserContext, Page } from "playwright";
import { openBrowser, observePage, executeBrowserAction } from "./browser.js";
import { WorkerClient } from "./worker-client.js";
import { Setup } from "./core.js";

export interface BrowserRuntime {
  attach(url: string, runId: string): Promise<void>;
  observe(): Promise<BrowserObservation>;
  act(action: BrowserAction): Promise<BrowserObservation>;
  close(): Promise<void>;
}

export class DirectBrowserRuntime implements BrowserRuntime {
  private context?: BrowserContext;
  private page?: Page;
  constructor(private readonly setup: Setup) {}
  async attach(url: string): Promise<void> { this.context = await openBrowser(this.setup); this.page = await this.context.newPage(); await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }); }
  async observe(): Promise<BrowserObservation> { if (!this.page) throw new Error("Browser runtime is not attached"); return observePage(this.page); }
  async act(action: BrowserAction): Promise<BrowserObservation> { if (!this.page) throw new Error("Browser runtime is not attached"); const observation = await observePage(this.page); await executeBrowserAction(this.page, this.page, action, observation); return observePage(this.page); }
  async close(): Promise<void> { await this.context?.close(); this.context = undefined; this.page = undefined; }
}

export class WorkerBrowserRuntime implements BrowserRuntime {
  private runId?: string;
  constructor(private readonly client = new WorkerClient()) {}
  async attach(url: string, runId: string): Promise<void> { await this.client.attach(runId, url); this.runId = runId; }
  async observe(): Promise<BrowserObservation> { if (!this.runId) throw new Error("Browser runtime is not attached"); return this.client.observe(this.runId); }
  async act(action: BrowserAction): Promise<BrowserObservation> { if (!this.runId) throw new Error("Browser runtime is not attached"); return this.client.act(this.runId, action); }
  async close(): Promise<void> { if (this.runId) await this.client.close(this.runId).catch(() => undefined); this.runId = undefined; }
}
