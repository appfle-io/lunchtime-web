import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { isAdminUser } from "@/lib/admin-server";
import { db } from "@/lib/firebase";
import { validateBrandMatch, checkZeroPayOfficialWithTrace, type TraceStep } from "@/lib/zeropay-official";

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
  patch: {
    isZeroPay: boolean;
    zeroPayOfficialName: string | null;
    zeroPayOfficialAddress: string | null;
    zeroPaySource?: string;
    zeroPayEnrichedAt?: string;
  };
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

export async function POST(request: NextRequest) {
  let body: { companyCode?: string; targetIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다." }, { status: 400 });
  }

  const { companyCode, targetIds } = body;
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

        const diffs: ZeroPayAuditDiffItem[] = [];
        const total = docsToScan.length;

        sendEvent({
          type: "start",
          total,
          companyCode,
          message: `제로페이 가맹점 점검 시작 (총 ${total}개 가맹점 대상)`,
        });

        for (let i = 0; i < total; i++) {
          const doc = docsToScan[i];
          const data = doc.data();
          const id = doc.id;
          const name = (data.name as string) ?? "";
          const address = (data.address as string) ?? "";
          const currentIsZeroPay = Boolean(data.isZeroPay);
          const currentOfficialName = (data.zeroPayOfficialName as string) ?? (data.naverMatchedName as string) ?? null;
          const currentOfficialAddress = (data.zeroPayOfficialAddress as string) ?? (data.naverMatchedAddress as string) ?? null;

          const steps: TraceStep[] = [];
          let logStatus: ZeroPayAuditLogItem["status"] = "unchanged";
          let logSummary = "제로페이 상태 일치 (변경 없음)";
          let diffItem: ZeroPayAuditDiffItem | undefined;

          // 1. 기존 DB 브랜드 불일치 오매칭 정합성 검증
          let hasExistingMismatch = false;
          if (currentIsZeroPay && currentOfficialName) {
            const isBrandValid = validateBrandMatch(name, currentOfficialName);
            if (!isBrandValid) {
              hasExistingMismatch = true;
              diffItem = {
                id,
                name,
                address,
                currentIsZeroPay: true,
                proposedIsZeroPay: false,
                currentOfficialName,
                proposedOfficialName: null,
                currentOfficialAddress,
                proposedOfficialAddress: null,
                patch: {
                  isZeroPay: false,
                  zeroPayOfficialName: null,
                  zeroPayOfficialAddress: null,
                  zeroPaySource: "audit_cleared",
                  zeroPayEnrichedAt: new Date().toISOString(),
                },
                reason: `브랜드 상호 불일치 오매칭 (DB: '${name}' != 제로페이: '${currentOfficialName}')`,
              };
              logStatus = "mismatch_fixed";
              logSummary = `⚠️ 기존 오매칭 감지: DB '${name}' ↔ 제로페이 '${currentOfficialName}' 불일치 ➔ 제로페이 미지원으로 수정`;
              steps.push({
                step: "기존 DB 정합성 검증",
                status: "fail",
                message: `기존 등록된 제로페이 상호 '${currentOfficialName}'가 DB 상호 '${name}'과 브랜드 불일치하여 오매칭 판정됨`,
                details: { dbName: name, officialName: currentOfficialName },
              });
            }
          }

          if (!hasExistingMismatch && !currentIsZeroPay && data.zeroPayOfficialName) {
            const isBrandValid = validateBrandMatch(name, data.zeroPayOfficialName as string);
            if (!isBrandValid) {
              hasExistingMismatch = true;
              diffItem = {
                id,
                name,
                address,
                currentIsZeroPay: false,
                proposedIsZeroPay: false,
                currentOfficialName: data.zeroPayOfficialName as string,
                proposedOfficialName: null,
                currentOfficialAddress: (data.zeroPayOfficialAddress as string) ?? null,
                proposedOfficialAddress: null,
                patch: {
                  isZeroPay: false,
                  zeroPayOfficialName: null,
                  zeroPayOfficialAddress: null,
                  zeroPaySource: "audit_cleared",
                  zeroPayEnrichedAt: new Date().toISOString(),
                },
                reason: "오매칭 찌꺼기 텍스트 필드 삭제 정리",
              };
              logStatus = "mismatch_fixed";
              logSummary = `⚠️ 오매칭 찌꺼기 텍스트 정리: '${data.zeroPayOfficialName}' 필드 초기화`;
              steps.push({
                step: "기존 DB 정합성 검증",
                status: "fail",
                message: `미지원 매장에 남아있던 이전 공식상호 '${data.zeroPayOfficialName}' 찌꺼기 삭제`,
                details: { dbName: name, leftoverName: data.zeroPayOfficialName },
              });
            }
          }

          // 2. 제로페이 공식 사이트 실시간 조회 (선택 검사이거나, 미지원 가맹점인 경우)
          if (!hasExistingMismatch) {
            try {
              const zpTrace = await checkZeroPayOfficialWithTrace(name, address);
              zpTrace.steps.forEach((s) => steps.push(s));

              if (zpTrace.result.isZeroPay && zpTrace.result.officialName) {
                if (!currentIsZeroPay) {
                  diffItem = {
                    id,
                    name,
                    address,
                    currentIsZeroPay: false,
                    proposedIsZeroPay: true,
                    currentOfficialName: null,
                    proposedOfficialName: zpTrace.result.officialName,
                    currentOfficialAddress: null,
                    proposedOfficialAddress: zpTrace.result.officialAddress ?? null,
                    patch: {
                      isZeroPay: true,
                      zeroPayOfficialName: zpTrace.result.officialName,
                      zeroPayOfficialAddress: zpTrace.result.officialAddress ?? null,
                      zeroPaySource: "official_zeropay_api",
                      zeroPayEnrichedAt: new Date().toISOString(),
                    },
                    reason: `제로페이 공식 사이트 실시간 조회 매칭 성공 ('${zpTrace.result.officialName}')`,
                  };
                  logStatus = "match_success";
                  logSummary = `✅ 제로페이 공식 가맹점 매칭 성공: '${zpTrace.result.officialName}' (주소: ${zpTrace.result.officialAddress ?? "일치"})`;
                } else {
                  logStatus = "match_success";
                  logSummary = `✅ 제로페이 가맹점 상태 확인 완료: '${zpTrace.result.officialName}' (현재 상태 유지)`;
                }
              } else {
                if (currentIsZeroPay) {
                  logStatus = "match_fail";
                  logSummary = `❌ 제로페이 공식 사이트 조회 결과 일치 가맹점 없음 (사유: ${zpTrace.failedReason ?? "미발견"})`;
                } else {
                  logStatus = "unchanged";
                  logSummary = `ℹ️ 제로페이 미지원 확인 (시도한 검색어에서 일치 항목 없음)`;
                }
              }
            } catch (zpErr) {
              logStatus = "error";
              logSummary = `오류 발생: ${(zpErr as Error).message}`;
              steps.push({
                step: "공식 사이트 조회",
                status: "fail",
                message: `조회 예외: ${(zpErr as Error).message}`,
              });
            }
          }

          if (diffItem) {
            diffs.push(diffItem);
          }

          const logItem: ZeroPayAuditLogItem = {
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
          message: `제로페이 점검 완료 (총 ${total}개 중 ${diffs.length}개 변경 항목 발견)`,
        });
      } catch (err) {
        sendEvent({
          type: "error",
          error: (err as Error).message ?? "제로페이 점검 중 오류가 발생했습니다.",
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
