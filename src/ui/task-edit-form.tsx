"use client";

/**
 * タスク編集フォーム（仕様 §9-2）。
 * 編集できるのはタスク名・説明・期限・担当者・優先度の5項目のみ。
 * 由来（派生元・業務フロー）や依存関係には触れない。
 */
import { useState } from "react";
import type { Task, User } from "@/core/model/types";
import {
  TASK_PRIORITIES, TITLE_MAX, DESCRIPTION_MAX,
  draftFromTask, isDirty, patchFromDraft, validateTaskEdit,
  type TaskEditDraft, type TaskEditError,
} from "@/core/model/task-edit";
import { Button, Card } from "./primitives";

const INPUT =
  "w-full rounded-lg border bg-surface px-3 py-2 text-[13px] outline-none transition-colors focus:border-brand";

function Field({
  label, required, error, hint, hintTone, children,
}: {
  label: string; required?: boolean; error?: string; hint?: string;
  hintTone?: "normal" | "over"; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-baseline gap-1.5 text-[13px] font-medium">
        {label}
        {required && <span className="text-[11px] text-danger">必須</span>}
        {hint && (
          <span className={`ml-auto text-[11px] font-normal ${hintTone === "over" ? "text-danger" : "text-ink-3"}`}>
            {hint}
          </span>
        )}
      </label>
      {children}
      {error && <p className="mt-1 text-[12px] text-danger">{error}</p>}
    </div>
  );
}

export function TaskEditForm({
  task, users, onSave, onCancel,
}: {
  task: Task;
  users: User[];
  onSave: (patch: Partial<Task>) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<TaskEditDraft>(() => draftFromTask(task));
  const [errors, setErrors] = useState<TaskEditError[]>([]);
  const [touched, setTouched] = useState(false);

  const errorOf = (f: keyof TaskEditDraft) => errors.find((e) => e.field === f)?.message;
  const set = <K extends keyof TaskEditDraft>(k: K, v: TaskEditDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    if (touched) setErrors(validateTaskEdit({ ...draft, [k]: v }, users));
  };

  function save() {
    setTouched(true);
    const found = validateTaskEdit(draft, users);
    setErrors(found);
    if (found.length > 0) return;
    onSave(patchFromDraft(draft, task));
  }

  const border = (f: keyof TaskEditDraft) => (errorOf(f) ? "border-danger" : "border-line");
  const dirty = isDirty(draft, task);

  return (
    <Card className="mb-5 p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-[14px] font-bold">タスクを編集</h2>
        <span className="text-[11.5px] text-ink-3">
          由来・依存関係・業務との紐付けは変更されません
        </span>
      </div>

      <div className="flex flex-col gap-4">
        <Field
          label="タスク名" required error={errorOf("title")}
          hint={`${draft.title.trim().length} / ${TITLE_MAX}`}
          hintTone={draft.title.trim().length > TITLE_MAX ? "over" : "normal"}
        >
          <input
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            className={`${INPUT} ${border("title")}`}
            placeholder="何をするタスクかを書いてください"
            aria-label="タスク名"
          />
        </Field>

        <Field
          label="説明" error={errorOf("description")}
          hint={`${draft.description.length} / ${DESCRIPTION_MAX}`}
          hintTone={draft.description.length > DESCRIPTION_MAX ? "over" : "normal"}
        >
          <textarea
            value={draft.description}
            onChange={(e) => set("description", e.target.value)}
            rows={3}
            className={`${INPUT} ${border("description")} leading-relaxed`}
            placeholder="補足があれば記入してください（任意）"
            aria-label="説明"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="期限" error={errorOf("dueAt")}>
            <input
              type="date"
              value={draft.dueAt}
              onChange={(e) => set("dueAt", e.target.value)}
              className={`${INPUT} ${border("dueAt")}`}
              aria-label="期限"
            />
            {!draft.dueAt && <p className="mt-1 text-[11.5px] text-ink-3">未設定（期限なし）</p>}
          </Field>

          <Field label="担当者" required error={errorOf("assigneeId")}>
            <select
              value={draft.assigneeId}
              onChange={(e) => set("assigneeId", e.target.value)}
              className={`${INPUT} ${border("assigneeId")}`}
              aria-label="担当者"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}（{u.team}）</option>
              ))}
            </select>
          </Field>

          <Field label="優先度" required error={errorOf("priority")}>
            <select
              value={draft.priority}
              onChange={(e) => set("priority", e.target.value as TaskEditDraft["priority"])}
              className={`${INPUT} ${border("priority")}`}
              aria-label="優先度"
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="mt-4 rounded-lg border border-danger/40 bg-danger-soft p-3.5">
          <p className="mb-1.5 text-[12.5px] font-bold text-danger">保存できません</p>
          <ul className="flex flex-col gap-0.5">
            {errors.map((e, i) => (
              <li key={i} className="text-[12px] text-danger">・{e.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex items-center gap-2">
        <Button onClick={save} disabled={!dirty}>変更を保存</Button>
        <Button variant="secondary" onClick={onCancel}>キャンセル</Button>
        {!dirty && <span className="text-[12px] text-ink-3">変更はありません</span>}
      </div>
    </Card>
  );
}
