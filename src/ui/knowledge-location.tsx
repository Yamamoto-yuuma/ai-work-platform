"use client";

/**
 * ナレッジの「置き場所」を出すところ。
 *
 * 業務の最中に要るのは中身の全文より先に在り処であることが多い
 * （テンプレがどこか、あの資料がどこか）。一覧・右パネル・STEPの
 * どこで出しても同じ見え方・同じ開き方にするため、ここに寄せる。
 */
import { isOpenable } from "@/core/model/knowledge-draft";

export function KnowledgeLocation({ location }: { location?: string }) {
  if (!location) return null;

  return (
    <p className="mt-1.5 text-[12px]">
      <span className="mr-1.5 text-ink-3">置き場所</span>
      {isOpenable(location) ? (
        /*
          外部の置き場所だけ別タブで開く。ここで画面ごと移ると、
          進めていた業務から出てしまう。
        */
        <a
          href={location} target="_blank" rel="noreferrer"
          className="break-all text-brand hover:underline"
        >
          {location} ↗
        </a>
      ) : (
        /* 共有フォルダなどは押しても開けない。写せる形にとどめる */
        <span className="select-all break-all text-ink-2">{location}</span>
      )}
    </p>
  );
}
