"use client";

/** 設定（仕様 §12画面 / §23 権限 / §22 外部連携）。管理系画面へのハブも兼ねる */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore, clearStorage } from "@/adapters/memory/store";
import { allComponentSpecs } from "@/components-registry/registry";
import { isRuleActive } from "@/core/rules/resolver";
import { Badge, Button, Card, PageHeader } from "@/ui/primitives";

const ROLE_LABEL = { executor: "実行者", designer: "業務設計者", admin: "管理者", viewer: "閲覧者" } as const;

const PERMISSIONS = [
  { op: "業務の実行・完了", executor: true, designer: true, admin: true, viewer: false },
  { op: "自分のタスクの操作", executor: true, designer: true, admin: true, viewer: false },
  { op: "業務フロー定義の作成・編集", executor: false, designer: true, admin: true, viewer: false },
  { op: "業務フロー定義の公開", executor: false, designer: true, admin: true, viewer: false },
  { op: "一時ルールの作成・編集", executor: false, designer: true, admin: true, viewer: false },
  { op: "派生ルールの作成・編集", executor: false, designer: true, admin: true, viewer: false },
  { op: "ユーザー・チーム管理", executor: false, designer: false, admin: true, viewer: false },
  { op: "外部連携の設定", executor: false, designer: false, admin: true, viewer: false },
];

