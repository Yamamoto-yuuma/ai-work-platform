"use client";

/**
 * AIツール（仕様 §20）。
 * AIチャット画面ではない。「AIをどこで、どういう制約で使うか」を示す管理画面。
 */
import Link from "next/link";
import { useStore } from "@/adapters/memory/store";
import { Badge, Card, PageHeader } from "@/ui/primitives";

const AI_USES = [
  { no: 1, use: "業務分解（アドホック業務）", confirm: "必須", fallback: "空のテンプレートに手入力", phase: "Phase 3" },
  { no: 2, use: "不足情報の検出", confirm: "必須", fallback: "完了条件から機械的に列挙（実装済み）", phase: "Phase 3" },
  { no: 3, use: "確認事項の文章生成", confirm: "必須（使用前）", fallback: "定型文テンプレート", phase: "Phase 3" },
  { no: 4, use: "文章の生成・推敲", confirm: "必須（確定前）", fallback: "テンプレートをそのまま使用（実装済み）", phase: "Phase 8" },
  { no: 5, use: "メール文面の生成・推敲", confirm: "必須（送信前）", fallback: "テンプレートをそのまま使用（実装済み）", phase: "Phase 8" },
  { no: 6, use: "企業情報の整理・要約", confirm: "参考表示", fallback: "生データの一覧表示（実装済み）", phase: "Phase 6" },
  { no: 7, use: "検索結果の絞り込み提案", confirm: "選定は人間のみ", fallback: "条件によるソート（実装済み）", phase: "Phase 6" },
  { no: 8, use: "派生タスク候補の追加提案", confirm: "必須", fallback: "派生ルールによる生成のみ（実装済み）", phase: "Phase 8" },
  { no: 9, use: "変更影響の分析", confirm: "必須", fallback: "派生ルールのグラフのみ（実装済み）", phase: "Phase 8" },
  { no: 10, use: "業務フロー案の生成", confirm: "必須（下書き保存）", fallback: "手動作成", phase: "Phase 8" },
];

export default function AiPage() {
  const { integrations } = useStore();
  const llm = integrations.find((i) => i.key === "llm");

  return (
    <div className="mx-auto max-w-[980px] px-6 py-6">
      <PageHeader
        title="AIツール"
        description="AIは主役ではなく補助です。骨格は決定的なロジックが作り、AIはその周辺の自然言語処理だけを担当します。"
      />

      <Card className="mb-6 border-ai/30 bg-ai-soft p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-bold text-ai">LLM API（Claude）は現在未接続です</p>
            <p className="mt-1 text-[12.5px] text-ink-2">{llm?.note}</p>
          </div>
          <Badge tone="ai">{llm?.plannedPhase} で接続予定</Badge>
        </div>
      </Card>

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <p className="text-[12.5px] font-bold">AIが停止していても業務は完遂できます</p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">
            業務フローの実行・派生タスクの生成・不足情報の検出・逆算スケジュール・ルール適用は、
            すべてAIに依存しない決定的なロジックで動作します。
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[12.5px] font-bold">AIが勝手に確定することはありません</p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">
            業務の開始・タスクの確定・メールの送信・企業の選定・業務フローの公開は、
            すべてユーザーの明示的な確認を必要とします。
          </p>
        </Card>
      </div>

      <h2 className="mb-3 text-[13px] font-bold">AIを利用する箇所と、その制約</h2>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[720px] bg-surface text-[12.5px]">
          <thead className="bg-surface-2 text-[11.5px] text-ink-2">
            <tr>
              <th className="px-3 py-2.5 text-left font-medium">#</th>
              <th className="px-3 py-2.5 text-left font-medium">用途</th>
              <th className="px-3 py-2.5 text-left font-medium">ユーザー確認</th>
              <th className="px-3 py-2.5 text-left font-medium">AI停止時の代替</th>
              <th className="px-3 py-2.5 text-left font-medium">実装</th>
            </tr>
          </thead>
          <tbody>
            {AI_USES.map((r) => (
              <tr key={r.no} className="border-t border-line-soft">
                <td className="px-3 py-2.5 tabular-nums text-ink-3">{r.no}</td>
                <td className="px-3 py-2.5 font-medium">{r.use}</td>
                <td className="px-3 py-2.5">
                  <Badge tone={r.confirm.startsWith("必須") || r.confirm.includes("人間") ? "danger" : "neutral"}>{r.confirm}</Badge>
                </td>
                <td className="px-3 py-2.5 text-ink-2">{r.fallback}</td>
                <td className="px-3 py-2.5"><Badge tone="neutral">{r.phase}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Card className="mt-6 p-4">
        <p className="text-[12.5px] font-bold">なぜAIチャット画面がないのか</p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">
          ユーザーが質問を考えて入力する時点で、すでに「何をすべきか分からない」状態が発生しています。
          本プロダクトはその状態自体をなくすことを目的としているため、
          AIは各STEPの中に「下書きさせる」ボタンとして埋め込まれ、独立したチャット画面を持ちません。
        </p>
        <Link href="/" className="mt-2 inline-block text-[12px] text-brand hover:underline">HOMEで実際の提示を見る →</Link>
      </Card>
    </div>
  );
}
