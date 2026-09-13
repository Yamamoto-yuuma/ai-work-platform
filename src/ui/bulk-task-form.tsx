"use client";

/**
 * まとめてタスクを入れるところ。
 *
 * 依頼が立て込むと、1件ごとにフォームを開いて項目を埋める手間が
 * そのまま税になる。思い出した順に書き並べて、一度に入れられるようにする。
 *
 * 読み取った結果は必ず先に見せる。黙って期限を付けると、
 * 身に覚えのない日付のタスクが並ぶことになり、次からは全部を
 * 確かめる羽目になって、速く入れられる意味が無くなる。
 */
import { useMemo, useState } from "react";
import { parseBulk, type ParsedTaskLine } from "@/core/task/bulk";
import { formatMinutes, TASK_PRIORITIES } from "@/core/model/task-draft";
import { Button, Card } from "./primitives";

const SAMPLE = `アオイ製作所に見積を送る 明日 30分
15日締めの請求書を確認する
・記事の校正 1時間
至急 ハシモト会計へ折り返し`;

export function BulkTaskForm({
  now, onSubmit, onCancel,
}: {
  now: Date;
  /** 読み取り済みの行が、外した分を除いて渡ってくる */
  onSubmit: (lines: ParsedTaskLine[]) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  // 取り違えた行だけ外せるようにする。書き直させない
  const [dropped, setDropped] = useState<Set<number>>(new Set());

  const parsed = useMemo(() => parseBulk(text, now), [text, now]);
  const kept = parsed.filter((_, i) => !dropped.has(i));

  const toggle = (i: number) =>
    setDropped((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });

  const lineCount = text.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
  const ignored = lineCount - parsed.length;

  return (
    <Card className="mb-5 p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-bold">まとめて追加</h2>
        <span className="text-[12px] text-ink-3">1行が1件になります</span>
      </div>

      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setDropped(new Set()); }}
        rows={7}
        aria-label="まとめて入力"
        placeholder={SAMPLE}
        className="field w-full leading-relaxed"
      />

      <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
        期限（明日・来週・9/15・15日・月曜）、見積（30分・1時間）、
        急ぎの印（! や 至急）を書いておくと、そのまま読み取ります。
        書かなくても構いません。
      </p>

      {parsed.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <p className="text-[13.5px] font-medium">
              こう入ります
              <span className="ml-1.5 font-normal text-ink-3">{kept.length}件</span>
            </p>
            {ignored > 0 && (
              <p className="text-[12px] text-ink-3">
                名前の無い{ignored}行は入りません
              </p>
            )}
          </div>

          <ul className="overflow-hidden rounded-xl border border-line-soft">
            {parsed.map((p, i) => {
              const off = dropped.has(i);
              const pri = p.priority
                ? TASK_PRIORITIES.find((x) => x.value === p.priority)?.label
                : undefined;
              return (
                <li
                  key={i}
                  className={`flex items-center gap-2.5 border-t border-line-soft px-3 py-2 first:border-t-0 ${
                    off ? "bg-surface-2" : "bg-surface"
                  }`}
                >
                  <span className={`min-w-0 flex-1 truncate text-[13.5px] ${
                    off ? "text-ink-3 line-through" : "font-medium"
                  }`}>
                    {p.title}
                  </span>

                  {/* 読み取ったものだけ出す。読めなかった欄は空けておく */}
                  {p.dueAt && (
                    <span className="shrink-0 cell-num text-[12px] text-ink-2">
                      {new Date(p.dueAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" })}
                    </span>
                  )}
                  {p.estimatedMinutes !== undefined && (
                    <span className="shrink-0 text-[12px] text-ink-3">{formatMinutes(p.estimatedMinutes)}</span>
                  )}
                  {pri && <span className="shrink-0 text-[12px] text-danger">{pri}</span>}

                  <button
                    type="button"
                    onClick={() => toggle(i)}
                    className="shrink-0 rounded-md px-2 py-0.5 text-[12px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                    aria-label={off ? `${p.title} を入れる` : `${p.title} を入れない`}
                  >
                    {off ? "戻す" : "外す"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <Button onClick={() => onSubmit(kept)} disabled={kept.length === 0}>
          {kept.length > 0 ? `${kept.length}件を追加する` : "追加する"}
        </Button>
        <Button variant="secondary" onClick={onCancel}>キャンセル</Button>
      </div>
    </Card>
  );
}
