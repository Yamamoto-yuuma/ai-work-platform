/**
 * ポート定義。UI とドメインはこのインターフェースにしか依存しない。
 * Phase 1 は adapters/memory が実装。Phase 7 で Supabase / Google API に差し替える。
 */
import type {
  BusinessRule, ChangeEvent, Company, Customer, DerivationRule, EmailTemplate,
  KnowledgeItem, StepRun, Task, User, WorkEvent, WorkRun, WorkflowDefinition,
} from "../core/model/types";

export interface WorkflowRepository {
  list(): WorkflowDefinition[];
  byKey(key: string, version?: number): WorkflowDefinition | undefined;
}

export interface RunRepository {
  list(): WorkRun[];
  byId(id: string): WorkRun | undefined;
  stepRuns(runId: string): StepRun[];
}

export interface TaskRepository {
  list(): Task[];
  byId(id: string): Task | undefined;
}

export interface RuleRepository {
  list(): BusinessRule[];
  derivationRules(): DerivationRule[];
}

export interface KnowledgeRepository {
  list(): KnowledgeItem[];
}

export interface MasterRepository {
  customers(): Customer[];
  companies(): Company[];
  users(): User[];
  emailTemplates(): EmailTemplate[];
}

export interface EventRepository {
  workEvents(): WorkEvent[];
  changeEvents(): ChangeEvent[];
}

/** 将来 Gmail / Google Calendar / LLM / 企業検索API がここに入る */
export interface IntegrationStatus {
  key: "calendar" | "mailer" | "llm" | "companySearch" | "knowledgeSource" | "database";
  label: string;
  connected: boolean;
  plannedPhase: string;
  note: string;
}

export interface Container {
  workflows: WorkflowRepository;
  runs: RunRepository;
  tasks: TaskRepository;
  rules: RuleRepository;
  knowledge: KnowledgeRepository;
  master: MasterRepository;
  events: EventRepository;
  integrations(): IntegrationStatus[];
}
