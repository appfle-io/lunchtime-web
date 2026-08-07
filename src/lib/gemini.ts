import type { RestaurantSummary } from "@/types";

// 2026-08-07: 예전엔 @google/generative-ai(구 Node.js SDK)를 썼는데, 실제로 카테고리 재분류
// 스크립트를 돌려보니 "Your project has been denied access. Please contact support." 403
// 오류가 계속 났다(API 키를 무료→선불 Tier 1으로 올려도 동일했음). 원인을 찾아보니 이 SDK는
// 2025-11-30부로 Google이 공식 지원 종료한 패키지였다(Google이 저장소 이름 자체를
// google-gemini/deprecated-generative-ai-js로 바꿔둠). 반면 packinbag(appfle-io/packinbag-app)은
// 같은 API 키로 같은 generativelanguage.googleapis.com 엔드포인트를 SDK 없이 raw fetch로 직접
// 호출하고 있고 실제로 정상 동작한다 - 그래서 이 프로젝트도 SDK 의존성을 걷어내고 packinbag과
// 동일한 raw fetch 방식(+x-goog-api-key 헤더)으로 맞췄다. 새 통합 SDK(@google/genai)로 갈아타는
// 대신, 이미 프로덕션에서 검증된 packinbag의 호출 방식을 그대로 재사용하는 쪽을 택함.
//
// packinbag과는 별도의 Gemini API 키/프로젝트 사용을 권장 (사용량·과금 분리, 키 유출 시 영향 범위 최소화).
const apiKey = process.env.GEMINI_API_KEY;

const GEMINI_ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// packinbag과 동일: 간단한 분류/요약 용도로는 빠르고 저렴한 flash-lite면 충분하다.
const DEFAULT_MODEL = "gemini-2.5-flash-lite";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 900;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface CallGeminiOptions {
  model?: string;
  systemInstruction?: string;
  jsonMode?: boolean; // true면 모델이 순수 JSON만 반환하도록 강제 (파싱 실패 위험을 줄임)
}

async function callGemini(userText: string, opts: CallGeminiOptions = {}): Promise<string> {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY가 설정되지 않았습니다. .env.local을 확인하세요.");
  }
  const model = opts.model ?? DEFAULT_MODEL;

  let lastStatus = 0;
  let lastErrText = "";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const res = await fetch(GEMINI_ENDPOINT(model), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        ...(opts.systemInstruction
          ? { system_instruction: { parts: [{ text: opts.systemInstruction }] } }
          : {}),
        contents: [{ role: "user", parts: [{ text: userText }] }],
        ...(opts.jsonMode ? { generationConfig: { responseMimeType: "application/json" } } : {}),
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
    if (isRetryable && attempt < MAX_RETRIES) {
      await sleep(RETRY_DELAY_MS * (attempt + 1));
      continue;
    }
    throw new Error(`Gemini API 오류 (${lastStatus}): ${lastErrText.slice(0, 300)}`);
  }

  throw new Error(`Gemini API 오류 (${lastStatus}): ${lastErrText.slice(0, 300)}`);
}

interface RecommendationContext {
  weather?: string; // 예: "32도, 맑음"
  recentRestaurantNames: string[]; // 최근 방문 이력 (회피 추천용)
  candidates: RestaurantSummary[];
}

/**
 * "오늘의 추천" - 날씨/최근 이력을 고려해 후보 중 하나를 추천하고 이유를 짧게 설명.
 * TODO: 여러 명(팀) 취향 통합 추천은 candidates + 참여자별 최근 이력을 함께 넘기는 방식으로 확장.
 */
export async function recommendLunch(ctx: RecommendationContext) {
  const prompt = `
당신은 회사 동료들의 점심 메뉴를 추천해주는 재치있는 도우미입니다.
아래 후보 식당 중 오늘 점심으로 가장 적절한 곳 1곳을 추천하고, 한두 문장으로 캐주얼하게 이유를 설명하세요.

오늘 날씨: ${ctx.weather ?? "정보 없음"}
최근에 다녀온 식당(가능하면 피하기): ${ctx.recentRestaurantNames.join(", ") || "없음"}

후보 목록:
${ctx.candidates.map((r) => `- ${r.name} (${r.category ?? "카테고리 미정"})`).join("\n")}

응답 형식(JSON): {"restaurantName": string, "reason": string}
`.trim();

  return callGemini(prompt, { jsonMode: true });
}

/**
 * 리뷰 여러 개를 한 줄 요약 + 분위기 태그로 정리.
 * 예: "웨이팅 있음(12시 전 방문 추천)", "부장님 모시고 가기 좋음"
 */
export async function summarizeReviews(reviewTexts: string[]) {
  if (reviewTexts.length === 0) return { summary: "", tags: [] as string[] };
  const prompt = `
다음은 한 식당에 대한 사내 리뷰들입니다. 핵심을 한 줄로 요약하고, 분위기를 나타내는 짧은 태그 2~4개를 뽑아주세요.
JSON 형식으로만 답하세요: {"summary": string, "tags": string[]}

리뷰:
${reviewTexts.map((t, i) => `${i + 1}. ${t}`).join("\n")}
`.trim();

  return callGemini(prompt, { jsonMode: true });
}
