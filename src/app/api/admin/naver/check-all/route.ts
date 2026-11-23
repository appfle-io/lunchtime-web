import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { isAdminUser } from "@/lib/admin-server";
import { getCompanyByCode } from "@/lib/company-server";
import { db } from "@/lib/firebase";
import { listRestaurants } from "@/lib/restaurant-server";
import { judgeNaverPlaceMatch } from "@/lib/naver-match";
import { findVerifiedNaverPlace, naverClearFields, naverFieldsFromDetails } from "@/lib/naver-verify";
import type { TraceStep } from "@/lib/zeropay-official";

// 한 곳 확인에 네이버 요청이 1~4번 생긴다. 한 번의 요청에서 처리할 시간을 제한하고,
// 남은 가맹점은 응답의 unprocessedIds로 돌려줘 화면이 이어서 요청하게 한다 (제로페이 점검과 같은 방식).
export const maxDuration = 60;
const TIME_BUDGET_MS = 40_000;
const CONCURRENCY = 2;

async function requireAdmin(companyCode: string) {
  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);
  if (!session || session.companyCode !== companyCode) return null;
  const admin = await isAdminUser(companyCode, session.nicknameId);
  if (!admin) return null;
  return session;
}

export interface NaverRefreshDiffItem {
  id: string;
  name: string;
  address: string;
  currentPhone: string | null;
  proposedPhone: string | null;
  currentNaverMatchedName: string | null;
  proposedNaverMatchedName: string | null;
  currentNaverMatchedAddress: string | null;
  proposedNaverMatchedAddress: string | null;
  patch: Record<string, unknown>;
  reason: string;
  // review: 다른 가게 정보를 지우는 제안. 관리자가 체크한 것만 반영된다.
  confidence: "high" | "review";
}

export interface NaverAuditLogItem {
  storeId: string;
  storeName: string;
  address: string;
  status: "match_success" | "match_fail" | "mismatch_fixed" | "unchanged" | "error";
  summary: string;
  steps: TraceStep[];
  diff?: NaverRefreshDiffItem;
}

