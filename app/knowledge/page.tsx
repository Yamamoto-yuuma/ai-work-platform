"use client";

/**
 * ナレッジ（仕様 §16）。
 * この画面は「取りこぼしを拾う補助手段」であり、主導線ではない。
 * 本来は業務STEPから必要なものが提示される。
 */
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useStore } from "@/adapters/memory/store";
import { useWorkflows } from "@/ui/use-navigator";
import { Badge, Button, Card, Cells, Empty, Row, RowHead, RowList, Tabs, TopBar } from "@/ui/primitives";
import { Drawer } from "@/ui/drawer";
import { KnowledgeForm } from "@/ui/knowledge-form";
import { DeleteKnowledgeButton } from "@/ui/delete-knowledge";
import {
  isOpenable, newKnowledgeFromDraft, patchFromKnowledgeDraft,
} from "@/core/model/knowledge-draft";
import { newKnowledgeId } from "@/lib/id";

const KIND_LABEL = { manual: "マニュアル", faq: "FAQ", policy: "社内ルール", material: "資料" } as const;
const SOURCE_LABEL = { internal: "社内", gdrive: "Google Drive", notion: "Notion" } as const;

const KINDS = [
  { key: "all", label: "すべて" },
  { key: "manual", label: KIND_LABEL.manual },
  { key: "faq", label: KIND_LABEL.faq },
  { key: "policy", label: KIND_LABEL.policy },
  { key: "material", label: KIND_LABEL.material },
] as const;

type KindKey = (typeof KINDS)[number]["key"];

/* 見出し行と各行で同じ列幅を使う。ここがずれると表に見えなくなる */
const TEMPLATE = "minmax(0,1fr) 100px 108px 88px";

