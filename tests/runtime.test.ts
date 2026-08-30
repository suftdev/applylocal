import assert from "node:assert/strict";
import { test } from "node:test";
import { WorkerBrowserRuntime } from "../src/runtime.js";

test("worker runtime requires attachment before observation or action", async () => {
  const runtime = new WorkerBrowserRuntime({} as never);
  await assert.rejects(() => runtime.observe(), /not attached/);
  await assert.rejects(() => runtime.act({ type: "click", target: "next" }), /not attached/);
});
