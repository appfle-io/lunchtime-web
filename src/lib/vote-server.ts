import { db } from "@/lib/firebase";
import type { DocumentSnapshot } from "firebase-admin/firestore";

// 2026-08-06 신규: "오늘 점심 뭐 먹지?" 투표 - 친구목록에서 참가자를 골라 만드는 투표.
// companies/{code}/votes/{voteId}
//   .../responses/{nicknameId} - 참가자별 응답(어떤 옵션을 골랐는지)
//   .../comments/{commentId}  - 투표 안 댓글
//
// "저는 따로 먹을게요" 옵션은 매 투표마다 저장할 필요 없이(어차피 항상 있는 고정 옵션이라 문서에
// 중복 저장하면 낭비), 조회 시점(withSeparateOption)에 항상 뒤에 붙여서 내려준다.
export const SEPARATE_OPTION_ID = "separate";
export const SEPARATE_OPTION_LABEL = "저는 따로 먹을게요";

export interface VoteOption {
  id: string;
  label: string;
  restaurantId?: string;
}

export interface VoteResponseEntry {
  nicknameId: string;
  nickname: string;
  optionId: string;
  respondedAt: string;
}

export interface VoteCommentEntry {
  id: string;
  authorNicknameId: string;
  authorNickname: string;
  content: string;
  createdAt: string;
}

export interface VoteSummary {
  id: string;
  title: string;
  creatorNicknameId: string;
  creatorNickname: string;
  options: VoteOption[]; // "저는 따로 먹을게요"가 항상 마지막에 자동 포함되어 내려온다.
  participantNicknameIds: string[];
  createdAt: string;
  responses: VoteResponseEntry[];
  comments: VoteCommentEntry[];
}

function votesRef(companyCode: string) {
  return db.collection("companies").doc(companyCode).collection("votes");
}

function withSeparateOption(options: VoteOption[]): VoteOption[] {
  return [...options, { id: SEPARATE_OPTION_ID, label: SEPARATE_OPTION_LABEL }];
}

export async function createVote(
  companyCode: string,
  creatorNicknameId: string,
  creatorNickname: string,
  title: string,
  options: { restaurantId?: string; label: string }[],
  participantNicknameIds: string[]
): Promise<VoteSummary> {
  const createdAt = new Date().toISOString();
  const resolvedTitle = title.trim() || "오늘 점심 뭐 먹지?";
  // "목록에 없는 메뉴 직접 입력"으로 추가한 옵션은 restaurantId가 없다. 이를
  // `restaurantId: o.restaurantId`로 그대로 넣으면 필드 값이 undefined가 된다. Firestore는
  // undefined 필드를 거부하므로("Cannot use undefined as a Firestore value") 직접 입력
  // 옵션이 하나라도 있으면 투표 생성 자체가 500 에러로 실패했다. restaurantId가
  // 있을 때만 필드를 넣도록(spread) 고쳐서, 없으면 그 필드 자체가 문서에서 빠지게 한다.
  const optionDocs: VoteOption[] = options.map((o, i) => ({
    id: `opt${i}`,
    label: o.label,
    ...(o.restaurantId ? { restaurantId: o.restaurantId } : {}),
  }));

  // 만든 사람도 참가자로 포함해야 본인도 투표할 수 있다.
  const participants = Array.from(new Set([creatorNicknameId, ...participantNicknameIds]));

  const docRef = await votesRef(companyCode).add({
    title: resolvedTitle,
    creatorNicknameId,
    creatorNickname,
    options: optionDocs,
    participantNicknameIds: participants,
    createdAt,
  });

  return {
    id: docRef.id,
    title: resolvedTitle,
    creatorNicknameId,
    creatorNickname,
    options: withSeparateOption(optionDocs),
    participantNicknameIds: participants,
    createdAt,
    responses: [],
    comments: [],
  };
}

