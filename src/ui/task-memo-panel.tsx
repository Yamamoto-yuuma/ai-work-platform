"use client";

/**
 * タスクメモ。
 *
 * 思いついた仕事を、整った形にする前に置いておくところ。
 * タスクの入力フォームではない。題名・期限・担当・優先度を最初から埋めさせると、
 * 「あとで入れよう」になって、結局どこにも残らない。まず書けることを優先する。
 *
 * HOME の上に右から重ねる。別の画面へ飛ばさない。
 * 飛ばすと、いま見ていた「本日の作業」が消えて、何をメモしようとしたか分からなくなる。
 *
 * 読み取りは決まった規則だけで行う（core/task/bulk）。AI には渡さない。
 * 書いた内容が外へ出ないのと、同じ文字列がいつも同じ結果になるのを優先している。
 *
 * 「①」「②」のような印を付けた行から次の印までが 1 件。印の無い行は前の件の続きになる。
 * 思いついたことを続けて書いても、途中の一文が別のタスクにならないようにするため。
 * 印をどこにも使わなければ、1 行が 1 件になる。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseMemo, type MemoBlock } from "@/core/task/bulk";
import { formatMinutes } from "@/core/model/task-draft";
import { newTaskId } from "@/lib/id";
import { useStore } from "@/adapters/memory/store";
import type { Task } from "@/core/model/types";
import { Button } from "./primitives";

/**
 * 書きかけの置き場。
 *
 * 業務データ（ai-work-platform:v1）とは別の鍵にする。
 * 書きかけのメモが壊れても、タスクや業務までは道連れにしない。
 */
const DRAFT_KEY = "ai-work-platform:task-memo";

const PLACEHOLDER = `例：
①○○社の資料を確認する 明日
　MTGで使うので先に目を通しておく
②田中さんに資料を見てもらう
③佐藤さんへ資料を送付する 30分`;

/** 確認前の 1 件。人が直せるように、読み取った結果をそのまま持つ */
interface Candidate {
  key: string;
  title: string;
  /** 期限。input[type=date] に合わせて yyyy-MM-dd で持つ。空なら未設定 */
  due: string;
  assigneeId: string;
  estimatedMinutes?: number;
  priority: Task["priority"];
  /** 見出しに続けて書かれたもの。タスクの説明として残す */
  note?: string;
  /** 何を読み取ったか。「なぜこの期限になったか」を出すために残す */
  matched: string[];
}

/** ISO の日時を input[type=date] の形にする（ローカル時間で見た日付） */
function toDateInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** input[type=date] の値を、その日の 18 時（既存の一括入力と同じ）に戻す */
function fromDateInput(value: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 18, 0, 0, 0).toISOString();
}

function toCandidate(block: MemoBlock, index: number, defaultAssigneeId: string): Candidate {
  return {
    key: `${index}-${block.raw}`,
    title: block.title,
    due: toDateInput(block.dueAt),
    assigneeId: defaultAssigneeId,
    estimatedMinutes: block.estimatedMinutes,
    priority: block.priority ?? "normal",
    note: block.note,
    matched: block.matched,
  };
}

