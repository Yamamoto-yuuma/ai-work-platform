"use client";

/**
 * 画面を描くところで落ちたときの受け皿。
 *
 * 何も出さないと真っ白になり、利用者には手の打ちようがない。
 * 起きたことと、その場でできる手を出す。
 *
 * 保存した中身が古くて読めない場合がいちばん多いので、
 * 初期化して開き直す入口をここに置く。押すまでは何も消さない。
 */
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-[560px] px-6 py-16">
      <h1 className="text-[17px] font-bold">画面を表示できませんでした</h1>
      <p className="mt-3 text-[13px] leading-[1.9] text-ink-2">
        処理の途中で問題が起きました。多くの場合は、もう一度開き直すと表示できます。
        繰り返し出る場合は、この端末に保存した内容が古くなっている可能性があります。
      </p>

      <div className="mt-6 flex flex-wrap gap-2.5">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center rounded-[5px] border border-transparent bg-brand px-4 py-2 text-[13px] font-medium text-white hover:bg-brand-ink"
        >
          もう一度開く
        </button>
        <button
          type="button"
          onClick={() => {
            try {
              window.localStorage.removeItem("ai-work-platform:v1");
            } catch {
              /* 消せなくても開き直しはできる */
            }
            window.location.href = "/";
          }}
          className="inline-flex items-center rounded-[5px] border border-line bg-surface px-4 py-2 text-[13px] font-medium text-ink hover:border-ink-3 hover:bg-surface-2"
        >
          この端末の保存内容を消して開き直す
        </button>
      </div>

      <p className="mt-5 text-[11px] leading-[1.9] text-ink-3">
        「保存内容を消して開き直す」を押すと、この端末で作った業務・タスク・ナレッジは消えます。
        日報はスプレッドシート側にあるため消えません。
      </p>

      {error.digest && (
        <p className="mt-4 font-mono text-[11px] text-ink-3">識別子: {error.digest}</p>
      )}
    </div>
  );
}
