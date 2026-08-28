/**
 * ハードコード禁止チェック（仕様 §7-9 / 設計書 §10-1）。
 * 業務名・STEP名・ルール名が seed/ の外（app/ src/）に文字列で存在しないことを検証する。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = [
  "新規問い合わせ対応", "CV後フォロー", "企業リサーチ",
  "ヒアリング", "顧客情報確認", "フォローアップタスク作成",
  "9月限定", "予算を確認", "導入時期を確認", "AI導入経験を確認",
  "配信設定の期間変更", "LP掲載期間の変更", "関係者への変更通知",
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const files = [...walk("app"), ...walk("src")];
const hits = [];
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const term of FORBIDDEN) {
    if (text.includes(term)) hits.push(`${f}: 「${term}」`);
  }
}

if (hits.length > 0) {
  console.error("✗ 業務固有の文字列がコード内に見つかりました。seed/ かデータ側へ移してください:\n");
  for (const h of hits) console.error("  " + h);
  process.exit(1);
}
console.log(`✓ ハードコード検査を通過しました（${files.length} ファイル / ${FORBIDDEN.length} 語を検査）`);