// 2026-08-10 리팩터: 투표 문서 자체는 이미 읽어둔 스냅샷을 그대로 받아 재사용하고(같은 문서를
// 두 번 읽는 낭비 제거), responses/comments 서브컬렉션만 추가로 읽어서 VoteSummary로 조립한다.
// getVote()(단건 조회)와 listVotesForUser()(목록 조회) 양쪽에서 공유해서 쓴다.
async function hydrateVote(companyCode: string, voteSnap: DocumentSnapshot): Promise<VoteSummary> {
  const voteRef = votesRef(companyCode).doc(voteSnap.id);
  const [responsesSnap, commentsSnap] = await Promise.all([
    voteRef.collection("responses").get(),
    voteRef.collection("comments").get(),
  ]);

  const data = voteSnap.data()!;

  return {
    id: voteSnap.id,
    title: data.title,
    creatorNicknameId: data.creatorNicknameId,
    creatorNickname: data.creatorNickname,
    options: withSeparateOption(data.options ?? []),
    participantNicknameIds: data.participantNicknameIds ?? [],
    createdAt: data.createdAt,
    responses: responsesSnap.docs.map((d) => {
      const r = d.data();
      return { nicknameId: d.id, nickname: r.nickname, optionId: r.optionId, respondedAt: r.respondedAt };
    }),
    comments: commentsSnap.docs
      .map((d) => {
        const c = d.data();
        return {
          id: d.id,
          authorNicknameId: c.authorNicknameId,
          authorNickname: c.authorNickname,
          content: c.content,
          createdAt: c.createdAt,
        };
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
  };
}

export async function getVote(companyCode: string, voteId: string): Promise<VoteSummary | null> {
  const voteSnap = await votesRef(companyCode).doc(voteId).get();
  if (!voteSnap.exists) return null;
  return hydrateVote(companyCode, voteSnap);
}

// 참가자로 등록된 투표만(히스토리 포함) 조회한다. array-contains + orderBy를 같이 쓰면 Firestore가
// 복합 인덱스를 요구하게 되므로(popular-server.ts에서와 같은 이유로 피함), orderBy 없이 조회해서
// 메모리에서 최신순 정렬한다.
//
// 2026-08-10 수정: 예전엔 이 목록 쿼리로 얻은 투표 문서를 무시하고 getVote()가 voteId마다 같은
// 투표 문서를 한 번 더 읽었다 (투표당 3읍기: 문서 중복 1 + responses 1 + comments 1). 이미 위
// where() 쿼리에서 문서 내용을 전부 들고 있으므로 그 스냅샷을 hydrateVote()에 그대로 넘겨서
// 투표당 2읍기(responses+comments)로 줄였다 - 참가 투표가 많은 사용자일수록(최대 200개) 절감폭이 크다.
export async function listVotesForUser(companyCode: string, nicknameId: string): Promise<VoteSummary[]> {
  const snapshot = await votesRef(companyCode)
    .where("participantNicknameIds", "array-contains", nicknameId)
    .get();

  // 2026-08-06 3차: 목록 탭에 검색/페이징 기능이 추가된 걸 감안해 50 -> 200개로 늘렸다
  // (토이 프로젝트 규모라 충분한 상한선).
  const topVoteDocs = snapshot.docs
    .sort((a, b) => (a.data().createdAt < b.data().createdAt ? 1 : -1))
    .slice(0, 200);

  return Promise.all(topVoteDocs.map((doc) => hydrateVote(companyCode, doc)));
}

// 2026-08-06 추가: 같은 옵션을 다시 누르는 경우(이미 그 옵션에 응답해둔 상태에서 같은 옵션을
// 또 클릭) 새 응답을 쓰지 않고 응답 문서 자체를 삭제해서 "토글로 취소"되게 한다(사용자 요청).
// 다른 옵션을 누르면 평소처럼 그 옵션으로 덮어쓴다.
export async function respondToVote(
  companyCode: string,
  voteId: string,
  nicknameId: string,
  nickname: string,
  optionId: string
): Promise<void> {
  const responseRef = votesRef(companyCode).doc(voteId).collection("responses").doc(nicknameId);
  const existing = await responseRef.get();

  if (existing.exists && existing.data()?.optionId === optionId) {
    await responseRef.delete();
    return;
  }

  await responseRef.set({ nickname, optionId, respondedAt: new Date().toISOString() });
}

// 2026-08-11 신규: 투표를 만든 뒤에도 참가자가 메뉴(식당) 옵션을 추가할 수 있게 한다(사용자 요청 -
// 만들 때 깜빡한 식당을 나중에 아무 참가자나 끼워 넣을 수 있어야 함). 이미 있는 옵션과 같은
// restaurantId(또는 같은 label의 직접입력 옵션)면 중복 추가하지 않고 현재 상태를 그대로 반환한다.
export async function addVoteOption(
  companyCode: string,
  voteId: string,
  option: { label: string; restaurantId?: string }
): Promise<VoteSummary | null> {
  const voteRef = votesRef(companyCode).doc(voteId);
  const voteSnap = await voteRef.get();
  if (!voteSnap.exists) return null;

  const data = voteSnap.data()!;
  const existingOptions: VoteOption[] = data.options ?? [];
  const label = option.label.trim();

  const isDuplicate = existingOptions.some(
    (o) => (option.restaurantId && o.restaurantId === option.restaurantId) || o.label === label
  );
  if (isDuplicate) {
    return hydrateVote(companyCode, voteSnap);
  }

  const newOption: VoteOption = {
    id: `opt${existingOptions.length}`,
    label,
    ...(option.restaurantId ? { restaurantId: option.restaurantId } : {}),
  };

  await voteRef.update({ options: [...existingOptions, newOption] });

  const updatedSnap = await voteRef.get();
  return hydrateVote(companyCode, updatedSnap);
}

export async function addVoteComment(
  companyCode: string,
  voteId: string,
  authorNicknameId: string,
  authorNickname: string,
  content: string
): Promise<VoteCommentEntry> {
  const createdAt = new Date().toISOString();
  const docRef = await votesRef(companyCode)
    .doc(voteId)
    .collection("comments")
    .add({ authorNicknameId, authorNickname, content, createdAt });
  return { id: docRef.id, authorNicknameId, authorNickname, content, createdAt };
}
