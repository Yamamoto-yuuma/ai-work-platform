"use client";

/**
 * ナレッジの入力フォーム。
 * 追加と編集で同じ入力ルール・同じ検証・同じ見た目を使う。
 *
 * 置き場所を必ず書ける形にしてあるのが要点。
 * 「テンプレはどこだったか」を思い出せないのが困りごとなので、
 * 中身を書ききれなくても、在り処だけ残せれば用は足りる。
 */
import { useState } from "react";
import type { KnowledgeItem, WorkflowDefinition } from "@/core/model/types";
import {
  BODY_MAX, KNOWLEDGE_KINDS, TITLE_MAX,
  draftFromKnowledge, emptyKnowledgeDraft, validateKnowledgeDraft,
  type KnowledgeDraft, type KnowledgeDraftError,
} from "@/core/model/knowledge-draft";
import { Button } from "./primitives";

export type KnowledgeFormMode =
  | { kind: "create" }
  | { kind: "edit"; item: KnowledgeItem };

function Field({
  label, required, error, hint, children,
}: {
  label: string; required?: boolean; error?: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-baseline gap-1.5 text-[12.5px] font-medium">
        {label}
        {required && <span className="text-[11px] text-danger">必須</span>}
        {hint && <span className="ml-auto text-[11px] font-normal text-ink-3">{hint}</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-[12px] text-danger">{error}</p>}
    </div>
  );
}

export function KnowledgeForm({
  mode, workflows, onSubmit, onCancel,
}: {
  mode: KnowledgeFormMode;
  workflows: WorkflowDefinition[];
  onSubmit: (draft: KnowledgeDraft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<KnowledgeDraft>(() =>
    mode.kind === "edit" ? draftFromKnowledge(mode.item) : emptyKnowledgeDraft(),
  );
  const [errors, setErrors] = useState<KnowledgeDraftError[]>([]);
  const [touched, setTouched] = useState(false);

  const errorOf = (f: keyof KnowledgeDraft) => errors.find((e) => e.field === f)?.message;
  const set = <K extends keyof KnowledgeDraft>(k: K, v: KnowledgeDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    if (touched) setErrors(validateKnowledgeDraft({ ...draft, [k]: v }));
  };

  function submit() {
    setTouched(true);
    const found = validateKnowledgeDraft(draft);
    setErrors(found);
    if (found.length > 0) return;
    onSubmit(draft);
  }

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="タイトル" required error={errorOf("title")}
        hint={`${draft.title.trim().length} / ${TITLE_MAX}`}
      >
        <input
          className="field" value={draft.title} aria-label="タイトル"
          onChange={(e) => set("title", e.target.value)}
          placeholder="何についてのものか"
        />
      </Field>

      {/*
        置き場所を中身より先に置く。
        「どこにあるか」だけ分かれば足りる場面が多い。
      */}
      <Field label="置き場所" error={errorOf("location")} hint="URL・共有フォルダ・棚など">
        <input
          className="field" value={draft.location} aria-label="置き場所"
          onChange={(e) => set("location", e.target.value)}
          placeholder="https://… や \\\\共有\\テンプレ\\… など"
        />
      </Field>

      <Field
        label="中身" error={errorOf("body")}
        hint={`${draft.body.length} / ${BODY_MAX}`}
      >
        <textarea
          className="field leading-relaxed" rows={5} value={draft.body} aria-label="中身"
          onChange={(e) => set("body", e.target.value)}
          placeholder="手順・注意点・使い方など。置き場所だけでも構いません"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="種別" required error={errorOf("kind")}>
          <select
            className="field" value={draft.kind} aria-label="種別"
            onChange={(e) => set("kind", e.target.value as KnowledgeDraft["kind"])}
          >
            {KNOWLEDGE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </Field>

        <Field label="タグ" hint="読点・空白区切り">
          <input
            className="field" value={draft.tags} aria-label="タグ"
            onChange={(e) => set("tags", e.target.value)}
            placeholder="テンプレ、見積"
          />
        </Field>
      </div>

      {/*
        どの業務で出すか。ここを繋いでおくと、該当のSTEPを開いたときに
        自動で出てくる。探しに来なくて済むのが本来の姿。
      */}
      {workflows.length > 0 && (
        <Field label="このナレッジを出す業務" hint="任意・複数可">
          <div className="flex flex-wrap gap-1.5">
            {workflows.map((w) => {
              const on = draft.linkedWorkflowKeys.includes(w.key);
              return (
                <button
                  key={w.key} type="button" aria-pressed={on}
                  onClick={() => set("linkedWorkflowKeys",
                    on ? draft.linkedWorkflowKeys.filter((k) => k !== w.key)
                       : [...draft.linkedWorkflowKeys, w.key])}
                  className={`px-3 py-1.5 text-[12px] ${on ? "pick-on" : "pick"}`}
                >
                  {w.name}
                </button>
              );
            })}
          </div>
        </Field>
      )}

      {errors.length > 0 && (
        <div className="rounded-lg bg-danger-soft p-3.5">
          <p className="mb-1.5 text-[12.5px] font-bold text-danger">保存できません</p>
          <ul className="flex flex-col gap-0.5">
            {errors.map((e, i) => <li key={i} className="text-[12px] text-danger">・{e.message}</li>)}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={submit}>{mode.kind === "edit" ? "変更を保存" : "追加する"}</Button>
        <Button variant="secondary" onClick={onCancel}>キャンセル</Button>
      </div>
    </div>
  );
}
