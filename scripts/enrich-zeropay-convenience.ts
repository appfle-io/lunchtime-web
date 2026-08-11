import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { checkZeroPayOfficial } from "../src/lib/zeropay-official";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const CHECKPOINT_FILE = path.resolve(process.cwd(), ".enrich-convenience-checkpoint.json");

function loadCheckpoint(): Set<string> {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const data = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf-8"));
      return new Set<string>(data.done ?? []);
    }
  } catch (_) {}
  return new Set<string>();
}

function saveCheckpoint(done: Set<string>) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({ done: [...done], updatedAt: new Date().toISOString() }));
}

async function main() {
  const { db } = await import("../src/lib/firebase");
  const { chromium } = await import("playwright");
  const { invalidateRestaurantsCache } = await import("../src/lib/restaurant-server");

  const args = process.argv.slice(2);
  const companyCode = args.find((a) => !a.startsWith("--")) || "ssg";
  const isDryRun = args.includes("--dry-run");
  const resetCheckpoint = args.includes("--reset");

  const checkpoint = resetCheckpoint ? new Set<string>() : loadCheckpoint();

  console.log(`\n==================================================`);
  console.log(`🏪 [편의점 전용 제로페이 공식 스크래핑 배치]`);
  console.log(`회사: ${companyCode} | dry-run: ${isDryRun}`);
  console.log(`==================================================\n`);

  const restaurantsRef = db.collection("companies").doc(companyCode).collection("restaurants");
  const snap = await restaurantsRef.get();

  if (snap.empty) {
    console.log("❌ 가맹점 데이터를 찾을 수 없습니다.");
    return;
  }

  // 편의점 가맹점만 필터링 (categoryLabel === "편의점" OR source === "seed_convenience" OR category 포함 "편의점")
  const convenienceDocs = snap.docs.filter((doc) => {
    const data = doc.data();
    return (
      data.categoryLabel === "편의점" ||
      data.source === "seed_convenience" ||
      (typeof data.category === "string" && data.category.includes("편의점")) ||
      (typeof data.name === "string" && (
        data.name.includes("GS25") ||
        data.name.includes("CU") ||
        data.name.includes("세븐일레븐") ||
        data.name.includes("이마트24") ||
        data.name.includes("미니스톱")
      ))
    );
  });

  console.log(`🔍 총 ${snap.size}개 매장 중 편의점 매장: ${convenienceDocs.length}개`);

  const pending = convenienceDocs.filter((d) => !checkpoint.has(d.id));
  console.log(`📋 미처리 대상: ${pending.length}개 (체크포인트 완료: ${checkpoint.size}개)\n`);

  if (pending.length === 0) {
    console.log("🎉 모든 편의점 제로페이 검증이 완료되었습니다!");
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "ko-KR" });

  let doneCount = 0;
  let zeroPayCount = 0;
  let nonZeroPayCount = 0;
  const total = pending.length;
  const results = new Map<string, { isZeroPay: boolean; officialName?: string; officialAddress?: string }>();

  try {
    for (const doc of pending) {
      const data = doc.data();
      const name = data.name as string;
      const address = (data.address as string) ?? "";

      try {
        const res = await checkZeroPayOfficial(name, address, context);
        results.set(doc.id, {
          isZeroPay: res.isZeroPay,
          officialName: res.officialName,
          officialAddress: res.officialAddress,
        });

        doneCount++;

        if (res.isZeroPay) {
          zeroPayCount++;
          console.log(`  [${doneCount}/${total}] 🟢 (제로페이 O) ${name}`);
          console.log(`          └ 공식상호: ${res.officialName ?? "N/A"} | 주소: ${res.officialAddress ?? "N/A"}`);
        } else {
          nonZeroPayCount++;
          console.log(`  [${doneCount}/${total}] 🔴 (제로페이 X) ${name}`);
        }
      } catch (err) {
        console.warn(`  [${doneCount + 1}/${total}] ⚠️ 오류 (${name}): ${(err as Error).message}`);
      }

      checkpoint.add(doc.id);
      if (doneCount % 5 === 0) {
        saveCheckpoint(checkpoint);
      }

      await new Promise((r) => setTimeout(r, 800));
    }
  } finally {
    await context.close();
    await browser.close();
  }

  // Firestore DB 업데이트
  if (isDryRun) {
    console.log("\n[dry-run] DB 업데이트를 건너뜁니다.");
  } else {
    console.log("\n💾 DB 업데이트 진행 중...");
    const WRITE_BATCH = 400;
    const entries = [...results.entries()];
    let updated = 0;

    for (let i = 0; i < entries.length; i += WRITE_BATCH) {
      const batch = db.batch();
      for (const [id, r] of entries.slice(i, i + WRITE_BATCH)) {
        batch.update(restaurantsRef.doc(id), {
          isZeroPay: r.isZeroPay,
          zeroPaySource: "official_zeropay_api",
          zeroPayOfficialName: r.officialName ?? null,
          zeroPayOfficialAddress: r.officialAddress ?? null,
          zeroPayEnrichedAt: new Date().toISOString(),
        });
        updated++;
      }
      await batch.commit();
    }
    invalidateRestaurantsCache(companyCode);
    console.log(`✅ DB 업데이트 완료: ${updated}개 편의점 반영됨`);
  }

  if (!isDryRun) {
    try {
      fs.unlinkSync(CHECKPOINT_FILE);
    } catch (_) {}
  }

  console.log(`\n==================================================`);
  console.log(`🎉 [편의점 제로페이 검증 완료]`);
  console.log(`  - 총검사: ${doneCount}개`);
  console.log(`  - 🟢 제로페이 가맹점: ${zeroPayCount}개`);
  console.log(`  - 🔴 미가맹점: ${nonZeroPayCount}개`);
  console.log(`==================================================\n`);
}

main().catch((err) => {
  console.error("[스크립트 실패]", err);
  process.exit(1);
});
