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

// 2026-08-11 신규(firestore 과잉사용 분석 반영): 투표 문서만 읍고(서브컬렉션은 건드리지 않는다)
// 권한 체크(참가자인지, 옵션이 실제 존재하는지 등)에 쓴다. respond/options/comments API
// 라우트가 매번 "권한 체크용 getVote()"로 responses+comments까지 통째로 불러오던 낭비를
// 없애기 위한 가벼운 조회.
export async function getVoteDoc(companyCode: string, voteId: string): Promise<DocumentSnapshot> {
  return votesRef(companyCode).doc(voteId).get();
}

// 2026-08-11 신규: 서브컬렉션(responses/comments)을 전혀 읍지 않고 투표 문서 필드만으로 만드는
// 가벼운 VoteSummary. 목록 화면(투표함 탭)의 카드 접힌 상태는 title/참가자수/만든사람만 보여주고
// 실제로 responses/comments 내용은 필요로 하지 않으므로(펼쳤을 때만 필요), 목록 조회에서는 이
// 함수로 빈 배열을 채운 "placeholder" 요약을 내려주고, 카드를 펼칠 때만(프론트엔드가
// GET /api/votes/{voteId}로) 실제 상세를 지연 로딩한다.
function summaryFromDocOnly(voteSnap: DocumentSnapshot): VoteSummary {
  const data = voteSnap.data()!;
  return {
    id: voteSnap.id,
    title: data.title,
    creatorNicknameId: data.creatorNicknameId,
    creatorNickname: data.creatorNickname,
    options: withSeparateOption(data.options ?? []),
    participantNicknameIds: data.participantNicknameIds ?? [],
    createdAt: data.createdAt,
    responses: [],
    comments: [],
  };
}

// 투표 문서 자체는 이미 읽어둔 스냅샷을 그대로 받아 재사용하고(같은 문서를 두 번 읽는 낭비 제거),
// responses/comments 서브컬렉션만 추가로 읍어서 VoteSummary로 조립한다. 단건 상세 조회(카드를
// 펼칠 때의 지연 로딩)에서만 쓰인다 - 목록 조회는 summaryFromDocOnly를 쓴다.
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

// 단건 상세 조회(responses/comments까지 전부 포함) - 카드를 펼칠 때 프론트엔드가 지연 로딩용으로
// 호출하는 GET /api/votes/{voteId}에서 쓴다.
export async function getVote(companyCode: string, voteId: string): Promise<VoteSummary | null> {
  const voteSnap = await votesRef(companyCode).doc(voteId).get();
  if (!voteSnap.exists) return null;
  return hydrateVote(companyCode, voteSnap);
}

// 참가자로 등록된 투표만(히스토리 포함) 조회한다. array-contains + orderBy를 같이 쓰면 Firestore가
// 복합 인덱스를 요구하게 되므로(popular-server.ts에서와 같은 이유로 피함), orderBy 없이 조회해서
// 메모리에서 최신순 정렬한다.
//
// 2026-08-11 수정(firestore 과잉사용 분석 반영): 예전엔(2026-08-10 리팩터 이후에도) 목록에 보여줄
// 투표 하나하나마다 hydrateVote로 responses/comments 서브컬렉션을 각각 읍었다 - 참가한 투표가
// 200개면 새로고침(⟳) 버튼 한 번에 최소 400번의 서브컬렉션 read가 나가는 N+1이었다. 그런데
// 목록(투표함 탭)의 카드가 "접힌" 상태에서는 responses/comments 내용을 화면에 전혀 안 쓴다
// (제목/만든사람/참가자수만 보여줌 - 참가자수도 participantNicknameIds.length로 이미 문서
// 필드에 있어서 서브컬렉션이 필요 없다). 그래서 목록 조회는 summaryFromDocOnly로 문서 필드만
// 쓰는 가벼운 요약을 내려주고, 실제 응답/댓글 내용은 사용자가 카드를 펼쳤을 때만
// GET /api/votes/{voteId}로 그 투표 1건만 지연 로딩한다(LunchVoteModal.tsx VoteCard 참고).
export async function listVotesForUser(companyCode: string, nicknameId: string): Promise<VoteSummary[]> {
  const snapshot = await votesRef(companyCode)
    .where("participantNicknameIds", "array-contains", nicknameId)
    .get();

  // 2026-08-06 3차: 목록 탭에 검색/페이징 기능이 추가된 걸 감안해 50 -> 200개로 늘렸다
  // (토이 프로젝트 규모라 충분한 상한선).
  const topVoteDocs = snapshot.docs
    .sort((a, b) => (a.data().createdAt < b.data().createdAt ? 1 : -1))
    .slice(0, 200);

  return topVoteDocs.map(summaryFromDocOnly);
}

