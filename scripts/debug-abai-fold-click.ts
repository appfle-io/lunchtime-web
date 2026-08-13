import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { chromium } from "playwright";

async function debugFoldClick() {
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
    await page.waitForTimeout(2000);

    // Find the exact element with text "펼쳐보기" or "영업시간"
    const clickedInfo = await page.evaluate(() => {
      // Find all clickable elements or elements with text "펼쳐보기"
      const all = Array.from(document.querySelectorAll("a, button, div, span, svg"));
      const foldEl = all.find((el) => el.textContent?.trim() === "펼쳐보기" || el.textContent?.includes("20:05에 라스트오더"));

      if (foldEl) {
        const target = (foldEl.closest("a") || foldEl.closest("button") || foldEl) as HTMLElement;
        target.click();
        return {
          found: true,
          tagName: target.tagName,
          className: target.className,
          text: target.innerText,
        };
      }
      return { found: false };
    });

    console.log("Clicked Info:", clickedInfo);
    await page.waitForTimeout(1500);

    // Capture text around business hours after JS click
    const hoursSectionText = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll("*"));
      const header = all.find((el) => el.children.length === 0 && el.textContent?.trim() === "영업시간");
      if (!header) return "No 영업시간 heading";

      let container: HTMLElement | null = header.parentElement;
      for (let i = 0; i < 5; i++) {
        if (container && container.innerText.length > 50) break;
        if (container?.parentElement) container = container.parentElement;
      }
      return container ? container.innerText : "No container text";
    });

    console.log("\n=== HOURS SECTION TEXT AFTER JS CLICK ===");
    console.log(hoursSectionText);

    // Also check if Apollo State gained new keys after click
    const apolloState = await page.evaluate(() => {
      const win = window as any;
      const apollo = win.__APOLLO_STATE__ || {};
      return Object.keys(apollo).filter((k) => /hour|biz|time|period|day|work/i.test(k)).map((k) => ({
        key: k,
        data: apollo[k],
      }));
    });

    console.log("\n=== APOLLO STATE HOUR KEYS AFTER CLICK ===");
    console.log(JSON.stringify(apolloState, null, 2));

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await browser.close();
  }
}

debugFoldClick();