function KnowledgeInner() {
  const { knowledge, dispatch } = useStore();
  const workflows = useWorkflows();
  const search = useSearchParams();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<KindKey>("all");
  // 一覧から離れずに中身を読むための右パネル
  const [openId, setOpenId] = useState<string | null>(null);
  // 追加・書き換え。パネルの中で完結させ、別画面に移らない
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);

  /*
    検索から直接ここへ来たとき、その1件を開いた状態で見せる。
    一覧に着地させると、探し当てたものをもう一度探すことになる。
  */
  const wanted = search.get("open");
  useEffect(() => { if (wanted) setOpenId(wanted); }, [wanted]);

  const filtered = knowledge.filter((k) => {
    if (kind !== "all" && k.kind !== kind) return false;
    if (!q) return true;
    const t = q.toLowerCase();
    return k.title.toLowerCase().includes(t) || k.body.toLowerCase().includes(t) || k.tags.some((x) => x.includes(t));
  });

  const opened = openId ? knowledge.find((k) => k.id === openId) ?? null : null;
  const openedLinks = opened ? workflows.filter((w) => opened.linkedWorkflowKeys.includes(w.key)) : [];

  return (
    <div className="mx-auto max-w-[1000px] px-6 pb-8">
      <TopBar
        title="ナレッジ"
        action={
          !creating && (
            <Button onClick={() => { setCreating(true); setOpenId(null); }}>＋ ナレッジを追加</Button>
          )
        }
      >
        {/* 1件も無いときは、絞り込みも検索も出さない。絞る対象が無い */}
        {knowledge.length > 0 && (
          <div className="flex flex-wrap items-end justify-between gap-2">
            <Tabs items={KINDS} value={kind} onChange={setKind} />
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="キーワードで検索"
              aria-label="キーワードで検索"
              className="field field-sm mb-2 w-auto min-w-[180px]"
            />
          </div>
        )}
      </TopBar>

      {/*
        追加は別画面に飛ばさず、一覧の上に開く。
        「どこに何を書いたか」を残しに来ただけなので、往復させない。
      */}
      {creating && (
        <Card className="mb-4">
          <h2 className="mb-4 text-[13px] font-semibold">ナレッジを追加</h2>
          <KnowledgeForm
            mode={{ kind: "create" }}
            workflows={workflows}
            onCancel={() => setCreating(false)}
            onSubmit={(draft) => {
              const item = newKnowledgeFromDraft(draft, newKnowledgeId(), new Date());
              dispatch({ type: "addKnowledge", item });
              setCreating(false);
              // 追加したものをそのまま開く。入れたはずのものを探し直さない
              setOpenId(item.id);
            }}
          />
        </Card>
      )}

      {/*
        「探さなくても出てくる」のは、紐付いたナレッジがある場合の話。
        1件も無いうちにこれを出すと、もう用意されているように読めてしまう。
      */}
      {knowledge.length > 0 && (
        <p className="mb-4 text-[12px] text-ink-3">
          各ナレッジは業務のSTEPに紐付いており、該当のSTEPで自動的に表示されます。
        </p>
      )}

      {knowledge.length === 0 ? (
        <Empty>
          まだナレッジは登録されていません。
          <br />
          社内資料・業務マニュアル・サービス資料・過去のやり取りなど、
          <br />
          業務のSTEPで手元にあってほしいものをここに貯めていきます。
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty>該当するナレッジはありません</Empty>
      ) : (
        <RowList>
          <RowHead template={TEMPLATE}>
            <span>タイトル</span>
            <span>種別</span>
            <span>出所</span>
            <span>更新</span>
          </RowHead>
          {filtered.map((k) => {
            const linked = workflows.filter((w) => k.linkedWorkflowKeys.includes(w.key));
            return (
              <Row key={k.id}>
                <Cells template={TEMPLATE}>
                  {/*
                    本文はここには出さない。表は縦に読むためのもので、
                    長い文章が挟まると行の高さが揃わず、表でなくなる。
                    中身は行を押すと右から出る。
                  */}
                  <span className="cell-clip flex items-center gap-1.5">
                    {/*
                      タイトルそのものを押せるようにし、当たり判定だけ行全体に
                      広げる（::before）。文字のない当たり判定を上に重ねると、
                      読み上げに「何を開くのか分からないボタン」として出てしまう。
                    */}
                    <button
                      type="button"
                      onClick={() => setOpenId(k.id)}
                      className="cell-clip text-left text-[13px] font-medium before:absolute before:inset-0"
                    >
                      {k.title}
                    </button>
                    {/*
                      置き場所がある行に印を出す。「どこにあるか」が
                      書いてあるかどうかは、開く前に分かってほしい。
                    */}
                    {k.location && (
                      <span
                        role="img" aria-label="置き場所あり" title={k.location}
                        className="relative z-10 shrink-0 text-[11px] leading-none text-ink-3"
                      >
                        ↗
                      </span>
                    )}
                    {linked.length > 0 && (
                      <span className="shrink-0 text-[11px] text-ink-3">・{linked.length}業務</span>
                    )}
                  </span>
                  <span className="relative z-10"><Badge tone="neutral">{KIND_LABEL[k.kind]}</Badge></span>
                  <span className="relative z-10">
                    <Badge tone={k.source === "internal" ? "neutral" : "brand"}>{SOURCE_LABEL[k.source]}</Badge>
                  </span>
                  <span className="cell-clip cell-num text-[12px] text-ink-3">
                    {new Date(k.updatedAt).toLocaleDateString("ja-JP", { year: "2-digit", month: "numeric", day: "numeric" })}
                  </span>
                </Cells>
              </Row>
            );
          })}
        </RowList>
      )}

      <p className="mt-5 text-center text-[12px] text-ink-3">
        Google Drive / Notion からの取り込みは Phase 7 で接続します。現在は社内データのみを表示しています。
      </p>

      {opened && (
        <Drawer
          open
          onClose={() => { setOpenId(null); setEditing(false); }}
          title={opened.title}
          subtitle={`${KIND_LABEL[opened.kind]}／${SOURCE_LABEL[opened.source]}・更新 ${new Date(opened.updatedAt).toLocaleDateString("ja-JP")}`}
        >
          {editing ? (
            <KnowledgeForm
              mode={{ kind: "edit", item: opened }}
              workflows={workflows}
              onCancel={() => setEditing(false)}
              onSubmit={(draft) => {
                dispatch({
                  type: "updateKnowledge",
                  id: opened.id,
                  patch: { ...patchFromKnowledgeDraft(draft), updatedAt: new Date().toISOString() },
                });
                setEditing(false);
              }}
            />
          ) : (
            <>
              {/*
                置き場所を中身より上に置く。開いた理由がだいたいこれで、
                本文を読み下してから在り処に辿り着くのでは遅い。
              */}
              {opened.location && (
                <div className="mb-4 rounded-lg border border-line-soft bg-surface-2 px-3.5 py-2.5">
                  <p className="mb-1 text-[11px] text-ink-3">置き場所</p>
                  {isOpenable(opened.location) ? (
                    /*
                      外部の置き場所だけ別タブで開く。ここで画面ごと移ると、
                      進めていた業務から出てしまう。
                    */
                    <a
                      href={opened.location} target="_blank" rel="noreferrer"
                      className="break-all text-[12.5px] text-brand hover:underline"
                    >
                      {opened.location} ↗
                    </a>
                  ) : (
                    /* 共有フォルダなどは押しても開けない。写せる形にとどめる */
                    <p className="select-all break-all text-[12.5px] text-ink">{opened.location}</p>
                  )}
                </div>
              )}

              {opened.body && (
                <p className="whitespace-pre-wrap text-[12.5px] leading-[1.9] text-ink">{opened.body}</p>
              )}

              {opened.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {opened.tags.map((t) => <Badge key={t} tone="neutral">{t}</Badge>)}
                </div>
              )}

              {openedLinks.length > 0 && (
                <div className="mt-5 border-t border-line-soft pt-3.5">
                  <p className="mb-2 text-[11.5px] text-ink-3">このナレッジが出てくる業務</p>
                  <ul className="flex flex-col gap-1">
                    {openedLinks.map((w) => (
                      <li key={w.key}>
                        <Link href={`/workflows/${w.key}`} className="text-[12.5px] text-brand hover:underline">
                          {w.name} →
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3.5">
                <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>編集</Button>
                <DeleteKnowledgeButton item={opened} onDeleted={() => setOpenId(null)} />
              </div>
            </>
          )}
        </Drawer>
      )}
    </div>
  );
}

export default function KnowledgePage() {
  return (
    <Suspense fallback={<div className="p-8 text-[13px] text-ink-3">読み込み中…</div>}>
      <KnowledgeInner />
    </Suspense>
  );
}
