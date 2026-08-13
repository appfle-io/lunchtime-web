import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { chromium } from "playwright";

async function findElement() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    locale: "ko-KR",
  });

  const page = await context.newPage();
  try {
    const url = "https://pcmap.place.naver.com/restaurant/37778669/home";
    await page.goto(url, { waitUntil: "load", timeout: 15000 });
    await page.waitForTimeout(2000);

    const elements = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll("*"));
      return all
        .filter((el) => {
          const t = el.innerText || "";
          return (t.includes("영업시간") || t.includes("라스트오더")) && el.children.length > 0 && el.children.length < 10;
        })
        .map((el) => ({
          tagName: el.tagName,
          className: el.className,
          outerHTML: el.outerHTML.slice(0, 300),
        }));
    });

    console.log("Found Elements:", JSON.stringify(elements, null, 2));

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await browser.close();
  }
}

findElement();
