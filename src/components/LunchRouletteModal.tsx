"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RestaurantSummary } from "@/types";
import { getCategoryVisual } from "@/lib/restaurant-category";
import { getAvailableCategoryLabels } from "@/lib/restaurant-filters";

interface RecommendResult {
  restaurant: RestaurantSummary;
  reason: string;
  isFallback: boolean;
}

interface FriendEntry {
  nicknameId: string;
  nickname: string;
}

interface CompanyUserEntry {
  nicknameId: string;
  nickname: string;
}

interface LunchRouletteModalProps {
  open: boolean;
  companyCode: string;
  // 2026-08-08 개편: 예전엔 필터바 조건까지 적용된 visibleRestaurants를 그대로 받아서 바로 돌렸는데,
  // 사용자가 "누르면 바로 시작하는 게 아니라 조건(반경/카테고리/제로페이)을 직접 고르고 싶다"고
  // 요청해서, 이 모달이 조건 선택 화면을 자체적으로 가지게 됐다. 그래서 이미 걸러진 목록이 아니라
  // 회사 식당 전체(실시간 제로페이 상태가 반영된 CompanyHome의 restaurants state)를 받아서, 이
  // 컴포넌트 안에서 직접 필터링한다 - 메인 필터바 선택과 이중으로 겹쳐서 헷갈리는 걸 피하기 위함.
  allRestaurants: RestaurantSummary[];
  onClose: () => void;
  onFocusRestaurant?: (restaurant: RestaurantSummary) => void;
  onSelectRestaurant?: (restaurant: RestaurantSummary) => void;
  // 2026-08-11 신규(firestore 과잉사용 분석 반영): 예전엔 이 모달이 열릴 때마다 직접 /api/users를
  // 불렀다 - FriendsModal/LunchVoteModal도 각자 같은 목록을 따로 불러오고 있어서, 세 모달을
  // 순서대로 열면 같은 목록을 3번 재조회하는 낭비가 있었다. CompanyHome이 1회만 불러와
  // 공유하는 값을 props로 물려받는다.
  companyUsers: CompanyUserEntry[];
}

// 룰렛이 실제로 도는 것처럼 느껴지려면 최소 이 정도는 돌아야 한다 - 응답이 그보다 빨리 와도
// 이 시간까지는 계속 이름을 돌린다(너무 빨리 딱 멈추면 "룰렛"이라는 느낌이 안 남).
const MIN_SPIN_MS = 1400;
const SPIN_INTERVAL_MS = 90;

// 반경 선택 옵션(미터). null이면 "거리 제한 없음". 메인 필터바의 "도보 5분"(400m) 기준과
// 맞추고, 그 위로 10분/15분 단계를 더 뒀다.
const RADIUS_OPTIONS: { value: number | null; label: string }[] = [
  { value: 400, label: "도보 5분 이내 (400m)" },
  { value: 800, label: "도보 10분 이내 (800m)" },
  { value: 1200, label: "도보 15분 이내 (1.2km)" },
  { value: null, label: "거리 제한 없음" },
];

type Phase = "conditions" | "spinning" | "result" | "error";

