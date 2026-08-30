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
import { users, customers, companies, knowledge, emailTemplates } from "../../../seed/master";
import { runs as seedRuns, stepRunsByRun as seedStepRuns, tasks as seedTasks, changeEvents as seedChanges } from "../../../seed/runs";

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
  changeEvents: ChangeEvent[];
  workEvents: WorkEvent[];
  businessRules: BusinessRule[];
  currentUserId: string;
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
  | { type: "reset" }
  | { type: "hydrate"; state: AppState };

function initialState(): AppState {
  return {
    userWorkflows: [],
    runs: seedRuns,
    stepRunsByRun: seedStepRuns,
    tasks: seedTasks,
    changeEvents: seedChanges,
    workEvents: [],
    businessRules,
    currentUserId: "user-me",
    simulatedDate: null,
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
    knowledge, customers, companies, users, emailTemplates, integrations,
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
