"use client";

import { useEffect, useMemo, useState } from "react";

export interface FriendEntry {
  nicknameId: string;
  nickname: string;
  memo: string;
  addedAt: string;
}

interface CompanyUserEntry {
  nicknameId: string;
  nickname: string;
}

interface FriendsModalProps {
  companyCode: string;
  open: boolean;
  onClose: () => void;
  onNotify?: (message: string) => void;
  onFriendsChanged?: (friends: FriendEntry[]) => void;
  // 알림함의 "나도 추가하기"에서 열 때 검색창에 미리 채워주는 닉네임 (2026-08-06 신규).
  prefillNickname?: string | null;
  // 2026-08-11 신규(firestore 과잉사용 분석 반영): 예전엔 이 모달이 열릴 때마다 직접
  // /api/users를 불렀다 - LunchVoteModal/LunchRouletteModal도 각자 같은 목록을 따로
  // 불러오고 있어서, 세 모달을 순서대로 열면 같은 목록을 3번 재조회하는 낭비가 있었다.
  // CompanyHome이 1회만 불러와 공유하는 값을 props로 물려받는다.
  companyUsers: CompanyUserEntry[];
}

// 한 번에 더 보여주는 단위. 숫자 페이징(1,2,3...) 대신 "더보기"를 누를 때마다 이만큼씩 늘어난다.
const ALL_USERS_PAGE_SIZE = 20;

