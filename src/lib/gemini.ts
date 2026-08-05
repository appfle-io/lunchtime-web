import { GoogleGenerativeAI } from "@google/generative-ai";
import type { RestaurantSummary } from "@/types";

// packinbag과는 별도의 Gemini API 키/프로젝트 사용을 권장 (사용량·과금 분리, 키 유출 시 영향 범위 최소화).
const apiKey = process.env.GEMINI_API_KEY;

function getModel() {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY가 설정되지 않았습니다. .env.local을 확인하세요.");
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
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
  const model = getModel();

  const prompt = `
당신은 회사 동료들의 점심 메뉴를 추천해주는 재치있는 도우미입니다.
아래 후보 식당 중 오늘 점심으로 가장 적절한 곳 1곳을 추천하고, 한두 문장으로 캐주얼하게 이유를 설명하세요.

오늘 날씨: ${ctx.weather ?? "정보 없음"}
최근에 다녀온 식당(가능하면 피하기): ${ctx.recentRestaurantNames.join(", ") || "없음"}

후보 목록:
${ctx.candidates.map((r) => `- ${r.name} (${r.category ?? "카테고리 미정"})`).join("\n")}

응답 형식(JSON): {"restaurantName": string, "reason": string}
`.trim();

  const result = await model.generateContent(prompt);
  return result.response.text();
}

/**
 * 리뷰 여러 개를 한 줄 요약 + 분위기 태그로 정리.
 * 예: "웨이팅 있음(12시 전 방문 추천)", "부장님 모시고 가기 좋음"
 */
export async function summarizeReviews(reviewTexts: string[]) {
  if (reviewTexts.length === 0) return { summary: "", tags: [] as string[] };
  const model = getModel();
  const prompt = `
다음은 한 식당에 대한 사내 리뷰들입니다. 핵심을 한 줄로 요약하고, 분위기를 나타내는 짧은 태그 2~4개를 뽑아주세요.
JSON 형식으로만 답하세요: {"summary": string, "tags": string[]}

리뷰:
${reviewTexts.map((t, i) => `${i + 1}. ${t}`).join("\n")}
`.trim();

  const result = await model.generateContent(prompt);
  return result.response.text();
}
