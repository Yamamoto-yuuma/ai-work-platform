"use client";

/**
 * 業務の編集（仕様 §28-8）。
 *
 * 保存すると新しいバージョンとして積まれる。進行中の実行は開始時の
 * バージョンを見ているため、編集しても途中の業務は壊れない（仕様 §7-3）。
 */
import { use, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useStore } from "@/adapters/memory/store";
import { useNow } from "@/ui/use-navigator";
import { PageHeader } from "@/ui/primitives";
import { WorkflowWizard } from "@/ui/workflow-wizard";
import { compileWorkflow, draftFromWorkflow, type WorkflowDraft } from "@/core/workflow/draft";
import { latestOf, nextVersion } from "@/core/workflow/registry";

export default function EditWorkflowPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const router = useRouter();
  const { state, workflows, dispatch } = useStore();
  const now = useNow();

  const def = latestOf(workflows, key);
  const initial = useMemo<WorkflowDraft | null>(
    () => (def ? draftFromWorkflow(def) : null),
    [def],
  );

  if (!def || !initial) {
    return <div className="p-8 text-[13px]">業務が見つかりません。</div>;
  }

  const runCount = state.runs.filter((r) => r.workflowKey === def.key).length;

  function save(draft: WorkflowDraft) {
    if (!def) return;
    const workflow = compileWorkflow({
      draft,
      key: def.key,
      version: nextVersion(workflows, def.key),
      now,
      createdAt: def.createdAt,
      copiedFromKey: def.copiedFromKey,
      status: def.status,
      // 分岐条件が参照する業務情報の定義を落とさない
      ...(draft.flowLocked ? { variables: def.variables } : {}),
    });
    dispatch({ type: "saveWorkflow", workflow });
    router.push(`/workflows/${def.key}`);
  }

  return (
    <div className="mx-auto max-w-[900px] px-6 py-6">
      <div className="mb-2 text-[12px] text-ink-3">
        <Link href="/workflows" className="hover:text-brand">業務</Link> /{" "}
        <Link href={`/workflows/${def.key}`} className="hover:text-brand">{def.name}</Link> / 編集
      </div>
      <PageHeader
        title="業務を編集"
        description={`現在 v${def.version}。保存すると v${nextVersion(workflows, def.key)} として登録されます。`}
      />
      <WorkflowWizard
        mode="edit"
        initial={initial}
        runCount={runCount}
        onSave={save}
        onCancel={() => router.push(`/workflows/${def.key}`)}
      />
    </div>
  );
}
