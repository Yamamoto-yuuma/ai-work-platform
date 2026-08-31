/**
 * 業務登録・編集の入力値と、業務フロー定義への変換（仕様 §28-6）。
 *
 * 画面が持つのは「人が書ける形（Draft）」だけにして、
 * WorkflowDefinition への組み立てと検証はここに閉じ込める。
 * framework 非依存の純粋関数で、ストアにもUIにも依存しない。
 *
 * 生成される定義は、シードで手書きしている定義と同じ形にする。
 * フローエンジン（core/flow）はこの定義がどこから来たかを知らない。
 */
import type {
  ComparisonOp, ConditionExpr, DeadlineRule, FlowEdge, StartSchedule, StartScheduleRepeat,
  StartTrigger, StepDefinition,
  TaskPriority, VariableDef, WorkComponentType, WorkQuota, WorkKind,
  WorkflowDefinition, WorkflowNotes,
} from "../model/types";
import { BODY_SLOT } from "./step-body";

// ---------------------------------------------------------------------------
// 語彙
// ---------------------------------------------------------------------------

/** 登録画面で選べる部品。設定まで画面で作りきれるものだけを並べる */
export const REGISTERABLE_COMPONENTS: {
  type: WorkComponentType; label: string; hint: string;
}[] = [
  { type: "checklist", label: "確認して進める", hint: "チェック項目を消化するSTEP" },
  { type: "input", label: "情報を入力する", hint: "項目に値を書き込むSTEP" },
  { type: "select", label: "選んで決める", hint: "選択肢から選ぶSTEP。分岐の判定に使えます" },
  { type: "document-compose", label: "文章を作成する", hint: "資料・原稿などを書くSTEP" },
  { type: "task-create", label: "タスクを作る", hint: "完了時にフォロータスクを生成するSTEP" },
  { type: "knowledge-view", label: "資料を確認する", hint: "登録済みナレッジを読むSTEP" },
];

export const WORK_KINDS: { value: WorkKind; label: string; hint: string }[] = [
  { value: "routine", label: "定型業務", hint: "決まった間隔で繰り返す業務" },
  { value: "reactive", label: "発生型業務", hint: "何かが起きたときに始まる業務" },
  { value: "term", label: "期間限定業務", hint: "期間を区切って取り組む業務" },
  { value: "urgent", label: "緊急対応", hint: "割り込みで入る突発的な業務" },
  { value: "other", label: "その他", hint: "上のどれにも当てはまらない業務" },
];

export const NAME_MAX = 60;
export const DESCRIPTION_MAX = 400;
export const STEP_TITLE_MAX = 60;

// ---------------------------------------------------------------------------
// 入力値
// ---------------------------------------------------------------------------

export interface FieldDraft {
  key: string;
  label: string;
  required: boolean;
  /** select のときだけ使う */
  options: { value: string; label: string }[];
}

export interface StepDraft {
  /** 定義内で一意。既存STEPを編集するときは変えない（実行中の業務が参照している） */
  key: string;
  title: string;
  guidance: string;
  preconditions: string;
  componentType: WorkComponentType;
  required: boolean;
  /** 数値の文字列。空文字は未設定 */
  estimatedMinutes: string;
  /** input / select */
  fields: FieldDraft[];
  /** checklist */
  items: { key: string; label: string }[];
  /** task-create */
  templates: { title: string; offsetDays: string }[];
  /** knowledge-view */
  knowledgeRefs: string[];
  /** 業務開始からの営業日数。空文字はSTEP期限なし */
  deadlineDays: string;
  /**
   * 登録画面では設定を作りきれない部品（メール作成・承認など）。
   * 種類の変更を許さず、元の設定をそのまま持ち回る。勝手に壊さないため。
   */
  locked: boolean;
  /** locked のときに保持する元の設定 */
  rawConfig: Record<string, unknown>;
}

/** このSTEPを終えたあと、どう進むか */
export type FlowDraft =
  | { kind: "next" }
  | {
      kind: "branch";
      /** 判定に使う項目（select / input のフィールドキー） */
      fieldKey: string;
      paths: { value: string; label: string; toStepKey: string }[];
      /** どれにも当てはまらないとき */
      elseToStepKey: string;
      /**
       * どのルートを通っても、そのあと必ず通るSTEP（合流先）。
       * 各ルートの最後のSTEPからここへ繋ぐ。空なら合流しない。
       */
      joinStepKey: string;
    }
  | { kind: "parallel"; toStepKeys: string[]; joinStepKey: string }
  | { kind: "end" };

export interface QuotaDraft {
  enabled: boolean;
  metric: WorkQuota["metric"];
  period: WorkQuota["period"];
  target: string;
  direction: WorkQuota["direction"];
}

export interface StartTriggerDraft {
  kind: StartTrigger["kind"];
  date: string;
  weekdays: number[];
  time: string;
  eventLabel: string;
  afterWorkflowKey: string;
  taskLabel: string;
  note: string;
}

/**
 * 開始スケジュールの下書き。
 * 入力途中は数値も文字列で持つ（空欄を許すため）。
 */
