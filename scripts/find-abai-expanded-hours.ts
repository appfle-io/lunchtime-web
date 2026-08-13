import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { chromium } from "playwright";

async function findExpandedHours() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
    locale: "ko-KR",
  });

  const page = await context.newPage();

  try {
    const mobileUrl = "https://m.place.naver.com/restaurant/37778669/home";
    console.log(`Navigating to ${mobileUrl}...`);
    await page.goto(mobileUrl, { waitUntil: "load", timeout: 15000 });
    await page.waitForTimeout(2000);

    // Click on the business hours element / fold button on mobile page
    const foldClicked = await page.evaluate(() => {
      // Find element containing "영업시간" or "라스트오더" or "펼쳐보기"
      const candidates = Array.from(document.querySelectorAll("a, button, div, span"));
      const btn = candidates.find((el) => {
        const t = el.textContent || "";
        return t.includes("영업시간") || t.includes("라스트오더") || t.includes("영업 중") || t.includes("펼쳐보기");
      });

      if (btn) {
        (btn as HTMLElement).click();
        return true;
      }
      return false;
    });

    console.log("Fold Clicked:", foldClicked);
    await page.waitForTimeout(1500);

    const mobileBodyText = await page.evaluate(() => document.body.innerText);
    console.log("\n=== MOBILE BODY TEXT AFTER CLICK ===");
    console.log(mobileBodyText);

    // Also check Apollo state on mobile page
    const apolloData = await page.evaluate(() => {
      const win = window as any;
      const apollo = win.__APOLLO_STATE__ || {};
      const keys = Object.keys(apollo);
      const bizKeys = keys.filter((k) => /biz|hour|opening|time|period|day|work/i.test(k));

      const hourObjects: Record<string, any> = {};
      keys.forEach((k) => {
        const item = apollo[k];
        if (item && (item.day || item.dayOfWeek || item.businessHours || item.periodList || item.openingHours)) {
          hourObjects[k] = item;
        }
      });

      return {
        bizKeys,
        hourObjects,
      };
    });

    console.log("\n=== MOBILE APOLLO HOUR OBJECTS ===");
    console.log(JSON.stringify(apolloData, null, 2));

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await browser.close();
  }
}

findExpandedHours();
