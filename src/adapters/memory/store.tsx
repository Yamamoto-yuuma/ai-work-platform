"use client";

/**
 * インメモリ・ストア（Phase 1 の永続化アダプタ）。
 *
 * ports/ のインターフェースを満たす唯一の実装。Phase 7 で Supabase 実装に
 * 差し替える際、UI とドメインのコードは変更しない。
 * 状態は localStorage に保存し、リロードしても業務の進捗が残るようにしている。
 */
import { createContext, useContext, useEffect, useMemo, useReducer } from "react";
import type {
  BusinessRule, ChangeEvent, Company, Customer, DerivationRule, EmailTemplate,
  KnowledgeItem, StepRun, Task, User, WorkEvent, WorkRun,
  WorkflowDefinition, WorkflowStatus,
} from "@/core/model/types";
import type { IntegrationStatus } from "@/ports";
import { mergeWorkflows } from "@/core/workflow/registry";
import { workflows as seedWorkflows } from "../../../seed/workflows";
import { businessRules, derivationRules } from "../../../seed/rules";
import { users, customers, companies, emailTemplates, knowledge as sampleKnowledge } from "../../../seed/master";
import {
  runs as sampleRuns, stepRunsByRun as sampleStepRuns,
  tasks as sampleTasks, changeEvents as sampleChanges,
} from "../../../seed/runs";

const STORAGE_KEY = "ai-work-platform:v1";

export interface AppState {
  /**
   * 自分で登録した業務フロー定義（仕様 §28-1）。
   * シードの定義とは分けて保持し、読み出すときに合成する。
   * 編集はバージョンを積み上げるだけで、過去バージョンは消さない。
   * 実行中の WorkRun は開始時のバージョンを見ているため、編集の影響を受けない。
   */
  userWorkflows: WorkflowDefinition[];
  runs: WorkRun[];
  stepRunsByRun: Record<string, StepRun[]>;
  tasks: Task[];
  /**
   * 登録済みのナレッジ。
   * 以前はシードから直接読んでいたが、それだと「まだ何も登録していないのに
   * 設定済みに見える」うえ、ユーザーが自分で足す土台にもならない。
   * 状態として持つことで、空から始めて育てられるようにする。
   */
  knowledge: KnowledgeItem[];
  changeEvents: ChangeEvent[];
  workEvents: WorkEvent[];
  businessRules: BusinessRule[];
  currentUserId: string;
  /** サンプルデータを読み込んでいるか。初期状態は空で始める */
  sampleLoaded: boolean;
  /** デモ用の業務日。null なら実時刻。一時ルールの期間判定に使う */
  simulatedDate: string | null;
}

export type Action =
  | { type: "advanceStep"; runId: string; stepKey: string; nextKeys: string[]; skipped: string[]; output: Record<string, unknown>; checklist: Record<string, boolean>; appliedRuleIds: string[]; contextPatch: Record<string, unknown>; runDone: boolean }
  | { type: "reopenStep"; runId: string; stepKey: string }
  | { type: "setStepDraft"; runId: string; stepKey: string; output?: Record<string, unknown>; checklist?: Record<string, boolean> }
  | { type: "startRun"; run: WorkRun; stepRuns: StepRun[] }
  | { type: "addTasks"; tasks: Task[] }
  | { type: "confirmTasks"; taskIds: string[] }
  | { type: "rejectTasks"; taskIds: string[] }
  | { type: "updateTask"; taskId: string; patch: Partial<Task> }
  /**
   * タスクを消す（存在自体が不要だと判断したもの）。
   * 「完了」とは別。完了は済んだ記録として残り、削除は記録ごと消える。
   */
  | { type: "deleteTask"; taskId: string }
  /** 業務実行の更新。変更起票（B-6）で期限を書き換えるためだけに使う */
  | { type: "updateRun"; runId: string; patch: Pick<WorkRun, "dueAt"> }
  /** 業務の中止（仕様 §6-4）。完了とは別の終わり方 */
  | { type: "cancelRun"; runId: string; reason: string }
  /** 業務を待ちにする。自分が次に確認する日を決めて一旦止める */
  | { type: "pauseRun"; runId: string; waitingFor: string; waitingUntil: string }
  /** 待ちを解いて作業に戻す。STEP は待ちに入る前のまま */
  | { type: "resumeRun"; runId: string }
  /** 業務フロー定義の登録・更新。既存 key なら新しいバージョンとして積む */
  | { type: "saveWorkflow"; workflow: WorkflowDefinition }
  /** 業務の停止・再開。最新バージョンの状態だけを切り替える */
  | { type: "setWorkflowStatus"; key: string; status: WorkflowStatus; latest: WorkflowDefinition }
  | { type: "addChangeEvent"; change: ChangeEvent }
  | { type: "toggleRule"; ruleId: string }
  | { type: "addRule"; rule: BusinessRule }
  | { type: "setUser"; userId: string }
  | { type: "setSimulatedDate"; date: string | null }
  /** 動きを見るためのサンプルデータを入れる／片付ける */
  | { type: "loadSample" }
  | { type: "clearSample" }
  | { type: "reset" }
  | { type: "hydrate"; state: AppState };

