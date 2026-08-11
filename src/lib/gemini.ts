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
// 2026-08-11: gemini-2.5-flash-lite가 "신규 사용자에게는 더 이상 제공되지 않는 모델"이 되어
// (밥시간의 Gemini API 키는 packinbag보다 나중에 새로 발급받은 신규 프로젝트라 이 모델에 접근이
// 막혀 있었음 - 404 "is no longer available to new users" 응답으로 확인됨) gemini-3.5-flash-lite로
// 교체함. scripts/classify-categories-ai.ts는 이미 같은 이유로 다른 세션에서 먼저 고쳐져 있었는데
// (그쪽 파일의 GEMINI_MODEL 상수), 이 파일(lib/gemini.ts)의 DEFAULT_MODEL은 그때 같이 안 바뀌어서
// "오늘 뭐 먹지?" 추천(recommendLunch)만 계속 404가 나고 있었던 것 - 이제 두 곳 다 통일함.
const DEFAULT_MODEL = "gemini-3.5-flash-lite";

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
  recentRestaurantNames: string[]; // 최근 방문 이력 (회피 추천용) - 나 혼자일 때도, 친구를 초대했을 때는
  // 참가자 전원의 최근 방문 이력을 합친 것일 수도 있다 (아래 participantCount 참고).
  candidates: RestaurantSummary[];
  // 2026-08-08 신규: "오늘 뭐 먹지?" 룰렛에 친구를 초대해서 같이 돌릴 수 있게 되면서, 이 추천이
  // 몇 명을 위한 것인지도 Gemini에게 알려준다 - recentRestaurantNames가 이제 나 혼자만의 이력이
  // 아니라 초대된 사람들 전원의 최근 방문을 합친 것이라는 맥락을 주고, 인원이 많으면(3명 이상)
  // 여러 명이 함께 가기 좋은 곳(자리가 넉넉한 곳 등)을 더 고려해달라고 넌지시 알려주기 위함.
  participantCount?: number;
}

/**
 * "오늘의 추천" - 날씨/최근 이력을 고려해 후보 중 하나를 추천하고 이유를 짧게 설명.
 */
export async function recommendLunch(ctx: RecommendationContext) {
  const participantCount = ctx.participantCount ?? 1;
  const participantLine =
    participantCount <= 1
      ? "오늘은 혼자 먹어요."
      : `오늘은 총 ${participantCount}명이 함께 먹어요 - 최근 방문 이력은 이 사람들 전체를 합친 목록이니, 인원이 여럿이면 다 같이 가기 좋은 곳도 고려해주세요.`;

  const prompt = `
당신은 회사 동료들의 점심 메뉴를 추천해주는 재치있는 도우미입니다.
아래 후보 식당 중 오늘 점심으로 가장 적절한 곳 1곳을 추천하고, 한두 문장으로 캐주얼하게 이유를 설명하세요.

${participantLine}
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
