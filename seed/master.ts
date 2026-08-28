/** マスタデータ・ナレッジ・テンプレートのシード */
import type {
  Company, Customer, EmailTemplate, KnowledgeItem, User,
} from "../src/core/model/types";

export const users: User[] = [
  { id: "user-me", name: "山本 悠真", roles: ["executor", "designer"], team: "sales" },
  { id: "user-manager", name: "佐藤 部長", roles: ["designer", "admin"], team: "sales" },
  { id: "user-marketing", name: "田中 花子", roles: ["executor"], team: "marketing" },
];

export const customers: Customer[] = [
  { id: "cus-001", name: "株式会社アオイ製作所", contactName: "青井 誠", industry: "製造", employeeCount: 420, isExisting: false, note: "Webフォームから問い合わせ。AI導入検討中。" },
  { id: "cus-002", name: "みどりリテール株式会社", contactName: "緑川 里美", industry: "小売", employeeCount: 1200, isExisting: true, lastContactAt: "2026-07-14T10:00:00+09:00", note: "既存顧客。昨年度に研修を実施。" },
  { id: "cus-003", name: "ソラノ運輸株式会社", contactName: "空野 隆", industry: "運輸", employeeCount: 85, isExisting: false, note: "展示会で名刺交換。" },
  { id: "cus-004", name: "ハシモト会計事務所", contactName: "橋本 恵", industry: "士業", employeeCount: 32, isExisting: true, lastContactAt: "2026-08-02T10:00:00+09:00" },
];

export const companies: Company[] = [
  { id: "co-001", name: "株式会社テクノフロンティア", industry: "製造", employeeCount: 520, region: "東京都", revenue: "80億円", aiAdoption: "considering" },
  { id: "co-002", name: "北都フーズ株式会社", industry: "食品", employeeCount: 240, region: "北海道", revenue: "35億円", aiAdoption: "none" },
  { id: "co-003", name: "西日本メディカル株式会社", industry: "医療", employeeCount: 1100, region: "大阪府", revenue: "210億円", aiAdoption: "partial" },
  { id: "co-004", name: "カワセ物流株式会社", industry: "運輸", employeeCount: 380, region: "愛知県", revenue: "62億円", aiAdoption: "considering" },
  { id: "co-005", name: "株式会社みなとITサービス", industry: "IT", employeeCount: 95, region: "神奈川県", revenue: "12億円", aiAdoption: "advanced" },
  { id: "co-006", name: "サクラ不動産株式会社", industry: "不動産", employeeCount: 160, region: "東京都", revenue: "28億円", aiAdoption: "none" },
  { id: "co-007", name: "東海精密工業株式会社", industry: "製造", employeeCount: 760, region: "静岡県", revenue: "140億円", aiAdoption: "considering" },
  { id: "co-008", name: "株式会社グリーンアグリ", industry: "農業", employeeCount: 55, region: "熊本県", revenue: "8億円", aiAdoption: "none" },
];