/**
 * 何も入っていない状態。ここが既定。
 *
 * 以前はサンプルの業務・タスク・ナレッジがそのまま入っていたので、
 * 使い始めた時点で身に覚えのないものが並び、自分のものと見分けがつかなかった。
 * 空から始めて、必要なら設定でサンプルを入れられるようにする。
 *
 * 業務フロー定義とルールはここには含めない。手順の型そのものなので、
 * 消すと何も始められなくなる。不要なものは業務一覧から停止できる。
 */
function initialState(): AppState {
  return {
    userWorkflows: [],
    runs: [],
    stepRunsByRun: {},
    tasks: [],
    knowledge: [],
    changeEvents: [],
    workEvents: [],
    businessRules,
    currentUserId: "user-me",
    sampleLoaded: false,
    simulatedDate: null,
  };
}

/** 動きを見るためのサンプル一式。自分で作ったものには触らない */
function withSample(state: AppState): AppState {
  const taken = new Set(state.tasks.map((t) => t.id));
  const known = new Set(state.knowledge.map((k) => k.id));
  return {
    ...state,
    runs: [...state.runs, ...sampleRuns.filter((r) => !state.runs.some((x) => x.id === r.id))],
    stepRunsByRun: { ...sampleStepRuns, ...state.stepRunsByRun },
    tasks: [...state.tasks, ...sampleTasks.filter((t) => !taken.has(t.id))],
    knowledge: [...state.knowledge, ...sampleKnowledge.filter((k) => !known.has(k.id))],
    changeEvents: [...state.changeEvents, ...sampleChanges.filter((c) => !state.changeEvents.some((x) => x.id === c.id))],
    sampleLoaded: true,
  };
}

/**
 * いま画面にサンプルが混ざっているか。
 * 旧いバージョンで保存された状態にはフラグが無いので、実データで判定する。
 */
export function hasSampleData(state: AppState): boolean {
  return (
    state.runs.some((r) => sampleRuns.some((x) => x.id === r.id)) ||
    state.tasks.some((t) => sampleTasks.some((x) => x.id === t.id)) ||
    state.knowledge.some((k) => sampleKnowledge.some((x) => x.id === k.id))
  );
}

