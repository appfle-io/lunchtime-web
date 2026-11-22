import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { isAdminUser } from "@/lib/admin-server";
import { db } from "@/lib/firebase";
import { listRestaurants } from "@/lib/restaurant-server";
import { zeroPayCheckFields } from "@/lib/enrich-server";
import {
  checkZeroPayOfficialWithTrace,
  type TraceStep,
  type ZeroPayCandidate,
  type ZeroPayCheckStatus,
} from "@/lib/zeropay-official";

// 큰 건물은 한 곳 확인에 수십 초가 걸릴 수 있어 한 번의 요청에서 처리할 시간을 제한하고,
// 남은 가맹점은 응답의 unprocessedIds로 돌려줘 화면이 이어서 요청하게 한다.
export const maxDuration = 60;
const TIME_BUDGET_MS = 40_000;
const CONCURRENCY = 3;

async function requireAdmin(companyCode: string) {
  const sessionToken = cookies().get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(sessionToken);
  if (!session || session.companyCode !== companyCode) return null;
  const admin = await isAdminUser(companyCode, session.nicknameId);
  if (!admin) return null;
  return session;
}

export interface ZeroPayAuditDiffItem {
  id: string;
  name: string;
  address: string;
  currentIsZeroPay: boolean;
  proposedIsZeroPay: boolean;
  currentOfficialName: string | null;
  proposedOfficialName: string | null;
  currentOfficialAddress: string | null;
  proposedOfficialAddress: string | null;
  /** high: 공식 사이트에서 확정 -> 기본 반영 / review: 관리자가 직접 체크해야 반영 */
  confidence: "high" | "review";
  checkStatus: ZeroPayCheckStatus;
  candidates?: Pick<ZeroPayCandidate, "name" | "address" | "bizType" | "reason">[];
  patch: Record<string, unknown>;
  reason: string;
}

export interface ZeroPayAuditLogItem {
  storeId: string;
  storeName: string;
  address: string;
  status: "match_success" | "match_fail" | "mismatch_fixed" | "unchanged" | "error";
  summary: string;
  steps: TraceStep[];
  diff?: ZeroPayAuditDiffItem;
}

