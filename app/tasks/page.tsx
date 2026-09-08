"use client";

/** タスク一覧（仕様 §9-5）。提案中のタスクは確定済みと明確に区別する */
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useStore } from "@/adapters/memory/store";
import { useNow } from "@/ui/use-navigator";
import Link from "next/link";
import {
  Badge, Button, Card, Cells, Check, Empty, Row, RowHead, RowList, Tabs, TopBar,
} from "@/ui/primitives";
import { Drawer } from "@/ui/drawer";
import { TaskForm } from "@/ui/task-form";
import { DeadlineCascadePanel } from "@/ui/deadline-cascade";
import { proposeDependentDeadlines, shiftDirection, type DeadlineProposal } from "@/core/schedule/cascade";
import { DeleteTaskButton } from "@/ui/delete-task";
import { newTaskFromDraft, patchFromDraft, describeTaskRepeat } from "@/core/model/task-draft";
import { completeTaskEffects, reopenTaskEffects } from "@/core/task/repeat";
import { newTaskId } from "@/lib/id";
import { TASK_STATUS_LABEL, TASK_STATUS_DOT, TASK_SOURCE_LABEL } from "@/core/model/task-labels";
import { TASK_PRIORITIES } from "@/core/model/task-draft";
import { blockingPredecessors, effectiveStatus } from "@/core/task/dependency";
import { remainingLabel, urgencyOf } from "@/core/context/resolver";
import { escalatedPriority } from "@/core/priority/escalate";
import type { Task } from "@/core/model/types";

