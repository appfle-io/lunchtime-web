"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import BottomSheet from "./BottomSheet";
import type { RestaurantSummary } from "@/types";

interface RestaurantCandidate {
  title: string;
  address: string;
  lat: number;
  lng: number;
  category: string | null;
  distanceMeters: number;
}

interface RestaurantListProps {
  companyCode: string;
  restaurants: RestaurantSummary[]; // 이미 FilterBar 조건으로 걸러진 목록 (필터 UI는 여기 없음)
  hasAnyRestaurants: boolean; // 필터와 무관하게 이 회사에 식당 데이터가 하나라도 있는지
  favoriteIds: Set<string>;
  onToggleFavorite: (restaurant: RestaurantSummary) => void;
  onFocusRestaurant?: (restaurant: RestaurantSummary) => void;
  onSelectRestaurant?: (restaurant: RestaurantSummary) => void;
  onNotify?: (message: string) => void;
  // 2026-08-06 신규: 알림/친구목록/투표 버튼 (BottomSheet header 슬롯에 같이 둔다)
  unreadNotifCount?: number;
  onOpenNotifications?: () => void;
  onOpenFriends?: () => void;
  onOpenVote?: () => void;
  // 2026-08-06 오후 신규: 지도에서 클러스터를 클릭해 구역 확대 상태로 들어왔을 때(null이 아니면 숫자)
  // 리스트도 그 구역 식당만 보고 있다는 걸 배너로 바로 알려주기 위해.
  clusterFilterCount?: number | null;
  onClearClusterFilter?: () => void;
  // 2026-08-06 3차 신규: BottomSheet의 title("주변 식당") 줄 오른쪽 끝에 얹을 사용자 메뉴
  // (UserMenu - 닉네임 버튼 + 로그아웃/비밀번호 변경 드롭다운). 여기서는 그대로 전달만 한다.
  userMenu?: ReactNode;
}

// 이보다 멀면 후보 목록에 "회사에서 좀 멀어요" 배지를 표시한다. 자동으로 거부하지는 않음 -
// 사용자가 주소를 직접 보고 맞는지 최종 판단한다 (2026-08-06, 아래 큰 주석 참고).
const FAR_AWAY_METERS = 5000;