export interface StartScheduleDraft {
  id: string;
  label: string;
  repeatKind: StartScheduleRepeat["kind"];
  /** weekly のとき。0=日 … 6=土 */
  weekdays: number[];
  /** monthly-day のとき。1〜31の文字列 */
  monthDay: string;
  time: string;
  enabled: boolean;
}

export const START_REPEAT_CHOICES: {
  kind: StartScheduleRepeat["kind"]; label: string; hint: string;
}[] = [
  { kind: "daily", label: "毎日", hint: "曜日を問わず毎日" },
  { kind: "weekly", label: "毎週", hint: "曜日を選ぶ" },
  { kind: "monthly-day", label: "毎月（日付）", hint: "毎月の決まった日" },
  { kind: "monthly-last", label: "毎月（月末）", hint: "その月の最終日" },
];

export function emptyStartSchedule(id: string): StartScheduleDraft {
  return {
    id,
    label: "",
    repeatKind: "weekly",
    weekdays: [],
    monthDay: "1",
    // 業務の区切りに置かれることが多いので、夕方を既定にする
    time: "17:00",
    enabled: true,
  };
}

export interface WorkflowDraft {
  /** 既存の定義を編集しているときだけ入る */
  key: string;
  name: string;
  description: string;
  category: string;
  workKind: WorkKind;
  estimatedMinutes: string;
  defaultPriority: TaskPriority;
  /** 業務開始からの日数。空文字は期限なし */
  deadlineDays: string;
  deadlineBusinessDaysOnly: boolean;
  startTrigger: StartTriggerDraft;
  /** 繰り返しの開始予定。何本でも持てる */
  startSchedules: StartScheduleDraft[];
  quota: QuotaDraft;
  steps: StepDraft[];
  /** STEPキー → 進み方 */
  flow: Record<string, FlowDraft>;
  notes: WorkflowNotes;
  /**
   * 登録画面のモデルでは表現しきれない流れ（分岐ノードを持つ定義など）。
   * true のときは STEP の並びと分岐を編集させず、元の構成をそのまま引き継ぐ。
   * 「編集したら分岐が消えていた」を起こさないための取り決め。
   */
  flowLocked: boolean;
  /** flowLocked のときに書き戻す、元の分岐ノード・完了STEP */
  preservedSteps: StepDefinition[];
  /** flowLocked のときに書き戻す、元のエッジ */
  preservedEdges: FlowEdge[];
}

export interface DraftError {
  /** どの画面の問題か。ウィザードの該当STEPへ戻すために使う */
  stage: 1 | 2 | 3 | 4;
  message: string;
  stepKey?: string;
}

// ---------------------------------------------------------------------------
// 初期値
// ---------------------------------------------------------------------------

export function emptyStartTrigger(): StartTriggerDraft {
  return {
    kind: "manual", date: "", weekdays: [], time: "",
    eventLabel: "", afterWorkflowKey: "", taskLabel: "", note: "",
  };
}

export function emptyStepDraft(index: number): StepDraft {
  return {
    key: `step-${index}`,
    title: "",
    guidance: "",
    preconditions: "",
    componentType: "checklist",
    required: true,
    estimatedMinutes: "",
    fields: [],
    items: [],
    templates: [],
    knowledgeRefs: [],
    deadlineDays: "",
    locked: false,
    rawConfig: {},
  };
}

export function emptyWorkflowDraft(): WorkflowDraft {
  return {
    key: "",
    name: "",
    description: "",
    category: "",
    workKind: "routine",
    estimatedMinutes: "",
    defaultPriority: "normal",
    deadlineDays: "",
    deadlineBusinessDaysOnly: true,
    startTrigger: emptyStartTrigger(),
    startSchedules: [],
    quota: { enabled: false, metric: "count", period: "month", target: "", direction: "atLeast" },
    steps: [],
    flow: {},
    notes: {},
    flowLocked: false,
    preservedSteps: [],
    preservedEdges: [],
  };
}

/** 新しいSTEPキー。既存キーとぶつからない番号を採る */
export function nextStepKey(steps: StepDraft[]): string {
  const taken = new Set(steps.map((s) => s.key));
  for (let i = 1; i < 1000; i += 1) {
    const k = `step-${i}`;
    if (!taken.has(k)) return k;
  }
  return `step-${Date.now().toString(36)}`;
}

