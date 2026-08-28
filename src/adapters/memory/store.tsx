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
} from "@/core/model/types";
import type { IntegrationStatus } from "@/ports";
import { workflows } from "../../../seed/workflows";
import { businessRules, derivationRules } from "../../../seed/rules";
import { users, customers, companies, knowledge, emailTemplates } from "../../../seed/master";
import { runs as seedRuns, stepRunsByRun as seedStepRuns, tasks as seedTasks, changeEvents as seedChanges } from "../../../seed/runs";

const STORAGE_KEY = "ai-work-platform:v1";

export interface AppState {
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
  | { type: "addChangeEvent"; change: ChangeEvent }
  | { type: "toggleRule"; ruleId: string }
  | { type: "addRule"; rule: BusinessRule }
  | { type: "setUser"; userId: string }
  | { type: "setSimulatedDate"; date: string | null }
  | { type: "reset" }
  | { type: "hydrate"; state: AppState };

function initialState(): AppState {
  return {
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

    case "addChangeEvent": {
      const exists = state.changeEvents.some((c) => c.id === action.change.id);
      return exists ? state : { ...state, changeEvents: [action.change, ...state.changeEvents] };
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
  }
}

interface StoreValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  // 読み取り用のポート実装（静的データはシードから直接返す）
  workflows: typeof workflows;
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

  const value = useMemo<StoreValue>(() => ({
    state, dispatch, workflows, derivationRules,
    knowledge, customers, companies, users, emailTemplates, integrations,
    currentUser: users.find((u) => u.id === state.currentUserId) ?? users[0],
  }), [state]);

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
