/**
 * gas/daily-report/*.gs を 1 本にまとめる。
 *
 * Apps Script のプロジェクトはファイルを分けて貼るのが面倒なので、実運用では
 * まとめたものを 1 枚貼っている。だが手で作ると、こちらを直したあとに貼り替え忘れ、
 * 向こうだけ古いまま動き続ける。実際にそれで、直したはずの不具合が再発した。
 *
 *   npm run bundle:gas            → gas/daily-report/bundle/日報自動生成.gs へ書き出す
 *   npm run bundle:gas -- --check → 書き出さず、中身が最新かどうかだけを確かめる
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const SRC_DIR = join("gas", "daily-report");
const OUT_DIR = join(SRC_DIR, "bundle");
const OUT_FILE = join(OUT_DIR, "日報自動生成.gs");

/**
 * 並べる順。設定と日付の部品を先に置き、入口（main / menu / api）とテストを後ろにする。
 * Apps Script は全ファイルを 1 つの空間に読み込むため、動作自体は順序に依らない。
 * 読む人が上から追えるようにするための順番。
 */
const ORDER = [
  "config", "date", "businessDay", "calendar", "nightBody", "report", "chatwork",
  "lock", "sheet", "draft", "main", "menu", "api", "test",
];

const HEADER = `/**
 * 日報自動生成システム（Google Apps Script）
 *
 * カレンダーの予定から日報を作り、「日報」シートに下書きとして書き出す。
 * Chatwork の本番ルームへ送るのは、ボタンを押したときだけで、トリガーからは送信しない。
 *
 * ■ このファイルは自動生成です
 *   gas/daily-report/*.gs を 1 本にまとめたものです。直すときは元のファイルを直し、
 *   npm run bundle:gas で作り直してください。ここを直しても次の生成で消えます。
 *
 * ■ このコードはスプレッドシートに紐づけて使います
 *   日報用のスプレッドシートを開き、［拡張機能］→［Apps Script］から貼り付けてください。
 *   （単独の Apps Script プロジェクトでは、シートへの書き出しとボタンが使えません）
 *
 * ■ 使う前に
 *   1. ［プロジェクトの設定］でタイムゾーンを Asia/Tokyo にする
 *   2. ［スクリプト プロパティ］に CHATWORK_API_TOKEN と CHATWORK_ROOM_ID を設定する
 *   3. runAllTests を実行して全件成功することを確認する
 *   4. setupTriggers を実行してトリガー（12:55 / 18:25）を作る
 *
 * ■ 毎日の流れ
 *   12:55 / 18:25 にトリガーが動き、「日報」シートに下書きが 1 行増える
 *     ↓ 本文のセルで所感を書き足す（そのままでもよい）
 *   ボタン（またはメニュー［日報］）を押す → 確認ダイアログ → Chatwork へ送信
 *
 * ■ 日報に入るもの
 *   そのまま Chatwork へ貼れる本文だけです。
 *   どちらの型かを示す見出し（昼用・夜用の別）は入りません。
 *
 * ■ AI Work（業務プラットフォーム）から使う場合
 *   ［スクリプト プロパティ］に API_SHARED_SECRET（推測されにくい文字列）を足し、
 *   ［デプロイ］→［新しいデプロイ］→ ウェブアプリ（実行:自分 / アクセス:全員）で公開します。
 *   その URL と合言葉を、プラットフォーム側の環境変数
 *   DAILY_REPORT_GAS_URL / DAILY_REPORT_SECRET に設定してください。
 *   合言葉が合わないリクエストは通しません。
 *
 *   コードを貼り替えたあとは、［デプロイを管理］→ 編集 → バージョン「新バージョン」で
 *   更新してください。ウェブアプリはデプロイ済みの版を配るので、保存しただけでは
 *   プラットフォーム側は古いコードのまま動きます。
 *
 * ■ 実行ボタン・シートのボタンに割り当てられる関数
 *   sendDayReportButton / sendNightReportButton  送信（確認ダイアログあり）
 *   rebuildDayDraft     / rebuildNightDraft      下書きを作り直す
 *   runAllTests                                  テスト
 *   setupTriggers                                トリガーを作る
 *   showDayDraft / showNightDraft                下書きをログで確認
 *   sendDayDraft / sendNightDraft                送信（ダイアログなし・エディタ用）
 *   runDayReport / runNightReport                下書きを作る（トリガーが実行するもの）
 *   testDayReport / testNightReport              本文だけ確認
 *   testTodayEvents                              今日の予定を確認（HOME の Schedule 欄用）
 *
 *   これ以外の関数は名前の末尾が _ になっており、実行メニューには出ません。
 *   （doGet / doPost はウェブアプリの入口です。手で実行するものではありません）
 */
`;

function buildBundle() {
  const parts = [HEADER];
  for (const name of ORDER) {
    const path = join(SRC_DIR, `${name}.gs`);
    if (!existsSync(path)) {
      throw new Error(`まとめる対象が見つかりません: ${path}`);
    }
    parts.push(
      `\n/* ==================================================================\n` +
        ` * ${name}.gs\n` +
        ` * ================================================================== */\n`,
    );
    parts.push(`${readFileSync(path, "utf8").replace(/\s+$/, "")}\n`);
  }
  return parts.join("");
}

/**
 * 同じ名前が 2 回定義されていないか。
 * まとめた結果あとの定義が前の定義を上書きすると、動きが静かに変わる。
 */
function findDuplicateNames(text) {
  const seen = new Map();
  const pattern = /^(?:function\s+([A-Za-z0-9_]+)|var\s+([A-Za-z0-9_]+)\s*=)/gm;
  for (const match of text.matchAll(pattern)) {
    const name = match[1] ?? match[2];
    seen.set(name, (seen.get(name) ?? 0) + 1);
  }
  return [...seen].filter(([, count]) => count > 1).map(([name]) => name);
}

const bundle = buildBundle();

const duplicates = findDuplicateNames(bundle);
if (duplicates.length > 0) {
  console.error(`同じ名前が 2 回定義されています: ${duplicates.join(", ")}`);
  process.exit(1);
}

if (process.argv.includes("--check")) {
  const current = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, "utf8") : null;
  if (current !== bundle) {
    console.error(
      `${OUT_FILE} が元のファイルより古くなっています。npm run bundle:gas で作り直してください。`,
    );
    process.exit(1);
  }
  console.log(`✓ ${OUT_FILE} は最新です。`);
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, bundle);
console.log(`✓ ${OUT_FILE} を書き出しました（${bundle.split("\n").length} 行）。`);
