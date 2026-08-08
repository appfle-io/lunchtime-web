// 네이버맵 매칭에 실패한 가맹점들을 네이버 지역검색 API로 빠르게 재검증하는 스크립트.
//
// 사용법:
//   npm run verify:unmatched -- ssg --dry-run    (리포트만, 삭제 없음)
//   npm run verify:unmatched -- ssg              (확실한 폐점 자동 삭제)
//
// 분류 기준:
//   🗑  삭제 권장: 검색결과 0건 + 이름에 법인/회사 키워드 포함
//   ⚠️  검토 필요: 검색결과 있지만 지역 불일치 or 유사도 낮음
//   🔄  재시도: 특수문자 제거 후 재검색하면 매칭될 가능성 있음

import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const SLEEP_MS = 120; // 네이버 API 요청 간격

// 법인명 패턴 - 음식점이 아닐 가능성이 높은 이름
const CORPORATE_PATTERNS =
  /^(주식회사|유한회사|합자회사|합명회사|\(주\)|\(유\))|주식회사$|유한회사$|코리아$|korea$/i;

// 특수문자 정리 - 검색 정확도를 높이기 위해
function cleanName(name: string): string {
  return name
    .replace(/[;；]/g, " ") // 세미콜론 → 공백
    .replace(/&amp;/g, "&") // HTML 엔티티 복원
    .replace(/\s+/g, " ")
    .trim();
}