export function nextFieldKey(step: StepDraft): string {
  const taken = new Set(step.fields.map((f) => f.key));
  for (let i = 1; i < 1000; i += 1) {
    const k = `${step.key.replace(/-/g, "_")}_f${i}`;
    if (!taken.has(k)) return k;
  }
  return `f-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// 検証
// ---------------------------------------------------------------------------

function num(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

export function validateWorkflowDraft(draft: WorkflowDraft): DraftError[] {
  const errors: DraftError[] = [];
  const name = draft.name.trim();

  if (name.length === 0) errors.push({ stage: 1, message: "業務名を入力してください" });
  else if (name.length > NAME_MAX) {
    errors.push({ stage: 1, message: `業務名は${NAME_MAX}文字以内で入力してください（現在 ${name.length} 文字）` });
  }
  if (draft.description.length > DESCRIPTION_MAX) {
    errors.push({ stage: 1, message: `説明は${DESCRIPTION_MAX}文字以内で入力してください（現在 ${draft.description.length} 文字）` });
  }
  const seenKeys = new Set<string>();
  for (const s of draft.steps) {
    if (seenKeys.has(s.key)) {
      errors.push({ stage: 2, message: "STEPの識別子が重複しています", stepKey: s.key });
    }
    seenKeys.add(s.key);

    const no = draft.steps.indexOf(s) + 1;
    if (s.title.trim().length === 0) {
      errors.push({ stage: 2, message: `${no}番目のSTEPに名前を入力してください`, stepKey: s.key });
    } else if (s.title.trim().length > STEP_TITLE_MAX) {
      errors.push({ stage: 2, message: `${no}番目のSTEP名は${STEP_TITLE_MAX}文字以内にしてください`, stepKey: s.key });
    }

    const est = num(s.estimatedMinutes);
    if (Number.isNaN(est) || (est !== undefined && est < 0)) {
      errors.push({ stage: 3, message: "想定所要時間は0以上の数値で入力してください", stepKey: s.key });
    }
    const dd = num(s.deadlineDays);
    if (Number.isNaN(dd)) {
      errors.push({ stage: 4, message: "STEPの期限は数値で入力してください", stepKey: s.key });
    }

    if (s.locked) continue;

    /**
     * STEP の中身（チェック項目・入力項目・作成するタスク）は必須にしない。
     * まず並びだけ登録して、使いながら育てられるようにするため（仕様 §28-6）。
     * ここで見るのは「書きかけの行」だけ。空の行を残したまま保存すると
     * 実行時に意味のない項目が出てしまうので、それだけは知らせる。
     */
    for (const f of s.fields) {
      if (f.label.trim().length === 0) {
        errors.push({ stage: 3, message: `「${s.title || "STEP"}」に名前のない項目があります`, stepKey: s.key });
      }
    }
    for (const item of s.items) {
      if (item.label.trim().length === 0) {
        errors.push({ stage: 3, message: `「${s.title || "STEP"}」に内容のないチェック項目があります`, stepKey: s.key });
      }
    }
    for (const t of s.templates) {
      if (t.title.trim().length === 0) {
        errors.push({ stage: 3, message: `「${s.title || "STEP"}」に名前のないタスクがあります`, stepKey: s.key });
      }
      if (Number.isNaN(num(t.offsetDays))) {
        errors.push({ stage: 3, message: `「${s.title || "STEP"}」のタスクの期限は数値で入力してください`, stepKey: s.key });
      }
    }
  }

  // 進み方の検証。元の構成を引き継ぐ定義では、進み方は編集させないので検証しない
  const keys = new Set(draft.steps.map((s) => s.key));
  for (const s of draft.flowLocked ? [] : draft.steps) {
    const f = draft.flow[s.key];
    if (!f) continue;
    if (f.kind === "branch") {
      if (!f.fieldKey) {
        errors.push({ stage: 4, message: `「${s.title || "STEP"}」の分岐に使う項目を選んでください`, stepKey: s.key });
      }
      if (f.paths.length === 0) {
        errors.push({ stage: 4, message: `「${s.title || "STEP"}」の分岐先を1つ以上設定してください`, stepKey: s.key });
      }
      for (const p of f.paths) {
        if (!keys.has(p.toStepKey)) {
          errors.push({ stage: 4, message: `「${s.title || "STEP"}」の分岐先が存在しません`, stepKey: s.key });
        }
      }
      if (f.elseToStepKey && !keys.has(f.elseToStepKey)) {
        errors.push({ stage: 4, message: `「${s.title || "STEP"}」の既定の進み先が存在しません`, stepKey: s.key });
      }
      if (f.joinStepKey) {
        const j = draft.steps.findIndex((x) => x.key === f.joinStepKey);
        const targets = [...f.paths.map((p) => p.toStepKey), f.elseToStepKey]
          .filter(Boolean)
          .map((k) => draft.steps.findIndex((x) => x.key === k));
        if (j < 0) {
          errors.push({ stage: 4, message: `「${s.title || "STEP"}」の合流先が存在しません`, stepKey: s.key });
        } else if (targets.some((t) => t > j)) {
          errors.push({
            stage: 4,
            message: `「${s.title || "STEP"}」の合流先は、分かれた先のSTEPより後ろにしてください`,
            stepKey: s.key,
          });
        }
      }
    }
    if (f.kind === "parallel") {
      if (f.toStepKeys.length < 2) {
        errors.push({ stage: 4, message: `「${s.title || "STEP"}」の並列STEPを2つ以上選んでください`, stepKey: s.key });
      }
      if (!f.joinStepKey || !keys.has(f.joinStepKey)) {
        errors.push({ stage: 4, message: `「${s.title || "STEP"}」の合流先を選んでください`, stepKey: s.key });
      }
      if (f.toStepKeys.includes(f.joinStepKey)) {
        errors.push({ stage: 4, message: `「${s.title || "STEP"}」の合流先は並列STEPと別にしてください`, stepKey: s.key });
      }
    }
  }

  if (Number.isNaN(num(draft.estimatedMinutes))) {
    errors.push({ stage: 4, message: "業務全体の想定所要時間は数値で入力してください" });
  }
  if (Number.isNaN(num(draft.deadlineDays))) {
    errors.push({ stage: 4, message: "期限は数値で入力してください" });
  }
  if (draft.quota.enabled && (Number.isNaN(num(draft.quota.target)) || num(draft.quota.target) === undefined)) {
    errors.push({ stage: 4, message: "目標の数値を入力してください" });
  }
  const t = draft.startTrigger;
  if (t.kind === "date" && !t.date) errors.push({ stage: 4, message: "開始する日付を選んでください" });
  if (t.kind === "weekday" && t.weekdays.length === 0) errors.push({ stage: 4, message: "開始する曜日を選んでください" });
  if (t.kind === "time" && !t.time) errors.push({ stage: 4, message: "開始する時刻を入力してください" });
  if (t.kind === "event" && !t.eventLabel.trim()) errors.push({ stage: 4, message: "きっかけになる出来事を書いてください" });
  if (t.kind === "task" && !t.taskLabel.trim()) errors.push({ stage: 4, message: "きっかけになるタスクを書いてください" });
  if (t.kind === "after-workflow" && !t.afterWorkflowKey) errors.push({ stage: 4, message: "先行する業務を選んでください" });
  if (t.kind === "condition" && !t.note.trim()) errors.push({ stage: 4, message: "成立させたい条件を書いてください" });

  // 開始スケジュール。中身が足りないものは、消すか埋めるかを選んでもらう
  draft.startSchedules.forEach((sc, i) => {
    const nth = `${i + 1}本目の開始スケジュール`;
    if (!sc.time.trim()) {
      errors.push({ stage: 4, message: `${nth}の開始時刻を入力してください` });
    }
    if (sc.repeatKind === "weekly" && sc.weekdays.length === 0) {
      errors.push({ stage: 4, message: `${nth}の曜日を選んでください` });
    }
    if (sc.repeatKind === "monthly-day") {
      const day = Number(sc.monthDay);
      if (!Number.isFinite(day) || day < 1 || day > 31) {
        errors.push({ stage: 4, message: `${nth}の日付は1〜31で入力してください` });
      }
    }
  });

  return errors;
}

/**
 * まだ決めていない項目の案内（仕様 §28-6）。
 *
 * これは「登録できない理由」ではない。登録したうえで、あとから足せるものを
 * 思い出せるようにするためのメモ。確認画面に注意ではなく案内として出す。
 */
export function describeUnset(draft: WorkflowDraft): string[] {
  const hints: string[] = [];
  if (draft.steps.length === 0) {
    hints.push("STEPがまだありません。あとから追加できます");
    return hints;
  }
  const noGuidance = draft.steps.filter((s) => s.guidance.trim().length === 0).length;
  if (noGuidance > 0) {
    hints.push(`${noGuidance}件のSTEPに「何をするか」の説明がありません`);
  }
  // 「中身が未設定」の規則は step-body.ts に集約している。
  // 実行画面で空のSTEPカードを畳む判定と、必ず同じ規則にするため
  const empty = draft.steps.filter((s) => {
    if (s.locked) return false;
    const slot = BODY_SLOT[s.componentType];
    return slot ? s[slot].length === 0 : false;
  }).length;
  if (empty > 0) hints.push(`${empty}件のSTEPは中身が未設定です（名前だけで進められます）`);
  if (draft.deadlineDays.trim() === "") hints.push("期限は決めていません");
  if (draft.category.trim() === "") hints.push("カテゴリは「未分類」になります");
  return hints;
}

// ---------------------------------------------------------------------------
// 定義への変換
// ---------------------------------------------------------------------------

const DONE_KEY = "done";

function toStartTrigger(d: StartTriggerDraft): StartTrigger | undefined {
  if (d.kind === "manual") return { kind: "manual" };
  const t: StartTrigger = { kind: d.kind };
  if (d.date) t.date = d.date;
  if (d.weekdays.length > 0) t.weekdays = [...d.weekdays].sort();
  if (d.time) t.time = d.time;
  if (d.eventLabel.trim()) t.eventLabel = d.eventLabel.trim();
  if (d.afterWorkflowKey) t.afterWorkflowKey = d.afterWorkflowKey;
  if (d.taskLabel.trim()) t.taskLabel = d.taskLabel.trim();
  if (d.note.trim()) t.note = d.note.trim();
  return t;
}

function scheduleToDraft(s: StartSchedule): StartScheduleDraft {
  return {
    id: s.id,
    label: s.label ?? "",
    repeatKind: s.repeat.kind,
    weekdays: s.repeat.kind === "weekly" ? [...s.repeat.weekdays] : [],
    monthDay: s.repeat.kind === "monthly-day" ? String(s.repeat.day) : "1",
    time: s.time,
    enabled: s.enabled,
  };
}

/** 昔の「曜日で開始」「時間で開始」を、繰り返しの予定1本に読み替える */
function legacyRepeatAsSchedule(t: StartTrigger | undefined): StartScheduleDraft[] {
  if (!t) return [];
  if (t.kind === "weekday" && (t.weekdays ?? []).length > 0) {
    return [{
      id: "sch-legacy-weekday", label: "",
      repeatKind: "weekly", weekdays: [...(t.weekdays ?? [])],
      monthDay: "1", time: t.time || "09:00", enabled: true,
    }];
  }
  if (t.kind === "time" && t.time) {
    return [{
      id: "sch-legacy-time", label: "",
      repeatKind: "daily", weekdays: [],
      monthDay: "1", time: t.time, enabled: true,
    }];
  }
  return [];
}

/** 下書きを定義の形にする。中身が足りないものは落とす */
function toStartSchedules(list: StartScheduleDraft[]): StartSchedule[] | undefined {
  const out: StartSchedule[] = [];
  for (const d of list) {
    if (!d.time.trim()) continue;
    let repeat: StartScheduleRepeat;
    if (d.repeatKind === "weekly") {
      if (d.weekdays.length === 0) continue;
      repeat = { kind: "weekly", weekdays: [...d.weekdays].sort((a, b) => a - b) };
    } else if (d.repeatKind === "monthly-day") {
      const day = Number(d.monthDay);
      if (!Number.isFinite(day) || day < 1 || day > 31) continue;
      repeat = { kind: "monthly-day", day };
    } else if (d.repeatKind === "monthly-last") {
      repeat = { kind: "monthly-last" };
    } else {
      repeat = { kind: "daily" };
    }
    out.push({
      id: d.id,
      ...(d.label.trim() ? { label: d.label.trim() } : {}),
      repeat,
      time: d.time,
      enabled: d.enabled,
    });
  }
  return out.length > 0 ? out : undefined;
}

function toQuota(q: QuotaDraft): WorkQuota | undefined {
  if (!q.enabled) return undefined;
  const target = Number(q.target);
  if (!Number.isFinite(target)) return undefined;
  return { metric: q.metric, period: q.period, target, direction: q.direction };
}

function stepConfig(s: StepDraft): Record<string, unknown> {
  // 登録画面で作りきれない部品は、元の設定をそのまま残す
  if (s.locked) return s.rawConfig;
  switch (s.componentType) {
    case "checklist":
      return { items: s.items.map((i) => ({ key: i.key, label: i.label.trim(), required: true })) };
    case "input":
      return {
        fields: s.fields.map((f) => ({
          key: f.key, label: f.label.trim(), required: f.required,
        })),
      };
    case "select":
      return {
        fields: s.fields.map((f) => ({
          key: f.key, label: f.label.trim(), required: f.required,
          options: f.options.map((o) => ({ value: o.value, label: o.label.trim() })),
        })),
      };
    case "task-create":
      return {
        templates: s.templates.map((t) => {
          const offset = Number(t.offsetDays);
          return {
            title: t.title.trim(),
            ...(Number.isFinite(offset) && t.offsetDays.trim() !== ""
              ? { offsetDays: offset, businessDaysOnly: true }
              : {}),
          };
        }),
      };
    default:
      return {};
  }
}

/** 入力項目は業務情報（context）としても扱えるようにする */
function toVariables(steps: StepDraft[]): VariableDef[] {
  const out: VariableDef[] = [];
  const seen = new Set<string>();
  for (const s of steps) {
    if (s.componentType !== "input" && s.componentType !== "select") continue;
    for (const f of s.fields) {
      if (seen.has(f.key)) continue;
      seen.add(f.key);
      out.push({ key: f.key, label: f.label.trim() || f.key, type: "string", required: f.required });
    }
  }
  return out;
}

function eq(fieldKey: string, value: string): ConditionExpr {
  const op: ComparisonOp = "eq";
  return { op, left: { kind: "var", path: `context.${fieldKey}` }, right: { kind: "literal", value } };
}

/**
 * 「それ以外」の条件式。
 *
 * 条件を持たないエッジは、フローエンジンでは「並列に進む枝」として扱われる
 * （core/flow/engine.ts の resolveNextSteps）。分岐の既定ルートを条件なしで
 * 置くと、どの選択肢を選んでも既定ルートまで一緒に活性化してしまう。
 * そこで「どの選択肢にも当てはまらない」を条件式そのものとして持たせる。
 * エンジン側には手を入れない。
 */
function otherwise(fieldKey: string, values: string[]): ConditionExpr | undefined {
  if (values.length === 0) return undefined;
  return {
    op: "not",
    operand: values.length === 1
      ? eq(fieldKey, values[0])
      : { op: "or", operands: values.map((v) => eq(fieldKey, v)) },
  };
}

/**
 * STEPの並び順と「進み方」からエッジを組み立てる。
 *
 * 既定は上から下への一本道。分岐は完了STEPの出力（context）で判定し、
 * 並列は条件なしエッジを複数張り、合流STEPの入力エッジに joinPolicy: "all" を付ける。
 * この形はシードで手書きしている定義と同じで、フローエンジンの解釈も同じになる。
 */
export function buildEdges(draft: WorkflowDraft): FlowEdge[] {
  const steps = draft.steps;
  const edges: FlowEdge[] = [];
  const indexOf = (key: string) => steps.findIndex((s) => s.key === key);

  /**
   * 分岐ルートの出口。
   *
   * 分岐は「上から順」の一本道を一時的に分ける。分けた各ルートは
   * 合流先の手前までを担当し、ルートの最後のSTEPから合流先へ繋ぐ。
   * これをしないと、選ばなかったルートの先頭へ流れ込んでしまう。
   */
  const routeExit = new Map<string, string>();
  for (const [fromKey, f] of Object.entries(draft.flow)) {
    if (f.kind !== "branch" || !f.joinStepKey) continue;
    const b = indexOf(fromKey);
    const j = indexOf(f.joinStepKey);
    if (b < 0 || j < 0 || j <= b) continue;

    // ルートの開始位置（分岐と合流先のあいだにあるものだけ）
    const starts = Array.from(
      new Set([...f.paths.map((p) => p.toStepKey), f.elseToStepKey].filter(Boolean)),
    )
      .map(indexOf)
      .filter((i) => i > b && i < j)
      .sort((a, z) => a - z);

    starts.forEach((start, k) => {
      // 次のルートが始まる直前、または合流先の直前がこのルートの最後
      const end = (starts[k + 1] ?? j) - 1;
      const last = steps[end];
      if (last) routeExit.set(last.key, f.joinStepKey);
    });
  }

  steps.forEach((s, i) => {
    const fallback = routeExit.get(s.key) ?? steps[i + 1]?.key ?? DONE_KEY;
    const f = draft.flow[s.key] ?? { kind: "next" as const };

    if (f.kind === "end") {
      edges.push({ from: s.key, to: DONE_KEY, priority: 1 });
      return;
    }

    if (f.kind === "branch") {
      f.paths.forEach((p, j) => {
        edges.push({
          from: s.key, to: p.toStepKey, priority: j + 1,
          label: p.label.trim() || p.value,
          condition: eq(f.fieldKey, p.value),
        });
      });
      // 既定の進み先。指定がなければ合流先（＝どのルートも通らずに合流する）。
      // 「次のSTEP」に落とすと、片方のルートの先頭へ勝手に流れ込んでしまう
      const otherwiseTo = f.elseToStepKey || f.joinStepKey || fallback;
      const cond = otherwise(f.fieldKey, f.paths.map((p) => p.value));
      edges.push({
        from: s.key, to: otherwiseTo,
        priority: f.paths.length + 1, label: "それ以外",
        ...(cond ? { condition: cond } : {}),
      });
      return;
    }

    if (f.kind === "parallel") {
      f.toStepKeys.forEach((to, j) => {
        edges.push({ from: s.key, to, priority: j + 1 });
      });
      return;
    }

    edges.push({ from: s.key, to: fallback, priority: 1 });
  });

  // 合流：合流STEPへ入るエッジのうち、並列で分かれた側は全部そろうまで待つ
  for (const f of Object.values(draft.flow)) {
    if (f.kind !== "parallel") continue;
    for (const e of edges) {
      if (e.to === f.joinStepKey && f.toStepKeys.includes(e.from)) e.joinPolicy = "all";
    }
  }
  // 並列の枝から合流先へ届いていない場合は補う（枝が一本道の末尾のとき）
  for (const f of Object.values(draft.flow)) {
    if (f.kind !== "parallel") continue;
    for (const branchKey of f.toStepKeys) {
      const reaches = edges.some((e) => e.from === branchKey && e.to === f.joinStepKey);
      if (!reaches) {
        // 既存の出口を合流先に付け替える
        const own = edges.filter((e) => e.from === branchKey);
        if (own.length === 1 && !own[0].condition) {
          own[0].to = f.joinStepKey;
          own[0].joinPolicy = "all";
        } else {
          edges.push({ from: branchKey, to: f.joinStepKey, priority: 90, joinPolicy: "all" });
        }
      }
    }
  }

  // 到達不能なSTEPを残さない：どこからも入ってこないSTEPは直前のSTEPから繋ぐ
  const reached = new Set(edges.map((e) => e.to));
  steps.forEach((s, i) => {
    if (i === 0 || reached.has(s.key)) return;
    const prev = steps[i - 1];
    if (!prev) return;
    edges.push({ from: prev.key, to: s.key, priority: 80 });
  });

  return edges.filter((e) => e.from !== e.to);
}

export interface CompileInput {
  draft: WorkflowDraft;
  /** flowLocked の定義で、元の変数定義を保つために渡す */
  variables?: VariableDef[];
  key: string;
  version: number;
  now: Date;
  /** 新規登録時のみ。既存定義を編集した場合は元の値を引き継ぐ */
  createdAt?: string;
  copiedFromKey?: string;
  status?: WorkflowDefinition["status"];
}

/** 入力値から業務フロー定義を組み立てる。検証を通ってから呼ぶ */
export function compileWorkflow(input: CompileInput): WorkflowDefinition {
  const { draft, key, version, now } = input;
  const iso = now.toISOString();

  const steps: StepDefinition[] = draft.steps.map((s) => {
    const est = s.estimatedMinutes.trim() === "" ? undefined : Number(s.estimatedMinutes);
    const dd = s.deadlineDays.trim() === "" ? undefined : Number(s.deadlineDays);
    const deadlineRule: DeadlineRule | undefined =
      dd !== undefined && Number.isFinite(dd)
        ? { from: "run.startedAt", offsetDays: dd, businessDaysOnly: true }
        : undefined;

    return {
      key: s.key,
      title: s.title.trim(),
      // 未設定なら空のまま。STEP名で埋めると画面で同じ文字列が2回並ぶ
      guidance: s.guidance.trim(),
      componentType: s.componentType,
      config: stepConfig(s),
      required: s.required,
      ...(est !== undefined && Number.isFinite(est) ? { estimatedMinutes: est } : {}),
      ...(deadlineRule ? { deadlineRule } : {}),
      ...(s.knowledgeRefs.length > 0 ? { knowledgeRefs: s.knowledgeRefs } : {}),
      ...(s.preconditions.trim() ? { preconditions: s.preconditions.trim() } : {}),
      ruleTags: [key],
    };
  });

  if (draft.flowLocked) {
    // 分岐ノード・完了STEPは元のまま書き戻す
    steps.push(...draft.preservedSteps);
  } else {
    steps.push({
      key: DONE_KEY,
      title: "完了",
      guidance: "対応した内容を確認して業務を終了します。",
      componentType: "complete",
      config: {},
      required: true,
      ruleTags: [key],
    });
  }

  const totalEstimate = draft.estimatedMinutes.trim() === ""
    ? steps.reduce((sum, s) => sum + (s.estimatedMinutes ?? 0), 0) || undefined
    : Number(draft.estimatedMinutes);

  const deadlineDays = draft.deadlineDays.trim() === "" ? undefined : Number(draft.deadlineDays);

  return {
    key,
    version,
    status: input.status ?? "published",
    name: draft.name.trim(),
    description: draft.description.trim(),
    category: draft.category.trim() || "未分類",
    audience: { roles: [], teams: [] },
    variables: input.variables ?? toVariables(draft.steps),
    steps,
    edges: draft.flowLocked ? draft.preservedEdges : buildEdges(draft),
    completionPolicy: { requireAllRequiredSteps: true },
    ...(deadlineDays !== undefined && Number.isFinite(deadlineDays)
      ? {
          deadlineRule: {
            from: "run.startedAt" as const,
            offsetDays: deadlineDays,
            businessDaysOnly: draft.deadlineBusinessDaysOnly,
          },
        }
      : {}),
    ruleTags: [key],
    derivationRuleIds: [],
    ...(totalEstimate ? { estimatedMinutes: totalEstimate } : {}),
    updatedAt: iso,
    workKind: draft.workKind,
    startTrigger: toStartTrigger(draft.startTrigger),
    ...(toStartSchedules(draft.startSchedules) ? { startSchedules: toStartSchedules(draft.startSchedules) } : {}),
    defaultPriority: draft.defaultPriority,
    ...(toQuota(draft.quota) ? { quota: toQuota(draft.quota) } : {}),
    notes: draft.notes,
    origin: "user",
    ...(input.copiedFromKey ? { copiedFromKey: input.copiedFromKey } : {}),
    createdAt: input.createdAt ?? iso,
  };
}

// ---------------------------------------------------------------------------
// 定義から入力値へ（編集画面）
// ---------------------------------------------------------------------------

type CfgField = { key: string; label?: string; required?: boolean; options?: { value: unknown; label: string }[] };
type CfgItem = { key: string; label?: string };
type CfgTemplate = { title: string; offsetDays?: number };

/**
 * 分岐の合流先を読み戻す。
 * 各ルートの最後から合流先へ1本ずつ繋がっているので、
 * 分岐より後ろのSTEPから条件なしで複数本入ってくるSTEPが合流先。
 */
function readJoin(def: WorkflowDefinition, branchKey: string, order: string[]): string {
  const at = order.indexOf(branchKey);
  if (at < 0) return "";
  const after = new Set(order.slice(at + 1));
  const incoming = new Map<string, Set<string>>();
  for (const e of def.edges) {
    if (e.condition || !after.has(e.from) || !after.has(e.to)) continue;
    if (!incoming.has(e.to)) incoming.set(e.to, new Set());
    incoming.get(e.to)!.add(e.from);
  }
  for (const key of order.slice(at + 1)) {
    if ((incoming.get(key)?.size ?? 0) >= 2) return key;
  }
  return "";
}

function readFlow(def: WorkflowDefinition, stepKey: string, order: string[]): FlowDraft {
  const out = def.edges.filter((e) => e.from === stepKey).sort((a, b) => a.priority - b.priority);
  if (out.length === 0) return { kind: "end" };
  // 出口が1本なら一本道として扱う（並び順が進む順になっている）
  if (out.length === 1) return { kind: "next" };

  const conditional = out.filter((e) => e.condition);
  if (conditional.length > 0) {
    let fieldKey = "";
    const paths: { value: string; label: string; toStepKey: string }[] = [];
    for (const e of conditional) {
      const c = e.condition;
      if (!c || c.op !== "eq" || c.left.kind !== "var" || c.right?.kind !== "literal") continue;
      fieldKey = c.left.path.replace(/^context\./, "");
      paths.push({ value: String(c.right.value), label: e.label ?? "", toStepKey: e.to });
    }
    // 「それ以外」は not(...) 条件を持つ。条件なしエッジとしては残っていない
    const rest = out.find((e) => e.condition?.op === "not") ?? out.find((e) => !e.condition);
    const join = readJoin(def, stepKey, order);
    return {
      kind: "branch", fieldKey, paths,
      // 合流先と同じなら、指定なし（＝合流先へ）として扱う
      elseToStepKey: rest && rest.to !== join ? rest.to : "",
      joinStepKey: join,
    };
  }

  // 条件なしエッジが複数 = 並列
  const toStepKeys = out.map((e) => e.to);
  const join = def.edges.find((e) => e.joinPolicy === "all" && toStepKeys.includes(e.from));
  return { kind: "parallel", toStepKeys, joinStepKey: join?.to ?? "" };
}

/** この部品は登録画面で設定まで作れるか */
function isRegisterable(type: WorkComponentType): boolean {
  return REGISTERABLE_COMPONENTS.some((c) => c.type === type);
}

/**
 * 既存の定義を編集画面の入力値に戻す。
 *
 * 登録画面のモデル（一本道＋分岐＋並列）で表現しきれない定義は
 * flowLocked にして、STEPの並びと流れを元のまま引き継ぐ。
 * 「編集して保存したら分岐が消えていた」を起こさないための扱い。
 */
export function draftFromWorkflow(def: WorkflowDefinition): WorkflowDraft {
  const visible = def.steps.filter(
    (s) => s.componentType !== "complete" && s.componentType !== "branch",
  );
  const flowLocked = def.steps.some((s) => s.componentType === "branch");

  const steps: StepDraft[] = visible.map((s) => {
    const cfg = s.config as { fields?: CfgField[]; items?: CfgItem[]; templates?: CfgTemplate[] };
    return {
      key: s.key,
      title: s.title,
      guidance: s.guidance ?? "",
      preconditions: s.preconditions ?? "",
      componentType: s.componentType,
      required: s.required,
      estimatedMinutes: s.estimatedMinutes === undefined ? "" : String(s.estimatedMinutes),
      fields: (cfg.fields ?? []).map((f) => ({
        key: f.key,
        label: f.label ?? f.key,
        required: f.required !== false,
        options: (f.options ?? []).map((o) => ({ value: String(o.value), label: o.label })),
      })),
      items: (cfg.items ?? []).map((i) => ({ key: i.key, label: i.label ?? i.key })),
      templates: (cfg.templates ?? []).map((t) => ({
        title: t.title,
        offsetDays: t.offsetDays === undefined ? "" : String(t.offsetDays),
      })),
      knowledgeRefs: s.knowledgeRefs ?? [],
      deadlineDays:
        s.deadlineRule?.offsetDays === undefined ? "" : String(s.deadlineRule.offsetDays),
      locked: !isRegisterable(s.componentType),
      rawConfig: s.config,
    };
  });

  const order = visible.map((s) => s.key);
  const flow: Record<string, FlowDraft> = {};
  for (const s of visible) flow[s.key] = flowLocked ? { kind: "next" } : readFlow(def, s.key, order);

  const t = def.startTrigger;
  return {
    key: def.key,
    name: def.name,
    description: def.description,
    category: def.category,
    workKind: def.workKind ?? "other",
    estimatedMinutes: def.estimatedMinutes === undefined ? "" : String(def.estimatedMinutes),
    defaultPriority: def.defaultPriority ?? "normal",
    deadlineDays:
      def.deadlineRule?.offsetDays === undefined ? "" : String(def.deadlineRule.offsetDays),
    deadlineBusinessDaysOnly: def.deadlineRule?.businessDaysOnly !== false,
    /*
      昔の「曜日で開始」「時間で開始」は繰り返しの予定なので、
      編集画面ではスケジュール側へ移して扱う。定義側の startTrigger は
      触らないので、編集して保存するまで既存の判定はそのまま動く。
    */
    startSchedules: [
      ...(def.startSchedules ?? []).map(scheduleToDraft),
      ...legacyRepeatAsSchedule(t),
    ],
    startTrigger: {
      // 予定へ移した種別は、開始条件としては「自分で開始する」に戻す
      kind: t && (t.kind === "weekday" || t.kind === "time") ? "manual" : t?.kind ?? "manual",
      date: t?.date ?? "",
      weekdays: t?.weekdays ?? [],
      time: t?.time ?? "",
      eventLabel: t?.eventLabel ?? "",
      afterWorkflowKey: t?.afterWorkflowKey ?? "",
      taskLabel: t?.taskLabel ?? "",
      note: t?.note ?? "",
    },
    quota: {
      enabled: Boolean(def.quota),
      metric: def.quota?.metric ?? "count",
      period: def.quota?.period ?? "month",
      target: def.quota ? String(def.quota.target) : "",
      direction: def.quota?.direction ?? "atLeast",
    },
    steps,
    flow,
    notes: def.notes ?? {},
    flowLocked,
    preservedSteps: flowLocked
      ? def.steps.filter((s) => s.componentType === "complete" || s.componentType === "branch")
      : [],
    preservedEdges: flowLocked ? def.edges : [],
  };
}
