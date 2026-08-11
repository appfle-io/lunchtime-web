"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RestaurantSummary } from "@/types";
import { getCategoryVisual } from "@/lib/restaurant-category";

interface FriendEntry {
  nicknameId: string;
  nickname: string;
  memo: string;
}

interface CompanyUserEntry {
  nicknameId: string;
  nickname: string;
}

interface VoteOption {
  id: string;
  label: string;
  restaurantId?: string;
}

interface VoteResponseEntry {
  nicknameId: string;
  nickname: string;
  optionId: string;
  respondedAt: string;
}

interface VoteCommentEntry {
  id: string;
  authorNicknameId: string;
  authorNickname: string;
  content: string;
  createdAt: string;
}

interface VoteSummary {
  id: string;
  title: string;
  creatorNicknameId: string;
  creatorNickname: string;
  options: VoteOption[];
  participantNicknameIds: string[];
  createdAt: string;
  responses: VoteResponseEntry[];
  comments: VoteCommentEntry[];
}

interface DraftOption {
  key: string; // restaurantId가 있으면 그 값, 없으면(직접 입력 옵션) label 자체를 key로 사용
  label: string;
  restaurantId?: string;
  // 2026-08-06 3차 신규: 검색 결과에서 고른 옵션이면 그 식당의 카테고리를 같이 들고 있어서,
  // 선택된 옵션 칩에도 "무슨 음식인지" 작게 보여줄 수 있게 한다.
  category?: string;
}

interface LunchVoteModalProps {
  companyCode: string;
  myNickname: string;
  restaurants: RestaurantSummary[];
  open: boolean;
  onClose: () => void;
  onNotify?: (message: string) => void;
  // 알림함 "투표하러 가기"에서 열 때 바로 펼쳐서 보여줄 투표 id (2026-08-06 신규).
  focusVoteId?: string | null;
  // 2026-08-11 신규(firestore 과잉사용 분석 반영): 친구목록/전체 사용자 목록을 이 모달이 매번
  // 자체적으로 /api/users로 다시 불러오는 대신, CompanyHome이 한 번 로드해서 내려주는 값을
  // 그대로 쓴다(FriendsModal/LunchRouletteModal과 캐시 공유). 값이 없으면(로딩 전) 빈 배열로
  // 취급 - 검색/빠른선택 UI가 잠깐 비어 보일 뿐 기능 자체는 그대로 동작한다.
  companyUsers: CompanyUserEntry[];
}

const VOTES_PAGE_SIZE = 10;

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