// 2026-08-06 신규: 친구목록 모달. "직접 추가" 모달과 동일한 fixed inset-0 오버레이 패턴을 따른다.
// 단방향 추가(상대방 동의 불필요) - 검색해서 찾은 사람에게 간단한 메모를 남기고 바로 추가한다.
//
// 2026-08-06 추가: 검색 탭 옆에 "전체 목록" 탭을 신설 - 회사 전체 사용자를 닉네임 가나다순으로
// 정렬해서 보여주고, 체크박스로 여러 명을 한 번에 선택한 뒤 "선택한 N명 추가하기"로 일괄 추가할
// 수 있게 한다. 서버에 별도 배치(batch) API를 새로 만들지 않고, 기존 단건 POST /api/friends를
// 선택된 인원 수만큼 순차 호출하는 방식으로 처리한다(토이 프로젝트 규모라 순차 호출로도 충분).
//
// 2026-08-06 추가2: 이미 친구인 사람은 "이미 친구" 배지로 남겨두는 대신, 검색 결과와 전체 목록
// 둘 다에서 처음부터 제외한다(사용자 요청). 두 탭이 보는 대상 풀 자체를 nonFriendUsers로
// 미리 걸러두고, 검색/정렬/페이징은 전부 그 풀 위에서만 이뤄진다.
//
// 2026-08-10 신규: "내 친구" 목록에 검색창 추가 - 닉네임뿐 아니라 메모(예: "마케팅팀 김OO")로도
// 필터링된다. 친구 추가/전체목록 탭의 검색(회사 전체 사용자 대상)과는 별개의, 이미 추가한 내
// 친구들만 대상으로 하는 검색이라 상태를 분리했다(myFriendsSearch).
//
// 2026-08-11 개편(firestore 과잉사용 분석 반영): companyUsers(회사 전체 사용자 목록)를 이 모달이
// 직접 fetch하지 않는다 - CompanyHome이 페이지 진입 시 1회만 불러와서 props로 내려주는 값을
// 그대로 쓴다. LunchVoteModal/LunchRouletteModal도 같은 값을 공유해서, 세 모달을 순서대로 열어도
// 같은 목록을 3번 재조회하던 낭비가 없어졌다.
export default function FriendsModal({
  companyCode,
  open,
  onClose,
  onNotify,
  onFriendsChanged,
  prefillNickname,
  companyUsers,
}: FriendsModalProps) {
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"search" | "all">("search");
  const [search, setSearch] = useState("");
  const [addingNicknameId, setAddingNicknameId] = useState<string | null>(null);
  const [memoDraft, setMemoDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingMemoId, setEditingMemoId] = useState<string | null>(null);
  const [editingMemoDraft, setEditingMemoDraft] = useState("");

  // "전체 목록" 탭 전용 상태 - 다중 선택 체크박스 + "더보기" 페이징.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [visibleAllUsersCount, setVisibleAllUsersCount] = useState(ALL_USERS_PAGE_SIZE);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  // 2026-08-10 신규: "내 친구" 목록 검색 (닉네임 + 메모).
  const [myFriendsSearch, setMyFriendsSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    setSearch(prefillNickname ?? "");
    setActiveTab("search");
    setSelectedIds(new Set());
    setVisibleAllUsersCount(ALL_USERS_PAGE_SIZE);
    setMyFriendsSearch("");
    setLoading(true);
    fetch(`/api/friends?companyCode=${encodeURIComponent(companyCode)}`)
      .then((r) => r.json())
      .then((friendsData) => setFriends(friendsData.friends ?? []))
      .catch(() => onNotify?.("친구목록을 불러오지 못했어요."))
      .finally(() => setLoading(false));
  }, [open, companyCode, prefillNickname, onNotify]);

  const friendIds = useMemo(() => new Set(friends.map((f) => f.nicknameId)), [friends]);

  // 검색/전체목록 두 탭이 공통으로 바라보는 "아직 친구가 아닌 사용자" 풀.
  const nonFriendUsers = useMemo(
    () => companyUsers.filter((u) => !friendIds.has(u.nicknameId)),
    [companyUsers, friendIds]
  );

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return nonFriendUsers.filter((u) => u.nickname.toLowerCase().includes(q)).slice(0, 20);
  }, [search, nonFriendUsers]);

  // 닉네임 가나다순(ㄱㄴㄷ 순)으로 정렬 - "전체 목록" 탭에서만 쓰인다.
  const allUsersSorted = useMemo(
    () => [...nonFriendUsers].sort((a, b) => a.nickname.localeCompare(b.nickname, "ko")),
    [nonFriendUsers]
  );
  const visibleAllUsers = allUsersSorted.slice(0, visibleAllUsersCount);
  const hasMoreAllUsers = visibleAllUsersCount < allUsersSorted.length;

  // 2026-08-10 신규: "내 친구" 목록 필터링 - 닉네임 또는 메모 중 하나라도 검색어를 포함하면 노출.
  // addedAt 최신순은 friends 배열 자체가 이미 그 순서로 들어오니(listFriends 참고) 필터만 걸어도
  // 순서가 유지된다.
  const filteredFriends = useMemo(() => {
    const q = myFriendsSearch.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter(
      (f) => f.nickname.toLowerCase().includes(q) || f.memo.toLowerCase().includes(q)
    );
  }, [friends, myFriendsSearch]);

  if (!open) return null;

  function startAdding(user: CompanyUserEntry) {
    setAddingNicknameId(user.nicknameId);
    setMemoDraft("");
  }

  async function confirmAdd(user: CompanyUserEntry) {
    setSubmitting(true);
    try {
      const res = await fetch("/api/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, friendNickname: user.nickname, memo: memoDraft }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify?.(data.error ?? "친구 추가에 실패했어요.");
        return;
      }
      const next = [data.friend as FriendEntry, ...friends.filter((f) => f.nicknameId !== data.friend.nicknameId)];
      setFriends(next);
      onFriendsChanged?.(next);
      onNotify?.(`"${user.nickname}"님을 친구로 추가했어요.`);
      setAddingNicknameId(null);
      setMemoDraft("");
    } catch {
      onNotify?.("네트워크 오류로 친구를 추가하지 못했어요.");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleSelect(nicknameId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nicknameId)) next.delete(nicknameId);
      else next.add(nicknameId);
      return next;
    });
  }

  // 선택된 인원 전체를 순차적으로 POST /api/friends 호출해서 한 번에 추가한다. 일부만 실패해도
  // (예: 그 사이 상대가 탈퇴) 나머지는 계속 진행하고, 끝나면 성공/실패 인원수를 함께 알려준다.
  async function confirmBulkAdd() {
    if (selectedIds.size === 0 || bulkSubmitting) return;
    setBulkSubmitting(true);

    const targets = allUsersSorted.filter((u) => selectedIds.has(u.nicknameId));
    const added: FriendEntry[] = [];
    let failCount = 0;

    for (const user of targets) {
      try {
        const res = await fetch("/api/friends", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyCode, friendNickname: user.nickname, memo: "" }),
        });
        const data = await res.json();
        if (res.ok) {
          added.push(data.friend as FriendEntry);
        } else {
          failCount += 1;
        }
      } catch {
        failCount += 1;
      }
    }

    if (added.length > 0) {
      const addedIds = new Set(added.map((f) => f.nicknameId));
      const next = [...added, ...friends.filter((f) => !addedIds.has(f.nicknameId))];
      setFriends(next);
      onFriendsChanged?.(next);
    }

    setSelectedIds(new Set());
    setBulkSubmitting(false);

    if (failCount > 0) {
      onNotify?.(`${added.length}명 추가 완료, ${failCount}명은 실패했어요.`);
    } else if (added.length > 0) {
      onNotify?.(`${added.length}명을 친구로 추가했어요.`);
    }
  }

  async function removeFriendEntry(friend: FriendEntry) {
    try {
      const res = await fetch("/api/friends", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, friendNicknameId: friend.nicknameId }),
      });
      if (!res.ok) {
        onNotify?.("친구 삭제에 실패했어요.");
        return;
      }
      const next = friends.filter((f) => f.nicknameId !== friend.nicknameId);
      setFriends(next);
      onFriendsChanged?.(next);
    } catch {
      onNotify?.("네트워크 오류로 삭제하지 못했어요.");
    }
  }

  function startEditingMemo(friend: FriendEntry) {
    setEditingMemoId(friend.nicknameId);
    setEditingMemoDraft(friend.memo);
  }

  async function saveMemo(friend: FriendEntry) {
    setEditingMemoId(null);
    if (editingMemoDraft === friend.memo) return;
    try {
      await fetch("/api/friends", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyCode, friendNicknameId: friend.nicknameId, memo: editingMemoDraft }),
      });
      const next = friends.map((f) =>
        f.nicknameId === friend.nicknameId ? { ...f, memo: editingMemoDraft } : f
      );
      setFriends(next);
      onFriendsChanged?.(next);
    } catch {
      onNotify?.("메모 저장에 실패했어요.");
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-xl2 bg-surface p-5 shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-ink">친구목록</h3>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="rounded-full p-1 text-ink-soft transition hover:bg-surface-muted"
          >
            ✕
          </button>
        </div>

        <div className="flex gap-1 rounded-xl bg-surface-muted p-1">
          <button
            onClick={() => setActiveTab("search")}
            className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition ${
              activeTab === "search" ? "bg-surface text-ink shadow-soft" : "text-ink-soft"
            }`}
          >
            검색해서 추가
          </button>
          <button
            onClick={() => setActiveTab("all")}
            className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition ${
              activeTab === "all" ? "bg-surface text-ink shadow-soft" : "text-ink-soft"
            }`}
          >
            전체 목록
          </button>
        </div>

        {activeTab === "search" && (
          <div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="닉네임으로 검색해서 추가하기"
              className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
              autoFocus={Boolean(prefillNickname)}
            />
            {search.trim() && (
              <ul className="mt-2 flex flex-col gap-1.5">
                {searchResults.length === 0 && (
                  <li className="text-xs text-ink-soft">일치하는 닉네임이 없어요.</li>
                )}
                {searchResults.map((user) => (
                  <li key={user.nicknameId} className="rounded-xl border border-black/10 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink">{user.nickname}</span>
                      {addingNicknameId === user.nicknameId ? null : (
                        <button
                          onClick={() => startAdding(user)}
                          className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white transition hover:bg-primary-dark"
                        >
                          + 추가
                        </button>
                      )}
                    </div>
                    {addingNicknameId === user.nicknameId && (
                      <div className="mt-2 flex flex-col gap-1.5">
                        <input
                          value={memoDraft}
                          onChange={(e) => setMemoDraft(e.target.value)}
                          placeholder="메모 (선택, 예: 마케팅팀 김OO)"
                          className="rounded-lg border border-black/10 px-2.5 py-1.5 text-xs outline-none focus:border-primary"
                          autoFocus
                        />
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => confirmAdd(user)}
                            disabled={submitting}
                            className="flex-1 rounded-lg bg-primary px-2 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
                          >
                            {submitting ? "추가하는 중..." : "친구로 추가"}
                          </button>
                          <button
                            onClick={() => setAddingNicknameId(null)}
                            className="rounded-lg px-2 py-1.5 text-xs text-ink-soft hover:bg-surface-muted"
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {activeTab === "all" && (
          <div>
            {loading && <p className="text-sm text-ink-soft">불러오는 중...</p>}
            {!loading && allUsersSorted.length === 0 && (
              <p className="text-sm text-ink-soft">추가할 수 있는 사용자가 없어요.</p>
            )}
            {!loading && allUsersSorted.length > 0 && (
              <>
                <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1">
                  {visibleAllUsers.map((user) => {
                    const checked = selectedIds.has(user.nicknameId);
                    return (
                      <li
                        key={user.nicknameId}
                        className="flex items-center gap-2 rounded-xl border border-black/5 p-2.5"
                      >
                        <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm text-ink">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSelect(user.nicknameId)}
                            className="h-4 w-4 accent-primary"
                          />
                          {user.nickname}
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {hasMoreAllUsers && (
                  <button
                    onClick={() => setVisibleAllUsersCount((c) => c + ALL_USERS_PAGE_SIZE)}
                    className="mt-2 w-full rounded-lg border border-black/10 py-1.5 text-xs text-ink-soft transition hover:bg-surface-muted"
                  >
                    더보기 ({allUsersSorted.length - visibleAllUsersCount}명 더)
                  </button>
                )}
                <button
                  onClick={confirmBulkAdd}
                  disabled={selectedIds.size === 0 || bulkSubmitting}
                  className="mt-2 w-full rounded-lg bg-primary py-2 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-50"
                >
                  {bulkSubmitting ? "추가하는 중..." : `선택한 ${selectedIds.size}명 추가하기`}
                </button>
              </>
            )}
          </div>
        )}

        <div className="border-t border-black/5 pt-2">
          <p className="mb-2 text-xs font-semibold text-ink-soft">
            내 친구 {friends.length > 0 ? `(${friends.length}명)` : ""}
          </p>

          {/* 2026-08-10 신규: 닉네임/메모 통합 검색. 친구가 없거나 로딩 중이면 검색창 자체를
              숨겨서 빈 화면에 검색창만 덜렁 떠 있는 걸 피한다. */}
          {!loading && friends.length > 0 && (
            <input
              value={myFriendsSearch}
              onChange={(e) => setMyFriendsSearch(e.target.value)}
              placeholder="닉네임 또는 메모로 검색 (예: 마케팅팀)"
              className="mb-2 w-full rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-primary"
            />
          )}

          {loading && <p className="text-sm text-ink-soft">불러오는 중...</p>}
          {!loading && friends.length === 0 && (
            <p className="text-sm text-ink-soft">아직 추가한 친구가 없어요. 위에서 검색해서 추가해보세요.</p>
          )}
          {!loading && friends.length > 0 && filteredFriends.length === 0 && (
            <p className="text-sm text-ink-soft">검색 결과가 없어요.</p>
          )}
          <ul className="flex flex-col gap-1.5">
            {filteredFriends.map((friend) => (
              <li key={friend.nicknameId} className="rounded-xl border border-black/5 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ink">{friend.nickname}</span>
                  <button
                    onClick={() => removeFriendEntry(friend)}
                    aria-label="친구 삭제"
                    className="text-xs text-ink-soft transition hover:text-primary-dark"
                  >
                    삭제
                  </button>
                </div>
                {editingMemoId === friend.nicknameId ? (
                  <input
                    value={editingMemoDraft}
                    onChange={(e) => setEditingMemoDraft(e.target.value)}
                    onBlur={() => saveMemo(friend)}
                    onKeyDown={(e) => e.key === "Enter" && saveMemo(friend)}
                    placeholder="메모 입력"
                    autoFocus
                    className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1 text-xs outline-none focus:border-primary"
                  />
                ) : (
                  <button
                    onClick={() => startEditingMemo(friend)}
                    className="mt-1 block text-left text-xs text-ink-soft hover:text-primary-dark"
                  >
                    {friend.memo ? friend.memo : "+ 메모 추가"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
