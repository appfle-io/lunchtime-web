import { db } from "@/lib/firebase";

// 2026-08-06 신규: 친구목록 - 사용자 요청대로 "단방향" 추가(상대방 동의 불필요)로 설계.
// companies/{code}/users/{nicknameId}/friends/{friendNicknameId} 서브컬렉션에 문서가 있으면
// "내가 이 사람을 친구로 추가했다"는 뜻. 상대방 쪽에는 별도로 문서가 생기지 않고, 대신
// notification-server.ts를 통해 상대방에게 알림만 하나 남는다 - 상대방이 알림에서
// "나도 추가하기"를 눌러야 상대방 쪽 friends 서브컬렉션에도 (반대 방향) 문서가 생긴다.
export interface FriendEntry {
  nicknameId: string;
  nickname: string;
  memo: string;
  addedAt: string;
}

function friendsRef(companyCode: string, nicknameId: string) {
  return db
    .collection("companies")
    .doc(companyCode)
    .collection("users")
    .doc(nicknameId)
    .collection("friends");
}

export async function listFriends(companyCode: string, nicknameId: string): Promise<FriendEntry[]> {
  // orderBy 대신 전체를 읽어 메모리에서 정렬한다 - 친구 수가 적은 토이 프로젝트 규모라 충분하고,
  // 복합 인덱스가 필요 없다는 장점도 있다 (popular-server.ts/vote-server.ts와 동일한 방침).
  const snapshot = await friendsRef(companyCode, nicknameId).get();
  return snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        nicknameId: doc.id,
        nickname: data.nickname,
        memo: data.memo ?? "",
        addedAt: data.addedAt,
      };
    })
    .sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));
}

export async function isFriend(
  companyCode: string,
  nicknameId: string,
  friendNicknameId: string
): Promise<boolean> {
  const doc = await friendsRef(companyCode, nicknameId).doc(friendNicknameId).get();
  return doc.exists;
}

export async function addFriend(
  companyCode: string,
  nicknameId: string,
  friendNicknameId: string,
  friendNickname: string,
  memo: string
): Promise<FriendEntry> {
  const addedAt = new Date().toISOString();
  await friendsRef(companyCode, nicknameId)
    .doc(friendNicknameId)
    .set({ nickname: friendNickname, memo: memo.trim(), addedAt }, { merge: true });
  return { nicknameId: friendNicknameId, nickname: friendNickname, memo: memo.trim(), addedAt };
}

export async function updateFriendMemo(
  companyCode: string,
  nicknameId: string,
  friendNicknameId: string,
  memo: string
): Promise<void> {
  await friendsRef(companyCode, nicknameId).doc(friendNicknameId).set({ memo: memo.trim() }, { merge: true });
}

export async function removeFriend(
  companyCode: string,
  nicknameId: string,
  friendNicknameId: string
): Promise<void> {
  await friendsRef(companyCode, nicknameId).doc(friendNicknameId).delete();
}