const VIEWS = [
  { key: "today", label: "今日" },
  { key: "week", label: "今週" },
  { key: "overdue", label: "期限超過" },
  { key: "byRun", label: "業務別" },
  { key: "derived", label: "派生別" },
  { key: "proposed", label: "提案中" },
  { key: "all", label: "すべて" },
  /*
    終わったものの置き場。
    完了したタスクは他のどのビューにも出さない（下の filtered 参照）。
    消してしまうのではなく、ここに寄せて後から見返せるようにする。
  */
  { key: "done", label: "完了" },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"];

function TasksInner() {
  const search = useSearchParams();
  const { state, dispatch, workflows, users } = useStore();
  const [view, setView] = useState<ViewKey>((search.get("view") as ViewKey) ?? "today");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [creating, setCreating] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  // 完了にすると行が一覧から消える。消えたことと戻し方をその場に出す
  const [justDone, setJustDone] = useState<
    { id: string; title: string; nextDueAt?: string } | null
  >(null);
  // 一覧から離れずに中身を見るための右パネル。開いているタスクのid
  const [openId, setOpenId] = useState<string | null>(null);
  // パネルの中で直したいときがある。開き直させない
  const [editing, setEditing] = useState(false);
  // 期限が動いたときの後続への影響。確定するまで反映しない（仕様 §11-3）
  const [cascade, setCascade] = useState<{
    sourceTitle: string; direction: "later" | "earlier"; proposals: DeadlineProposal[];
  } | null>(null);

  /*
    検索から直接ここへ来たとき、その1件を開いた状態で見せる。
    ついでに、その行が背後の一覧に映るビューへ移す。
    パネルの後ろに当の行が無いと、閉じたときに行き場を見失う。
  */
  const wanted = search.get("open");
  useEffect(() => {
    if (!wanted) return;
    setOpenId(wanted);
    const t = state.tasks.find((x) => x.id === wanted);
    if (t) setView(t.status === "done" ? "done" : "all");
    // 開くのは URL が指した一度だけ。閉じたあとに開き直さないよう、
    // タスクの中身が変わっても再実行はしない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);
  const now = useNow();

  const open = state.tasks.filter((t) => t.confirmationState !== "rejected");
  const proposed = open.filter((t) => t.confirmationState === "proposed");

  const filtered = open.filter((t) => {
    /*
      終わったものは、抱えている仕事の一覧に混ぜない。
      済んだ行が残っていると、件数も画面の高さも「まだやること」を
      表さなくなる。見返したいときは「完了」に寄せてある。
    */
    if (view === "done") return t.status === "done";
    if (t.status === "done") return false;
    if (view === "proposed") return t.confirmationState === "proposed";
    if (t.confirmationState === "proposed") return false;
    const u = urgencyOf(t.dueAt, now);
    switch (view) {
      case "today": return u === "today" || u === "overdue";
      case "week": return t.dueAt ? new Date(t.dueAt).getTime() - now.getTime() < 7 * 864e5 : false;
      case "overdue": return u === "overdue";
      case "derived": return t.source === "derived";
      case "byRun": return Boolean(t.runId);
      case "all": return true;
    }
  });

  // 担当者フィルタはビューの上に重ねて効かせる
  const visible = assigneeFilter === "all"
    ? filtered
    : filtered.filter((t) => t.assigneeId === assigneeFilter);

  const mineCount = open.filter(
    (t) => t.assigneeId === state.currentUserId && t.status !== "done" && t.status !== "canceled",
  ).length;

  const grouped = view === "byRun"
    ? Object.entries(visible.reduce<Record<string, Task[]>>((acc, t) => {
        const k = t.runId ?? "その他";
        (acc[k] ??= []).push(t);
        return acc;
      }, {}))
    : [["", visible] as [string, Task[]]];

  /*
    担当の列は、他人が担当しているものが1件でもあるときだけ出す。
    自分ひとりで使っているあいだは、全部の行に自分の名前が並ぶだけの
    列になってしまう。列を1本減らすと、残りの列が広く使える。
  */
  const showAssignee = visible.some((t) => t.assigneeId !== state.currentUserId);

  /*
    見出し行と各行が同じ列幅を使う。
    ここを1か所にしておかないと、行ごとに縦がずれて表に見えなくなる。
    最後の列は、触れたときだけ出る削除の置き場所。ふだんは空けておく。
  */
  const TEMPLATE = showAssignee
    ? "20px minmax(0,1fr) 92px 72px 92px 104px 58px"
    : "20px minmax(0,1fr) 92px 72px 92px 58px";

  /**
   * 完了に戻す。
   * 繰り返しで湧いた次の1件が手つかずなら、それも一緒に引き取る
   * （判断は core/task/repeat.ts に置き、詳細画面と同じ結果になるようにする）。
   */
  function reopen(t: Task) {
    const { patch, removeTaskId } = reopenTaskEffects({ task: t, allTasks: state.tasks });
    dispatch({ type: "updateTask", taskId: t.id, patch });
    if (removeTaskId) dispatch({ type: "deleteTask", taskId: removeTaskId });
    setJustDone(null);
  }

  /** その場で終わらせる。完了と未着手のあいだだけを行き来する */
  function toggleDone(t: Task) {
    if (t.status === "done") { reopen(t); return; }

    // 繰り返しなら、ここで次の1件が生まれる
    const { patch, created } = completeTaskEffects({ task: t, now, newId: newTaskId });
    if (created) dispatch({ type: "addTasks", tasks: [created] });
    dispatch({ type: "updateTask", taskId: t.id, patch });
    /*
      完了にすると、その行は「完了」以外のビューから消える。
      黙って消えると取り消せないので、消えたことと戻し方をその場に残す。
    */
    setJustDone(view !== "done"
      ? { id: t.id, title: t.title, nextDueAt: created?.dueAt }
      : null);
  }

  function TaskRow({ t }: { t: Task }) {
    const u = urgencyOf(t.dueAt, now);
    const blockedBy = blockingPredecessors(t, state.tasks);
    const shownStatus = effectiveStatus(t, state.tasks);
    const assignee = users.find((x) => x.id === t.assigneeId);
    // 優先度は登録時のまま固定しない。期限が近づけば上がる
    const nowPriority = escalatedPriority(t.priority, t.dueAt, now);
    const priorityLabel = TASK_PRIORITIES.find((x) => x.value === nowPriority)?.label ?? nowPriority;
    const raised = nowPriority !== t.priority;
    const done = t.status === "done";

    return (
      <Row tone={t.id === createdId ? "ok" : t.confirmationState === "proposed" ? "signal" : "plain"}>
        <Cells template={TEMPLATE}>
          <span className="relative z-10">
            <Check
              done={done}
              label={`${t.title} を完了にする`}
              disabled={blockedBy.length > 0 && !done}
              reason={blockedBy.length > 0 && !done
                ? `先に「${blockedBy.map((x) => x.title).join("」「")}」が終わる必要があります`
                : undefined}
              onToggle={() => toggleDone(t)}
            />
          </span>

          <span className="cell-clip flex items-center gap-1.5">
            {/*
              名前そのものをリンクにして、当たり判定だけを行全体に広げる
              （::before）。行の上に文字のない透明なリンクを重ねると、
              読み上げにも検索にも「行き先の分からないリンク」に見えてしまう。

              押すと右から中身が出る。Ctrl や ⌘ を押しながらなら、
              今までどおり別タブで詳細ページが開く。
            */}
            <Link
              href={`/tasks/${t.id}`}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                setOpenId(t.id);
              }}
              className={`cell-clip text-[13px] before:absolute before:inset-0 ${
                done ? "text-ink-3 line-through" : "font-medium"
              }`}
            >
              {t.title}
            </Link>
            {t.confirmationState === "proposed" && <Badge tone="signal">提案中</Badge>}
            {t.source === "derived" && <Badge tone="ai">{TASK_SOURCE_LABEL.derived}</Badge>}
            {t.source === "manual" && <Badge>{TASK_SOURCE_LABEL.manual}</Badge>}
            {t.source === "flow" && <Badge tone="brand">{TASK_SOURCE_LABEL.flow}</Badge>}
            {t.impactLayer === "check" && <Badge tone="brand">確認事項</Badge>}
            {/* 繰り返しは印だけ。周期そのものは列を1本増やすほどの情報ではない */}
            {t.repeat && (
              <span
                aria-label={`繰り返し：${describeTaskRepeat(t.repeat)}`}
                title={`${describeTaskRepeat(t.repeat)}に繰り返します`}
                className="shrink-0 text-[12px] leading-none text-ink-3"
              >
                ↻
              </span>
            )}
          </span>

          {/* 期限は日付そのものより「あとどれだけか」を出す。急ぎだけ色を差す */}
          <span className={`cell-clip cell-num text-[12px] ${
            u === "overdue" ? "font-medium text-danger" : u === "today" ? "text-signal" : "text-ink-3"
          }`}>
            {t.dueAt ? remainingLabel(new Date(t.dueAt), now) : "—"}
          </span>

          {/*
            引き上げられた優先度は、理由を書き足すと列に収まらない。
            矢印1つで「上がっている」ことだけを示し、理由は指を置けば読める。
          */}
          <span
            className={`cell-clip text-[12px] ${raised ? "font-medium text-danger" : "text-ink-2"}`}
            title={raised ? "期限が近いため引き上げています" : undefined}
          >
            {priorityLabel}
            {raised && <span aria-label="期限が近いため引き上げ"> ↑</span>}
          </span>

          {/*
            何を待っているかは列にしない。列を増やすと、待っている行の
            ためだけに全部の行が狭くなる。状態の欄に添えて、指を置けば読める。
            全文は行を開けば出る。
          */}
          <span
            className={`cell-clip flex items-center gap-1.5 text-[12px] ${
              shownStatus === "blocked" ? "font-medium text-danger" : "text-ink-2"
            }`}
            title={blockedBy.length > 0 ? `待機中：${blockedBy.map((x) => x.title).join(" / ")}` : undefined}
          >
            <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${TASK_STATUS_DOT[shownStatus]}`} aria-hidden />
            {TASK_STATUS_LABEL[shownStatus]}
          </span>

          {showAssignee && (
            <span className="cell-clip text-[12px] text-ink-3">
              {/* 自分が担当の行は空けておく。自分の名前を読ませる意味がない */}
              {t.assigneeId === state.currentUserId ? "" : assignee?.name ?? "未割当"}
            </span>
          )}

          {/* 間違えて作ったものを片付ける入口。ふだんは出さない */}
          <span className="relative z-10 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <DeleteTaskButton task={t} />
          </span>
        </Cells>
      </Row>
    );
  }

  const opened = openId ? state.tasks.find((t) => t.id === openId) ?? null : null;

  function closeDrawer() {
    setOpenId(null);
    setEditing(false);
    setCascade(null);
  }

  return (
    <div className="mx-auto max-w-[1100px] px-6 pb-8">
      <TopBar
        title="タスク"
        action={
          !creating && (
            <Button onClick={() => { setCreating(true); setCreatedId(null); }}>＋ タスクを追加</Button>
          )
        }
      >
        <div className="flex flex-wrap items-end justify-between gap-2">
          <Tabs
            items={VIEWS.map((v) => ({
              ...v,
              count: v.key === "proposed" ? proposed.length : undefined,
            }))}
            value={view}
            onChange={(v) => { setView(v); setJustDone(null); }}
          />
          {/*
            人が自分ひとりなら、絞り込む先が「すべて」と「自分」で同じになる。
            選んでも何も変わらないものを置かない。
          */}
          {users.length > 1 && (
          <label className="mb-2 flex shrink-0 items-center gap-2 whitespace-nowrap text-[12px] text-ink-3">
            担当者
            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              aria-label="担当者で絞り込む"
              className="field field-sm w-auto"
            >
              <option value="all">すべての担当者</option>
              <option value={state.currentUserId}>自分（{mineCount}件）</option>
              {users
                .filter((u) => u.id !== state.currentUserId)
                .map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
            </select>
          </label>
          )}
        </div>
      </TopBar>

      {creating && (
        <TaskForm
          mode={{ kind: "create", defaultAssigneeId: state.currentUserId }}
          users={users}
          onSubmit={(draft) => {
            const task = newTaskFromDraft(draft, newTaskId());
            dispatch({ type: "addTasks", tasks: [task] });
            setCreating(false);
            setCreatedId(task.id);
            // 作成したタスクが今のビューの条件から外れて見失わないようにする
            setView("all");
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {/* 完了にした直後だけ出す。押し間違えても1回で戻せるようにする */}
      {justDone && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg bg-ok-soft px-4 py-2.5">
          <span className="text-[12.5px] font-medium text-ok">
            「{justDone.title}」を完了にしました
            {/* 繰り返しなら、次がいつ来るかまで言う。黙って湧かせない */}
            {justDone.nextDueAt && (
              <>
                。次回分（
                {new Date(justDone.nextDueAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" })}
                ）を作りました
              </>
            )}
          </span>
          <button
            type="button"
            onClick={() => {
              const t = state.tasks.find((x) => x.id === justDone.id);
              if (t) reopen(t);
              else setJustDone(null);
            }}
            className="text-[12.5px] text-brand hover:underline"
          >
            元に戻す
          </button>
          <button
            type="button"
            onClick={() => setView("done")}
            className="text-[12.5px] text-ink-3 hover:text-ink hover:underline"
          >
            完了したタスクを見る →
          </button>
        </div>
      )}

      {createdId && !creating && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg bg-ok-soft px-4 py-2.5">
          <span className="text-[12.5px] font-medium text-ok">タスクを作成しました</span>
          <Link href={`/tasks/${createdId}`} className="text-[12.5px] text-brand hover:underline">
            作成したタスクを開く →
          </Link>
        </div>
      )}

      {proposed.length > 0 && view !== "proposed" && (
        <Card className="mb-5 bg-signal-soft p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-bold text-signal">{proposed.length}件の派生タスクが未確認です</p>
              <p className="mt-0.5 text-[12px] text-ink-2">変更によって提案されたタスクです。確認して確定してください。</p>
            </div>
            <Button variant="secondary" onClick={() => setView("proposed")}>内容を確認する</Button>
          </div>
        </Card>
      )}

      {view === "proposed" && proposed.length > 0 && (
        <div className="mb-4 flex gap-2">
          <Button onClick={() => dispatch({ type: "confirmTasks", taskIds: proposed.map((t) => t.id) })}>
            すべて確定する（{proposed.length}件）
          </Button>
          <Button variant="danger" onClick={() => dispatch({ type: "rejectTasks", taskIds: proposed.map((t) => t.id) })}>
            すべて却下
          </Button>
        </div>
      )}

      {visible.length === 0 ? (
        <Empty>該当するタスクはありません</Empty>
      ) : (
        grouped.map(([groupKey, list]) => (
          <section key={groupKey} className="mb-6">
            {groupKey && (
              <h2 className="mb-2 text-[12.5px] font-bold text-ink-3">
                {state.runs.find((r) => r.id === groupKey)?.subject.label ?? groupKey}
                <span className="ml-2 font-normal">
                  {workflows.find((w) => w.key === state.runs.find((r) => r.id === groupKey)?.workflowKey)?.name}
                </span>
              </h2>
            )}
            <RowList>
              {/* 見出し行。同じ種類の値が縦に揃っていることを目で分かるようにする */}
              <RowHead template={TEMPLATE}>
                <span />
                <span>タスク名</span>
                <span>期限</span>
                <span>優先度</span>
                <span>状態</span>
                {showAssignee && <span>担当</span>}
                <span />
              </RowHead>
              {list.map((t) => <TaskRow key={t.id} t={t} />)}
            </RowList>
          </section>
        ))
      )}

      <TaskDrawer task={opened} onClose={closeDrawer} onToggleDone={toggleDone} />
    </div>
  );

  /** 一覧から離れずに中身を見る。深掘りは詳細ページに任せる */
  function TaskDrawer({
    task, onClose, onToggleDone,
  }: {
    task: Task | null; onClose: () => void; onToggleDone: (t: Task) => void;
  }) {
    if (!task) return null;
    const blockedBy = blockingPredecessors(task, state.tasks);
    const shownStatus = effectiveStatus(task, state.tasks);
    const assignee = users.find((x) => x.id === task.assigneeId);
    const nowPriority = escalatedPriority(task.priority, task.dueAt, now);
    const priorityLabel = TASK_PRIORITIES.find((x) => x.value === nowPriority)?.label ?? nowPriority;
    const run = task.runId ? state.runs.find((r) => r.id === task.runId) : undefined;
    const def = run ? workflows.find((w) => w.key === run.workflowKey) : undefined;
    const change = task.originEventId
      ? state.changeEvents.find((c) => c.id === task.originEventId)
      : undefined;
    const u = urgencyOf(task.dueAt, now);

    const Line = ({ k, children }: { k: string; children: React.ReactNode }) => (
      <div className="flex gap-3 py-1.5">
        <dt className="w-20 shrink-0 text-[11.5px] text-ink-3">{k}</dt>
        <dd className="min-w-0 flex-1 text-[12.5px]">{children}</dd>
      </div>
    );

    return (
      <Drawer
        open
        onClose={onClose}
        title={task.title}
        subtitle={def && run ? `${def.name}／${run.subject.label}` : TASK_SOURCE_LABEL[task.source]}
        footer={
          editing ? undefined : (
            <>
              <Button
                variant={task.status === "done" ? "secondary" : "primary"}
                disabled={blockedBy.length > 0 && task.status !== "done"}
                onClick={() => onToggleDone(task)}
              >
                {task.status === "done" ? "未着手に戻す" : "完了にする"}
              </Button>
              {/* 直すためだけに画面を移らせない（提案中でも文言は直せる。仕様 §10-6） */}
              <Button variant="secondary" onClick={() => setEditing(true)}>編集</Button>
              <Link href={`/tasks/${task.id}`} className="text-[12.5px] text-brand hover:underline">
                詳細ページを開く →
              </Link>
              <span className="ml-auto">
                <DeleteTaskButton task={task} onDeleted={onClose} />
              </span>
            </>
          )
        }
      >
        {editing ? (
          <TaskForm
            mode={{ kind: "edit", task }}
            users={users}
            onSubmit={(draft) => {
              const patch = patchFromDraft(draft, task);
              const previousDueAt = task.dueAt;
              dispatch({ type: "updateTask", taskId: task.id, patch });
              setEditing(false);

              // 期限が動いた場合だけ、後続への影響を提案として出す（詳細画面と同じ経路）
              const updated = { ...task, ...patch };
              const proposals = proposeDependentDeadlines({
                changedTask: updated, previousDueAt, allTasks: state.tasks,
              });
              const direction = previousDueAt && updated.dueAt
                ? shiftDirection(previousDueAt, updated.dueAt)
                : "none";
              setCascade(
                proposals.length > 0 && direction !== "none"
                  ? { sourceTitle: updated.title, direction, proposals }
                  : null,
              );
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
        <>
        {cascade && (
          <div className="mb-4">
            <DeadlineCascadePanel
              sourceTitle={cascade.sourceTitle}
              direction={cascade.direction}
              proposals={cascade.proposals}
              onApply={(accepted) => {
                for (const pr of accepted) {
                  dispatch({ type: "updateTask", taskId: pr.taskId, patch: { dueAt: pr.proposedDueAt } });
                }
                setCascade(null);
              }}
              onDismiss={() => setCascade(null)}
            />
          </div>
        )}

        {task.confirmationState === "proposed" && (
          <div className="mb-4 rounded-lg bg-signal-soft p-3.5">
            <p className="text-[12.5px] font-bold text-signal">このタスクは提案中です</p>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-2">
              変更によって自動生成されたタスクです。内容を確認して確定してください。
            </p>
            <div className="mt-2.5 flex gap-2">
              <Button size="sm" onClick={() => dispatch({ type: "confirmTasks", taskIds: [task.id] })}>確定する</Button>
              <Button size="sm" variant="danger" onClick={() => dispatch({ type: "rejectTasks", taskIds: [task.id] })}>却下する</Button>
            </div>
          </div>
        )}

        <dl className="divide-y divide-line-soft">
          {/* 詳細画面と同じ言葉を使う。画面ごとに呼び名が変わると照らし合わせられない */}
          <Line k="確定">
            {task.confirmationState === "proposed" ? "提案中（未確定）" : "確定済み"}
          </Line>
          <Line k="状態">
            <span className="flex items-center gap-1.5">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${TASK_STATUS_DOT[shownStatus]}`} aria-hidden />
              {TASK_STATUS_LABEL[shownStatus]}
            </span>
          </Line>
          <Line k="期限">
            <span className={u === "overdue" ? "font-medium text-danger" : u === "today" ? "text-signal" : ""}>
              {task.dueAt
                ? `${new Date(task.dueAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" })}（${remainingLabel(new Date(task.dueAt), now)}）`
                : "未設定"}
            </span>
          </Line>
          <Line k="優先度">{priorityLabel}</Line>
          {task.repeat && (
            <Line k="繰り返し">
              {describeTaskRepeat(task.repeat)}
              <span className="ml-1.5 text-[11.5px] text-ink-3">完了にすると次の1件が作られます</span>
            </Line>
          )}
          {task.assigneeId !== state.currentUserId && (
            <Line k="担当">{assignee?.name ?? "未割当"}</Line>
          )}
          {task.description && (
            <Line k="説明">
              <span className="block whitespace-pre-wrap leading-relaxed text-ink-2">{task.description}</span>
            </Line>
          )}
          {blockedBy.length > 0 && (
            <Line k="待機中">
              <span className="text-danger">
                {blockedBy.map((x) => x.title).join(" / ")} が終わるまで着手できません
              </span>
            </Line>
          )}
          {run && (
            <Line k="業務">
              <Link href={`/navigator/${run.id}`} className="text-brand hover:underline">
                ナビゲーターを開く →
              </Link>
            </Line>
          )}
        </dl>

        {/*
          派生タスクは「なぜ出てきたのか」が分からないと確定の判断ができない。
          一覧から開いたときも、詳細ページと同じところへたどれるようにする。
        */}
        {change && (
          <div className="mt-4 border-t border-line-soft pt-3.5">
            <p className="mb-2 text-[11.5px] text-ink-3">このタスクが発生した理由</p>
            <Link
              href={`/map/impact/${change.id}`}
              className="block rounded-lg bg-surface-2 px-3.5 py-3 transition-colors hover:bg-brand-soft"
            >
              <span className="block text-[12.5px] font-medium">{change.entityLabel}</span>
              <span className="mt-1 block text-[12px] text-ink-2">
                {change.fieldLabel}：
                {new Date(String(change.before)).toLocaleDateString("ja-JP")}
                {" → "}
                {new Date(String(change.after)).toLocaleDateString("ja-JP")}
              </span>
              {change.reason && <span className="mt-1 block text-[11.5px] text-ink-3">{change.reason}</span>}
              <span className="mt-2 block text-[11.5px] text-brand">インパクトマップで影響範囲を見る →</span>
            </Link>
          </div>
        )}
        </>
        )}
      </Drawer>
    );
  }
}

export default function TasksPage() {
  return (
    <Suspense fallback={<div className="p-8 text-[13px] text-ink-3">読み込み中…</div>}>
      <TasksInner />
    </Suspense>
  );
}