export const knowledge: KnowledgeItem[] = [
  { id: "kb-inquiry-sla", title: "問い合わせ対応のSLA", kind: "policy", source: "internal",
    body: "新規問い合わせは受信から24時間以内に一次返信を行う。24時間を超える場合は、必ず中間報告のメールを送ること。土日祝を挟む場合は翌営業日を起点とする。",
    tags: ["inquiry", "sla"], linkedStepKeys: ["receive"], linkedWorkflowKeys: ["inquiry-new"], updatedAt: "2026-06-01T10:00:00+09:00" },
  { id: "kb-customer-check", title: "顧客情報確認チェックポイント", kind: "manual", source: "internal",
    body: "1. 既存顧客かどうかをマスタで確認する\n2. 既存の場合は担当者と進行中案件を確認する\n3. 過去にクレーム履歴がないかを確認する\n4. 同一法人の別部署からの問い合わせでないかを確認する",
    tags: ["customer"], linkedStepKeys: ["confirm-customer"], linkedWorkflowKeys: ["inquiry-new"], updatedAt: "2026-05-20T10:00:00+09:00" },
  { id: "kb-existing-customer", title: "既存顧客からの問い合わせ対応", kind: "manual", source: "internal",
    body: "既存顧客からの新規問い合わせは、必ず既存担当者に共有してから対応する。二重アプローチは信頼を損なうため厳禁。過去の提案内容と重複していないかを確認すること。",
    tags: ["customer"], linkedStepKeys: ["check-history"], linkedWorkflowKeys: ["inquiry-new"], updatedAt: "2026-06-10T10:00:00+09:00" },
  { id: "kb-hearing-guide", title: "ヒアリング項目ガイド", kind: "manual", source: "internal",
    body: "課題：現状の業務でどこに時間がかかっているかを具体的に聞く\n対象規模：対象部門の人数と、対象業務の頻度を聞く\n決裁者：予算承認を出す人が誰かを確認する（担当者本人でないことが多い）",
    tags: ["hearing", "inquiry"], linkedStepKeys: ["hearing"], linkedWorkflowKeys: ["inquiry-new"], updatedAt: "2026-07-01T10:00:00+09:00" },
  { id: "kb-service-matrix", title: "サービス選定マトリクス", kind: "material", source: "internal",
    body: "AI導入コンサル：課題が不明確／全社的な検討段階の場合\n受託開発：課題と要件が明確で、内製リソースがない場合\n社内研修：人材育成が主目的の場合、または導入後のフォロー段階",
    tags: ["service"], linkedStepKeys: ["select-service"], linkedWorkflowKeys: ["inquiry-new"], updatedAt: "2026-04-15T10:00:00+09:00" },
  { id: "kb-mail-tone", title: "メール文面のトーン規定", kind: "policy", source: "internal",
    body: "・初回接触は敬体、簡潔に。3スクロール以内に収める\n・専門用語には必ず補足をつける\n・「ぜひ」「必ず」などの押しの強い表現は避ける\n・署名は必ず正式な部署名を含める",
    tags: ["email"], linkedStepKeys: ["compose-email", "thanks-mail", "compose"], linkedWorkflowKeys: ["inquiry-new", "post-cv", "email-standalone"], updatedAt: "2026-03-01T10:00:00+09:00" },
  { id: "kb-material-list", title: "送付資料一覧と使い分け", kind: "material", source: "gdrive",
    body: "サービス概要資料：全般的な問い合わせに\n導入事例集（製造業版）：製造業の顧客に\n料金表：料金の問い合わせがあった場合のみ\n※資料は毎月更新。必ず最新版を確認すること。",
    tags: ["material"], linkedStepKeys: ["send-material"], linkedWorkflowKeys: ["post-cv"], updatedAt: "2026-08-01T10:00:00+09:00" },
  { id: "kb-article-policy", title: "記事制作ガイドライン", kind: "policy", source: "notion",
    body: "・1記事あたり3000〜5000文字を目安とする\n・見出しは h2 / h3 のみを使用する\n・引用元は必ず明記し、一次情報にあたる\n・競合他社の実名比較は行わない",
    tags: ["article"], linkedStepKeys: ["plan", "draft", "review"], linkedWorkflowKeys: ["article-writing"], updatedAt: "2026-07-20T10:00:00+09:00" },
  { id: "kb-interview-guide", title: "取材の進め方", kind: "manual", source: "internal",
    body: "1. 質問票は取材の3営業日前までに送付する\n2. 録音の許可を必ず取る\n3. 公開前に必ず先方の確認を取る（校正戻し期間は5営業日）",
    tags: ["article"], linkedStepKeys: ["interview"], linkedWorkflowKeys: ["article-writing"], updatedAt: "2026-06-25T10:00:00+09:00" },
  { id: "kb-legal-expression", title: "薬機法・景表法チェックリスト", kind: "policy", source: "internal",
    body: "以下の表現は使用不可：\n・「治る」「効く」などの効能を断定する表現\n・「No.1」「最高」などの最上級表現（根拠の明示がない場合）\n・体験談を効果の根拠として提示すること",
    tags: ["article", "legal"], linkedStepKeys: ["review"], linkedWorkflowKeys: ["article-writing"], updatedAt: "2026-07-30T10:00:00+09:00" },
  { id: "kb-target-criteria", title: "ターゲット企業の選定基準", kind: "policy", source: "internal",
    body: "優先度A：従業員100〜1000名、AI導入を検討中、意思決定者にアクセス可能\n優先度B：従業員1000名以上、部分導入済み\n除外：競合他社の関連会社、過去に取引を断られた企業",
    tags: ["company-search", "research"], linkedStepKeys: ["search", "select"], linkedWorkflowKeys: ["company-research"], updatedAt: "2026-05-10T10:00:00+09:00" },
];

export const emailTemplates: EmailTemplate[] = [
  { id: "tpl-inquiry-reply", name: "新規問い合わせ返信", tone: "丁寧",
    subject: "【ご返信】お問い合わせいただきありがとうございます",
    body: "{{customer.contactName}} 様\n\nお世話になっております。\nこのたびは弊社へお問い合わせいただき、誠にありがとうございます。\n\nいただいたご相談内容について、{{service}} のご提案が可能かと存じます。\n\n詳細をご説明させていただく機会を頂戴できますと幸いです。\n\n何卒よろしくお願いいたします。",
    variables: ["customer.contactName", "service"], workflowKeys: ["inquiry-new"] },
  { id: "tpl-cv-thanks", name: "CV後お礼", tone: "丁寧",
    subject: "資料をご請求いただきありがとうございます",
    body: "{{customer.contactName}} 様\n\nお世話になっております。\nこのたびは資料をご請求いただき、誠にありがとうございます。\n\nご不明な点がございましたら、お気軽にご連絡ください。\n\n何卒よろしくお願いいたします。",
    variables: ["customer.contactName"], workflowKeys: ["post-cv"] },
  { id: "tpl-approach", name: "アプローチ（新規開拓）", tone: "簡潔",
    subject: "{{company.name}} 様へのご提案のご相談",
    body: "ご担当者様\n\n突然のご連絡失礼いたします。\n\n{{company.industry}} 業界の企業様に向けて、業務効率化のご支援をしております。\n\n15分ほどお時間を頂戴できませんでしょうか。\n\n何卒よろしくお願いいたします。",
    variables: ["company.name", "company.industry"], workflowKeys: ["company-research", "email-standalone"] },
  { id: "tpl-article", name: "記事構成テンプレート", tone: "解説",
    subject: "{{theme}}",
    body: "# {{theme}}\n\n## はじめに\n\n## 現状の課題\n\n## 解決のアプローチ\n\n## 事例\n\n## まとめ",
    variables: ["theme"], workflowKeys: ["article-writing"] },
];