// POST /api/admin/zeropay/check-all
// body: { companyCode, targetIds?: string[], mode?: "plan" }
// - mode: "plan"  -> 점검할 가맹점 id 목록만 돌려준다 (서버 캐시 사용, Firestore 전체 읽기 없음)
// - targetIds     -> 해당 가맹점들을 제로페이 공식 사이트 기준으로 판정해 변경 제안(diff)을 스트리밍한다.
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

        sendEvent({ type: "start", total: docs.length, companyCode, message: `제로페이 점검 (${docs.length}곳)` });

        const diffs: ZeroPayAuditDiffItem[] = [];
        const processed = new Set<string>();
        let next = 0;
        let doneCount = 0;

        const worker = async () => {
          while (next < docs.length) {
            if (Date.now() - startedAt > TIME_BUDGET_MS) return; // 남은 건 다음 요청으로
            const doc = docs[next++];
            const log = await auditOne(doc.id, doc.data() ?? {});
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
          message: `제로페이 점검 ${processed.size}곳 완료 (변경 제안 ${diffs.length}건)`,
        });
      } catch (err) {
        sendEvent({ type: "error", error: (err as Error).message ?? "제로페이 점검 중 오류가 발생했습니다." });
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

async function auditOne(id: string, data: Record<string, unknown>): Promise<ZeroPayAuditLogItem> {
  const name = (data.name as string) ?? "";
  const address = (data.address as string) ?? "";
  const currentIsZeroPay = Boolean(data.isZeroPay);
  const source = (data.zeroPaySource as string | undefined) ?? null;
  const currentOfficialName = (data.zeroPayOfficialName as string | undefined) ?? null;
  const currentOfficialAddress = (data.zeroPayOfficialAddress as string | undefined) ?? null;

  const base = { storeId: id, storeName: name, address };

  if (source === "manual") {
    return {
      ...base,
      status: "unchanged",
      summary: `관리자가 직접 설정한 값 유지 (제로페이 ${currentIsZeroPay ? "지원" : "미지원"})`,
      steps: [{ step: "판정 생략", status: "skip", message: "관리자 수동 설정은 점검에서 바꾸지 않습니다." }],
    };
  }

  let trace;
  try {
    trace = await checkZeroPayOfficialWithTrace({ name, address, phone: (data.phone as string | undefined) ?? null });
  } catch (err) {
    return {
      ...base,
      status: "error",
      summary: `조회 오류: ${(err as Error).message}`,
      steps: [{ step: "공식 사이트 조회", status: "fail", message: (err as Error).message }],
    };
  }

  const { result, steps } = trace;
  const checkFields = zeroPayCheckFields(result, { isZeroPay: currentIsZeroPay, zeroPaySource: source });
  const diffBase = {
    id,
    name,
    address,
    currentIsZeroPay,
    currentOfficialName,
    currentOfficialAddress,
    checkStatus: result.status,
  };

  if (result.status === "error") {
    return { ...base, status: "error", summary: `판정 보류: ${result.message}`, steps };
  }

  if (result.status === "confirmed") {
    if (currentIsZeroPay && currentOfficialName === (result.officialName ?? null)) {
      return { ...base, status: "match_success", summary: `제로페이 가맹점 확인: '${result.officialName}'`, steps };
    }
    const diff: ZeroPayAuditDiffItem = {
      ...diffBase,
      proposedIsZeroPay: true,
      proposedOfficialName: result.officialName ?? null,
      proposedOfficialAddress: result.officialAddress ?? null,
      confidence: "high",
      patch: checkFields,
      reason: currentIsZeroPay
        ? `공식 등록 정보 갱신: '${result.officialName}'`
        : `제로페이 공식 사이트에서 확인: '${result.officialName}' (${result.officialAddress ?? ""})`,
    };
    return {
      ...base,
      status: currentIsZeroPay ? "match_success" : "mismatch_fixed",
      summary: diff.reason,
      steps,
      diff,
    };
  }

  if (result.status === "review") {
    const candidates = (result.candidates ?? []).slice(0, 5).map((c) => ({
      name: c.name,
      address: c.address,
      bizType: c.bizType,
      reason: c.reason,
    }));
    if (currentIsZeroPay) {
      return {
        ...base,
        status: "match_success",
        summary: `현재 지원 유지 (확정 근거는 부족, 후보: ${candidates.map((c) => c.name).join(", ")})`,
        steps,
      };
    }
    const first = result.candidates?.[0];
    const diff: ZeroPayAuditDiffItem = {
      ...diffBase,
      proposedIsZeroPay: true,
      proposedOfficialName: first?.name ?? null,
      proposedOfficialAddress: first?.address ?? null,
      confidence: "review",
      candidates,
      patch: {
        ...checkFields,
        isZeroPay: true,
        zeroPaySource: "official_review_confirmed",
        zeroPayOfficialName: first?.name ?? null,
        zeroPayOfficialAddress: first?.address ?? null,
        zeroPayEnrichedAt: new Date().toISOString(),
      },
      reason: `관리자 확인 필요 - ${result.message}`,
    };
    return { ...base, status: "match_fail", summary: diff.reason, steps, diff };
  }

  // not_found
  if (!currentIsZeroPay) {
    return { ...base, status: "unchanged", summary: "제로페이 미가맹 확인", steps };
  }
  const diff: ZeroPayAuditDiffItem = {
    ...diffBase,
    proposedIsZeroPay: false,
    proposedOfficialName: null,
    proposedOfficialAddress: null,
    confidence: "review",
    patch: {
      ...checkFields,
      isZeroPay: false,
      zeroPaySource: "official_not_found",
      zeroPayOfficialName: null,
      zeroPayOfficialAddress: null,
      zeroPayEnrichedAt: new Date().toISOString(),
    },
    reason: `현재 '지원'인데 공식 사이트에서 찾지 못함${currentOfficialName ? ` (기존 매칭: '${currentOfficialName}')` : ""} - ${result.message}`,
  };
  return { ...base, status: "match_fail", summary: diff.reason, steps, diff };
}
