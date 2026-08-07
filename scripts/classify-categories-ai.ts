// 정부 데이터(소상공인시장진흥공단 상가정보)로 시딩된 식당은 업종 텍스트 자체가 뭉뚱그려져
// 있는 경우가 많다 - 예를 들어 갈비집/삼겹살집도 그냥 "한식음식점"으로만 등록돼 있거나, 아예
// "기타 간이 음식점" 같은 진짜 뭉뚱그린 업종으로 등록된 곳도 많다. 그래서 restaurant-category.ts의
// 키워드 정규식(우리 필터 로직)이 참고할 원본 텍스트 자체가 애매해서, "고기" 필터를 눌러도
// 결과가 거의 안 나오는 문제가 생긴다.
//
// 이 스크립트는 Gemini에게 "식당 이름 + 원본 업종 텍스트"를 보여주고, 우리 필터가 인식하는
// 고정 라벨(restaurant-category.ts의 CATEGORY_LABELS) 중 하나로 재분류하게 해서 각 식당 문서의
// categoryLabel 필드에 저장한다. 원본 category 필드는 절대 건드리지 않는다 - getCategoryVisual()이
// categoryLabel이 있으면 그걸 최우선으로 쓰고, 없으면 기존처럼 category 텍스트로 추론하는 식이라
// "덮어쓰기"가 아니라 "보강"이다. 잘못 분류된 게 있어도 categoryLabel 필드만 지우면 바로 원래
// 동작(정규식 추론)으로 되돌아간다.
//
// 사용법:
//   npm run classify:categories -- ssg          (categoryLabel이 아직 없는 식당만 처리 - 기본, 안전)
//   npm run classify:categories -- ssg --force   (이미 분류된 식당도 전부 다시 분류)
//
// 2026-08-07 API 호출 방식 변경: 처음엔 @google/generative-ai SDK로 만들었는데, 실제로 돌려보니
// 전체 배치가 "Your project has been denied access. Please contact support." (403)로 실패했다.
// API 키를 무료→선불(Tier 1)로 올려도 동일 - 알고 보니 이 SDK는 2025-11-30부로 Google이 공식
// 지원 종료한 패키지였다(저장소 이름 자체가 google-gemini/deprecated-generative-ai-js로 바뀜).
// packinbag(appfle-io/packinbag-app)은 같은 API 키로 같은 엔드포인트를 SDK 없이 raw fetch로
// 직접 호출하고 있고 정상 동작해서, 이 스크립트도 SDK 의존성을 걷어내고 packinbag과 동일한
// 방식(raw fetch + x-goog-api-key 헤더 + responseMimeType: "application/json"으로 JSON 강제)으로
// 바꿨다. lib/gemini.ts도 동일하게 맞춰뒀다.
//
// 비용/속도 참고: 식당 하나당 API 호출 한 번씩 하면 수백~수천 건일 때 너무 오래 걸리고 비용도
// 커지므로, 한 번에 여러 식당(BATCH_SIZE)을 묶어서 한 번의 Gemini 호출로 처리한다. 배치 하나가
// 실패해도(JSON 파싱 실패, API 오류 등) 그 배치만 건너뛰고 나머지는 계속 진행하며, 실패한 식당은
// categoryLabel이 여전히 없으므로 스크립트를 다시 실행하면 자동으로 재시도된다.

import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const BATCH_SIZE = 40;
const SLEEP_MS_BETWEEN_BATCHES = 1200; // Gemini 분당 요청 제한에 여유를 두기 위한 슬리핑.

const GEMINI_MODEL = "gemini-2.5-flash-lite"; // packinbag과 동일 - 단순 분류 작업엔 충분하고 저렴함.
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const API_MAX_RETRIES = 2;
const API_RETRY_DELAY_MS = 900;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ClassifyItem {
  id: string;
  name: string;
  rawCategory: string;
}

function buildSystemInstruction(labels: string[]): string {
  return `
당신은 한국 식당의 이름과 (부정확하거나 뭉뚱그려져 있을 수 있는) 원본 업종 텍스트를 보고,
아래 고정된 라벨 목록 중 가장 알맞은 것 딱 하나로 분류하는 도우미입니다.

라벨 목록(반드시 이 중에서만 골라야 함): ${labels.join(", ")}

판단 기준:
- 원본 업종 텍스트가 이미 구체적이면 그것을 최우선으로 참고하세요.
- 원본 업종 텍스트가 "기타", "한식", "분식"처럼 뭉뚱그려져 있거나 실제 메뉴와 안 맞아 보이면,
  식당 이름에서 드러나는 실제 메뉴(예: "OO갈비", "OO곱창", "OO초밥", "OO칼국수")를 근거로
  더 구체적인 라벨로 재분류하세요.
- 정말 판단 근거가 없으면 "기타"로 분류하세요. 목록에 없는 라벨은 절대 만들지 마세요.

아래 JSON 배열의 각 항목에 대해, 반드시 같은 개수·같은 순서로 라벨만 채운 JSON 배열로만
답하세요. 다른 설명 없이 이 배열만 출력하세요.
형식: [{"id": "abc123", "label": "고기"}, ...]
`.trim();
}

function buildUserText(items: ClassifyItem[]): string {
  return `식당 목록:\n${items.map((it) => `- id=${it.id}, name=${it.name}, rawCategory=${it.rawCategory}`).join("\n")}`;
}

