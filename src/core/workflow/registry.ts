/**
 * 業務定義のレジストリ（仕様 §28-1）。
 *
 * 業務定義は「シードとして最初から入っているもの」と「自分で登録したもの」の
 * 2系統から来る。画面はその違いを意識せず、常にここで合成された一覧を見る。
 *
 * 定義はバージョンを積み上げる。実行中の WorkRun は開始時のバージョンを
 * 固定して持っているため、定義を編集しても進行中の業務は変化しない（仕様 §7-3）。
 */
import type { WorkflowDefinition } from "../model/types";

/** 同じ key + version は、自分で登録した方を優先する */
export function mergeWorkflows(
  seed: WorkflowDefinition[],
  user: WorkflowDefinition[],
): WorkflowDefinition[] {
  const map = new Map<string, WorkflowDefinition>();
  for (const w of seed) map.set(`${w.key}@${w.version}`, { origin: "seed", ...w });
  for (const w of user) map.set(`${w.key}@${w.version}`, w);
  return [...map.values()];
}

/** key ごとに最新バージョンだけを残す。一覧表示に使う */
export function latestWorkflows(all: WorkflowDefinition[]): WorkflowDefinition[] {
  const byKey = new Map<string, WorkflowDefinition>();
  for (const w of all) {
    const cur = byKey.get(w.key);
    if (!cur || w.version > cur.version) byKey.set(w.key, w);
  }
  return [...byKey.values()];
}

export function latestOf(all: WorkflowDefinition[], key: string): WorkflowDefinition | undefined {
  return all
    .filter((w) => w.key === key)
    .sort((a, b) => b.version - a.version)[0];
}

/** 定義を編集して保存するときの次バージョン */
export function nextVersion(all: WorkflowDefinition[], key: string): number {
  const cur = latestOf(all, key);
  return cur ? cur.version + 1 : 1;
}

/** 業務名から key を作る。日本語名でも衝突しない識別子にする */
export function makeWorkflowKey(existing: WorkflowDefinition[], seedFrom: string): string {
  const base = seedFrom
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const stem = base.length > 0 ? `wf-${base}`.slice(0, 40) : "wf";
  const taken = new Set(existing.map((w) => w.key));
  if (!taken.has(stem)) return stem;
  for (let i = 2; i < 500; i += 1) {
    const candidate = `${stem}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem}-${Date.now().toString(36)}`;
}
