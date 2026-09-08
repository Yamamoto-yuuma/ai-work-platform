/**
 * ナレッジの入力値と検証。
 *
 * 「テンプレはどこにあるか」「あの手順はどこに書いてあるか」を
 * 自分で残せるようにするためのもの。タスクの入力（task-draft.ts）と
 * 同じ作りにしてある。framework 非依存の純粋関数で、画面は結果を出すだけ。
 */
import { sourceFromLocation } from "./knowledge-link";
import type { KnowledgeItem } from "./types";

export const KNOWLEDGE_KINDS: { value: KnowledgeItem["kind"]; label: string }[] = [
  { value: "manual", label: "マニュアル" },
  { value: "faq", label: "FAQ" },
  { value: "policy", label: "社内ルール" },
  { value: "material", label: "資料" },
];

export const TITLE_MAX = 100;
export const BODY_MAX = 4000;
export const LOCATION_MAX = 500;

export interface KnowledgeDraft {
  title: string;
  body: string;
  kind: KnowledgeItem["kind"];
  /** 置き場所。URL でもパスでもよい */
  location: string;
  /** 読点・カンマ・空白で区切って入れる */
  tags: string;
  /** このナレッジを出す業務 */
  linkedWorkflowKeys: string[];
}

export interface KnowledgeDraftError {
  field: keyof KnowledgeDraft;
  message: string;
}

/** 区切り文字を問わずタグに割る。空は落とす */
export function parseTags(input: string): string[] {
  return Array.from(new Set(
    input.split(/[,、\s]+/).map((t) => t.trim()).filter((t) => t.length > 0),
  ));
}

/**
 * 開ける置き場所か。
 * http(s) だけをリンクにする。共有フォルダのパスを <a> にしても、
 * ブラウザの決まりで開けないことが多く、押せそうに見えるだけになる。
 */
export function isOpenable(location: string | undefined): boolean {
  if (!location) return false;
  return /^https?:\/\/\S+$/i.test(location.trim());
}

export function emptyKnowledgeDraft(): KnowledgeDraft {
  return { title: "", body: "", kind: "manual", location: "", tags: "", linkedWorkflowKeys: [] };
}

export function draftFromKnowledge(k: KnowledgeItem): KnowledgeDraft {
  return {
    title: k.title,
    body: k.body,
    kind: k.kind,
    location: k.location ?? "",
    tags: k.tags.join("、"),
    linkedWorkflowKeys: [...k.linkedWorkflowKeys],
  };
}

export function validateKnowledgeDraft(draft: KnowledgeDraft): KnowledgeDraftError[] {
  const errors: KnowledgeDraftError[] = [];
  const title = draft.title.trim();

  if (title.length === 0) {
    errors.push({ field: "title", message: "タイトルを入力してください" });
  } else if (title.length > TITLE_MAX) {
    errors.push({ field: "title", message: `タイトルは${TITLE_MAX}文字以内で入力してください（現在 ${title.length} 文字）` });
  }

  /*
    中身か置き場所のどちらかは要る。
    どちらも空だと、題名だけが並んで何の役にも立たない。
  */
  if (draft.body.trim().length === 0 && draft.location.trim().length === 0) {
    errors.push({ field: "body", message: "中身か置き場所のどちらかを入力してください" });
  }
  if (draft.body.length > BODY_MAX) {
    errors.push({ field: "body", message: `中身は${BODY_MAX}文字以内で入力してください（現在 ${draft.body.length} 文字）` });
  }
  if (draft.location.length > LOCATION_MAX) {
    errors.push({ field: "location", message: `置き場所は${LOCATION_MAX}文字以内で入力してください` });
  }
  if (!KNOWLEDGE_KINDS.some((k) => k.value === draft.kind)) {
    errors.push({ field: "kind", message: "種別を選択してください" });
  }

  return errors;
}

/** 検証済みの入力値から、書き換える差分を作る */
export function patchFromKnowledgeDraft(draft: KnowledgeDraft): Partial<KnowledgeItem> {
  const location = draft.location.trim();
  return {
    title: draft.title.trim(),
    body: draft.body.trim(),
    kind: draft.kind,
    // 出所は置き場所から決まる。同じことを人にもう一度聞かない
    source: sourceFromLocation(location),
    ...(location.length > 0 ? { location } : { location: undefined }),
    tags: parseTags(draft.tags),
    linkedWorkflowKeys: [...draft.linkedWorkflowKeys],
  };
}

/** 検証済みの入力値から、新しいナレッジを組み立てる */
export function newKnowledgeFromDraft(draft: KnowledgeDraft, id: string, now: Date): KnowledgeItem {
  const location = draft.location.trim();
  return {
    id,
    title: draft.title.trim(),
    body: draft.body.trim(),
    kind: draft.kind,
    /*
      どこにあるものかは置き場所で決まる。
      Gemini Notebook の URL を貼れば Gemini Notebook のものとして出る。
      何も無ければ、ここに書いたもの＝社内扱い。
    */
    source: sourceFromLocation(location),
    ...(location.length > 0 ? { location } : {}),
    tags: parseTags(draft.tags),
    // STEP 単位の紐付けは、業務の定義側で持つ。ここでは業務までにする
    linkedStepKeys: [],
    linkedWorkflowKeys: [...draft.linkedWorkflowKeys],
    updatedAt: now.toISOString(),
  };
}
