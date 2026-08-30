import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { test } from "node:test";
import { waitForConfirmation } from "../src/browser.js";

test("waits for delayed confirmation and times out safely", async () => {
  const server = createServer((_request, response) => { response.setHeader("content-type", "text/html"); response.end("<form></form><script>setTimeout(() => { document.body.innerHTML = '<h1>Thank you for applying</h1>'; }, 300)</script>"); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not start");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}`);
  assert.equal((await waitForConfirmation(page, [/thank you/i], 2000)).confirmed, true);
  await page.goto(`http://127.0.0.1:${address.port}`);
  assert.equal((await waitForConfirmation(page, [/missing/i], 100)).confirmed, false);
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
