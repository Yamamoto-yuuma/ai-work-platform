"use client";

/**
 * 業務の登録（仕様 §28-6）。
 *
 * ここで登録した定義は、シードの定義とまったく同じ形でストアに入る。
 * 以降は HOME・業務一覧・ナビゲーター・タスク・マップが同じように扱う。
 */
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useStore } from "@/adapters/memory/store";
import { useNow } from "@/ui/use-navigator";
import { PageHeader } from "@/ui/primitives";
import { WorkflowWizard } from "@/ui/workflow-wizard";
import { compileWorkflow, describeUnset, draftFromWorkflow, emptyWorkflowDraft, type WorkflowDraft } from "@/core/workflow/draft";
import { catForRegistered } from "@/core/cat/message";
import { CatSays } from "@/ui/cat";
import { latestOf, makeWorkflowKey } from "@/core/workflow/registry";

function NewWorkflowInner() {
  const router = useRouter();
  const search = useSearchParams();
  const { workflows, dispatch } = useStore();
  const now = useNow();

  // 既存の業務を複製して作り始める（テンプレートとしての利用／仕様 §28-7）
  const copyFrom = search.get("copyFrom");
  const source = copyFrom ? latestOf(workflows, copyFrom) : undefined;

  const initial = useMemo<WorkflowDraft>(() => {
    if (!source) return emptyWorkflowDraft();
    const d = draftFromWorkflow(source);
    return { ...d, key: "", name: `${source.name}のコピー` };
  }, [source]);

  const [saved, setSaved] = useState<{ key: string; name: string; unsetCount: number } | null>(null);

  function save(draft: WorkflowDraft) {
    const key = makeWorkflowKey(workflows, draft.name);
    const workflow = compileWorkflow({
      draft, key, version: 1, now,
      ...(source ? { copiedFromKey: source.key } : {}),
      ...(draft.flowLocked && source ? { variables: source.variables } : {}),
    });
    dispatch({ type: "saveWorkflow", workflow });
    setSaved({ key, name: workflow.name, unsetCount: describeUnset(draft).length });
  }

  if (saved) {
    return (
      <div className="mx-auto max-w-[720px] px-6 py-10">
        <div className="rounded-xl bg-ok-soft p-6 text-center">
          <p className="text-[13px] font-bold text-ok">業務を登録しました</p>
          <h1 className="mt-2 text-[20px] font-bold tracking-tight">{saved.name}</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            この業務は「業務」一覧に並びました。開始すると、HOME・タスク・マップにも現れます。
          </p>
          {/* 登録した直後だけ。未設定があるなら、後から足せることを伝える */}
          <CatSays
            className="mt-4 justify-center text-left"
            message={catForRegistered({ key: saved.key, unsetCount: saved.unsetCount })}
          />
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link
              href={`/workflows/${saved.key}`}
              className="rounded-lg border border-brand bg-brand px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-ink"
            >
              登録した業務を見る
            </Link>
            <Link
              href="/workflows"
              className="rounded-lg border border-line bg-surface px-5 py-2.5 text-sm font-medium hover:bg-surface-2"
            >
              業務一覧へ
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[900px] px-6 py-6">
      <div className="mb-2 text-[12px] text-ink-3">
        <Link href="/workflows" className="hover:text-brand">業務</Link> / 業務を登録
      </div>
      <PageHeader
        title={source ? "業務を複製して登録" : "業務を登録"}
        description={
          source
            ? "元の業務の内容をそのまま持ってきています。必要なところだけ直してください。"
            : "自分の業務を登録すると、STEPに沿って進められるようになります。一度に全部を決める必要はありません。"
        }
      />
      <WorkflowWizard
        mode="create"
        initial={initial}
        onSave={save}
        onCancel={() => router.push("/workflows")}
      />
    </div>
  );
}

export default function NewWorkflowPage() {
  return (
    <Suspense fallback={<div className="p-8 text-[13px] text-ink-3">読み込み中…</div>}>
      <NewWorkflowInner />
    </Suspense>
  );
}
