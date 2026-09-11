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
import { newKnowledgeFromDraft, patchFromKnowledgeDraft } from "@/core/model/knowledge-draft";
import { KnowledgeLocation } from "@/ui/knowledge-location";
import { NotebookLauncher } from "@/ui/notebook-launcher";
import { serviceLabel, type LocationService } from "@/core/model/knowledge-link";
import { LOCATION_MARK } from "@/ui/icons";
import { newKnowledgeId } from "@/lib/id";

const KIND_LABEL = { manual: "マニュアル", faq: "FAQ", policy: "社内ルール", material: "資料" } as const;
const SOURCE_LABEL = {
  internal: "社内", gdrive: "Google ドライブ", notion: "Notion", notebooklm: "Gemini Notebook",
} as const;

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

  /*
    置き場所が Gemini Notebook のもの。絞り込みタブや検索には従わせない。
    「開きに行く」入口なので、いま何で絞っていても同じ場所に同じものが要る。
  */
  const notebooks = knowledge.filter((k) => k.source === "notebooklm" && k.location);

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
      {/*
        ノートブックへの入口。中身は向こうにあるので、開きに行く一手が
        いちばん多い。表の1行にせず、押すと決まっている場所に大きく置く。
      */}
      {!creating && <NotebookLauncher items={notebooks} onOpenDetail={setOpenId} />}

      {knowledge.length > 0 && !creating && <KnowledgeGuide />}

      {knowledge.length === 0 ? (
        <Empty>
          まだナレッジは登録されていません。
          <br />
          業務のSTEPで手元にあってほしいものを、ここに貯めていきます。
          <br />
          中身を書ききらなくても、置き場所のURLだけ残せば用は足ります。
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
                <div className="mb-4">
                  <KnowledgeLocation location={opened.location} />
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

/*
  置き場所の使い方の案内。
  「テンプレはどこか」を残すのがこの画面の主な用なので、
  何を貼れば何になるのかを、貼る前に読めるところに置く。

  対応表そのものを見せる。文章で「主要なサービスに対応しています」と
  書くより、印と名前が並んでいるほうが早いし、嘘をつけない。
*/
function KnowledgeGuide() {
  const samples: { service: LocationService; example: string }[] = [
    { service: "notebooklm", example: "notebooklm.google.com/notebook/…" },
    { service: "gdocs", example: "docs.google.com/document/…" },
    { service: "gdrive", example: "drive.google.com/…" },
    { service: "notion", example: "notion.so/…" },
  ];

  return (
    <div className="mb-4 rounded-xl border border-line-soft bg-surface p-4 shadow-card">
      {/*
        JSX は改行を空白1つに畳む。英文では要る空白だが、
        日本語では文の途中に穴が空いて見える。改行しない。
      */}
      <p className="text-[12.5px] leading-relaxed text-ink-2">
        ナレッジは業務のSTEPに紐付けておくと、該当のSTEPで自動的に出てきます。
        <br />
        <span className="font-medium text-ink">置き場所</span>
        にURLを入れておくと、何のリンクかが分かる形で並び、その場から開けます。
      </p>

      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {samples.map(({ service, example }) => {
          const Mark = LOCATION_MARK[service];
          return (
            /* min-w-0 が無いと、URL の例が縮まずに列ごと広がる */
            <li key={service} className="flex min-w-0 items-center gap-2 text-[11.5px]">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line-soft bg-surface-2 text-ink-3">
                <Mark />
              </span>
              <span className="shrink-0 font-medium text-ink-2">{serviceLabel(service)}</span>
              <span className="min-w-0 truncate text-ink-3">{example}</span>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 border-t border-line-soft pt-2.5 text-[11.5px] leading-relaxed text-ink-3">
        共有フォルダのパスや棚の場所など、ブラウザで開けないものも書けます。その場合はリンクにせず、写せる文字として出します。
      </p>
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