/** 두 문자열의 자카드 유사도 (0~1) */
function similarity(a: string, b: string): number {
  const sa = new Set(a.replace(/\s/g, "").split(""));
  const sb = new Set(b.replace(/\s/g, "").split(""));
  const intersection = [...sa].filter((c) => sb.has(c)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 1 : intersection / union;
}

/** 위경도 두 점 사이 거리 (m) */
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const companyCode = args.find((a) => !a.startsWith("--"));
  if (!companyCode) {
    console.error("사용법: npm run verify:unmatched -- <companyCode> [--dry-run]");
    process.exit(1);
  }
  const isDryRun = args.includes("--dry-run");

  const { db } = await import("../src/lib/firebase");
  const { searchNaverLocal, stripHtmlTags, parseNaverCoords } = await import(
    "../src/lib/naver-local-search"
  );

  // ── Firestore에서 매칭 실패 건만 읽기 ───────────────────
  const snap = await db
    .collection("companies")
    .doc(companyCode)
    .collection("restaurants")
    .get();

  const unmatched = snap.docs.filter((d) => !d.data().naverPlaceId);
  console.log(`\n[대상] 총 ${snap.size}건 중 naverPlaceId 없는 미매칭: ${unmatched.length}건\n`);

  // 결과 분류
  const toDelete: typeof unmatched = [];
  const toRetry: Array<{ doc: (typeof unmatched)[0]; cleanedName: string }> = [];
  const needsReview: Array<{
    doc: (typeof unmatched)[0];
    reason: string;
    topMatch?: string;
  }> = [];

  for (let i = 0; i < unmatched.length; i++) {
    const doc = unmatched[i];
    const data = doc.data();
    const rawName = (data.name as string) ?? "";
    const cleanedName = cleanName(rawName);
    const lat = data.lat as number;
    const lng = data.lng as number;

    process.stdout.write(
      `  [${(i + 1).toString().padStart(3)}/${unmatched.length}] ${rawName.slice(0, 30).padEnd(30)} `
    );

    // ── 1. 법인명 패턴 → 즉시 삭제 권장 ─────────────────
    if (CORPORATE_PATTERNS.test(rawName.trim())) {
      console.log("🗑  (법인명 패턴)");
      toDelete.push(doc);
      continue;
    }

    // ── 2. 네이버 지역검색으로 실재 확인 ─────────────────
    let items: Awaited<ReturnType<typeof searchNaverLocal>> = [];
    try {
      items = await searchNaverLocal(cleanedName, 3, "random");
    } catch {
      console.log("⚠️  (API 오류)");
      needsReview.push({ doc, reason: "API 오류" });
      await sleep(SLEEP_MS * 3);
      continue;
    }

    await sleep(SLEEP_MS);

    if (items.length === 0) {
      // 검색 결과 자체가 없음 → 폐점 가능성 높음
      console.log("🗑  (검색결과 0건 → 폐점 의심)");
      toDelete.push(doc);
      continue;
    }

    // 가장 가까운 결과의 이름 유사도 + 거리 확인
    const best = items
      .map((item) => {
        const { lat: iLat, lng: iLng } = parseNaverCoords(item);
        const dist = isNaN(iLat) ? Infinity : haversine(lat, lng, iLat, iLng);
        const sim = similarity(cleanedName, stripHtmlTags(item.title));
        return { item, dist, sim };
      })
      .sort((a, b) => b.sim - a.sim)[0];

    const bestName = stripHtmlTags(best.item.title);

    if (best.sim >= 0.6 && best.dist <= 300) {
      // 유사도 높고 근거리 → 특수문자 등의 문제로 Playwright에서 못 잡은 것
      console.log(`🔄  재시도 가능 (유사도=${(best.sim * 100).toFixed(0)}% 거리=${best.dist.toFixed(0)}m)`);
      toRetry.push({ doc, cleanedName });
    } else if (best.dist <= 500) {
      console.log(
        `⚠️  검토 필요 (유사도=${(best.sim * 100).toFixed(0)}% 거리=${best.dist.toFixed(0)}m → "${bestName}")`
      );
      needsReview.push({ doc, reason: `유사도 낮음: "${bestName}"`, topMatch: bestName });
    } else {
      // 검색 결과는 있지만 다른 지역 → 실질적으로 없는 것과 같음
      console.log(`🗑  (검색결과 있지만 ${best.dist.toFixed(0)}m 밖 → 폐점 의심)`);
      toDelete.push(doc);
    }
  }

  // ── 결과 요약 ────────────────────────────────────────────
  console.log(`
=== 최종 분류 결과 ===
🗑  삭제 권장 (폐점/법인명):  ${toDelete.length}건
🔄  재시도 권장 (이름 정제):  ${toRetry.length}건
⚠️  수동 검토 필요:            ${needsReview.length}건
`);

  if (toRetry.length > 0) {
    console.log("=== 🔄 재시도 권장 목록 (Playwright 스크립트로 다시 돌리면 됨) ===");
    for (const { doc, cleanedName } of toRetry) {
      console.log(`  [${doc.data().source}] ${doc.data().name} → 정제된 이름: "${cleanedName}"`);
    }
  }

  if (needsReview.length > 0) {
    console.log("\n=== ⚠️  수동 검토 필요 목록 ===");
    for (const { doc, reason } of needsReview) {
      console.log(`  [${doc.data().source}] ${doc.data().name} | ${doc.data().address?.slice(0, 40)}`);
      console.log(`    사유: ${reason}`);
    }
  }

  console.log("\n=== 🗑  삭제 권장 목록 ===");
  for (const doc of toDelete) {
    console.log(`  [${doc.data().source}] ${doc.data().name} | ${doc.data().address?.slice(0, 40)}`);
  }

  // ── Firestore 삭제 ───────────────────────────────────────
  if (isDryRun) {
    console.log(`\n[dry-run] 실제 삭제는 수행하지 않습니다. --dry-run을 빼면 ${toDelete.length}건이 삭제됩니다.`);
    return;
  }

  if (toDelete.length === 0) {
    console.log("\n삭제할 항목이 없습니다.");
    return;
  }

  const restaurantsRef = db
    .collection("companies")
    .doc(companyCode)
    .collection("restaurants");

  const BATCH_SIZE = 400;
  let deleted = 0;
  const ids = toDelete.map((d) => d.id);

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const id of ids.slice(i, i + BATCH_SIZE)) {
      batch.delete(restaurantsRef.doc(id));
    }
    await batch.commit();
    deleted += Math.min(BATCH_SIZE, ids.length - i);
    console.log(`  ...${deleted}/${toDelete.length}건 삭제 완료`);
  }

  console.log(`\n[완료] ${deleted}건 삭제. 남은 가맹점: ${snap.size - deleted}건`);
  console.log("재시도 권장 건은 scripts/enrich-zeropay-naver.ts의 이름 정제 후 재실행 예정.");
}

main().catch((err) => {
  console.error("[실패]", err);
  process.exit(1);
});