// TODO: "오늘 뭐 먹지?" 버튼 클릭 시 룰렛/카드 스와이프 인터랙션 + /api/recommend(Gemini) 호출.
// TODO: 지도 마커 클릭 시 이 리스트에서 해당 항목 하이라이트/스크롤 (지금은 리스트 -> 지도 방향만 연결됨)
// 카테고리/제로페이/도보5분/즐겨찾기/회식/여름별미 필터 UI는 FilterBar(지도 위 상단 플로팅)로 옮겨졌다.
// 여기서는 이미 필터링된 restaurants를 받아서 렌더링만 한다 (2026-08-06).
//
// "직접 추가"는 2026-08-06에 2단계 방식으로 개편됨: 예전엔 이름(+위치힌트)만 넣으면 서버가
// 자동으로 후보 하나를 확정해서 바로 저장했는데, "궁중삼계탕"처럼 전국에 지점이 많은 체인 이름에서
// 자동 매칭이 반복적으로 실패/오매칭됐다(거리검증/정렬방식/랜드마크 앵커까지 다 시도해봤지만 계속 실패).
// 사용자 제안으로 "후보 목록(상호명+주소+거리)을 먼저 보여주고 사용자가 직접 고르게" 바꿈 - 사업자가
// 네이버에 업종을 다르게 등록해둔 경우(예: 실제 식당인데 카테고리가 "도소매")까지 사람이 눈으로 보고
// 걸러낼 수 있어서 자동 필터링보다 훨씬 확실하다.
//
// 2026-08-06 추가 개편: "오늘 뭐 먹지?"/"직접 추가하기" 버튼을 BottomSheet의 리스트 스크롤 영역
// 안에 그냥 같이 넣었더니, 목록을 보려고 스크롤하면 버튼이 같이 밀려 올라가고, 직접 추가 폼을
// 펼치면 그 폼이 목록 위 공간을 다 차지해서 목록을 보려면 폼까지 스크롤해서 지나쳐야 했다
// ("스크롤 압박이 심하다"는 사용자 피드백). 그래서 (1) 두 버튼은 BottomSheet의 header 슬롯으로
// 옮겨서 항상 같은 자리에 고정시키고, (2) "직접 추가" 폼 자체는 리스트 안에 펼쳐지는 대신
// 화면 중앙에 뜨는 모달로 분리했다 - 리스트 스크롤 공간을 전혀 잡아먹지 않는다.
export default function RestaurantList({
  companyCode,
  restaurants,
  hasAnyRestaurants,
  favoriteIds,
  onToggleFavorite,
  onFocusRestaurant,
  onSelectRestaurant,
  onNotify,
  unreadNotifCount = 0,
  onOpenNotifications,
  onOpenFriends,
  onOpenVote,
  clusterFilterCount = null,
  onClearClusterFilter,
  userMenu,
}: RestaurantListProps) {
  const router = useRouter();
  const [showAddModal, setShowAddModal] = useState(false);
  const [addName, setAddName] = useState("");
  const [addAddressHint, setAddAddressHint] = useState("");
  const [searchStatus, setSearchStatus] = useState<"idle" | "loading" | "error">("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<RestaurantCandidate[] | null>(null);
  const [addingIndex, setAddingIndex] = useState<number | null>(null);

  function resetAddFlow() {
    setShowAddModal(false);
    setAddName("");
    setAddAddressHint("");
    setSearchStatus("idle");
    setSearchError(null);
    setCandidates(null);
    setAddingIndex(null);
  }

  // 1단계: 이름(+위치 힌트)으로 후보 목록을 검색한다. 아직 아무것도 저장하지 않는다.
  async function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!addName.trim()) return;

    setSearchStatus("loading");
    setSearchError(null);
    setCandidates(null);

    try {
      const res = await fetch("/api/restaurants/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyCode,
          name: addName.trim(),
          addressHint: addAddressHint.trim() || undefined,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setSearchStatus("error");
        setSearchError(data.error ?? "검색하지 못했어요.");
        return;
      }

      setSearchStatus("idle");
      setCandidates((data.candidates ?? []) as RestaurantCandidate[]);
    } catch {
      setSearchStatus("error");
      setSearchError("네트워크 오류로 검색하지 못했어요. 다시 시도해줘.");
    }
  }

  // 2단계: 사용자가 후보 목록 중 하나를 클릭하면 그 후보를 그대로 저장한다.
  async function handlePickCandidate(candidate: RestaurantCandidate, index: number) {
    setAddingIndex(index);
    setSearchError(null);

    try {
      const res = await fetch("/api/restaurants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, candidate }),
      });
      const data = await res.json();

      if (!res.ok) {
        setSearchError(data.error ?? "식당을 추가하지 못했어요.");
        setAddingIndex(null);
        return;
      }

      const { restaurant, existing } = data as {
        restaurant: RestaurantSummary;
        existing: boolean;
      };

      resetAddFlow();

      if (existing) {
        // 이미 있는 식당이면 새로 만들지 않고, 토스트로 알려준 다음 지도만 그 위치로 이동시킨다.
        onNotify?.(`"${restaurant.name}"은 이미 목록에 있어요.`);
      } else {
        router.refresh(); // 서버 컴포넌트를 다시 실행해서 방금 추가한 식당을 목록에 반영
        onNotify?.(`"${restaurant.name}"을 추가했어요.`);
      }
      onFocusRestaurant?.(restaurant);
    } catch {
      setSearchError("네트워크 오류로 추가하지 못했어요. 다시 시도해줘.");
      setAddingIndex(null);
    }
  }

  const headerButtons = (
    <>
      {/* 2026-08-06 신규: 알림/친구목록/투표 버튼. 다른 절대위치 버튼처럼 화면 좌표를 새로 잡지 않고,
          항상 안전한 이 header 슬롯에 같이 둔다(레이아웃 회귀를 또 만들지 않기 위함). */}
      <div className="mb-2 flex gap-1.5">
        <button
          onClick={onOpenNotifications}
          aria-label="알림"
          className="relative flex-1 rounded-xl2 border border-black/10 px-2 py-2 text-sm transition hover:border-primary hover:text-primary"
        >
          🔔
          {unreadNotifCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
              {unreadNotifCount}
            </span>
          )}
        </button>
        <button
          onClick={onOpenFriends}
          className="flex-1 rounded-xl2 border border-black/10 px-2 py-2 text-sm transition hover:border-primary hover:text-primary"
        >
          👥 친구
        </button>
        <button
          onClick={onOpenVote}
          className="flex-1 rounded-xl2 border border-black/10 px-2 py-2 text-sm transition hover:border-primary hover:text-primary"
        >
          🍚 투표
        </button>
      </div>

      <button className="mb-2 w-full rounded-xl2 bg-ink px-4 py-3 font-semibold text-white transition hover:bg-black">
        🎲 오늘 뭐 먹지?
      </button>
      <button
        onClick={() => setShowAddModal(true)}
        className="mb-1 w-full rounded-xl2 border border-dashed border-black/15 px-4 py-2.5 text-sm font-medium text-ink-soft transition hover:border-primary hover:text-primary"
      >
        + 여기 없는 식당 직접 추가하기
      </button>
    </>
  );

  return (
    <>
      <BottomSheet title="주변 식당" titleRight={userMenu} header={headerButtons}>
        {typeof clusterFilterCount === "number" && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-xl2 bg-primary-light px-3 py-2 text-xs text-primary-dark">
            <span>📍 지도에서 선택한 구역 식당만 보는 중 ({clusterFilterCount}개)</span>
            <button
              onClick={onClearClusterFilter}
              className="shrink-0 rounded-full bg-surface px-2.5 py-1 font-semibold transition hover:bg-white"
            >
              전체보기
            </button>
          </div>
        )}
        {restaurants.length === 0 ? (
          <div className="mb-4 rounded-xl2 border border-black/5 p-4 text-sm text-ink-soft">
            {!hasAnyRestaurants
              ? `${companyCode} 근처 식당 데이터가 아직 없어요. 관리자 시딩이 필요합니다.`
              : "이 필터 조건에 맞는 식당이 없어요."}
          </div>
        ) : (
          <ul className="mb-4 flex flex-col gap-3">
            {restaurants.map((r) => (
              <li
                key={r.id}
                className="rounded-xl2 border border-black/5 p-4 transition hover:border-primary/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div
                    className="min-w-0 flex-1 cursor-pointer"
                    onClick={() => {
                      onFocusRestaurant?.(r);
                      onSelectRestaurant?.(r);
                    }}
                  >
                    <p className="font-semibold text-ink">{r.name}</p>
                    <p className="text-xs text-ink-soft">{r.address}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(r);
                      }}
                      aria-label={favoriteIds.has(r.id) ? "즐겨찾기 해제" : "즐겨찾기 추가"}
                      className="rounded-full p-0.5 text-lg leading-none transition hover:bg-surface-muted"
                    >
                      {favoriteIds.has(r.id) ? "❤️" : "🤍"}
                    </button>
                    {typeof r.distanceMeters === "number" && (
                      <span className="whitespace-nowrap text-xs text-ink-soft">{r.distanceMeters}m</span>
                    )}
                  </div>
                </div>
                <div
                  className="mt-2 flex cursor-pointer flex-wrap gap-1.5"
                  onClick={() => {
                    onFocusRestaurant?.(r);
                    onSelectRestaurant?.(r);
                  }}
                >
                  {r.category && (
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-soft">
                      {r.category}
                    </span>
                  )}
                  {r.isZeroPay && (
                    <span className="rounded-full bg-primary-light px-2 py-0.5 text-xs text-primary-dark">
                      제로페이
                    </span>
                  )}
                  {r.isZeroPayNeedsReview && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                      ⚠️ 확인필요
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </BottomSheet>

      {/* "직접 추가" 모달. BottomSheet 바깥의 독립된 오버레이라 리스트 스크롤과 완전히 분리됨. */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
          onClick={resetAddFlow}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-xl2 bg-surface p-5 shadow-soft"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-ink">식당 직접 추가</h3>
              <button
                type="button"
                onClick={resetAddFlow}
                aria-label="닫기"
                className="rounded-full p-1 text-ink-soft transition hover:bg-surface-muted"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSearchSubmit} className="flex flex-col gap-2">
              <input
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="식당 이름 (예: 영등포신세계 OO식당)"
                className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
                autoFocus
              />
              <input
                value={addAddressHint}
                onChange={(e) => setAddAddressHint(e.target.value)}
                placeholder="위치 힌트 (선택, 예: 영등포시장역 / 신세계백화점 영등포점 지하)"
                className="rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
              />
              {searchError && <p className="text-xs text-primary-dark">{searchError}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={searchStatus === "loading"}
                  className="flex-1 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
                >
                  {searchStatus === "loading" ? "찾는 중..." : "찾아보기"}
                </button>
                <button
                  type="button"
                  onClick={resetAddFlow}
                  className="rounded-xl px-3 py-2 text-sm text-ink-soft hover:bg-surface-muted"
                >
                  취소
                </button>
              </div>
            </form>

            {candidates && (
              <div className="flex flex-col gap-2 border-t border-black/5 pt-2">
                {candidates.length === 0 ? (
                  <p className="text-xs text-ink-soft">
                    검색 결과가 없어요. 상호명이나 위치 힌트를 다시 확인해서 시도해주세요.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-ink-soft">
                      이 중에 맞는 곳을 골라주세요 (회사에서 가까운 순, 카테고리가 이상해도 실제로 맞으면 골라도 돼요):
                    </p>
                    <ul className="flex flex-col gap-1.5">
                      {candidates.map((c, i) => (
                        <li key={`${c.title}-${c.address}`}>
                          <button
                            type="button"
                            disabled={addingIndex !== null}
                            onClick={() => handlePickCandidate(c, i)}
                            className="w-full rounded-xl border border-black/10 p-2.5 text-left text-sm transition hover:border-primary disabled:opacity-60"
                          >
                            <p className="font-medium text-ink">{c.title}</p>
                            <p className="text-xs text-ink-soft">{c.address}</p>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-ink-soft">
                                {c.distanceMeters < 1000
                                  ? `${c.distanceMeters}m`
                                  : `${(c.distanceMeters / 1000).toFixed(1)}km`}
                              </span>
                              {c.category && (
                                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-ink-soft">
                                  {c.category}
                                </span>
                              )}
                              {c.distanceMeters > FAR_AWAY_METERS && (
                                <span className="rounded-full bg-primary-light px-2 py-0.5 text-[11px] text-primary-dark">
                                  회사에서 좀 멀어요
                                </span>
                              )}
                            </div>
                            {addingIndex === i && (
                              <p className="mt-1 text-[11px] text-primary">추가하는 중...</p>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