// 2026-08-06 신규: "오늘 점심 뭐 먹지?" 투표. 식당 옵션을 몇 개 골라 투표를 만든다. "저는 따로
// 먹을게요" 옵션은 항상 자동으로 포함된다(서버가 붙여줌). 히스토리 전체를 검색/페이징으로 보고,
// 각 투표 안에서 응답/댓글을 남길 수 있다.
//
// 2026-08-11 개편(firestore 과잉사용 분석 반영): 투표함 목록을 불러올 때 투표마다 responses/
// comments 서브컬렉션을 다 읍던 N+1을 없앴다. 이제 목록(GET /api/votes)은 제목/참가자수 같은
// 가벼운 필드만 내려주고, 카드를 펼칠 때(VoteCard)만 그 투표 1건에 대해 GET /api/votes/{id}로
// 상세(응답/댓글)를 지연 로딩한다. 또한 응답/댓글/메뉴추가 액션들은 서버가 매번 vote 전체를
// 재조립해서 돌려주는 대신 "무엇이 바뀌었는지"(델타)만 돌려주고, 그 델타를 로컬에 들고 있는
// vote 객체에 병합한다 - 서버 쪽 재조회 자체가 사라졌다.
export default function LunchVoteModal({
  companyCode,
  myNickname,
  restaurants,
  open,
  onClose,
  onNotify,
  focusVoteId,
  companyUsers,
}: LunchVoteModalProps) {
  const [tab, setTab] = useState<"list" | "create">("list");
  const [loading, setLoading] = useState(false);
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [votes, setVotes] = useState<VoteSummary[]>([]);
  const [expandedVoteId, setExpandedVoteId] = useState<string | null>(null);

  // 투표함(목록) 탭 - 검색 + 페이징
  const [voteSearch, setVoteSearch] = useState("");
  const [votePage, setVotePage] = useState(0);

  // 새 투표 만들기 폼 상태
  const [title, setTitle] = useState("");
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<Set<string>>(new Set());
  const [participantSearch, setParticipantSearch] = useState("");
  const [restaurantFilter, setRestaurantFilter] = useState("");
  const [selectedOptions, setSelectedOptions] = useState<DraftOption[]>([]);
  const [customOptionText, setCustomOptionText] = useState("");
  const [creating, setCreating] = useState(false);

  // 친구목록만 이 모달 전용으로 불러온다 - 전체 사용자 목록(companyUsers)은 CompanyHome이
  // 내려주는 공유 데이터를 쓴다(2026-08-11 수정).
  function loadAll() {
    setLoading(true);
    Promise.all([
      fetch(`/api/friends?companyCode=${encodeURIComponent(companyCode)}`).then((r) => r.json()),
      fetch(`/api/votes?companyCode=${encodeURIComponent(companyCode)}`).then((r) => r.json()),
    ])
      .then(([friendsData, votesData]) => {
        setFriends(friendsData.friends ?? []);
        setVotes(votesData.votes ?? []);
      })
      .catch(() => onNotify?.("투표 정보를 불러오지 못했어요."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!open) return;
    loadAll();
    setVoteSearch("");
    setVotePage(0);
    if (focusVoteId) {
      setTab("list");
      setExpandedVoteId(focusVoteId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, companyCode, focusVoteId]);

  // 알림함 "투표하러 가기"로 들어왔을 때, 그 투표가 몇 페이지째에 있는지 찾아서 페이지를 맞춰준다.
  useEffect(() => {
    if (!focusVoteId) return;
    const idx = votes.findIndex((v) => v.id === focusVoteId);
    if (idx === -1) return;
    setVotePage(Math.floor(idx / VOTES_PAGE_SIZE));
  }, [votes, focusVoteId]);

  // voteSearch가 바뀌면 항상 첫 페이지로.
  useEffect(() => {
    setVotePage(0);
  }, [voteSearch]);

  const filteredVotes = useMemo(() => {
    const q = voteSearch.trim().toLowerCase();
    if (!q) return votes;
    return votes.filter((v) => v.title.toLowerCase().includes(q));
  }, [votes, voteSearch]);

  const totalVotePages = Math.max(1, Math.ceil(filteredVotes.length / VOTES_PAGE_SIZE));
  const pagedVotes = filteredVotes.slice(
    votePage * VOTES_PAGE_SIZE,
    (votePage + 1) * VOTES_PAGE_SIZE
  );

  // 참가자 칩에 닉네임을 표시하기 위한 조회용 맵 - 친구목록/전체 사용자 목록 둘 다에서 채운다.
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

  const filteredRestaurants = useMemo(() => {
    const q = restaurantFilter.trim().toLowerCase();
    if (!q) return [];
    return restaurants
      .filter((r) => r.name.toLowerCase().includes(q))
      .filter((r) => !selectedOptions.some((o) => o.key === r.id))
      .slice(0, 15);
  }, [restaurantFilter, restaurants, selectedOptions]);

  if (!open) return null;

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

  function addOption(option: DraftOption) {
    setSelectedOptions((prev) => (prev.some((o) => o.key === option.key) ? prev : [...prev, option]));
    setRestaurantFilter("");
  }

  function removeOption(key: string) {
    setSelectedOptions((prev) => prev.filter((o) => o.key !== key));
  }

  function addCustomOption() {
    const label = customOptionText.trim();
    if (!label) return;
    addOption({ key: `custom_${label}`, label });
    setCustomOptionText("");
  }

  function resetCreateForm() {
    setTitle("");
    setSelectedParticipantIds(new Set());
    setParticipantSearch("");
    setRestaurantFilter("");
    setSelectedOptions([]);
    setCustomOptionText("");
  }

  async function handleCreateVote() {
    if (selectedOptions.length === 0) {
      onNotify?.("메뉴(식당) 옵션을 1개 이상 골라줘.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/votes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyCode,
          title,
          options: selectedOptions.map((o) => ({ label: o.label, restaurantId: o.restaurantId })),
          participantNicknameIds: Array.from(selectedParticipantIds),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify?.(data.error ?? "투표를 만들지 못했어요.");
        return;
      }
      // 새로 만든 투표는 생성 응답 자체가 이미 responses:[]/comments:[]까지 완전한 형태라
      // 별도로 다시 조회할 필요가 없다.
      setVotes((prev) => [data.vote, ...prev]);
      setExpandedVoteId(data.vote.id);
      setVoteSearch("");
      setVotePage(0);
      resetCreateForm();
      setTab("list");
      onNotify?.("투표를 만들었어요.");
    } catch {
      onNotify?.("네트워크 오류로 투표를 만들지 못했어요.");
    } finally {
      setCreating(false);
    }
  }

  // 카드가 부분(델타) 병합이든 지연 로딩한 상세 전체든, 최신 vote 객체로 목록의 해당 항목만
  // 교체한다 - respond/comment/옵션추가/상세로딩 전부 이 콜백 하나로 반영.
  function handleVoteUpdated(updated: VoteSummary) {
    setVotes((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-xl2 bg-surface p-5 shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">오늘 점심 투표</h3>
          <div className="flex items-center gap-1">
            {/* 2026-08-11 신규: 다른 참가자가 투표를 새로 만들거나 메뉴를 추가한 걸 반영하려면
                모달을 닫았다 다시 열 필요 없이 이 버튼으로 목록 전체를 다시 불러올 수 있게 한다.
                목록 자체는 가벼운 요약만 다시 받아오고, 펼쳐진 카드가 있었다면 그 카드는 다음에
                펼침 상태를 다시 감지할 때(아래 VoteCard의 useEffect) 상세를 다시 지연 로딩한다. */}
            <button
              onClick={loadAll}
              disabled={loading}
              aria-label="새로고침"
              title="새로고침"
              className="rounded-full p-1 text-ink-soft transition hover:bg-surface-muted disabled:opacity-50"
            >
              ⟳
            </button>
            <button
              onClick={onClose}
              aria-label="닫기"
              className="rounded-full p-1 text-ink-soft transition hover:bg-surface-muted"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex gap-1.5">
          <button
            onClick={() => setTab("list")}
            className={[
              "flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition",
              tab === "list" ? "bg-primary text-white" : "bg-surface-muted text-ink-soft",
            ].join(" ")}
          >
            투표함 {votes.length > 0 ? `(${votes.length})` : ""}
          </button>
          <button
            onClick={() => setTab("create")}
            className={[
              "flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition",
              tab === "create" ? "bg-primary text-white" : "bg-surface-muted text-ink-soft",
            ].join(" ")}
          >
            + 새 투표 만들기
          </button>
        </div>

        {loading && <p className="text-sm text-ink-soft">불러오는 중...</p>}

        {!loading && tab === "list" && (
          <div className="flex flex-col gap-2">
            <input
              value={voteSearch}
              onChange={(e) => setVoteSearch(e.target.value)}
              placeholder="투표 제목으로 검색"
              className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
            />

            <ul className="flex flex-col gap-2">
              {filteredVotes.length === 0 && (
                <li className="rounded-xl2 border border-black/5 p-4 text-sm text-ink-soft">
                  {voteSearch.trim()
                    ? "검색 결과가 없어요."
                    : '아직 투표가 없어요. "+ 새 투표 만들기"로 시작해보세요.'}
                </li>
              )}
              {pagedVotes.map((vote) => (
                <VoteCard
                  key={vote.id}
                  vote={vote}
                  companyCode={companyCode}
                  myNickname={myNickname}
                  restaurants={restaurants}
                  expanded={expandedVoteId === vote.id}
                  onToggleExpand={() => setExpandedVoteId((prev) => (prev === vote.id ? null : vote.id))}
                  onVoteUpdated={handleVoteUpdated}
                  onNotify={onNotify}
                />
              ))}
            </ul>

            {filteredVotes.length > VOTES_PAGE_SIZE && (
              <div className="flex items-center justify-between text-xs text-ink-soft">
                <button
                  onClick={() => setVotePage((p) => Math.max(0, p - 1))}
                  disabled={votePage === 0}
                  className="rounded-full px-2.5 py-1 transition hover:bg-surface-muted disabled:opacity-40"
                >
                  ← 이전
                </button>
                <span>
                  {votePage + 1} / {totalVotePages}페이지
                </span>
                <button
                  onClick={() => setVotePage((p) => Math.min(totalVotePages - 1, p + 1))}
                  disabled={votePage >= totalVotePages - 1}
                  className="rounded-full px-2.5 py-1 transition hover:bg-surface-muted disabled:opacity-40"
                >
                  다음 →
                </button>
              </div>
            )}
          </div>
        )}

        {!loading && tab === "create" && (
          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-ink">투표 제목</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="오늘 점심 뭐 먹지?"
                className="w-full rounded-xl border border-black/10 px-3 py-2.5 text-sm outline-none focus:border-primary"
              />
            </div>

            {/* 참가자 섹션 - 카드로 묶어서 아래 메뉴 옵션 섹션과 시각적으로 분리한다. */}
            <div className="rounded-2xl border border-black/5 bg-surface-muted/50 p-3.5">
              <div className="mb-2.5 flex items-baseline justify-between">
                <p className="text-sm font-semibold text-ink">참가자</p>
                <p className="text-[11px] text-ink-soft">누구나 초대할 수 있어요</p>
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
                        aria-label="참가자 제거"
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
                  <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-xl border border-black/10 bg-surface p-1.5 shadow-soft">
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
                          <span className="text-xs text-ink-soft">+ 추가</span>
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
            </div>

            {/* 메뉴(식당) 옵션 섹션 - 참가자 섹션과 동일한 카드 스타일로 통일한다. */}
            <div className="rounded-2xl border border-black/5 bg-surface-muted/50 p-3.5">
              <p className="mb-2.5 text-sm font-semibold text-ink">메뉴 옵션</p>

              {selectedOptions.length > 0 && (
                <ul className="mb-2 flex flex-wrap gap-1.5">
                  {selectedOptions.map((option) => (
                    <li
                      key={option.key}
                      className="flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-white"
                    >
                      {option.label}
                      {option.category && (
                        <span className="text-[10px] text-white/70">· {option.category}</span>
                      )}
                      <button
                        onClick={() => removeOption(option.key)}
                        aria-label="옵션 제거"
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
                  value={restaurantFilter}
                  onChange={(e) => setRestaurantFilter(e.target.value)}
                  placeholder="식당 이름으로 검색해서 옵션 추가"
                  className="w-full rounded-xl border border-black/10 bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                />
                {restaurantFilter.trim() && (
                  <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-xl border border-black/10 bg-surface p-1.5 shadow-soft">
                    {filteredRestaurants.length === 0 && (
                      <li className="px-2 py-1.5 text-xs text-ink-soft">일치하는 식당이 없어요.</li>
                    )}
                    {filteredRestaurants.map((r) => (
                      <li key={r.id}>
                        <button
                          onClick={() =>
                            addOption({
                              key: r.id,
                              label: r.name,
                              restaurantId: r.id,
                              category: getCategoryVisual(r.category, r.categoryLabel, r.name).label,
                            })
                          }
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-ink transition hover:bg-primary-light hover:text-primary-dark"
                        >
                          <span className="min-w-0 flex-1 truncate">{r.name}</span>
                          <span className="shrink-0 rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] text-ink-soft">
                            {getCategoryVisual(r.category, r.categoryLabel, r.name).label}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-2 flex gap-1.5">
                <input
                  value={customOptionText}
                  onChange={(e) => setCustomOptionText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addCustomOption()}
                  placeholder="목록에 없는 메뉴 직접 입력"
                  className="min-w-0 flex-1 rounded-xl border border-black/10 bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <button
                  onClick={addCustomOption}
                  disabled={!customOptionText.trim()}
                  className="shrink-0 rounded-xl bg-surface px-3.5 py-2 text-sm font-medium text-ink-soft ring-1 ring-inset ring-black/10 transition hover:bg-primary-light hover:text-primary-dark disabled:opacity-50"
                >
                  추가
                </button>
              </div>
            </div>

            <button
              onClick={handleCreateVote}
              disabled={creating || selectedOptions.length === 0}
              className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-50"
            >
              {creating ? "만드는 중..." : "투표 만들기"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface VoteCardProps {
  vote: VoteSummary;
  companyCode: string;
  myNickname: string;
  restaurants: RestaurantSummary[];
  expanded: boolean;
  onToggleExpand: () => void;
  onVoteUpdated: (vote: VoteSummary) => void;
  onNotify?: (message: string) => void;
}

// 투표 하나(옵션별 응답 현황 + 댓글)를 보여주는 카드.
//
// 2026-08-11 개편(firestore 과잉사용 분석 반영):
// - 목록에서 받은 vote는 responses/comments가 빈 배열인 "가벼운 요약"일 수 있다. 카드를 처음
//   펼칠 때(expanded가 true가 됐는데 아직 상세를 못 받았을 때)만 GET /api/votes/{id}로 그
//   투표 1건의 상세(응답+댓글)를 지연 로딩해서 onVoteUpdated로 반영한다. 한 번 로딩되면
//   detailLoadedRef로 표시해두고, 접었다 다시 펴도 재요청하지 않는다.
// - 응답(respond)/댓글(comment)/메뉴추가(option) 액션은 서버가 vote 전체를 돌려주지 않고
//   "무엇이 바뀌었는지"만 돌려준다. 이 컴포넌트가 그 델타를 현재 vote 객체에 병합해서
//   onVoteUpdated로 올린다 - 그 순간부터는 이 카드도 "상세를 이미 가지고 있는" 상태가 되므로
//   detailLoadedRef를 true로 표시해서, 그 사이 지연 로딩 요청이 늦게 도착해도 방금 반영한
//   변경을 덮어쓰지 않게 막는다(느린 네트워크에서 상세 로딩과 응답 클릭이 겹치는 드문 경우 대비).
function VoteCard({
  vote,
  companyCode,
  myNickname,
  restaurants,
  expanded,
  onToggleExpand,
  onVoteUpdated,
  onNotify,
}: VoteCardProps) {
  const [responding, setResponding] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const detailLoadedRef = useRef(false);

  // 2026-08-11 신규: 투표가 이미 만들어진 뒤에도 참가자가 메뉴(식당) 옵션을 더 추가할 수
  // 있게 하는 미니 검색/직접입력 상태 새 투표 만들기 폼과 같은 패턴).
  const [optionFilter, setOptionFilter] = useState("");
  const [customOptionText, setCustomOptionText] = useState("");
  const [addingOption, setAddingOption] = useState(false);

  useEffect(() => {
    if (!expanded || detailLoadedRef.current) return;
    setLoadingDetail(true);
    fetch(`/api/votes/${vote.id}?companyCode=${encodeURIComponent(companyCode)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.vote) return;
        // 상세 로딩 중에 사용자가 이미 응답/댓글/옵션추가를 해서 detailLoadedRef가 true가
        // 됐다면(방금 반영한 변경이 최신 상태), 늦게 도착한 이 결과로 덮어쓰지 않는다.
        if (detailLoadedRef.current) return;
        onVoteUpdated(data.vote);
        detailLoadedRef.current = true;
      })
      .catch(() => onNotify?.("투표 상세 정보를 불러오지 못했어요."))
      .finally(() => setLoadingDetail(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, vote.id]);

  const myResponse = vote.responses.find((r) => r.nickname === myNickname);

  const filteredRestaurantsForOption = useMemo(() => {
    const q = optionFilter.trim().toLowerCase();
    if (!q) return [];
    return restaurants
      .filter((r) => r.name.toLowerCase().includes(q))
      .filter((r) => !vote.options.some((o) => o.restaurantId === r.id))
      .slice(0, 10);
  }, [optionFilter, restaurants, vote.options]);

  async function handleAddOption(payload: { label: string; restaurantId?: string }) {
    setAddingOption(true);
    try {
      const res = await fetch(`/api/votes/${vote.id}/options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify?.(data.error ?? "메뉴를 추가하지 못했어요.");
        return;
      }
      detailLoadedRef.current = true;
      onVoteUpdated({ ...vote, options: data.options });
      setOptionFilter("");
    } catch {
      onNotify?.("네트워크 오류로 메뉴를 추가하지 못했어요.");
    } finally {
      setAddingOption(false);
    }
  }

  function handleAddCustomOption() {
    const label = customOptionText.trim();
    if (!label) return;
    setCustomOptionText("");
    handleAddOption({ label });
  }

  async function respond(optionId: string) {
    setResponding(true);
    try {
      const res = await fetch(`/api/votes/${vote.id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, optionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify?.(data.error ?? "투표에 응답하지 못했어요.");
        return;
      }
      // 서버는 델타(removed/entry)만 돌려준다 - 내 예전 응답을 지우고, 취소가 아니면 새
      // 응답으로 채운다. nicknameId 대신 nickname으로 내 응답을 찾는 건 myResponse와 동일한
      // 방식(이 앱은 nickname이 회사 내에서 유일하다는 전제를 그대로 따른다).
      const filtered = vote.responses.filter((r) => r.nickname !== myNickname);
      const newResponses = data.removed ? filtered : [...filtered, data.entry];
      detailLoadedRef.current = true;
      onVoteUpdated({ ...vote, responses: newResponses });
    } catch {
      onNotify?.("네트워크 오류로 응답하지 못했어요.");
    } finally {
      setResponding(false);
    }
  }

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentText.trim()) return;
    setSubmittingComment(true);
    try {
      const res = await fetch(`/api/votes/${vote.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, content: commentText.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify?.(data.error ?? "댓글을 남기지 못했어요.");
        return;
      }
      // 새 댓글은 항상 가장 최근 createdAt을 가지므로 배열 끝에 그대로 append하면 된다
      // (서버 hydrateVote도 createdAt 오름차순으로 정렬해서 내려주던 것과 동일한 순서).
      detailLoadedRef.current = true;
      onVoteUpdated({ ...vote, comments: [...vote.comments, data.comment] });
      setCommentText("");
    } catch {
      onNotify?.("네트워크 오류로 댓글을 남기지 못했어요.");
    } finally {
      setSubmittingComment(false);
    }
  }

  return (
    <li className="rounded-xl2 border border-black/5 p-3">
      <div className="cursor-pointer" onClick={onToggleExpand}>
        <p className="text-sm font-semibold text-ink">{vote.title}</p>
        <p className="mt-0.5 text-xs text-ink-soft">
          {vote.creatorNickname}님이 만듦 · {formatRelativeTime(vote.createdAt)} · 참가자{" "}
          {vote.participantNicknameIds.length}명
        </p>
      </div>

      {expanded && (
        <div className="mt-3 flex flex-col gap-3">
          {loadingDetail && vote.responses.length === 0 && vote.comments.length === 0 && (
            <p className="text-xs text-ink-soft">응답/댓글을 불러오는 중...</p>
          )}
          <ul className="flex flex-col gap-1.5">
            {vote.options.map((option) => {
              const voters = vote.responses.filter((r) => r.optionId === option.id);
              const isMine = myResponse?.optionId === option.id;
              return (
                <li key={option.id}>
                  <button
                    onClick={() => respond(option.id)}
                    disabled={responding}
                    title={isMine ? "다시 누르면 취소돼요" : undefined}
                    className={[
                      "flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition disabled:opacity-60",
                      isMine ? "border-primary bg-primary-light" : "border-black/10 hover:border-primary/40",
                    ].join(" ")}
                  >
                    <span className={isMine ? "font-semibold text-primary-dark" : "text-ink"}>
                      {option.label}
                    </span>
                    <span className="shrink-0 text-xs text-ink-soft">{voters.length}명</span>
                  </button>
                  {voters.length > 0 && (
                    <p className="mt-0.5 px-1 text-[11px] text-ink-soft">
                      {voters.map((v) => v.nickname).join(", ")}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          {/* 2026-08-11 신규: 투표 생성 이후에도 참가자 누구나 메뉴를 더 추가할 수 있게 하는 미니 폼. */}
          <div className="rounded-xl border border-dashed border-black/15 p-2.5">
            <p className="mb-1.5 text-[11px] font-medium text-ink-soft">메뉴 추가하기</p>
            <div className="relative">
              <input
                value={optionFilter}
                onChange={(e) => setOptionFilter(e.target.value)}
                placeholder="식당 이름으로 검색해서 추가"
                className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-xs outline-none focus:border-primary"
              />
              {optionFilter.trim() && (
                <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-40 overflow-y-auto rounded-lg border border-black/10 bg-surface p-1 shadow-soft">
                  {filteredRestaurantsForOption.length === 0 && (
                    <li className="px-2 py-1.5 text-xs text-ink-soft">일치하는 식당이 없어요.</li>
                  )}
                  {filteredRestaurantsForOption.map((r) => (
                    <li key={r.id}>
                      <button
                        onClick={() => handleAddOption({ label: r.name, restaurantId: r.id })}
                        disabled={addingOption}
                        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-ink transition hover:bg-primary-light hover:text-primary-dark disabled:opacity-50"
                      >
                        <span className="min-w-0 flex-1 truncate">{r.name}</span>
                        <span className="shrink-0 text-[10px] text-ink-soft">+ 추가</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <input
                value={customOptionText}
                onChange={(e) => setCustomOptionText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddCustomOption()}
                placeholder="목록에 없는 메뉴 직접 입력"
                className="min-w-0 flex-1 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs outline-none focus:border-primary"
              />
              <button
                onClick={handleAddCustomOption}
                disabled={addingOption || !customOptionText.trim()}
                className="shrink-0 rounded-lg bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-soft ring-1 ring-inset ring-black/10 transition hover:bg-primary-light hover:text-primary-dark disabled:opacity-50"
              >
                추가
              </button>
            </div>
          </div>

          <div className="border-t border-black/5 pt-2">
            <p className="mb-1.5 text-xs font-semibold text-ink-soft">댓글</p>
            {vote.comments.length === 0 && !loadingDetail && (
              <p className="text-xs text-ink-soft">아직 댓글이 없어요.</p>
            )}
            <ul className="flex flex-col gap-1.5">
              {vote.comments.map((comment) => (
                <li key={comment.id} className="rounded-lg bg-surface-muted p-2">
                  <p className="text-xs text-ink">{comment.content}</p>
                  <p className="mt-0.5 text-[11px] text-ink-soft">{comment.authorNickname}</p>
                </li>
              ))}
            </ul>
            <form onSubmit={submitComment} className="mt-2 flex gap-1.5">
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="댓글 남기기"
                className="min-w-0 flex-1 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs outline-none focus:border-primary"
              />
              <button
                type="submit"
                disabled={submittingComment || !commentText.trim()}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
              >
                등록
              </button>
            </form>
          </div>
        </div>
      )}
    </li>
  );
}