/** サンプルだけを片付ける。自分で作ったものは残す */
function withoutSample(state: AppState): AppState {
  const runIds = new Set(sampleRuns.map((r) => r.id));
  const stepRuns = { ...state.stepRunsByRun };
  for (const id of runIds) delete stepRuns[id];
  return {
    ...state,
    runs: state.runs.filter((r) => !runIds.has(r.id)),
    stepRunsByRun: stepRuns,
    // サンプルの業務から生まれたタスクも一緒に片付ける
    tasks: state.tasks.filter(
      (t) => !sampleTasks.some((s) => s.id === t.id) && !(t.runId && runIds.has(t.runId)),
    ),
    knowledge: state.knowledge.filter((k) => !sampleKnowledge.some((s) => s.id === k.id)),
    changeEvents: state.changeEvents.filter((c) => !sampleChanges.some((s) => s.id === c.id)),
    workEvents: state.workEvents.filter((e) => !e.runId || !runIds.has(e.runId)),
    sampleLoaded: false,
  };
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "hydrate":
      return action.state;

    case "reset":
      return initialState();

    case "setUser":
      return { ...state, currentUserId: action.userId };

    case "setSimulatedDate":
      return { ...state, simulatedDate: action.date };

    case "setStepDraft": {
      const list = state.stepRunsByRun[action.runId] ?? [];
      return {
        ...state,
        stepRunsByRun: {
          ...state.stepRunsByRun,
          [action.runId]: list.map((sr) =>
            sr.stepKey === action.stepKey
              ? {
                  ...sr,
                  output: action.output ? { ...sr.output, ...action.output } : sr.output,
                  checklistState: action.checklist ? { ...sr.checklistState, ...action.checklist } : sr.checklistState,
                }
              : sr,
          ),
        },
      };
    }

    case "advanceStep": {
      const now = new Date().toISOString();
      const list = state.stepRunsByRun[action.runId] ?? [];
      const updated = list.map((sr) => {
        if (sr.stepKey === action.stepKey) {
          return {
            ...sr, status: "done" as const, completedAt: now,
            output: { ...sr.output, ...action.output },
            checklistState: { ...sr.checklistState, ...action.checklist },
            appliedRuleIds: action.appliedRuleIds,
          };
        }
        if (action.nextKeys.includes(sr.stepKey) && sr.status === "pending") {
          return { ...sr, status: "active" as const, startedAt: now };
        }
        if (action.skipped.includes(sr.stepKey) && sr.status === "pending") {
          return { ...sr, status: "skipped" as const };
        }
        return sr;
      });

      const run = state.runs.find((r) => r.id === action.runId);
      const nextRuns = state.runs.map((r) =>
        r.id === action.runId
          ? {
              ...r,
              context: { ...r.context, ...action.contextPatch },
              currentStepKeys: action.runDone
                ? []
                : Array.from(new Set([...r.currentStepKeys.filter((k) => k !== action.stepKey), ...action.nextKeys])),
              status: action.runDone ? ("done" as const) : r.status,
              completedAt: action.runDone ? now : r.completedAt,
            }
          : r,
      );

      const events: WorkEvent[] = [{
        id: `ev-${Math.random().toString(36).slice(2, 10)}`,
        runId: action.runId, type: "step.completed", actor: state.currentUserId,
        payload: { stepKey: action.stepKey, appliedRuleIds: action.appliedRuleIds },
        createdAt: now,
      }];
      if (action.runDone && run) {
        events.push({
          id: `ev-${Math.random().toString(36).slice(2, 10)}`,
          runId: action.runId, type: "run.completed", actor: state.currentUserId,
          payload: {}, createdAt: now,
        });
      }

      return {
        ...state,
        runs: nextRuns,
        stepRunsByRun: { ...state.stepRunsByRun, [action.runId]: updated },
        workEvents: [...state.workEvents, ...events],
      };
    }

    case "reopenStep": {
      const list = state.stepRunsByRun[action.runId] ?? [];
      return {
        ...state,
        runs: state.runs.map((r) =>
          r.id === action.runId
            ? { ...r, status: "active", completedAt: undefined,
                currentStepKeys: Array.from(new Set([...r.currentStepKeys, action.stepKey])) }
            : r,
        ),
        stepRunsByRun: {
          ...state.stepRunsByRun,
          [action.runId]: list.map((sr) =>
            sr.stepKey === action.stepKey ? { ...sr, status: "active" as const, completedAt: undefined } : sr,
          ),
        },
        workEvents: [...state.workEvents, {
          id: `ev-${Math.random().toString(36).slice(2, 10)}`,
          runId: action.runId, type: "step.reopened", actor: state.currentUserId,
          payload: { stepKey: action.stepKey }, createdAt: new Date().toISOString(),
        }],
      };
    }

    case "startRun":
      return {
        ...state,
        runs: [action.run, ...state.runs],
        stepRunsByRun: { ...state.stepRunsByRun, [action.run.id]: action.stepRuns },
        workEvents: [...state.workEvents, {
          id: `ev-${Math.random().toString(36).slice(2, 10)}`,
          runId: action.run.id, type: "run.started", actor: state.currentUserId,
          payload: { workflowKey: action.run.workflowKey }, createdAt: new Date().toISOString(),
        }],
      };

    case "addTasks": {
      const existing = new Set(state.tasks.map((t) => t.id));
      return { ...state, tasks: [...state.tasks, ...action.tasks.filter((t) => !existing.has(t.id))] };
    }

    case "confirmTasks":
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          action.taskIds.includes(t.id) ? { ...t, confirmationState: "confirmed" as const } : t,
        ),
      };

    case "rejectTasks":
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          action.taskIds.includes(t.id) ? { ...t, confirmationState: "rejected" as const } : t,
        ),
      };

    case "updateTask":
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.id === action.taskId ? { ...t, ...action.patch } : t)),
      };

    case "deleteTask":
      // 消えるのはタスクだけ。業務の進捗も、そのタスクを作ったSTEPの記録も動かさない
      return { ...state, tasks: state.tasks.filter((t) => t.id !== action.taskId) };

    case "loadSample":
      return withSample(state);

    case "clearSample":
      return withoutSample(state);

    case "updateRun": {
      const target = state.runs.find((r) => r.id === action.runId);
      if (!target) return state;
      return {
        ...state,
        runs: state.runs.map((r) => (r.id === action.runId ? { ...r, ...action.patch } : r)),
        workEvents: [...state.workEvents, {
          id: `ev-${Math.random().toString(36).slice(2, 10)}`,
          runId: action.runId, type: "field.changed", actor: state.currentUserId,
          payload: { field: "dueAt", before: target.dueAt, after: action.patch.dueAt },
          createdAt: new Date().toISOString(),
        }],
      };
    }

    case "cancelRun": {
      const target = state.runs.find((r) => r.id === action.runId);
      if (!target || target.status !== "active") return state;
      const now = new Date().toISOString();
      return {
        ...state,
        runs: state.runs.map((r) =>
          r.id === action.runId
            ? { ...r, status: "canceled" as const, currentStepKeys: [], completedAt: now }
            : r,
        ),
        workEvents: [...state.workEvents, {
          id: `ev-${Math.random().toString(36).slice(2, 10)}`,
          runId: action.runId, type: "run.canceled", actor: state.currentUserId,
          payload: { reason: action.reason, atStepKeys: target.currentStepKeys },
          createdAt: now,
        }],
      };
    }

    case "pauseRun": {
      const target = state.runs.find((r) => r.id === action.runId);
      // active からは待ちに入る。paused からは「まだ待つ」＝待ちの内容を更新する。
      // どちらも run.paused として記録し、延長の経緯が履歴に残るようにする
      if (!target || (target.status !== "active" && target.status !== "paused")) return state;
      return {
        ...state,
        // currentStepKeys は保持する。再開時に復元する必要をなくすため
        runs: state.runs.map((r) =>
          r.id === action.runId
            ? {
                ...r,
                status: "paused" as const,
                waitingFor: action.waitingFor,
                waitingUntil: action.waitingUntil,
              }
            : r,
        ),
        workEvents: [...state.workEvents, {
          id: `ev-${Math.random().toString(36).slice(2, 10)}`,
          runId: action.runId, type: "run.paused", actor: state.currentUserId,
          payload: {
            waitingFor: action.waitingFor,
            waitingUntil: action.waitingUntil,
            atStepKeys: target.currentStepKeys,
          },
          createdAt: new Date().toISOString(),
        }],
      };
    }

    case "resumeRun": {
      const target = state.runs.find((r) => r.id === action.runId);
      if (!target || target.status !== "paused") return state;
      return {
        ...state,
        runs: state.runs.map((r) =>
          r.id === action.runId
            ? { ...r, status: "active" as const, waitingFor: undefined, waitingUntil: undefined }
            : r,
        ),
        workEvents: [...state.workEvents, {
          id: `ev-${Math.random().toString(36).slice(2, 10)}`,
          runId: action.runId, type: "run.resumed", actor: state.currentUserId,
          payload: {
            waitedFor: target.waitingFor,
            plannedCheckAt: target.waitingUntil,
            resumeStepKeys: target.currentStepKeys,
          },
          createdAt: new Date().toISOString(),
        }],
      };
    }

    case "addChangeEvent": {
      const exists = state.changeEvents.some((c) => c.id === action.change.id);
      if (exists) return state;
      return {
        ...state,
        changeEvents: [action.change, ...state.changeEvents],
        workEvents: [...state.workEvents, {
          id: `ev-${Math.random().toString(36).slice(2, 10)}`,
          runId: action.change.runId, type: "field.changed", actor: action.change.actor,
          payload: {
            changeEventId: action.change.id, entityLabel: action.change.entityLabel,
            field: action.change.field, before: action.change.before, after: action.change.after,
          },
          createdAt: action.change.occurredAt,
        }],
      };
    }

    case "toggleRule":
      return {
        ...state,
        businessRules: state.businessRules.map((r) =>
          r.id === action.ruleId ? { ...r, enabled: !r.enabled } : r,
        ),
      };

    case "addRule":
      return { ...state, businessRules: [action.rule, ...state.businessRules] };

    case "saveWorkflow": {
      const w = action.workflow;
      // 同じ key + version は差し替える。別バージョンは履歴として残す
      const rest = state.userWorkflows.filter(
        (x) => !(x.key === w.key && x.version === w.version),
      );
      return { ...state, userWorkflows: [...rest, w] };
    }

    case "setWorkflowStatus": {
      const target = { ...action.latest, status: action.status };
      const rest = state.userWorkflows.filter(
        (x) => !(x.key === target.key && x.version === target.version),
      );
      return { ...state, userWorkflows: [...rest, target] };
    }
  }
}

