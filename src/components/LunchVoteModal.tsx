"use client";

import { useEffect, useMemo, useState } from "react";
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
// 2026-08-06 3차 개편:
// - 참가자 초대를 "친구목록에 있는 사람만"에서 "회사 내 누구나"로 완화했다. 친구목록은 그대로
//   두되 "빠르게 선택"하는 보조 UI로 남기고, 별도로 전체 사용자 검색창을 추가했다.
// - 메뉴(식당) 옵션 검색 결과/선택된 칩에 카테고리 라벨(예: "중식")을 작게 같이 보여준다.
// - 투표함 탭에 검색창 + 10개씩 페이징을 추가했다(서버가 이미 최신순으로 내려주므로 정렬은
//   그대로 두고, 클라이언트에서 검색 필터링 + 페이지 자르기만 한다).
export default function LunchVoteModal({
  companyCode,
  myNickname,
  restaurants,
  open,
  onClose,
  onNotify,
  focusVoteId,
}: LunchVoteModalProps) {
  const [tab, setTab] = useState<"list" | "create">("list");
  const [loading, setLoading] = useState(false);
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [companyUsers, setCompanyUsers] = useState<CompanyUserEntry[]>([]);
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

  function loadAll() {
    setLoading(true);
    Promise.all([
      fetch(`/api/friends?companyCode=${encodeURIComponent(companyCode)}`).then((r) => r.json()),
      fetch(`/api/votes?companyCode=${encodeURIComponent(companyCode)}`).then((r) => r.json()),
      fetch(`/api/users?companyCode=${encodeURIComponent(companyCode)}`).then((r) => r.json()),
    ])
      .then(([friendsData, votesData, usersData]) => {
        setFriends(friendsData.friends ?? []);
        setVotes(votesData.votes ?? []);
        setCompanyUsers(usersData.users ?? []);
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
    return companyUsers.filter((u) => u.nickname.toLowerCase().includes(q)).slice(0, 20);
  }, [participantSearch, companyUsers]);

  const filteredRestaurants = useMemo(() => {
    const q = restaurantFilter.trim().toLowerCase();
    if (!q) return [];
    return restaurants.filter((r) => r.name.toLowerCase().includes(q)).slice(0, 15);
  }, [restaurantFilter, restaurants]);

  if (!open) return null;

  function toggleParticipant(nicknameId: string) {
    setSelectedParticipantIds((prev) => {
      const next = new Set(prev);
      next.has(nicknameId) ? next.delete(nicknameId) : next.add(nicknameId);
      return next;
    });
  }

  function addOption(option: DraftOption) {
    setSelectedOptions((prev) => (prev.some((o) => o.key === option.key) ? prev : [...prev, option]));
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

  function handleVoteUpdated(updated: VoteSummary) {
    setVotes((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-xl2 bg-surface p-5 shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">🍚 오늘 점심 투표</h3>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="rounded-full p-1 text-ink-soft transition hover:bg-surface-muted"
          >
            ✕
          </button>
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
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">투표 제목</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="오늘 점심 뭐 먹지?"
                className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">
                참가자 초대 (누구나 초대할 수 있어요)
              </label>

              {selectedParticipantIds.size > 0 && (
                <ul className="mb-1.5 flex flex-wrap gap-1.5">
                  {Array.from(selectedParticipantIds).map((id) => (
                    <li
                      key={id}
                      className="flex items-center gap-1 rounded-full bg-primary-light px-2.5 py-1 text-xs text-primary-dark"
                    >
                      {nicknameById.get(id) ?? id}
                      <button onClick={() => toggleParticipant(id)} aria-label="참가자 제거">
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <input
                value={participantSearch}
                onChange={(e) => setParticipantSearch(e.target.value)}
                placeholder="닉네임으로 검색해서 초대"
                className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
              />
              {participantSearch.trim() && (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {filteredParticipantUsers.length === 0 && (
                    <li className="text-xs text-ink-soft">일치하는 닉네임이 없어요.</li>
                  )}
                  {filteredParticipantUsers.map((u) => (
                    <li key={u.nicknameId}>
                      <button
                        onClick={() => toggleParticipant(u.nicknameId)}
                        className={[
                          "w-full rounded-lg border px-2.5 py-1.5 text-left text-xs transition",
                          selectedParticipantIds.has(u.nicknameId)
                            ? "border-primary bg-primary-light text-primary-dark"
                            : "border-black/10 hover:border-primary",
                        ].join(" ")}
                      >
                        {u.nickname} {selectedParticipantIds.has(u.nicknameId) ? "· 선택됨" : ""}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {friends.length > 0 && (
                <div className="mt-2">
                  <p className="mb-1 text-[11px] text-ink-soft">내 친구 중에서 빠르게 선택</p>
                  <ul className="flex flex-wrap gap-1.5">
                    {friends.map((friend) => (
                      <li key={friend.nicknameId}>
                        <button
                          onClick={() => toggleParticipant(friend.nicknameId)}
                          className={[
                            "rounded-full px-3 py-1.5 text-xs font-medium transition",
                            selectedParticipantIds.has(friend.nicknameId)
                              ? "bg-primary text-white"
                              : "bg-surface-muted text-ink-soft hover:bg-primary-light",
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

            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">메뉴(식당) 옵션</label>
              {selectedOptions.length > 0 && (
                <ul className="mb-1.5 flex flex-wrap gap-1.5">
                  {selectedOptions.map((option) => (
                    <li
                      key={option.key}
                      className="flex items-center gap-1 rounded-full bg-primary-light px-2.5 py-1 text-xs text-primary-dark"
                    >
                      {option.label}
                      {option.category && (
                        <span className="text-[10px] text-primary-dark/70">· {option.category}</span>
                      )}
                      <button onClick={() => removeOption(option.key)} aria-label="옵션 제거">
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <input
                value={restaurantFilter}
                onChange={(e) => setRestaurantFilter(e.target.value)}
                placeholder="식당 이름으로 검색해서 옵션 추가"
                className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
              />
              {restaurantFilter.trim() && (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {filteredRestaurants.length === 0 && (
                    <li className="text-xs text-ink-soft">일치하는 식당이 없어요.</li>
                  )}
                  {filteredRestaurants.map((r) => (
                    <li key={r.id}>
                      <button
                        onClick={() =>
                          addOption({
                            key: r.id,
                            label: r.name,
                            restaurantId: r.id,
                            category: getCategoryVisual(r.category).label,
                          })
                        }
                        disabled={selectedOptions.some((o) => o.key === r.id)}
                        className="flex w-full items-center gap-1.5 rounded-lg border border-black/10 px-2.5 py-1.5 text-left text-xs transition hover:border-primary disabled:opacity-50"
                      >
                        <span className="min-w-0 flex-1 truncate">{r.name}</span>
                        <span className="shrink-0 rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] text-ink-soft">
                          {getCategoryVisual(r.category).label}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-1.5 flex gap-1.5">
                <input
                  value={customOptionText}
                  onChange={(e) => setCustomOptionText(e.target.value)}
                  placeholder="목록에 없는 메뉴 직접 입력"
                  className="min-w-0 flex-1 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs outline-none focus:border-primary"
                />
                <button
                  onClick={addCustomOption}
                  className="rounded-lg bg-surface-muted px-2.5 py-1.5 text-xs font-medium text-ink-soft transition hover:bg-primary-light"
                >
                  추가
                </button>
              </div>
            </div>

            <button
              onClick={handleCreateVote}
              disabled={creating}
              className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
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
  expanded: boolean;
  onToggleExpand: () => void;
  onVoteUpdated: (vote: VoteSummary) => void;
  onNotify?: (message: string) => void;
}

// 투표 하나(옵션별 응답 현황 + 댓글)를 보여주는 카드. 응답/댓글 이후에는 서버가 돌려주는
// 최신 vote 전체를 그대로 반영한다(부분 상태 갱신보다 단순하고 항상 일관됨).
function VoteCard({
  vote,
  companyCode,
  myNickname,
  expanded,
  onToggleExpand,
  onVoteUpdated,
  onNotify,
}: VoteCardProps) {
  const [responding, setResponding] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);

  const myResponse = vote.responses.find((r) => r.nickname === myNickname);

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
      onVoteUpdated(data.vote);
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
      onVoteUpdated(data.vote);
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
          <ul className="flex flex-col gap-1.5">
            {vote.options.map((option) => {
              const voters = vote.responses.filter((r) => r.optionId === option.id);
              const isMine = myResponse?.optionId === option.id;
              return (
                <li key={option.id}>
                  <button
                    onClick={() => respond(option.id)}
                    disabled={responding}
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

          <div className="border-t border-black/5 pt-2">
            <p className="mb-1.5 text-xs font-semibold text-ink-soft">댓글</p>
            {vote.comments.length === 0 && (
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