export default function SettingsPage() {
  const { state, dispatch, users, integrations, currentUser } = useStore();
  const router = useRouter();

  return (
    <div className="mx-auto max-w-[960px] px-6 py-6">
      <PageHeader title="管理" description="ユーザー・権限・外部連携・業務部品の設定です。" />

      {/* デモ用の業務日 — 一時ルールの自動適用・自動失効を確認するためのもの */}
      <section className="mb-7">
        <h2 className="mb-3 text-[13px] font-bold">業務日（デモ用）</h2>
        <Card className="p-4">
          <p className="mb-3 text-[12px] text-ink-2">
            一時ルールは期間で自動的に有効・無効が切り替わります（定期処理は不要）。
            業務日を切り替えると、同じルールが適用されたり外れたりすることを確認できます。
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "今日（実時刻）", date: null },
              { label: "2026/09/15", date: "2026-09-15T10:00:00+09:00" },
              { label: "2026/10/05", date: "2026-10-05T10:00:00+09:00" },
            ].map((base) => {
              // その日に有効な期間限定ルールの件数をデータから数える
              const at = base.date ? new Date(base.date) : new Date();
              const n = state.businessRules.filter(
                (r) => r.ruleType === "temporary" && isRuleActive(r, at),
              ).length;
              const o = { ...base, note: `期間限定ルール ${n}件が適用中` };
              return (
              <button
                key={o.label}
                onClick={() => dispatch({ type: "setSimulatedDate", date: o.date })}
                className={`rounded-lg border px-3.5 py-2.5 text-left transition-colors ${
                  (state.simulatedDate ?? null) === o.date
                    ? "border-brand bg-brand-soft"
                    : "border-line bg-surface hover:bg-surface-2"
                }`}
              >
                <span className="block text-[13px] font-medium">{o.label}</span>
                <span className="block text-[11px] text-ink-3">{o.note}</span>
              </button>
              );
            })}
          </div>
        </Card>
      </section>

      {/* 管理画面へのハブ */}
      <div className="mb-7 grid gap-3 sm:grid-cols-3">
        {[
          { href: "/rules", title: "一時ルール", desc: "期間限定の業務ルールを管理" },
          { href: "/ai", title: "AIツール", desc: "AIの利用箇所と制約を確認" },
          { href: "/workflows", title: "業務フロー", desc: "業務の定義を確認" },
        ].map((x) => (
          <Link key={x.href} href={x.href}>
            <Card className="h-full p-4 transition-colors hover:border-brand">
              <p className="text-[13.5px] font-bold">{x.title}</p>
              <p className="mt-1 text-[12px] text-ink-2">{x.desc}</p>
            </Card>
          </Link>
        ))}
      </div>

      {/* ユーザー切替 */}
      <section className="mb-7">
        <h2 className="mb-3 text-[13px] font-bold">ユーザー</h2>
        <Card className="p-4">
          <p className="mb-3 text-[12px] text-ink-3">
            認証は Phase 7 で接続します。現在はモックユーザーを切り替えて権限の違いを確認できます。
          </p>
          <div className="flex flex-col gap-2">
            {users.map((u) => (
              <label
                key={u.id}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-2.5 ${
                  u.id === state.currentUserId ? "border-brand bg-brand-soft" : "border-line hover:bg-surface-2"
                }`}
              >
                <input
                  type="radio" name="user" checked={u.id === state.currentUserId}
                  onChange={() => dispatch({ type: "setUser", userId: u.id })}
                  className="h-4 w-4 accent-[#1d5a78]"
                />
                <span className="flex-1 text-[13px] font-medium">{u.name}</span>
                <span className="text-[11.5px] text-ink-3">{u.team}</span>
                <span className="flex gap-1">
                  {u.roles.map((r) => <Badge key={r} tone="neutral">{ROLE_LABEL[r]}</Badge>)}
                </span>
              </label>
            ))}
          </div>
        </Card>
      </section>

      {/* 権限マトリクス */}
      <section className="mb-7">
        <h2 className="mb-3 text-[13px] font-bold">権限</h2>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[560px] bg-surface text-[12.5px]">
            <thead className="bg-surface-2 text-[11.5px] text-ink-2">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">操作</th>
                <th className="px-3 py-2.5 text-center font-medium">実行者</th>
                <th className="px-3 py-2.5 text-center font-medium">業務設計者</th>
                <th className="px-3 py-2.5 text-center font-medium">管理者</th>
                <th className="px-3 py-2.5 text-center font-medium">閲覧者</th>
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((p) => (
                <tr key={p.op} className="border-t border-line-soft">
                  <td className="px-3 py-2.5">{p.op}</td>
                  {([p.executor, p.designer, p.admin, p.viewer]).map((v, i) => (
                    <td key={i} className="px-3 py-2.5 text-center">
                      <span className={v ? "text-ok" : "text-ink-3"}>{v ? "✓" : "–"}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11.5px] text-ink-3">
          現在のユーザー「{currentUser.name}」の権限：{currentUser.roles.map((r) => ROLE_LABEL[r]).join(" / ")}
          （権限による操作制限の実装は Phase 7）
        </p>
      </section>

      {/* 外部連携 */}
      <section className="mb-7">
        <h2 className="mb-3 text-[13px] font-bold">外部連携</h2>
        <div className="flex flex-col gap-2">
          {integrations.map((i) => (
            <Card key={i.key} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[13px] font-medium">{i.label}</p>
                  <Badge tone={i.connected ? "ok" : "neutral"}>{i.connected ? "接続済み" : "未接続"}</Badge>
                  <Badge tone="brand">{i.plannedPhase}</Badge>
                </div>
                <p className="mt-1 text-[12px] text-ink-2">{i.note}</p>
              </div>
              <Button variant="secondary" size="sm" disabled>接続する</Button>
            </Card>
          ))}
        </div>
      </section>

      {/* 業務部品 */}
      <section className="mb-7">
        <h2 className="mb-3 text-[13px] font-bold">業務部品（{allComponentSpecs().length}種）</h2>
        <Card className="p-4">
          <p className="mb-3 text-[12px] text-ink-3">
            STEPで使える部品の一覧です。部品はレジストリに登録されており、追加してもフローエンジンや既存の業務定義には影響しません。
          </p>
          <div className="flex flex-wrap gap-1.5">
            {allComponentSpecs().map((s) => (
              <span key={s.type} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[12px]">
                <span>{s.icon}</span>
                <span className="font-medium">{s.label}</span>
                {s.requiredPorts.length > 0 && <span className="text-[10.5px] text-ink-3">要連携</span>}
              </span>
            ))}
          </div>
        </Card>
      </section>

      {/* データ */}
      <section>
        <h2 className="mb-3 text-[13px] font-bold">データ</h2>
        <Card className="p-4">
          <p className="text-[12px] text-ink-2">
            Phase 1 のデータはブラウザの localStorage に保存されています。
            業務を進めた状態をリセットして、シードデータの初期状態に戻せます。
          </p>
          <div className="mt-3">
            <Button
              variant="danger"
              onClick={() => {
                if (!window.confirm("進行中の業務・タスクの変更をすべて破棄し、初期状態に戻します。よろしいですか？")) return;
                clearStorage();
                dispatch({ type: "reset" });
                router.push("/");
              }}
            >
              デモデータを初期状態に戻す
            </Button>
          </div>
        </Card>
      </section>
    </div>
  );
}
