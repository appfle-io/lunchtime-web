import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { chromium } from "playwright";

async function testRealClick() {
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

    // Let's find all click targets inside the business hours section
    const clickTargets = await page.evaluate(() => {
      const allDivs = Array.from(document.querySelectorAll("div, a, button"));
      const bizHeader = allDivs.find((el) => el.children.length === 0 && el.textContent?.trim() === "영업시간");
      if (!bizHeader) return [];

      let parent: HTMLElement | null = bizHeader.parentElement;
      for (let i = 0; i < 4; i++) {
        if (parent?.parentElement) parent = parent.parentElement;
      }
      if (!parent) return [];

      const clickables = Array.from(parent.querySelectorAll("a, button, div[role='button'], div"));
      return clickables.map((c, i) => ({
        index: i,
        tagName: c.tagName,
        className: c.className,
        text: c.innerText.slice(0, 100),
      }));
    });

    console.log("Click Targets in Biz Section:", JSON.stringify(clickTargets, null, 2));

    // Try clicking each target to see which one expands the full schedule (목, 금, 토, 일, 월, 화, 수)
    for (let i = 0; i < clickTargets.length; i++) {
      const expandedText = await page.evaluate((idx) => {
        const allDivs = Array.from(document.querySelectorAll("div, a, button"));
        const bizHeader = allDivs.find((el) => el.children.length === 0 && el.textContent?.trim() === "영업시간");
        if (!bizHeader) return null;

        let parent: HTMLElement | null = bizHeader.parentElement;
        for (let k = 0; k < 4; k++) {
          if (parent?.parentElement) parent = parent.parentElement;
        }
        if (!parent) return null;

        const clickables = Array.from(parent.querySelectorAll("a, button, div[role='button'], div"));
        const target = clickables[idx] as HTMLElement;
        if (target) {
          target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        }

        return parent.innerText;
      }, i);

      await page.waitForTimeout(500);

      const hasSchedule = expandedText?.includes("월 07:30") || expandedText?.includes("목 07:30") || expandedText?.includes("정기휴무") || expandedText?.includes("07:30 - 21:00");
      if (hasSchedule) {
        console.log(`\n🎉 Click Target Index ${i} SUCCESS! Expanded Schedule:`);
        console.log(expandedText);
        break;
      }
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await browser.close();
  }
}

testRealClick();