// POST /api/admin/naver/check-all
// body: { companyCode, targetIds?: string[], mode?: "plan" }
// - mode: "plan"  -> 점검할 가맹점 id 목록만 돌려준다 (서버 캐시 사용, Firestore 전체 읽기 없음)
// - targetIds     -> 해당 가맹점의 네이버 플레이스가 같은 가게인지 확인하고 변경 제안(diff)을 스트리밍한다.
//                    DB는 바꾸지 않는다. 반영은 /api/admin/batch-update.
export async function POST(request: NextRequest) {
  let body: { companyCode?: string; targetIds?: string[]; mode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, targetIds, mode } = body;
  if (!companyCode) {
    return NextResponse.json({ error: "companyCode가 필요합니다." }, { status: 400 });
  }

  const session = await requireAdmin(companyCode);
  if (!session) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  if (mode === "plan") {
    const all = await listRestaurants(companyCode);
    return NextResponse.json({ ids: all.map((r) => r.id) });
  }

  if (!Array.isArray(targetIds) || targetIds.length === 0) {
    return NextResponse.json({ error: "targetIds가 필요합니다." }, { status: 400 });
  }
  const ids = Array.from(new Set(targetIds.filter((id) => typeof id === "string" && id))).slice(0, 100);

  const company = await getCompanyByCode(companyCode);
  const districtKeyword = (company?.districtCode ?? "").replace(/(구|시|군)$/, "").trim() || undefined;

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
      };

      try {
        const col = db.collection("companies").doc(companyCode).collection("restaurants");
        const snaps = await db.getAll(...ids.map((id) => col.doc(id)));
        const docs = snaps.filter((s) => s.exists);

        sendEvent({ type: "start", total: docs.length, companyCode, message: `네이버 정보 점검 (${docs.length}곳)` });

        const diffs: NaverRefreshDiffItem[] = [];
        const processed = new Set<string>();
        let next = 0;
        let doneCount = 0;

        const worker = async () => {
          while (next < docs.length) {
            if (Date.now() - startedAt > TIME_BUDGET_MS) return; // 남은 건 다음 요청으로
            const doc = docs[next++];
            const log = await auditOne(doc.id, doc.data() ?? {}, districtKeyword);
            processed.add(doc.id);
            doneCount++;
            if (log.diff) diffs.push(log.diff);
            sendEvent({ type: "progress", current: doneCount, total: docs.length, log, diff: log.diff });
          }
        };
        await Promise.all(Array.from({ length: CONCURRENCY }, worker));

        sendEvent({
          type: "done",
          totalChecked: processed.size,
          diffs,
          unprocessedIds: ids.filter((id) => !processed.has(id) && docs.some((d) => d.id === id)),
          message: `네이버 정보 점검 ${processed.size}곳 완료 (변경 제안 ${diffs.length}건)`,
        });
      } catch (err) {
        sendEvent({ type: "error", error: (err as Error).message ?? "네이버 정보 점검 중 오류가 발생했습니다." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

async function auditOne(
  id: string,
  data: Record<string, unknown>,
  districtKeyword: string | undefined
): Promise<NaverAuditLogItem> {
  const name = (data.name as string) ?? "";
  const address = (data.address as string) ?? "";
  const currentPhone = (data.phone as string | null | undefined) ?? null;
  const currentPlaceId = (data.naverPlaceId as string | null | undefined) ?? null;
  const currentName = (data.naverMatchedName as string | null | undefined) ?? null;
  const currentAddress = (data.naverMatchedAddress as string | null | undefined) ?? null;
  const currentMenus = Array.isArray(data.menus) ? data.menus : [];
  const hasNaverData = Boolean(currentPlaceId || currentName || data.naverPlaceUrl);

  const base = { storeId: id, storeName: name, address };
  const steps: TraceStep[] = [];
  const diffBase = {
    id,
    name,
    address,
    currentPhone,
    currentNaverMatchedName: currentName,
    currentNaverMatchedAddress: currentAddress,
  };

  let naver;
  try {
    naver = await findVerifiedNaverPlace(
      {
        name,
        address,
        naverPlaceId: currentPlaceId,
        naverPlaceUrl: (data.naverPlaceUrl as string | null | undefined) ?? null,
        naverMatchStatus: (data.naverMatchStatus as string | null | undefined) ?? null,
      },
      { districtKeyword, steps }
    );
  } catch (err) {
    return { ...base, status: "error", summary: `네이버 조회 오류: ${(err as Error).message}`, steps };
  }

  if (naver.status === null) {
    return { ...base, status: "error", summary: `네이버 조회 실패 (${naver.reason}), 기존 정보 유지`, steps };
  }

  if (naver.details && (naver.status === "verified" || naver.status === "manual")) {
    const d = naver.details;
    const patch: Record<string, unknown> = {
      ...(naver.existingRejected ? naverClearFields(naver.reason) : {}),
      ...naverFieldsFromDetails(d, naver.status, naver.reason),
    };
    const changes: string[] = [];
    if (naver.existingRejected) changes.push(`다른 가게 정보 교체 ('${currentName ?? currentPlaceId}' → '${d.matchedName}')`);
    else if (currentPlaceId !== d.naverPlaceId) changes.push(`플레이스 연결 '${d.matchedName}'`);
    if (d.phone && d.phone !== currentPhone) changes.push(`전화번호 ${currentPhone ?? "(없음)"} → ${d.phone}`);
    if (d.menus.length > 0 && d.menus.length !== currentMenus.length) changes.push(`메뉴 ${currentMenus.length}개 → ${d.menus.length}개`);
    if (!naver.existingRejected && d.matchedName && d.matchedName !== currentName) changes.push(`네이버 상호 '${d.matchedName}'`);

    if (changes.length === 0) {
      return { ...base, status: "unchanged", summary: `같은 가게 확인 (${naver.reason}), 바뀐 정보 없음`, steps };
    }
    const diff: NaverRefreshDiffItem = {
      ...diffBase,
      proposedPhone: d.phone ?? currentPhone,
      proposedNaverMatchedName: d.matchedName || null,
      proposedNaverMatchedAddress: d.matchedAddress || null,
      patch,
      reason: changes.join(", "),
      confidence: "high",
    };
    return {
      ...base,
      status: naver.existingRejected ? "mismatch_fixed" : "match_success",
      summary: changes.join(", "),
      steps,
      diff,
    };
  }

  // 같은 가게를 못 찾음. 붙어 있는 네이버 정보가 다른 가게 것으로 보이면 지우는 제안을 올린다 (체크한 것만 반영).
  // 플레이스 ID 없이 이름만 붙어 있는 옛 데이터도 같은 기준으로 확인한다.
  const legacyNameRejected =
    !currentPlaceId &&
    Boolean(currentName) &&
    judgeNaverPlaceMatch({ name, address }, { name: currentName ?? "", address: currentAddress ?? "" }).verdict ===
      "mismatch";
  if (hasNaverData && (naver.existingRejected || legacyNameRejected)) {
    const diff: NaverRefreshDiffItem = {
      ...diffBase,
      proposedPhone: null,
      proposedNaverMatchedName: null,
      proposedNaverMatchedAddress: null,
      patch: naverClearFields(naver.reason),
      reason: `다른 가게 정보로 보여 네이버 정보(전화, 영업시간, 메뉴 등)를 지움 - ${naver.reason}`,
      confidence: "review",
    };
    return { ...base, status: "mismatch_fixed", summary: `다른 가게 정보로 보임: ${naver.reason}`, steps, diff };
  }

  return { ...base, status: "match_fail", summary: `같은 가게로 확인된 네이버 플레이스 없음 (${naver.reason})`, steps };
}