export function TaskMemoPanel({ now }: { now: Date }) {
  const { dispatch, users, currentUser } = useStore();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  /** null のあいだは書くところ。配列が入ったら確認するところ */
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /* 書きかけを読み戻す。閉じても、開き直せば続きから書ける */
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(DRAFT_KEY);
      if (saved !== null) setText(saved);
    } catch {
      // 保存が使えない端末でも、書くこと自体はできる
    }
  }, []);

  /* 書いたそばから残す。閉じるボタンを押しても、タブを閉じても消えない */
  useEffect(() => {
    try {
      if (text === "") window.localStorage.removeItem(DRAFT_KEY);
      else window.localStorage.setItem(DRAFT_KEY, text);
    } catch {
      // 保存できないだけ。書いている内容はそのまま画面にある
    }
  }, [text]);

  /* 開いたら入力欄へ。メモは思いついた瞬間に書けることが大事 */
  useEffect(() => {
    if (open && candidates === null) textareaRef.current?.focus();
  }, [open, candidates]);

  const close = useCallback(() => {
    setOpen(false);
    setDone(null);
  }, []);

  /* Esc で閉じる。書きかけは残るので、閉じることに躊躇が要らない */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  /* 何件になるかを、押す前に出す。押してから数が違うと驚く */
  const blocks = useMemo(() => parseMemo(text, now), [text, now]);

  const toTasks = () => {
    if (blocks.length === 0) return;
    setCandidates(blocks.map((b, i) => toCandidate(b, i, currentUser.id)));
    setDone(null);
  };

  const patch = (key: string, change: Partial<Candidate>) =>
    setCandidates((cur) => (cur ?? []).map((c) => (c.key === key ? { ...c, ...change } : c)));

  const remove = (key: string) =>
    setCandidates((cur) => (cur ?? []).filter((c) => c.key !== key));

  const register = () => {
    const ready = (candidates ?? []).filter((c) => c.title.trim().length > 0);
    if (ready.length === 0) return;

    const createdAt = new Date().toISOString();
    const tasks: Task[] = ready.map((c) => ({
      id: newTaskId(),
      title: c.title.trim(),
      status: "todo",
      description: c.note,
      priority: c.priority,
      assigneeId: c.assigneeId,
      dueAt: fromDateInput(c.due),
      estimatedMinutes: c.estimatedMinutes,
      /*
        人が 1 件ずつ目で見て直したうえで押しているので、確認済みとして入れる。
        ここで「提案中」にすると、同じものをもう一度確認することになる。
      */
      source: "manual",
      confirmationState: "confirmed",
      dependsOn: [],
      createdAt,
    }));

    dispatch({ type: "addTasks", tasks });
    setCandidates(null);
    setText("");
    setDone(tasks.length);
  };

  return (
    <>
      {/*
        右端の入口。
        HOME の中身の上に重ねる。列を増やすと、いまの並びが崩れる。
        画面が狭いときは右下の小さなボタンにする（縦のタブだと本文にかぶる）。
      */}
      {!open && (
        <button
          type="button"
          id="task-memo-open"
          onClick={() => setOpen(true)}
          title="タスクメモを開く"
          className="fixed bottom-5 right-4 z-40 flex items-center gap-2 rounded-[5px] border border-line bg-surface px-3 py-2.5 text-[12.5px] font-medium text-ink shadow-pop transition-colors hover:bg-surface-2 md:bottom-auto md:right-0 md:top-1/2 md:-translate-y-1/2 md:flex-col md:gap-1.5 md:rounded-r-none md:px-2 md:py-4"
        >
          <MemoMark />
          <span className="md:[writing-mode:vertical-rl] md:tracking-[0.12em]">タスクメモ</span>
        </button>
      )}

      {open && (
        <>
          {/* 後ろの HOME は見えたままにする。開いていることが分かればよい */}
          <button
            type="button"
            aria-label="タスクメモを閉じる"
            onClick={close}
            className="fixed inset-0 z-40 cursor-default bg-ink/10"
          />

          <aside
            role="dialog"
            aria-label="タスクメモ"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-line bg-paper shadow-pop"
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-[14px] font-bold">タスク化前メモ</h2>
                <p className="mt-0.5 text-[11.5px] leading-[1.7] text-ink-2">
                  {candidates === null
                    ? "整理できていなくてOK。やることをそのまま書いてください。"
                    : "登録する前に確かめてください。直しても消してもかまいません。"}
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="閉じる"
                className="shrink-0 rounded-[5px] px-2 py-1 text-[15px] leading-none text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                ×
              </button>
            </div>

            {candidates === null ? (
              <>
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
                  {done !== null && (
                    <div className="rounded-[5px] bg-ok-soft px-3.5 py-2.5 text-[12px] text-ok">
                      {done}件のタスクを登録しました。
                    </div>
                  )}
                  <textarea
                    id="task-memo-text"
                    ref={textareaRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    aria-label="タスク化前メモ"
                    placeholder={PLACEHOLDER}
                    className="field min-h-[220px] flex-1 resize-none leading-[1.9]"
                  />
                  <p className="text-[11px] leading-[1.8] text-ink-3">
                    <span className="text-ink-2">①②③</span> や{" "}
                    <span className="text-ink-2">・</span> を付けた行から、次の印までが1件になります。
                    印の無い行は、その前の件の続きとして扱います。印を使わなければ1行が1件です。
                    <br />
                    「明日」「9/14」「金曜」「30分」「至急」を混ぜて書けば、期限・見積時間・優先度も読み取ります。
                  </p>
                </div>

                <div className="shrink-0 border-t border-line px-5 py-4">
                  <Button className="w-full justify-center" disabled={blocks.length === 0} onClick={toTasks}>
                    メモをタスクにする
                    {blocks.length > 0 ? `（${blocks.length}件）` : ""}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  {candidates.length === 0 ? (
                    <p className="py-8 text-center text-[12.5px] text-ink-3">
                      候補がなくなりました。前の画面から書き直せます。
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {candidates.map((c) => (
                        <li key={c.key} className="rounded-[5px] border border-line-soft bg-surface p-3">
                          <div className="flex items-start gap-2">
                            <input
                              value={c.title}
                              onChange={(e) => patch(c.key, { title: e.target.value })}
                              aria-label="タスク名"
                              className="field field-sm min-w-0 flex-1 font-medium"
                            />
                            <button
                              type="button"
                              onClick={() => remove(c.key)}
                              aria-label={`${c.title} を候補から外す`}
                              className="shrink-0 rounded-[5px] px-2 py-1.5 text-[13px] leading-none text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger"
                            >
                              ×
                            </button>
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <label className="flex items-center gap-1.5 text-[11px] text-ink-3">
                              期限
                              <input
                                type="date"
                                value={c.due}
                                onChange={(e) => patch(c.key, { due: e.target.value })}
                                className="field field-sm w-auto"
                              />
                            </label>
                            <label className="flex items-center gap-1.5 text-[11px] text-ink-3">
                              担当
                              <select
                                value={c.assigneeId}
                                onChange={(e) => patch(c.key, { assigneeId: e.target.value })}
                                className="field field-sm w-auto"
                              >
                                {users.map((u) => (
                                  <option key={u.id} value={u.id}>{u.name}</option>
                                ))}
                              </select>
                            </label>
                            {c.estimatedMinutes !== undefined && (
                              <span className="text-[11px] text-ink-3">{formatMinutes(c.estimatedMinutes)}</span>
                            )}
                          </div>

                          {c.note !== undefined && (
                            <p className="mt-2 whitespace-pre-wrap rounded-[3px] bg-surface-2 px-2.5 py-1.5 text-[11.5px] leading-[1.7] text-ink-2">
                              {c.note}
                            </p>
                          )}

                          {c.matched.length > 0 && (
                            <p className="mt-1.5 text-[10.5px] text-ink-3">
                              読み取り: {c.matched.join(" / ")}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-4">
                  <Button variant="secondary" onClick={() => setCandidates(null)}>
                    メモに戻る
                  </Button>
                  <Button
                    className="flex-1 justify-center"
                    disabled={candidates.every((c) => c.title.trim().length === 0)}
                    onClick={register}
                  >
                    タスク登録（{candidates.filter((c) => c.title.trim().length > 0).length}件）
                  </Button>
                </div>
              </>
            )}
          </aside>
        </>
      )}
    </>
  );
}

/** 入口の印。書き留めるところだと一目で分かればよい */
function MemoMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 2.5h6.2l2.8 2.8v8.2a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M9.6 2.6v3h3M5.6 8.5h4.8M5.6 11h3.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