// 2026-08-06 추가: 같은 옵션을 다시 누르는 경우(이미 그 옵션에 응답해둔 상태에서 같은 옵션을
// 또 클릭) 새 응답을 쓰지 않고 응답 문서 자체를 삭제해서 "토글로 취소"되게 한다(사용자 요청).
// 다른 옵션을 누르면 평소처럼 그 옵션으로 덮어쓴다.
//
// 2026-08-11 수정(firestore 과잉사용 분석 반영): 예전엔 이 함수가 void를 반환하고, 호출부(API
// 라우트)가 응답을 반영한 뒤 getVote()를 다시 호출해서(문서 재조회 1 + responses/comments
// 재조회 2, 총 3읍기) 최신 상태를 클라이언트에 돌려줬다. 이제는 이 함수가 "무엇이 바뀌었는지"
// (삭제됐는지, 아니면 어떤 항목이 새로 생겼는지)를 직접 반환해서, 호출부가 재조회 없이 그
// 델타만으로 클라이언트에 응답하고, 클라이언트는 이미 들고 있는 vote.responses 배열에 그
// 델타를 병합한다(vote-server.ts 밖의 재조회를 아예 없앰).
export async function respondToVote(
  companyCode: string,
  voteId: string,
  nicknameId: string,
  nickname: string,
  optionId: string
): Promise<{ removed: boolean; entry?: VoteResponseEntry }> {
  const responseRef = votesRef(companyCode).doc(voteId).collection("responses").doc(nicknameId);
  const existing = await responseRef.get();

  if (existing.exists && existing.data()?.optionId === optionId) {
    await responseRef.delete();
    return { removed: true };
  }

  const respondedAt = new Date().toISOString();
  await responseRef.set({ nickname, optionId, respondedAt });
  return { removed: false, entry: { nicknameId, nickname, optionId, respondedAt } };
}

// 2026-08-11 신규: 투표를 만든 뒤에도 참가자가 메뉴(식당) 옵션을 추가할 수 있게 한다(사용자 요청 -
// 만들 때 깜빡한 식당을 나중에 아무 참가자나 끼워 넣을 수 있어야 함). 이미 있는 옵션과 같은
// restaurantId(또는 같은 label의 직접입력 옵션)면 중복 추가하지 않고 현재 상태를 그대로 반환한다.
//
// 2026-08-11 수정(firestore 과잉사용 분석 반영): 처음 만들었을 때는 이 함수가 voteId만 받아서
// voteRef.get()으로 문서를 다시 읍고, update 후 voteRef.get()으로 또 읍고, 거기에 hydrateVote까지
// 돌려서(총 4읍기) 응답을 만들었다. 이제는 호출부(API 라우트)가 권한 체크용으로 이미 읍어둔
// voteSnap을 그대로 받아서 재사용하고, options 필드는 로컬에서 계산한 새 배열을 그대로
// update에 쓰기 때문에 update 이후 문서를 다시 읍을 필요가 없다 - 옵션 배열만 반환하면
// 프론트엔드가 기존 vote 객체의 options만 교체해서 병합한다(responses/comments는 이 작업으로
// 안 바뀌므로 굳이 다시 안 읍어도 된다).
export async function addVoteOption(
  companyCode: string,
  voteSnap: DocumentSnapshot,
  option: { label: string; restaurantId?: string }
): Promise<VoteOption[]> {
  const voteRef = votesRef(companyCode).doc(voteSnap.id);
  const data = voteSnap.data()!;
  const existingOptions: VoteOption[] = data.options ?? [];
  const label = option.label.trim();

  const isDuplicate = existingOptions.some(
    (o) => (option.restaurantId && o.restaurantId === option.restaurantId) || o.label === label
  );
  if (isDuplicate) {
    return withSeparateOption(existingOptions);
  }

  const newOption: VoteOption = {
    id: `opt${existingOptions.length}`,
    label,
    ...(option.restaurantId ? { restaurantId: option.restaurantId } : {}),
  };

  const updatedOptions = [...existingOptions, newOption];
  await voteRef.update({ options: updatedOptions });

  return withSeparateOption(updatedOptions);
}

// addVoteComment는 처음부터 추가 읍기가 없었다(생성한 댓글 내용을 그대로 반환) - 호출부가
// 굳이 getVote()를 또 부르지 않도록만 고치면 된다(app/api/votes/[voteId]/comments/route.ts 참고).
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