interface StoreValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  // 読み取り用のポート実装（静的データはシードから直接返す）
  /** シードと自分で登録したものを合成した全バージョン。実行中の業務の解決に使う */
  workflows: WorkflowDefinition[];
  derivationRules: DerivationRule[];
  knowledge: KnowledgeItem[];
  customers: Customer[];
  companies: Company[];
  users: User[];
  emailTemplates: EmailTemplate[];
  integrations: IntegrationStatus[];
  currentUser: User;
}

const StoreContext = createContext<StoreValue | null>(null);

const integrations: IntegrationStatus[] = [
  { key: "database", label: "データベース（Supabase / PostgreSQL）", connected: false, plannedPhase: "Phase 7", note: "現在はブラウザ内メモリと localStorage で保持しています。" },
  { key: "calendar", label: "Google Calendar", connected: false, plannedPhase: "Phase 7", note: "Calendar登録STEPは登録内容のプレビューまで動作します。" },
  { key: "mailer", label: "Gmail", connected: false, plannedPhase: "Phase 7", note: "メールは下書きとして保持され、送信は行いません。" },
  { key: "knowledgeSource", label: "Google Drive / Notion", connected: false, plannedPhase: "Phase 7", note: "ナレッジは内部データのみを表示しています。" },
  { key: "llm", label: "LLM API（Claude）", connected: false, plannedPhase: "Phase 8", note: "AI補助は未接続です。AIなしでも全業務が完遂できます。" },
  { key: "companySearch", label: "企業検索API", connected: false, plannedPhase: "Phase 7", note: "シードデータ8社を対象に検索しています。" },
];

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

  // localStorage から復元（初回のみ）
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as AppState;
        dispatch({ type: "hydrate", state: { ...initialState(), ...saved } });
      }
    } catch {
      // 復元できない場合はシードのまま続行する
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 保存に失敗しても業務の進行は妨げない
    }
  }, [state]);

  const workflows = useMemo(
    () => mergeWorkflows(seedWorkflows, state.userWorkflows),
    [state.userWorkflows],
  );

  const value = useMemo<StoreValue>(() => ({
    state, dispatch, workflows, derivationRules,
    knowledge: state.knowledge, customers, companies, users, emailTemplates, integrations,
    currentUser: users.find((u) => u.id === state.currentUserId) ?? users[0],
  }), [state, workflows]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore は StoreProvider の内側で使用してください");
  return ctx;
}

export function clearStorage() {
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}
