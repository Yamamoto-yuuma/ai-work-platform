/**
 * 横断検索。
 *
 * この道具の目的は「今日、自分が何をすればいいか迷わない」こと。
 * 検索も同じで、探し物で迷わないためのものにする。
 *
 * だから、並べ方は「文字の一致度」だけでは決めない。
 * いま抱えているもの（進行中の業務、まだ終わっていないタスク）を上に出す。
 * 済んだもの・止めたものは、探せば見つかるが、先には出さない。
 *
 * 結果には行き先と、迷わないだけの手がかり（どの業務の、いま何STEP目か）を
 * 添える。名前だけ並べても、同じような名前が並んだときに選べない。
 *
 * ここは純粋関数だけ。画面はこの並びをそのまま出す。
 */
import type { KnowledgeItem, Task, WorkRun, WorkflowDefinition } from "../model/types";
import { runLabel, subjectOf } from "../model/run-label";

export type HitKind = "run" | "task" | "workflow" | "knowledge";

export interface Hit {
  kind: HitKind;
  id: string;
  /** 主に読ませるもの */
  title: string;
  /** 迷わないための手がかり。業務名・STEP・期限など */
  hint?: string;
  /** 押したときの行き先 */
  href: string;
  /** 済んだもの・止めたものは弱めて出す */
  dimmed?: boolean;
  score: number;
}

export const HIT_KIND_LABEL: Record<HitKind, string> = {
  run: "進行中の業務",
  task: "タスク",
  workflow: "業務",
  knowledge: "ナレッジ",
};

/** 表記ゆれを吸収する。全角英数と半角、大文字小文字を同じ扱いにする */
function norm(s: string): string {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .trim();
}

/**
 * 一致の強さ。
 * 頭から一致 > 語の途中で一致 > 説明文に一致、の順で強くする。
 * 見出しに無い語が本文にだけあるものが上に来ると、探しているものが埋もれる。
 */
function match(text: string | undefined, q: string): number {
  if (!text) return 0;
  const t = norm(text);
  if (t.length === 0) return 0;
  const i = t.indexOf(q);
  if (i < 0) return 0;
  if (i === 0) return t === q ? 100 : 70;
  return 40;
}

/** 進行中・未完了を上に出すための下駄 */
const LIVE = 30;

export function search(input: {
  query: string;
  tasks: Task[];
  runs: WorkRun[];
  workflows: WorkflowDefinition[];
  knowledge: KnowledgeItem[];
  currentUserId: string;
  /** 出す件数。画面に収まる範囲で切る */
  limit?: number;
}): Hit[] {
  const q = norm(input.query);
  // 1文字では候補が多すぎて選べない。2文字から探す（日本語は1文字でも意味があるので許す）
  if (q.length === 0) return [];

  const hits: Hit[] = [];

  // --- 進行中の業務。いま抱えているものなので、いちばん上に来やすくする ---
  for (const run of input.runs) {
    if (run.status === "done" || run.status === "canceled") continue;
    const def = input.workflows.find((w) => w.key === run.workflowKey);
    const base = Math.max(match(runLabel(run), q), match(def?.name, q), match(run.title, q));
    if (base === 0) continue;
    const mine = run.assigneeId === input.currentUserId;
    hits.push({
      kind: "run", id: run.id, title: runLabel(run),
      hint: [subjectOf(run) ? def?.name : null, run.status === "paused" ? "待ち中" : null]
        .filter(Boolean).join("／") || undefined,
      href: `/navigator/${run.id}`,
      score: base + LIVE + (mine ? 10 : 0),
    });
  }

  // --- タスク。終わったものは弱める ---
  for (const t of input.tasks) {
    if (t.confirmationState === "rejected") continue;
    const base = Math.max(match(t.title, q), match(t.description, q) * 0.6);
    if (base === 0) continue;
    const finished = t.status === "done" || t.status === "canceled";
    const run = t.runId ? input.runs.find((r) => r.id === t.runId) : undefined;
    const def = run ? input.workflows.find((w) => w.key === run.workflowKey) : undefined;
    hits.push({
      kind: "task", id: t.id, title: t.title,
      hint: [def?.name, finished ? "完了" : null].filter(Boolean).join("／") || undefined,
      href: `/tasks/${t.id}`,
      dimmed: finished,
      score: base + (finished ? -20 : LIVE),
    });
  }

  // --- 業務の定義。止めたものは弱める ---
  for (const w of input.workflows) {
    const base = Math.max(match(w.name, q), match(w.category, q) * 0.8, match(w.description, q) * 0.6);
    if (base === 0) continue;
    const stopped = w.status !== "published";
    hits.push({
      kind: "workflow", id: w.key, title: w.name,
      hint: [w.category, stopped ? "停止中" : null].filter(Boolean).join("／") || undefined,
      href: `/workflows/${w.key}`,
      dimmed: stopped,
      score: base + (stopped ? -25 : 0),
    });
  }

  // --- ナレッジ。本文に当たったものは弱く出す ---
  for (const k of input.knowledge) {
    const base = Math.max(
      match(k.title, q),
      match(k.body, q) * 0.5,
      Math.max(0, ...k.tags.map((tag) => match(tag, q) * 0.7)),
    );
    if (base === 0) continue;
    hits.push({
      kind: "knowledge", id: k.id, title: k.title,
      hint: undefined,
      href: `/knowledge?open=${encodeURIComponent(k.id)}`,
      score: base,
    });
  }

  /*
    同点のときは種類の順で決める。実行中 → タスク → 業務 → ナレッジ。
    「いま動いているもの」から先に見せる、という並びを崩さない。
  */
  const order: Record<HitKind, number> = { run: 0, task: 1, workflow: 2, knowledge: 3 };
  hits.sort((a, b) => (b.score - a.score) || (order[a.kind] - order[b.kind]) || a.title.localeCompare(b.title, "ja"));
  return hits.slice(0, input.limit ?? 8);
}
