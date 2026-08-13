import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { chromium } from "playwright";

async function testGkp9iClick() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    locale: "ko-KR",
  });

  const page = await context.newPage();
  try {
    const url = "https://pcmap.place.naver.com/restaurant/37778669/home";
    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: "load", timeout: 15000 });
    await page.waitForTimeout(1500);

    // Click a.gKP9i or div.vV_z_
    const clicked = await page.evaluate(() => {
      const link = document.querySelector("a.gKP9i") || document.querySelector("div.vV_z_ a") || document.querySelector("div.O8qbU.pSavy a");
      if (link) {
        (link as HTMLElement).click();
        return true;
      }
      return false;
    });

    console.log("Clicked a.gKP9i:", clicked);
    await page.waitForTimeout(1000);

    // Extract expanded business hours text inside div.O8qbU.pSavy or div.vV_z_
    const expandedText = await page.evaluate(() => {
      const container = document.querySelector("div.O8qbU.pSavy") || document.querySelector("div.vV_z_");
      return container ? (container as HTMLElement).innerText : "Container not found";
    });

    console.log("\n=== EXPANDED BUSINESS HOURS FOR 37778669 ===");
    console.log(expandedText);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await browser.close();
  }
}

testGkp9iClick();
