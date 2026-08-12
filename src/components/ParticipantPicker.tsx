"use client";

import { useEffect, useMemo, useState } from "react";
import type { MiniGameParticipant } from "@/types";

interface FriendEntry {
  nicknameId: string;
  nickname: string;
}

interface CompanyUserEntry {
  nicknameId: string;
  nickname: string;
}

interface ParticipantPickerProps {
  companyCode: string;
  companyUsers: CompanyUserEntry[];
  participants: MiniGameParticipant[];
  onChange: (participants: MiniGameParticipant[]) => void;
}

let guestSeq = 0;
function makeGuestId(): string {
  guestSeq += 1;
  return `guest:${Date.now()}:${guestSeq}`;
}

// 미니게임 4종(제비뽑기/룰렛/사다리타기/팀나누기)이 전부 공유하는 참가자 등록 컴포넌트.
// 3가지 방법을 지원한다: (1) 닉네임 검색으로 lunchtime 가입자 초대, (2) 내 친구 목록에서
// 빠른 선택, (3) 계정 없는 사람을 이름으로 직접 추가(게스트). LunchRouletteModal.tsx의
// 참가자 초대 UI 패턴을 그대로 재사용했다.
export default function ParticipantPicker({
  companyCode,
  companyUsers,
  participants,
  onChange,
}: ParticipantPickerProps) {
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [search, setSearch] = useState("");
  const [guestName, setGuestName] = useState("");

  useEffect(() => {
    fetch(`/api/friends?companyCode=${encodeURIComponent(companyCode)}`)
      .then((r) => r.json())
      .then((d) => setFriends(d.friends ?? []))
      .catch(() => {
        // 친구 빠른선택은 부가 기능이라 실패해도 조용히 무시한다(검색/수기입력은 그대로 동작).
      });
  }, [companyCode]);

  const selectedIds = useMemo(() => new Set(participants.map((p) => p.id)), [participants]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return companyUsers
      .filter((u) => u.nickname.toLowerCase().includes(q))
      .filter((u) => !selectedIds.has(u.nicknameId))
      .slice(0, 20);
  }, [search, companyUsers, selectedIds]);

  function addRegistered(u: CompanyUserEntry) {
    onChange([...participants, { id: u.nicknameId, name: u.nickname, nicknameId: u.nicknameId, isGuest: false }]);
    setSearch("");
  }

  function toggleFriend(f: FriendEntry) {
    if (selectedIds.has(f.nicknameId)) {
      onChange(participants.filter((p) => p.id !== f.nicknameId));
    } else {
      onChange([
        ...participants,
        { id: f.nicknameId, name: f.nickname, nicknameId: f.nicknameId, isGuest: false },
      ]);
    }
  }

  function addGuest() {
    const name = guestName.trim();
    if (!name) return;
    onChange([...participants, { id: makeGuestId(), name, nicknameId: null, isGuest: true }]);
    setGuestName("");
  }

  function removeParticipant(id: string) {
    onChange(participants.filter((p) => p.id !== id));
  }

  return (
    <div className="flex flex-col gap-3">
      {participants.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {participants.map((p) => (
            <li
              key={p.id}
              className={[
                "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                p.isGuest ? "border border-dashed border-black/20 text-ink-soft" : "bg-primary text-white",
              ].join(" ")}
            >
              {p.name}
              {p.isGuest && <span className="text-[10px]">(게스트)</span>}
              <button
                onClick={() => removeParticipant(p.id)}
                aria-label="참가자 삭제"
                className={p.isGuest ? "text-ink-soft/70 hover:text-ink-soft" : "text-white/80 hover:text-white"}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="닉네임으로 검색해서 추가"
          className="w-full rounded-xl border border-black/10 bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
        />
        {search.trim() && (
          <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-40 overflow-y-auto rounded-xl border border-black/10 bg-surface p-1.5 shadow-soft">
            {filteredUsers.length === 0 && (
              <li className="px-2 py-1.5 text-xs text-ink-soft">일치하는 닉네임이 없어요.</li>
            )}
            {filteredUsers.map((u) => (
              <li key={u.nicknameId}>
                <button
                  onClick={() => addRegistered(u)}
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
        <div>
          <p className="mb-1.5 text-[11px] font-medium text-ink-soft">내 친구 중에서 빠르게 선택</p>
          <ul className="flex flex-wrap gap-1.5">
            {friends.map((f) => (
              <li key={f.nicknameId}>
                <button
                  onClick={() => toggleFriend(f)}
                  className={[
                    "rounded-full px-3 py-1.5 text-xs font-medium transition",
                    selectedIds.has(f.nicknameId)
                      ? "bg-primary text-white"
                      : "bg-surface text-ink-soft ring-1 ring-inset ring-black/10 hover:bg-primary-light",
                  ].join(" ")}
                >
                  {f.nickname}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-1.5">
        <input
          value={guestName}
          onChange={(e) => setGuestName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addGuest();
            }
          }}
          placeholder="계정 없는 사람 이름 직접입력"
          className="flex-1 rounded-xl border border-black/10 bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <button
          onClick={addGuest}
          type="button"
          className="shrink-0 rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold text-ink transition hover:border-primary hover:text-primary"
        >
          추가
        </button>
      </div>
    </div>
  );
}
