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
}

// 2026-08-06 신규: 친구목록 모달. "직접 추가" 모달과 동일한 fixed inset-0 오버레이 패턴을 따른다.
// 단방향 추가(상대방 동의 불필요) - 검색해서 찾은 사람에게 간단한 메모를 남기고 바로 추가한다.
export default function FriendsModal({
  companyCode,
  open,
  onClose,
  onNotify,
  onFriendsChanged,
  prefillNickname,
}: FriendsModalProps) {
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [companyUsers, setCompanyUsers] = useState<CompanyUserEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [addingNicknameId, setAddingNicknameId] = useState<string | null>(null);
  const [memoDraft, setMemoDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingMemoId, setEditingMemoId] = useState<string | null>(null);
  const [editingMemoDraft, setEditingMemoDraft] = useState("");

  useEffect(() => {
    if (!open) return;
    setSearch(prefillNickname ?? "");
    setLoading(true);
    Promise.all([
      fetch(`/api/friends?companyCode=${encodeURIComponent(companyCode)}`).then((r) => r.json()),
      fetch(`/api/users?companyCode=${encodeURIComponent(companyCode)}`).then((r) => r.json()),
    ])
      .then(([friendsData, usersData]) => {
        setFriends(friendsData.friends ?? []);
        setCompanyUsers(usersData.users ?? []);
      })
      .catch(() => onNotify?.("친구목록을 불러오지 못했어요."))
      .finally(() => setLoading(false));
  }, [open, companyCode, prefillNickname, onNotify]);

  const friendIds = useMemo(() => new Set(friends.map((f) => f.nicknameId)), [friends]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return companyUsers.filter((u) => u.nickname.toLowerCase().includes(q)).slice(0, 20);
  }, [search, companyUsers]);

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
          <h3 className="text-base font-bold text-ink">👥 친구목록</h3>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="rounded-full p-1 text-ink-soft transition hover:bg-surface-muted"
          >
            ✕
          </button>
        </div>

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
                    {friendIds.has(user.nicknameId) ? (
                      <span className="text-xs text-ink-soft">이미 친구</span>
                    ) : addingNicknameId === user.nicknameId ? null : (
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

        <div className="border-t border-black/5 pt-2">
          <p className="mb-2 text-xs font-semibold text-ink-soft">
            내 친구 {friends.length > 0 ? `(${friends.length}명)` : ""}
          </p>
          {loading && <p className="text-sm text-ink-soft">불러오는 중...</p>}
          {!loading && friends.length === 0 && (
            <p className="text-sm text-ink-soft">아직 추가한 친구가 없어요. 위에서 검색해서 추가해보세요.</p>
          )}
          <ul className="flex flex-col gap-1.5">
            {friends.map((friend) => (
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