// 2026-08-08 신규: "오늘 뭐 먹지?" 룰렛. RestaurantList의 버튼을 누르면 먼저 조건 선택 화면이
// 뜨고(반경 드롭다운 + 음식 종류 다중선택 칩 + 제로페이 토글 + 친구 초대), "룰렛 돌리기"를
// 눌러야 실제로 이름이 훑이며 돈다. 돈 뒤에는 /api/recommend(Gemini, 실패 시 랜덤 폴백) 결과를
// 보여주고, "다시 추천"은 방금 나온 곳만 빼고 같은 조건으로 다시 고르며, "조건 다시 설정"으로
// 처음 화면으로 돌아갈 수 있다.
//
// 2026-08-08 2차 개편:
// - 음식 종류를 단일 선택(드롭다운)에서 다중 선택(칩 토글)으로 바꿨다 - "한식 또는 일식 중
//   아무거나"처럼 여러 개를 동시에 고를 수 있게.
// - 친구 초대 기능 추가: 초대된 사람들의 최근 방문 이력도 같이 모아서 /api/recommend에 넘기고,
//   서버가 그 전체를 Gemini에게 "이 사람들이 최근에 다녀온 곳"으로 알려줘서 추천에 반영하게 한다
//   (LunchVoteModal의 참가자 검색 + 친구 빠른선택 UI 패턴을 그대로 재사용).
//
// 2026-08-11 개편(firestore 과잉사용 분석 반영): companyUsers(회사 전체 사용자 목록)를 이 모달이
// 직접 fetch하지 않는다 - CompanyHome이 페이지 진입 시 1회만 불러와서 props로 내려주는 값을
// 그대로 쓴다. friends(내 친구 목록)는 이 모달만의 것이라 그대로 자체 fetch를 유지한다.
export default function LunchRouletteModal({
  open,
  companyCode,
  allRestaurants,
  onClose,
  onFocusRestaurant,
  onSelectRestaurant,
  companyUsers,
}: LunchRouletteModalProps) {
  const [phase, setPhase] = useState<Phase>("conditions");
  const [spinName, setSpinName] = useState("");
  const [result, setResult] = useState<RecommendResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 조건 선택 상태 - 모달을 닫아도 컴포넌트 자체는 계속 마운트돼 있어서(부모가 open prop만
  // 바꿈), 다음에 다시 열어도 지난번 골랐던 조건이 그대로 남아있다(매번 처음부터 다시 고르지
  // 않아도 되게).
  const [radiusMeters, setRadiusMeters] = useState<number | null>(null);
  const [categoryLabels, setCategoryLabels] = useState<Set<string>>(new Set());
  const [zeroPayOnly, setZeroPayOnly] = useState(false);

  // 2026-08-08 신규: 룰렛에 초대할 사람들. friends는 "내 친구 중에서 빠르게 선택"용, companyUsers는
  // 닉네임 검색으로 누구나 초대할 수 있게 하기 위함(LunchVoteModal 참가자 초대와 동일 패턴).
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<Set<string>>(new Set());
  const [participantSearch, setParticipantSearch] = useState("");

  const spinIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 모달을 닫거나 "다시 추천"을 새로 누르는 사이 이전 요청이 늦게 도착해서 화면을 덮어쓰는 걸
  // 막기 위한 세대 카운터 (요청 시작 시 증가시키고, 응답이 왔을 때 그 사이 세대가 안 바뀌었는지 확인).
  const requestGenerationRef = useRef(0);

  // 지금 회사 식당 중 실제로 존재하는 카테고리만 보여준다(메인 필터바의 getAvailableCategoryLabels와
  // 동일한 헬퍼 재사용) - 없는 카테고리를 골라서 항상 0개가 되는 상황을 방지.
  const availableCategoryLabels = useMemo(
    () => getAvailableCategoryLabels(allRestaurants),
    [allRestaurants]
  );

  // 지금 조건(반경/카테고리/제로페이)에 맞는 후보 목록.
  const filteredCandidates = useMemo(() => {
    return allRestaurants.filter((r) => {
      if (radiusMeters !== null && (r.distanceMeters ?? Infinity) > radiusMeters) return false;
      if (categoryLabels.size > 0) {
        const visual = getCategoryVisual(r.category, r.categoryLabel);
        if (!categoryLabels.has(visual.label)) return false;
      }
      if (zeroPayOnly && !r.isZeroPay) return false;
      return true;
    });
  }, [allRestaurants, radiusMeters, categoryLabels, zeroPayOnly]);

  // 초대 대상 검색/이름 표시용 맵 - 친구목록/전체 사용자 목록 둘 다에서 채운다.
  const nicknameById = useMemo(() => {
    const map = new Map<string, string>();
    companyUsers.forEach((u) => map.set(u.nicknameId, u.nickname));
    friends.forEach((f) => map.set(f.nicknameId, f.nickname));
    return map;
  }, [companyUsers, friends]);

  const filteredParticipantUsers = useMemo(() => {
    const q = participantSearch.trim().toLowerCase();
    if (!q) return [];
    return companyUsers
      .filter((u) => u.nickname.toLowerCase().includes(q))
      .filter((u) => !selectedParticipantIds.has(u.nicknameId))
      .slice(0, 20);
  }, [participantSearch, companyUsers, selectedParticipantIds]);

  function stopSpinInterval() {
    if (spinIntervalRef.current) {
      clearInterval(spinIntervalRef.current);
      spinIntervalRef.current = null;
    }
  }

  async function runSpin(pool: RestaurantSummary[], excludeIds: string[]) {
    const myGeneration = ++requestGenerationRef.current;
    setPhase("spinning");
    setErrorMessage(null);

    const names = pool.map((c) => c.name).filter(Boolean);
    if (names.length > 0) {
      setSpinName(names[Math.floor(Math.random() * names.length)]);
      stopSpinInterval();
      spinIntervalRef.current = setInterval(() => {
        setSpinName(names[Math.floor(Math.random() * names.length)]);
      }, SPIN_INTERVAL_MS);
    }

    const startedAt = Date.now();
    const fetchPromise = fetch("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyCode,
        candidates: pool,
        excludeIds,
        participantNicknameIds: Array.from(selectedParticipantIds),
      }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "추천을 불러오지 못했어요.");
        return data as RecommendResult;
      });

    try {
      const data = await fetchPromise;
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_SPIN_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_SPIN_MS - elapsed));
      }
      if (myGeneration !== requestGenerationRef.current) return; // 그 사이 새 요청이 시작됨 - 이 결과는 버림
      stopSpinInterval();
      setResult(data);
      setPhase("result");
    } catch (err) {
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_SPIN_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_SPIN_MS - elapsed));
      }
      if (myGeneration !== requestGenerationRef.current) return;
      stopSpinInterval();
      setErrorMessage(err instanceof Error ? err.message : "추천을 불러오지 못했어요.");
      setPhase("error");
    }
  }

  // 모달이 열릴 때마다(open이 false -> true) 조건 선택 화면부터 다시 보여준다 - 바로 돌리지
  // 않는다(2026-08-08 요청사항). 지난번 골랐던 조건 값 자체는 그대로 남아있는다.
  useEffect(() => {
    if (!open) {
      stopSpinInterval();
      return;
    }
    setResult(null);
    setErrorMessage(null);
    setPhase("conditions");
  }, [open]);

  // 친구 초대용 목록 중 내 친구목록만 열릴 때마다 새로 받아온다(전체 사용자 목록은 이제
  // CompanyHome이 공유하는 companyUsers prop을 쓴다) - 그 사이 새 친구가 생겼을 수도 있으니.
  useEffect(() => {
    if (!open) return;
    fetch(`/api/friends?companyCode=${encodeURIComponent(companyCode)}`)
      .then((r) => r.json())
      .then((d) => setFriends(d.friends ?? []))
      .catch(() => {
        // 친구 초대는 부가 기능이라 실패해도 조용히 무시한다(빈 목록으로 남아 검색만 안 될 뿐).
      });
  }, [open, companyCode]);

  useEffect(() => () => stopSpinInterval(), []);

  if (!open) return null;

  function toggleCategoryLabel(label: string) {
    setCategoryLabels((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  }

  function toggleParticipant(nicknameId: string) {
    setSelectedParticipantIds((prev) => {
      const next = new Set(prev);
      next.has(nicknameId) ? next.delete(nicknameId) : next.add(nicknameId);
      return next;
    });
  }

  function addParticipant(nicknameId: string) {
    setSelectedParticipantIds((prev) => new Set(prev).add(nicknameId));
    setParticipantSearch("");
  }

  function handleStartSpin() {
    if (filteredCandidates.length === 0) return;
    runSpin(filteredCandidates, []);
  }

  function handleRetry() {
    runSpin(filteredCandidates, result ? [result.restaurant.id] : []);
  }

  function handleBackToConditions() {
    setResult(null);
    setErrorMessage(null);
    setPhase("conditions");
  }

  function handleViewOnMap() {
    if (!result) return;
    onFocusRestaurant?.(result.restaurant);
    onSelectRestaurant?.(result.restaurant);
    onClose();
  }

  const visual = result ? getCategoryVisual(result.restaurant.category, result.restaurant.categoryLabel) : null;
  const participantCount = 1 + selectedParticipantIds.size;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-xl2 bg-surface p-6 text-center shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex w-full items-center justify-between">
          <h3 className="text-base font-bold text-ink">오늘 뭐 먹지?</h3>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="rounded-full p-1 text-ink-soft transition hover:bg-surface-muted"
          >
            ✕
          </button>
        </div>

        {phase === "conditions" && (
          <div className="flex w-full flex-col gap-3 text-left">
            {/* 조건 카드 - 반경/음식 종류/제로페이 */}
            <div className="rounded-2xl border border-black/5 bg-surface-muted/50 p-3.5">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-soft">회사에서 거리</label>
                <select
                  value={radiusMeters === null ? "null" : String(radiusMeters)}
                  onChange={(e) =>
                    setRadiusMeters(e.target.value === "null" ? null : Number(e.target.value))
                  }
                  className="w-full rounded-xl border border-black/10 bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-primary"
                >
                  {RADIUS_OPTIONS.map((opt) => (
                    <option key={opt.label} value={opt.value === null ? "null" : opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-3">
                <label className="mb-1 block text-xs font-medium text-ink-soft">
                  음식 종류 (여러 개 골라도 돼요, 안 고르면 전체)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {availableCategoryLabels.map((label) => {
                    const active = categoryLabels.has(label);
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => toggleCategoryLabel(label)}
                        className={[
                          "rounded-full px-2.5 py-1.5 text-xs font-medium transition",
                          active
                            ? "bg-primary text-white"
                            : "bg-surface text-ink-soft ring-1 ring-inset ring-black/10 hover:bg-primary-light",
                        ].join(" ")}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setZeroPayOnly((v) => !v)}
                className={[
                  "mt-3 flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-sm font-medium transition",
                  zeroPayOnly
                    ? "border-primary bg-primary-light text-primary-dark"
                    : "border-black/10 text-ink-soft hover:border-primary/40",
                ].join(" ")}
              >
                <span>💚 제로페이 되는 곳만</span>
                <span
                  className={[
                    "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition",
                    zeroPayOnly ? "bg-primary" : "bg-black/15",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "inline-block h-4 w-4 transform rounded-full bg-white shadow transition",
                      zeroPayOnly ? "translate-x-4" : "translate-x-0.5",
                    ].join(" ")}
                  />
                </span>
              </button>
            </div>

            {/* 함께 먹을 사람 카드 - 초대된 사람들의 최근 방문 이력도 같이 고려해서 추천한다. */}
            <div className="rounded-2xl border border-black/5 bg-surface-muted/50 p-3.5">
              <div className="mb-2 flex items-baseline justify-between">
                <p className="text-sm font-semibold text-ink">함께 먹을 사람</p>
                <p className="text-[11px] text-ink-soft">초대 안 하면 나 혼자</p>
              </div>

              {selectedParticipantIds.size > 0 && (
                <ul className="mb-2 flex flex-wrap gap-1.5">
                  {Array.from(selectedParticipantIds).map((id) => (
                    <li
                      key={id}
                      className="flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-white"
                    >
                      {nicknameById.get(id) ?? id}
                      <button
                        onClick={() => toggleParticipant(id)}
                        aria-label="초대 취소"
                        className="text-white/80 hover:text-white"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="relative">
                <input
                  value={participantSearch}
                  onChange={(e) => setParticipantSearch(e.target.value)}
                  placeholder="닉네임으로 검색해서 초대"
                  className="w-full rounded-xl border border-black/10 bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                />
                {participantSearch.trim() && (
                  <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-40 overflow-y-auto rounded-xl border border-black/10 bg-surface p-1.5 shadow-soft">
                    {filteredParticipantUsers.length === 0 && (
                      <li className="px-2 py-1.5 text-xs text-ink-soft">일치하는 닉네임이 없어요.</li>
                    )}
                    {filteredParticipantUsers.map((u) => (
                      <li key={u.nicknameId}>
                        <button
                          onClick={() => addParticipant(u.nicknameId)}
                          className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm text-ink transition hover:bg-primary-light hover:text-primary-dark"
                        >
                          {u.nickname}
                          <span className="text-xs text-ink-soft">+ 초대</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {friends.length > 0 && (
                <div className="mt-2.5 border-t border-black/5 pt-2.5">
                  <p className="mb-1.5 text-[11px] font-medium text-ink-soft">내 친구 중에서 빠르게 선택</p>
                  <ul className="flex flex-wrap gap-1.5">
                    {friends.map((friend) => (
                      <li key={friend.nicknameId}>
                        <button
                          onClick={() => toggleParticipant(friend.nicknameId)}
                          className={[
                            "rounded-full px-3 py-1.5 text-xs font-medium transition",
                            selectedParticipantIds.has(friend.nicknameId)
                              ? "bg-primary text-white"
                              : "bg-surface text-ink-soft ring-1 ring-inset ring-black/10 hover:bg-primary-light",
                          ].join(" ")}
                        >
                          {friend.nickname}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="mt-2.5 text-[11px] text-ink-soft">
                초대한 사람들의 최근 방문 이력도 함께 살펴서, 다 같이 안 가본 곳 위주로 추천해요.
              </p>
            </div>

            <p className="text-xs text-ink-soft">
              지금 조건에 맞는 식당:{" "}
              <span className="font-semibold text-ink">{filteredCandidates.length}개</span>
              {participantCount > 1 && (
                <>
                  {" "}
                  · <span className="font-semibold text-ink">{participantCount}명</span>과 함께
                </>
              )}
            </p>

            <button
              onClick={handleStartSpin}
              disabled={filteredCandidates.length === 0}
              className="w-full rounded-xl2 bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-40"
            >
              {filteredCandidates.length === 0 ? "조건에 맞는 식당이 없어요" : "룰렛 돌리기"}
            </button>
          </div>
        )}

        {phase === "spinning" && (
          <div className="flex w-full flex-col items-center gap-3 py-6">
            <p className="w-full truncate text-lg font-bold text-ink">{spinName || "고르는 중..."}</p>
            <p className="text-xs text-ink-soft">오늘의 메뉴를 고민하는 중이에요...</p>
          </div>
        )}

        {phase === "error" && (
          <div className="flex w-full flex-col items-center gap-3 py-4">
            <p className="text-sm text-ink-soft">{errorMessage}</p>
            <div className="flex w-full gap-2">
              <button
                onClick={handleBackToConditions}
                className="flex-1 rounded-xl2 border border-black/10 px-3 py-2 text-sm font-semibold text-ink transition hover:border-primary hover:text-primary"
              >
                조건 다시 설정
              </button>
              {filteredCandidates.length > 0 && (
                <button
                  onClick={() => runSpin(filteredCandidates, [])}
                  className="flex-1 rounded-xl2 bg-ink px-3 py-2 text-sm font-semibold text-white transition hover:bg-black"
                >
                  다시 시도
                </button>
              )}
            </div>
          </div>
        )}

        {phase === "result" && result && visual && (
          <div className="flex w-full flex-col items-center gap-3">
            <div>
              <p className="text-xl font-bold text-ink">{result.restaurant.name}</p>
              <p className="mt-0.5 text-xs text-ink-soft">{result.restaurant.address}</p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-soft">
                {visual.label}
              </span>
              {result.restaurant.isZeroPay && (
                <span className="rounded-full bg-primary-light px-2 py-0.5 text-xs text-primary-dark">
                  제로페이
                </span>
              )}
              {typeof result.restaurant.distanceMeters === "number" && (
                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-soft">
                  {result.restaurant.distanceMeters}m
                </span>
              )}
              {participantCount > 1 && (
                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-soft">
                  {participantCount}명
                </span>
              )}
            </div>

            <div className="w-full rounded-xl2 bg-surface-muted p-3">
              <p className="text-sm text-ink">
                {result.reason}
              </p>
            </div>

            <div className="flex w-full gap-2">
              <button
                onClick={handleRetry}
                className="flex-1 rounded-xl2 border border-black/10 px-3 py-2.5 text-sm font-semibold text-ink transition hover:border-primary hover:text-primary"
              >
                다시 추천
              </button>
              <button
                onClick={handleViewOnMap}
                className="flex-1 rounded-xl2 bg-ink px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-black"
              >
                지도에서 보기
              </button>
            </div>
            <button
              onClick={handleBackToConditions}
              className="text-xs text-ink-soft underline-offset-2 transition hover:text-primary hover:underline"
            >
              조건 다시 설정
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