async function callGeminiJson(systemInstruction: string, userText: string, apiKey: string): Promise<string> {
  let lastStatus = 0;
  let lastErrText = "";

  for (let attempt = 0; attempt <= API_MAX_RETRIES; attempt += 1) {
    const res = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const text: string =
        data?.candidates?.[0]?.content?.parts
          ?.map((part: { text?: string }) => part.text ?? "")
          .join("") ?? "";
      return text;
    }

    lastStatus = res.status;
    lastErrText = await res.text();
    const isRetryable = lastStatus === 503 || lastStatus === 429;
    if (isRetryable && attempt < API_MAX_RETRIES) {
      await sleep(API_RETRY_DELAY_MS * (attempt + 1));
      continue;
    }
    throw new Error(`Gemini API 오류 (${lastStatus}): ${lastErrText.slice(0, 300)}`);
  }

  throw new Error(`Gemini API 오류 (${lastStatus}): ${lastErrText.slice(0, 300)}`);
}

function parseModelJson(rawText: string): { id: string; label: string }[] {
  // responseMimeType: "application/json"으로 강제해도 방어적으로 코드블록 표시는 한 번 벗겨준다.
  const cleaned = rawText
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/, "");
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error("모델 응답이 배열이 아닙니다.");
  return parsed;
}

async function main() {
  const [companyCodeArg, ...rest] = process.argv.slice(2);
  if (!companyCodeArg) {
    console.error("사용법: npm run classify:categories -- <companyCode> [--force]");
    process.exit(1);
  }
  const force = rest.includes("--force");

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY가 .env.local에 없습니다. Google AI Studio에서 발급받은 키를 넣어줘.");
    process.exit(1);
  }

  const { db } = await import("../src/lib/firebase");
  const { getCompanyByCode } = await import("../src/lib/company-server");
  const { CATEGORY_LABELS } = await import("../src/lib/restaurant-category");

  const company = await getCompanyByCode(companyCodeArg);
  if (!company) {
    console.error(`companies/${companyCodeArg} 문서를 찾을 수 없습니다. 회사코드를 확인해줘.`);
    process.exit(1);
  }

  const restaurantsRef = db.collection("companies").doc(company.code).collection("restaurants");
  const snapshot = await restaurantsRef.get();
  if (snapshot.empty) {
    console.error(`companies/${company.code}/restaurants 문서가 없습니다. 먼저 식당을 시딩해줘.`);
    process.exit(1);
  }

  const targets = snapshot.docs.filter((doc) => force || !doc.data().categoryLabel);
  console.log(
    `[대상 확인] 전체 ${snapshot.size}건 중 분류 대상 ${targets.length}건 ` +
      `(force=${force ? "true, 전부 재분류" : "false, categoryLabel 없는 것만"})`
  );

  if (targets.length === 0) {
    console.log("분류할 식당이 없어요. 이미 전부 categoryLabel이 있거나, --force를 빼먹은 건 아닌지 확인해줘.");
    return;
  }

  const systemInstruction = buildSystemInstruction(CATEGORY_LABELS);
  let succeeded = 0;
  let failed = 0;
  const totalBatches = Math.ceil(targets.length / BATCH_SIZE);

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batchNo = Math.floor(i / BATCH_SIZE) + 1;
    const batchDocs = targets.slice(i, i + BATCH_SIZE);
    const items: ClassifyItem[] = batchDocs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: (data.name as string) ?? "이름없음",
        rawCategory: (data.category as string | null) ?? "(없음)",
      };
    });

    try {
      const rawText = await callGeminiJson(systemInstruction, buildUserText(items), apiKey);
      const parsed = parseModelJson(rawText);

      const validIds = new Set(items.map((it) => it.id));
      const batch = db.batch();
      let batchWrites = 0;
      for (const entry of parsed) {
        if (!entry || typeof entry.id !== "string" || typeof entry.label !== "string") continue;
        if (!validIds.has(entry.id)) continue; // 모델이 없는 id를 지어내면 무시
        if (!CATEGORY_LABELS.includes(entry.label)) continue; // 모르는 라벨이면 원본 그대로 유지
        batch.update(restaurantsRef.doc(entry.id), { categoryLabel: entry.label });
        batchWrites += 1;
      }
      if (batchWrites > 0) await batch.commit();
      succeeded += batchWrites;
      failed += items.length - batchWrites;
      console.log(
        `  ...배치 ${batchNo}/${totalBatches} 처리 (${batchWrites}/${items.length}건 저장, 누적 성공 ${succeeded}건)`
      );
    } catch (err) {
      failed += items.length;
      console.error(`  [배치 ${batchNo}/${totalBatches} 실패 - 건너뜀]`, err instanceof Error ? err.message : err);
    }

    if (i + BATCH_SIZE < targets.length) {
      await sleep(SLEEP_MS_BETWEEN_BATCHES);
    }
  }

  console.log(`\n[완료] 성공 ${succeeded}건, 실패(건너뜀) ${failed}건`);
  if (failed > 0) {
    console.log("실패한 식당들은 categoryLabel이 여전히 없으니, 스크립트를 다시 실행하면 자동으로 재시도됩니다.");
  }
  console.log("결과 확인: npm run dev로 앱을 켜고 필터바에서 '고기' 등을 눌러 결과가 늘었는지 확인해줘.");
}

main().catch((err) => {
  console.error("[분류 실패]", err);
  process.exit(1);
});
