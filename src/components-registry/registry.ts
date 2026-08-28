/**
 * 業務部品レジストリ。
 * STEP の中身は「部品」として登録され、フローエンジンは部品の中身を知らない。
 * 新しい部品の追加は、このレジストリに1エントリ足すだけで済む（仕様 §7-5）。
 */
import type { WorkComponentType } from "../core/model/types";

export interface WorkComponentSpec {
  type: WorkComponentType;
  label: string;
  icon: string;
  /** この部品が必要とする外部連携。未接続なら UI で明示する */
  requiredPorts: ("llm" | "mailer" | "calendar" | "companySearch" | "knowledgeSource")[];
  /** 文脈提示のヒント。コンテキストパネルの絞り込みに使う */
  contextHints: { ruleTags: string[] };
  /** 設定スキーマのバージョン。将来の破壊的変更に備える */
  schemaVersion: number;
  description: string;
}

const specs: Record<WorkComponentType, WorkComponentSpec> = {
  "input": {
    type: "input", label: "入力", icon: "✎", requiredPorts: [],
    contextHints: { ruleTags: ["input"] }, schemaVersion: 1,
    description: "自由入力・数値・日付などの項目入力",
  },
  "select": {
    type: "select", label: "選択", icon: "◇", requiredPorts: [],
    contextHints: { ruleTags: ["select"] }, schemaVersion: 1,
    description: "選択肢からの単一／複数選択",
  },
  "checklist": {
    type: "checklist", label: "チェック", icon: "☑", requiredPorts: [],
    contextHints: { ruleTags: ["checklist", "hearing"] }, schemaVersion: 1,
    description: "チェックリストの消化",
  },
  "customer-view": {
    type: "customer-view", label: "顧客情報表示", icon: "◉", requiredPorts: [],
    contextHints: { ruleTags: ["customer"] }, schemaVersion: 1,
    description: "顧客・案件情報の参照",
  },
  "company-search": {
    type: "company-search", label: "企業検索", icon: "⌕", requiredPorts: ["companySearch"],
    contextHints: { ruleTags: ["company-search"] }, schemaVersion: 1,
    description: "条件による企業候補の検索",
  },
  "company-select": {
    type: "company-select", label: "企業選定", icon: "✓", requiredPorts: ["companySearch"],
    contextHints: { ruleTags: ["company-search"] }, schemaVersion: 1,
    description: "候補からの選定と理由記録",
  },
  "email-compose": {
    type: "email-compose", label: "メール作成", icon: "✉", requiredPorts: ["mailer"],
    contextHints: { ruleTags: ["email"] }, schemaVersion: 1,
    description: "テンプレート差し込みとメール作成",
  },
  "document-compose": {
    type: "document-compose", label: "文章作成", icon: "▤", requiredPorts: [],
    contextHints: { ruleTags: ["document"] }, schemaVersion: 1,
    description: "定型文書の作成",
  },
  "task-create": {
    type: "task-create", label: "タスク作成", icon: "＋", requiredPorts: [],
    contextHints: { ruleTags: ["task"] }, schemaVersion: 1,
    description: "フォロータスクの生成",
  },
  "calendar-create": {
    type: "calendar-create", label: "Calendar登録", icon: "▦", requiredPorts: ["calendar"],
    contextHints: { ruleTags: ["calendar"] }, schemaVersion: 1,
    description: "予定の登録",
  },
  "knowledge-view": {
    type: "knowledge-view", label: "ナレッジ表示", icon: "📄", requiredPorts: ["knowledgeSource"],
    contextHints: { ruleTags: ["knowledge"] }, schemaVersion: 1,
    description: "参照資料の提示",
  },
  "ai-assist": {
    type: "ai-assist", label: "AI処理", icon: "✦", requiredPorts: ["llm"],
    contextHints: { ruleTags: ["ai"] }, schemaVersion: 1,
    description: "AIによる補助処理",
  },
  "approval": {
    type: "approval", label: "承認", icon: "⎘", requiredPorts: [],
    contextHints: { ruleTags: ["approval"] }, schemaVersion: 1,
    description: "上長等による承認",
  },
  "branch": {
    type: "branch", label: "条件分岐", icon: "⑂", requiredPorts: [],
    contextHints: { ruleTags: [] }, schemaVersion: 1,
    description: "条件による経路分岐",
  },
  "complete": {
    type: "complete", label: "完了", icon: "●", requiredPorts: [],
    contextHints: { ruleTags: [] }, schemaVersion: 1,
    description: "業務の終了",
  },
};

export function getComponentSpec(type: WorkComponentType): WorkComponentSpec {
  return specs[type];
}

export function allComponentSpecs(): WorkComponentSpec[] {
  return Object.values(specs);
}
