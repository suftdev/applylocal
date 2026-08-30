import { Page } from "playwright";

export type JobMetadata = { title?: string; company?: string; location?: string; description: string; applicationUrl: string; authRequired: boolean };

export async function extractJob(page: Page): Promise<JobMetadata> {
  const ogTitle = page.locator('meta[property="og:title"]');
  const h1 = page.locator("h1").first();
  const title = await ogTitle.count() ? await ogTitle.getAttribute("content", { timeout: 2000 }).catch(() => null) : await h1.count() ? await h1.textContent({ timeout: 2000 }).catch(() => null) : await page.title().catch(() => "");
  const companyLocator = page.locator('[data-company], [class*="company"], [itemprop="hiringOrganization"]').first();
  const locationLocator = page.locator('[data-location], [class*="location"], [itemprop="jobLocation"]').first();
  const company = await companyLocator.count() ? await companyLocator.textContent({ timeout: 2000 }).catch(() => null) : null;
  const location = await locationLocator.count() ? await locationLocator.textContent({ timeout: 2000 }).catch(() => null) : null;
  const body = await page.locator("body").innerText().catch(() => "");
  const applyLinks = page.getByRole("link", { name: /apply|start application|apply for this|submit application/i });
  const href = await applyLinks.count() ? await applyLinks.first().getAttribute("href").catch(() => null) : null;
  const applicationUrl = href ? new URL(href, page.url()).toString() : page.url();
  const authRequired = /\/(login|register|sign-in|signin|signup)/i.test(new URL(applicationUrl).pathname);
  const workableMatch = applicationUrl.match(/^(https:\/\/apply\.workable\.com\/[^/]+\/j\/[^/?]+)/);
  if (workableMatch) return { title: title?.trim() || undefined, company: company?.trim() || undefined, location: location?.trim() || undefined, description: body.slice(0, 50_000), applicationUrl: `${workableMatch[1]}/apply/`, authRequired };
  return { title: title?.trim() || undefined, company: company?.trim() || undefined, location: location?.trim() || undefined, description: body.slice(0, 50_000), applicationUrl, authRequired };
}
