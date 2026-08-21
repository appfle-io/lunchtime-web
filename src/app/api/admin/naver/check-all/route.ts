import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { isAdminUser } from "@/lib/admin-server";
import { db } from "@/lib/firebase";
import { validateBrandMatch, type TraceStep } from "@/lib/zeropay-official";
import { enrichRestaurantByIdWithTrace } from "@/lib/enrich-server";

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
  patch: {
    phone?: string;
    naverMatchedName?: string | null;
    naverMatchedAddress?: string | null;
    category?: string;
    categoryLabel?: string | null;
    naverPlaceUrl?: string | null;
    businessHours?: string | null;
    facilities?: string[];
    paymentMethods?: string[];
    menus?: any[];
    isZeroPay?: boolean;
    naverEnrichedAt?: string;
  };
  reason: string;
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

export async function POST(request: NextRequest) {
  let body: { companyCode?: string; limit?: number; targetIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, limit = 50, targetIds } = body;
  if (!companyCode) {
    return NextResponse.json({ error: "companyCode가 필요합니다." }, { status: 400 });
  }

  const session = await requireAdmin(companyCode);
  if (!session) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(data: Record<string, any>) {
        controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
      }

      try {
        const snap = await db
          .collection("companies")
          .doc(companyCode)
          .collection("restaurants")
          .get();

        const targetSet = targetIds && targetIds.length > 0 ? new Set(targetIds) : null;
        const docsToScan = targetSet ? snap.docs.filter((d) => targetSet.has(d.id)) : snap.docs;

        const pendingDocs = docsToScan
          .filter((d) => {
            const data = d.data();
            return !data.phone || !data.naverMatchedName || !data.naverEnrichedAt;
          })
          .slice(0, limit);

        const docsToProcess = targetSet
          ? docsToScan
          : pendingDocs.length > 0
          ? pendingDocs
          : docsToScan.slice(0, limit);

        const diffs: NaverRefreshDiffItem[] = [];
        const total = docsToProcess.length;

        sendEvent({
          type: "start",
          total,
          companyCode,
          message: `네이버 정보 갱신 점검 시작 (총 ${total}개 가맹점 대상)`,
        });

        for (let i = 0; i < total; i++) {
          const doc = docsToProcess[i];
          const data = doc.data();
          const id = doc.id;
          const name = (data.name as string) ?? "";
          const address = (data.address as string) ?? "";
          const currentPhone = (data.phone as string) ?? null;
          const currentNaverMatchedName = (data.naverMatchedName as string) ?? null;
          const currentNaverMatchedAddress = (data.naverMatchedAddress as string) ?? null;

          const steps: TraceStep[] = [];
          let logStatus: NaverAuditLogItem["status"] = "unchanged";
          let logSummary = "네이버 정보 최신 상태";
          let diffItem: NaverRefreshDiffItem | undefined;

          // 1. 기존 DB 브랜드 불일치 오매칭 감지
          let hasExistingMismatch = false;
          if (currentNaverMatchedName) {
            const isBrandValid = validateBrandMatch(name, currentNaverMatchedName);
            if (!isBrandValid) {
              hasExistingMismatch = true;
              diffItem = {
                id,
                name,
                address,
                currentPhone,
                proposedPhone: currentPhone,
                currentNaverMatchedName,
                proposedNaverMatchedName: null,
                currentNaverMatchedAddress,
                proposedNaverMatchedAddress: null,
                patch: {
                  naverMatchedName: null,
                  naverMatchedAddress: null,
                  naverEnrichedAt: new Date().toISOString(),
                },
                reason: `네이버 브랜드 상호 불일치 오매칭 (DB: '${name}' != 네이버: '${currentNaverMatchedName}') ➔ 오매칭 초기화`,
              };
              logStatus = "mismatch_fixed";
              logSummary = `⚠️ 기존 네이버 오매칭 감지: '${currentNaverMatchedName}' 불일치 ➔ 초기화`;
              steps.push({
                step: "기존 DB 정합성 검증",
                status: "fail",
                message: `기존 네이버 매칭명 '${currentNaverMatchedName}'가 DB 상호 '${name}'과 브랜드 불일치하여 오매칭 판정됨`,
                details: { dbName: name, naverMatchedName: currentNaverMatchedName },
              });
            }
          }

          // 2. 네이버 플레이스 상세 수집기 실행 (saveToDb: false로 점검 모드 실행)
          try {
            const { enrichResult, steps: enrichSteps, changesSummary } = await enrichRestaurantByIdWithTrace(
              companyCode,
              id,
              { saveToDb: false }
            );

            enrichSteps.forEach((s) => steps.push(s));
            const newRest = enrichResult.restaurant;

            const proposedPhone = newRest.phone ?? null;
            const proposedNaverMatchedName = newRest.naverMatchedName ?? null;
            const proposedNaverMatchedAddress = newRest.address ?? null;
            const proposedMenus = newRest.menus ?? [];

            const patch: NaverRefreshDiffItem["patch"] = {
              phone: proposedPhone || undefined,
              naverMatchedName: proposedNaverMatchedName,
              naverPlaceUrl: newRest.naverPlaceUrl ?? null,
              categoryLabel: newRest.categoryLabel ?? null,
              businessHours: newRest.businessHours ? (typeof newRest.businessHours === "string" ? newRest.businessHours : JSON.stringify(newRest.businessHours)) : null,
              facilities: newRest.facilities ?? [],
              paymentMethods: newRest.paymentMethods ?? [],
              menus: proposedMenus,
              isZeroPay: newRest.isZeroPay,
              naverEnrichedAt: new Date().toISOString(),
            };

            if (changesSummary.length > 0) {
              diffItem = {
                id,
                name,
                address,
                currentPhone,
                proposedPhone,
                currentNaverMatchedName,
                proposedNaverMatchedName,
                currentNaverMatchedAddress,
                proposedNaverMatchedAddress,
                patch,
                reason: changesSummary.join(", "),
              };
              logStatus = "match_success";
              logSummary = `✅ 정보 갱신 항목 발견: ${changesSummary.join(", ")}`;
            } else if (targetSet) {
              diffItem = {
                id,
                name,
                address,
                currentPhone,
                proposedPhone,
                currentNaverMatchedName,
                proposedNaverMatchedName,
                currentNaverMatchedAddress,
                proposedNaverMatchedAddress,
                patch,
                reason: "네이버 플레이스 최신 정보 동기화",
              };
              logStatus = "match_success";
              logSummary = `✅ 네이버 플레이스 최신 정보 확인 완료 (전화번호: ${proposedPhone ?? "없음"}, 메뉴: ${proposedMenus.length}개)`;
            } else {
              logStatus = "unchanged";
              logSummary = `ℹ️ 최신 정보와 일치 (변경 항목 없음)`;
            }
          } catch (enrichErr) {
            logStatus = "error";
            logSummary = `수집 중 오류 발생: ${(enrichErr as Error).message}`;
            steps.push({
              step: "네이버 플레이스 수집",
              status: "fail",
              message: `수집 실패: ${(enrichErr as Error).message}`,
            });
          }

          if (diffItem) {
            diffs.push(diffItem);
          }

          const logItem: NaverAuditLogItem = {
            storeId: id,
            storeName: name,
            address,
            status: logStatus,
            summary: logSummary,
            steps,
            diff: diffItem,
          };

          sendEvent({
            type: "progress",
            current: i + 1,
            total,
            log: logItem,
            diff: diffItem,
          });
        }

        sendEvent({
          type: "done",
          totalChecked: total,
          diffs,
          message: `네이버 정보 갱신 점검 완료 (총 ${total}개 중 ${diffs.length}개 변경 항목 발견)`,
        });
      } catch (err) {
        sendEvent({
          type: "error",
          error: (err as Error).message ?? "네이버 정보 갱신 점검 중 오류가 발생했습니다.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}
