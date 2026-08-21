"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TraceStep } from "@/lib/zeropay-official";

export interface AuditLogItem {
  storeId: string;
  storeName: string;
  address: string;
  status: "match_success" | "match_fail" | "mismatch_fixed" | "unchanged" | "error";
  summary: string;
  steps: TraceStep[];
  diff?: any;
}

interface AuditLogModalProps {
  open: boolean;
  type: "zeropay" | "naver";
  companyCode: string;
  targetIds?: string[];
  onClose: () => void;
  onApplyBatch: (diffs: any[]) => Promise<void>;
  isApplyingBatch?: boolean;
}

export default function AuditLogModal({
  open,
  type,
  companyCode,
  targetIds,
  onClose,
  onApplyBatch,
  isApplyingBatch = false,
}: AuditLogModalProps) {
  const [status, setStatus] = useState<"idle" | "running" | "completed" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [diffs, setDiffs] = useState<any[]>([]);
  const [filterTab, setFilterTab] = useState<"all" | "success" | "fail" | "diff">("all");
  const [filterQuery, setFilterQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedStoreIds, setExpandedStoreIds] = useState<Set<string>>(new Set());

  const logListRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 모달이 열리면 스트리밍 점검 시작
  useEffect(() => {
    if (!open) return;

    setStatus("running");
    setErrorMessage(null);
    setCurrent(0);
    setTotal(0);
    setLogs([]);
    setDiffs([]);
    setFilterTab("all");
    setFilterQuery("");
    setExpandedStoreIds(new Set());

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const endpoint = type === "zeropay" ? "/api/admin/zeropay/check-all" : "/api/admin/naver/check-all";

    async function startStream() {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyCode, targetIds }),
          signal: abortController.signal,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          setStatus("error");
          setErrorMessage(errData.error ?? "점검을 시작하지 못했습니다.");
          return;
        }

        if (!res.body) {
          setStatus("error");
          setErrorMessage("응답 스트림을 열 수 없습니다.");
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);

              if (event.type === "start") {
                setTotal(event.total ?? 0);
              } else if (event.type === "progress") {
                setCurrent(event.current ?? 0);
                if (event.total) setTotal(event.total);
                if (event.log) {
                  setLogs((prev) => [...prev, event.log]);
                }
                if (event.diff) {
                  setDiffs((prev) => [...prev, event.diff]);
                }
              } else if (event.type === "done") {
                if (event.diffs) setDiffs(event.diffs);
                setStatus("completed");
              } else if (event.type === "error") {
                setStatus("error");
                setErrorMessage(event.error ?? "점검 중 오류가 발생했습니다.");
              }
            } catch (parseErr) {
              console.warn("[AuditLogModal] 파싱 오류 라인:", line, parseErr);
            }
          }
        }

        setStatus("completed");
      } catch (err: any) {
        if (err.name === "AbortError") {
          return;
        }
        setStatus("error");
        setErrorMessage(err.message ?? "네트워크 오류로 점검이 중단되었습니다.");
      }
    }

    startStream();

    return () => {
      abortController.abort();
    };
  }, [open, type, companyCode, targetIds]);

  // 자동 스크롤
  useEffect(() => {
    if (autoScroll && logListRef.current) {
      logListRef.current.scrollTop = logListRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const toggleExpand = (storeId: string) => {
    setExpandedStoreIds((prev) => {
      const next = new Set(prev);
      if (next.has(storeId)) {
        next.delete(storeId);
      } else {
        next.add(storeId);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedStoreIds(new Set(logs.map((l) => l.storeId)));
  };

  const collapseAll = () => {
    setExpandedStoreIds(new Set());
  };

  // 필터링된 로그
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // 1. 탭 필터
      if (filterTab === "success") {
        if (log.status !== "match_success") return false;
      } else if (filterTab === "fail") {
        if (log.status !== "match_fail" && log.status !== "unchanged") return false;
      } else if (filterTab === "diff") {
        if (!log.diff) return false;
      }

      // 2. 검색어 필터
      if (filterQuery.trim()) {
        const q = filterQuery.trim().toLowerCase();
        const nameMatch = log.storeName.toLowerCase().includes(q);
        const addrMatch = log.address.toLowerCase().includes(q);
        const summaryMatch = log.summary.toLowerCase().includes(q);
        if (!nameMatch && !addrMatch && !summaryMatch) return false;
      }

      return true;
    });
  }, [logs, filterTab, filterQuery]);

  const stats = useMemo(() => {
    const successCount = logs.filter((l) => l.status === "match_success").length;
    const failCount = logs.filter((l) => l.status === "match_fail" || l.status === "unchanged").length;
    const diffCount = diffs.length;
    return { successCount, failCount, diffCount };
  }, [logs, diffs]);

  const copyLogsToClipboard = () => {
    const text = logs
      .map((l, i) => {
        const header = `[${i + 1}/${logs.length}] ${l.storeName} (${l.address}) ➔ ${l.summary}`;
        const stepsText = l.steps.map((s) => `   - [${s.status.toUpperCase()}] ${s.step}: ${s.message}`).join("\n");
        return `${header}\n${stepsText}`;
      })
      .join("\n\n");

    navigator.clipboard.writeText(text).then(() => {
      alert("전체 점검 로그가 클립보드에 복사되었습니다.");
    });
  };

  if (!open) return null;

  const title = type === "zeropay" ? "🛡️ 제로페이 가맹점 실시간 점검 로그" : "🔄 네이버 정보 실시간 갱신 로그";
  const progressPercent = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in"
      onClick={() => {
        if (status !== "running") onClose();
      }}
    >
      <div
        className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-zinc-950 text-zinc-100 shadow-2xl border border-zinc-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 상단 콘솔 헤더 */}
        <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/90 px-6 py-4">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-white flex items-center gap-2">{title}</h2>
            {status === "running" && (
              <span className="flex items-center gap-1.5 rounded-full bg-blue-500/20 px-2.5 py-0.5 text-xs font-semibold text-blue-400 border border-blue-500/30 animate-pulse">
                <span className="h-2 w-2 rounded-full bg-blue-400"></span>
                점검 진행 중 ({current}/{total}개 · {progressPercent}%)
              </span>
            )}
            {status === "completed" && (
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/30">
                ✓ 점검 완료 ({total}개 완료)
              </span>
            )}
            {status === "error" && (
              <span className="rounded-full bg-red-500/20 px-2.5 py-0.5 text-xs font-semibold text-red-400 border border-red-500/30">
                오류 발생
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* 진행률 바 */}
        <div className="h-1.5 w-full bg-zinc-800">
          <div
            className={`h-full transition-all duration-300 ${
              status === "error"
                ? "bg-red-500"
                : status === "completed"
                ? "bg-emerald-500"
                : "bg-gradient-to-r from-blue-500 to-emerald-400"
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* 컨트롤 & 필터 바 */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 bg-zinc-900/60 px-6 py-2.5 text-xs">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setFilterTab("all")}
              className={`rounded-lg px-2.5 py-1 font-medium transition ${
                filterTab === "all" ? "bg-zinc-700 text-white font-bold" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              전체 ({logs.length})
            </button>
            <button
              onClick={() => setFilterTab("success")}
              className={`rounded-lg px-2.5 py-1 font-medium transition ${
                filterTab === "success" ? "bg-emerald-600/30 text-emerald-300 font-bold border border-emerald-500/30" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              ✅ 매칭/갱신 ({stats.successCount})
            </button>
            <button
              onClick={() => setFilterTab("fail")}
              className={`rounded-lg px-2.5 py-1 font-medium transition ${
                filterTab === "fail" ? "bg-zinc-800 text-zinc-300 font-bold border border-zinc-700" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              ❌ 미지원/탈락 ({stats.failCount})
            </button>
            <button
              onClick={() => setFilterTab("diff")}
              className={`rounded-lg px-2.5 py-1 font-medium transition ${
                filterTab === "diff" ? "bg-amber-600/30 text-amber-300 font-bold border border-amber-500/30" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              ⚠️ 변경 Diff ({stats.diffCount})
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="🔍 가맹점/사유 검색"
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-white placeholder-zinc-500 outline-none focus:border-blue-500"
            />
            <button
              onClick={expandedStoreIds.size > 0 ? collapseAll : expandAll}
              className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700 transition"
            >
              {expandedStoreIds.size > 0 ? "모두 접기" : "모두 펼치기"}
            </button>
            <button
              onClick={copyLogsToClipboard}
              className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700 transition"
            >
              📋 로그 복사
            </button>
          </div>
        </div>

        {/* 메인 로그 뷰어 콘솔 */}
        <div ref={logListRef} className="flex-1 overflow-y-auto p-6 space-y-3 font-mono text-xs">
          {errorMessage && (
            <div className="rounded-xl border border-red-500/30 bg-red-950/40 p-4 text-red-300">
              <p className="font-bold">⚠️ 오류 발생</p>
              <p className="mt-1 text-xs">{errorMessage}</p>
            </div>
          )}

          {logs.length === 0 && !errorMessage && (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-500 space-y-3">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-500 border-t-blue-400"></div>
              <p className="text-sm">가맹점 정보를 조회하고 점검 파이프라인을 실행하는 중입니다...</p>
            </div>
          )}

          {filteredLogs.map((log, index) => {
            const isExpanded = expandedStoreIds.has(log.storeId);
            const isSuccess = log.status === "match_success";
            const isMismatchFixed = log.status === "mismatch_fixed";
            const isFail = log.status === "match_fail";
            const isError = log.status === "error";

            let borderColor = "border-zinc-800/80";
            let bgCard = "bg-zinc-900/70";
            let badgeBg = "bg-zinc-800 text-zinc-400 border-zinc-700";
            let badgeText = "ℹ️ 변경없음";

            if (isSuccess) {
              borderColor = "border-emerald-500/40";
              bgCard = "bg-emerald-950/20";
              badgeBg = "bg-emerald-500/20 text-emerald-400 border-emerald-500/40";
              badgeText = "✅ 매칭/갱신 성공";
            } else if (isMismatchFixed) {
              borderColor = "border-amber-500/40";
              bgCard = "bg-amber-950/20";
              badgeBg = "bg-amber-500/20 text-amber-400 border-amber-500/40";
              badgeText = "⚠️ 오매칭 감지 및 수정";
            } else if (isFail) {
              borderColor = "border-zinc-800";
              bgCard = "bg-zinc-900/50";
              badgeBg = "bg-zinc-800 text-zinc-400 border-zinc-700";
              badgeText = "❌ 매칭 실패 / 미지원";
            } else if (isError) {
              borderColor = "border-red-500/40";
              bgCard = "bg-red-950/20";
              badgeBg = "bg-red-500/20 text-red-400 border-red-500/40";
              badgeText = "⚠️ 오류";
            }

            return (
              <div
                key={log.storeId || index}
                className={`rounded-xl border ${borderColor} ${bgCard} p-3.5 transition hover:border-zinc-700`}
              >
                {/* 헤더 행 */}
                <div
                  className="flex items-start justify-between gap-3 cursor-pointer select-none"
                  onClick={() => toggleExpand(log.storeId)}
                >
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-white text-sm">{log.storeName}</span>
                      <span className="text-[11px] text-zinc-400">({log.address})</span>
                      <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${badgeBg}`}>
                        {badgeText}
                      </span>
                    </div>
                    <p className={`text-xs ${isSuccess ? "text-emerald-300" : isMismatchFixed ? "text-amber-300" : "text-zinc-300"}`}>
                      {log.summary}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded-lg bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-400 hover:bg-zinc-700 hover:text-white transition shrink-0"
                  >
                    {isExpanded ? "▲ 과정 접기" : "▼ 상세 과정 보기"}
                  </button>
                </div>

                {/* 아코디언 상세 단계별 로그 */}
                {isExpanded && (
                  <div className="mt-3.5 space-y-2 border-t border-zinc-800/80 pt-3 text-[11px]">
                    <p className="font-semibold text-zinc-400 text-[10px] tracking-wider uppercase">
                      🔍 탐색 및 검증 파이프라인 단계별 기록:
                    </p>
                    <div className="space-y-1.5 rounded-lg bg-zinc-950/80 p-3 border border-zinc-800">
                      {log.steps.length === 0 ? (
                        <p className="text-zinc-500 italic">기록된 상세 단계가 없습니다.</p>
                      ) : (
                        log.steps.map((step, sIdx) => {
                          let stepIcon = "ℹ️";
                          let stepColor = "text-zinc-300";
                          if (step.status === "pass") {
                            stepIcon = "🟢";
                            stepColor = "text-emerald-400 font-medium";
                          } else if (step.status === "fail") {
                            stepIcon = "🔴";
                            stepColor = "text-red-400";
                          } else if (step.status === "skip") {
                            stepIcon = "⚪";
                            stepColor = "text-zinc-500";
                          }

                          return (
                            <div key={sIdx} className="flex items-start gap-2">
                              <span className="shrink-0">{stepIcon}</span>
                              <div className="flex-1 space-y-0.5">
                                <span className="font-semibold text-zinc-400 mr-2">[{step.step}]</span>
                                <span className={stepColor}>{step.message}</span>
                                {step.details && (
                                  <pre className="mt-1 overflow-x-auto rounded bg-zinc-900 p-1.5 text-[10px] text-zinc-400 leading-tight">
                                    {JSON.stringify(step.details, null, 2)}
                                  </pre>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Diff가 있을 경우 Before/After 요약 박스 */}
                    {log.diff && (
                      <div className="rounded-lg bg-amber-950/20 border border-amber-500/30 p-2.5 text-amber-200">
                        <span className="font-bold text-[11px] block mb-1">📝 변경 예정 데이터 (Patch):</span>
                        <pre className="overflow-x-auto text-[10px] text-amber-300 leading-tight">
                          {JSON.stringify(log.diff.patch, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 하단 푸터 바 */}
        <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-900/90 px-6 py-4">
          <div className="flex items-center gap-4 text-xs text-zinc-400">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded border-zinc-700 bg-zinc-800 text-blue-500 focus:ring-0"
              />
              실시간 자동 스크롤
            </label>
            <span>
              발견된 변경사항: <strong className="text-amber-400 font-bold">{diffs.length}건</strong>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-700 transition"
            >
              {status === "running" ? "닫기 (백그라운드 계속 진행)" : "닫기"}
            </button>
            <button
              onClick={() => onApplyBatch(diffs)}
              disabled={isApplyingBatch || diffs.length === 0 || status === "running"}
              className="rounded-xl bg-primary px-6 py-2.5 text-xs font-bold text-white shadow-soft transition hover:bg-primary-dark disabled:opacity-50"
            >
              {isApplyingBatch
                ? "DB에 반영하는 중..."
                : diffs.length > 0
                ? `발견된 ${diffs.length}개 변경사항 DB 반영하기`
                : "변경할 항목 없음"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
