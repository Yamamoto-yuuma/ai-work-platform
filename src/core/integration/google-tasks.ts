/**
 * Google ToDo リストの取り込み（読み取りのみ）。
 *
 * 向こうで作ったタスクを、こちらの一覧に並べるためのもの。
 * こちらからは書き戻さない。双方向にすると、片方で消したものが
 * もう片方でも消えるといった事故が起きる。まず片方向で確かめる。
 *
 * ここは純粋関数だけ。通信も id の採番も時刻も外から渡してもらう。
 * 取り込みの判断（作るのか、直すのか、触らないのか）を1か所に集める。
 */
import type { ExternalOrigin, Task } from "../model/types";

/** Google Tasks API から受け取るもののうち、こちらが使う分だけ */
export interface GoogleTask {
  id: string;
  title?: string;
  notes?: string;
  /** RFC3339。Google は日付だけを扱い、時刻は 00:00Z で入ってくる */
  due?: string;
  status?: "needsAction" | "completed";
  /** 向こうの更新時刻（RFC3339） */
  updated?: string;
  /** 向こうで消されたもの。showDeleted を付けたときだけ来る */
  deleted?: boolean;
  /** 向こうで隠されたもの（完了して整理済みなど） */
  hidden?: boolean;
  selfLink?: string;
}

export interface ImportPlan {
  /** 新しく作るもの */
  created: Task[];
  /** すでにあるものへの差分 */
  updated: { taskId: string; patch: Partial<Task> }[];
  /** 触らなかったもの（向こうが動いていない）。件数を出すために持つ */
  untouched: number;
  /** 向こうで消えていたもの。こちらでは消さず、件数だけ知らせる */
  goneOnRemote: Task[];
}

/**
 * Google の期限をこちらの期限に直す。
 *
 * Google ToDo の期限は日付だけで、時刻は 00:00Z で入ってくる。
 * そのまま入れると日本時間では前日の 9:00 になり、1日ずれる。
 * 日付だけを取り出して、こちらの既定時刻（18:00）に置き直す。
 */
export function dueFromGoogle(due: string | undefined, previous?: string): string | undefined {
  if (!due) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(due);
  if (!m) return undefined;
  const [, y, mo, d] = m;
  // 前の期限が持っていた時刻は残す。日付だけ動かしたいので
  let hours = 18;
  let minutes = 0;
  if (previous) {
    const prev = new Date(previous);
    if (!Number.isNaN(prev.getTime())) { hours = prev.getHours(); minutes = prev.getMinutes(); }
  }
  const at = new Date(Number(y), Number(mo) - 1, Number(d), hours, minutes, 0, 0);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

function originOf(t: Task): ExternalOrigin | undefined {
  return t.external?.service === "google-tasks" ? t.external : undefined;
}

/**
 * 取り込みの計画を立てる。実際に反映するのは呼ぶ側。
 *
 * 大事な決め事が3つある。
 *
 * 1. 向こうが動いていなければ、こちらは触らない。
 *    更新時刻が前回と同じものは、そのまま置く。ここを守らないと、
 *    こちらで完了にしたタスクが、取り込むたびに未着手へ戻る。
 * 2. 向こうが動いていれば、向こうを正とする。読み取り専用なので、
 *    食い違ったときにどちらを採るかは決めておかないといけない。
 * 3. 向こうで消えても、こちらでは消さない。
 *    こちらで手を加えているかもしれないものを、黙って消さない。
 */
export function planImport(input: {
  incoming: GoogleTask[];
  listId: string;
  existing: Task[];
  /** 取り込んだタスクの持ち主。自分ひとりで使うので、ふつうは自分 */
  assigneeId: string;
  now: Date;
  newId: () => string;
}): ImportPlan {
  const { incoming, listId, existing, assigneeId, now, newId } = input;

  const mine = existing.filter((t) => originOf(t)?.listId === listId);
  const byExternalId = new Map(mine.map((t) => [originOf(t)!.id, t]));

  const created: Task[] = [];
  const updated: ImportPlan["updated"] = [];
  let untouched = 0;
  const seen = new Set<string>();

  for (const g of incoming) {
    // 向こうで消えたもの・隠されたものは、取り込む対象にしない
    if (g.deleted || g.hidden) continue;
    const title = (g.title ?? "").trim();
    // 名前の無いタスクは向こうの入力途中。取り込むと空行が並ぶ
    if (!title) continue;

    seen.add(g.id);
    const found = byExternalId.get(g.id);
    const origin: ExternalOrigin = {
      service: "google-tasks",
      id: g.id,
      listId,
      updatedAt: g.updated ?? now.toISOString(),
      url: g.selfLink,
    };

    if (!found) {
      created.push({
        id: newId(),
        title,
        description: g.notes?.trim() || undefined,
        status: g.status === "completed" ? "done" : "todo",
        priority: "normal",
        assigneeId,
        dueAt: dueFromGoogle(g.due),
        source: "external",
        // 向こうで作られた時点で、人が意図して作ったもの。確認は挟まない
        confirmationState: "confirmed",
        dependsOn: [],
        createdAt: now.toISOString(),
        external: origin,
      });
      continue;
    }

    // 向こうが動いていなければ触らない（こちらの変更を守る）
    if (g.updated && g.updated === originOf(found)!.updatedAt) { untouched++; continue; }

    const patch: Partial<Task> = {
      title,
      description: g.notes?.trim() || undefined,
      dueAt: dueFromGoogle(g.due, found.dueAt),
      external: origin,
    };
    /*
      状態は、済んだかどうかだけを合わせる。
      「進行中」「ブロック中」はこちら側の見立てなので、向こうが
      未完了のままなら残す。向こうで完了したものは完了にする。
    */
    if (g.status === "completed" && found.status !== "done") patch.status = "done";
    if (g.status !== "completed" && found.status === "done") patch.status = "todo";

    updated.push({ taskId: found.id, patch });
  }

  const goneOnRemote = mine.filter((t) => !seen.has(originOf(t)!.id));
  return { created, updated, untouched, goneOnRemote };
}

/** 取り込み結果を1文にする。画面はこれを出すだけにする */
export function describeImport(plan: ImportPlan): string {
  const parts: string[] = [];
  if (plan.created.length > 0) parts.push(`${plan.created.length}件を取り込みました`);
  if (plan.updated.length > 0) parts.push(`${plan.updated.length}件を更新しました`);
  if (plan.untouched > 0) parts.push(`${plan.untouched}件は変更なし`);
  if (plan.goneOnRemote.length > 0) {
    parts.push(`${plan.goneOnRemote.length}件はGoogle側に見当たりません（こちらでは消していません）`);
  }
  return parts.length > 0 ? parts.join("／") : "取り込むものはありませんでした";
}
