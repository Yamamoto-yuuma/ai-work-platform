"use client";

/**
 * ナレッジの「置き場所」を出すところ。
 *
 * 業務の最中に要るのは中身の全文より先に在り処であることが多い
 * （テンプレがどこか、あの資料がどこか）。一覧・右パネル・STEPの
 * どこで出しても同じ見え方・同じ開き方にするため、ここに寄せる。
 *
 * 生の URL を貼っただけにはしない。押してみないと何か分からないものが
 * 並ぶと、結局そこで手が止まる。何のサービスの、どこなのかを先に出す。
 */
import { describeLocation, type LocationService } from "@/core/model/knowledge-link";
import { LOCATION_MARK } from "./icons";

export function KnowledgeLocation({
  location, size = "md",
}: {
  location?: string;
  /** sm はSTEPの資料カードや右パネルなど、本文の脇に添えるとき */
  size?: "sm" | "md";
}) {
  const info = describeLocation(location);
  if (!info) return null;

  const Mark = LOCATION_MARK[info.service as LocationService] ?? LOCATION_MARK.web;
  const pad = size === "sm" ? "px-2.5 py-2" : "px-3 py-2.5";

  const inner = (
    <>
      {/*
        印は面で持たせる。文字の列に線画だけを置くと、
        字の一部のように見えて、種類の目印として働かない。
      */}
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line-soft bg-surface text-ink-2">
        <Mark />
      </span>
      <span className="min-w-0 flex-1">
        {/* 添えるものが無いときは、名前だけを本文の大きさで出す。空行を作らない */}
        {info.display ? (
          <>
            <span className="block truncate text-[11px] leading-tight text-ink-3">{info.label}</span>
            <span className="block truncate text-[12.5px] font-medium leading-snug text-ink">
              {info.display}
            </span>
          </>
        ) : (
          <span className="block truncate text-[12.5px] font-medium text-ink">{info.label}</span>
        )}
      </span>
      {info.openable && (
        <span className="shrink-0 text-[11.5px] text-ink-3 transition-colors group-hover:text-brand">
          開く ↗
        </span>
      )}
    </>
  );

  if (!info.openable) {
    /*
      共有フォルダなどは押しても開けない。リンクの見た目にすると
      押せそうに見えるだけになるので、写せる文字にとどめる。
    */
    return (
      <div className={`flex items-center gap-2.5 rounded-xl border border-line-soft bg-surface-2 ${pad}`}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line-soft bg-surface text-ink-2">
          <Mark />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] leading-tight text-ink-3">{info.label}</span>
          <span className="block select-all break-all text-[12.5px] font-medium leading-snug text-ink">
            {info.display}
          </span>
        </span>
      </div>
    );
  }

  return (
    /*
      外の置き場所だけ別タブで開く。ここで画面ごと移ると、
      進めていた業務から出てしまう。
    */
    <a
      href={location} target="_blank" rel="noreferrer"
      className={`group flex items-center gap-2.5 rounded-xl border border-line-soft bg-surface-2 ${pad} transition-colors hover:border-brand/40 hover:bg-brand-soft/40`}
    >
      {inner}
    </a>
  );
}
