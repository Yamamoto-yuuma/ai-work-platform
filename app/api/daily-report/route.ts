/**
 * 日報の中継口。
 *
 * ブラウザから GAS を直接叩かせない。合言葉をブラウザに出さずに済むし、
 * GAS のウェブアプリの場所も画面側に持たせずに済む。
 *
 * ここは通し口であって、判断はしない。日報を作るのも送るのも GAS の役目で、
 * Chatwork のトークンは GAS の中から出てこない。
 */
import { NextResponse } from "next/server";

/** 毎回 GAS へ聞きに行く（結果を寝かせない） */
export const dynamic = "force-dynamic";

/** GAS に通す操作。ここに無いものは受け付けない */
const ACTIONS = ["drafts", "rebuild", "save", "send"] as const;
type Action = (typeof ACTIONS)[number];

const REPORT_TYPES = ["day", "night"] as const;
type ReportType = (typeof REPORT_TYPES)[number];

interface ClientRequest {
  action: Action;
  reportType?: ReportType;
  body?: string;
}

function isAction(value: unknown): value is Action {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

function isReportType(value: unknown): value is ReportType {
  return typeof value === "string" && (REPORT_TYPES as readonly string[]).includes(value);
}

/** 画面から届いた中身を確かめる。おかしければ GAS へ渡さない */
function readRequest(payload: unknown): ClientRequest | string {
  if (typeof payload !== "object" || payload === null) return "リクエストの形式が正しくありません。";
  const source = payload as Record<string, unknown>;

  if (!isAction(source.action)) return "知らない操作です。";
  const request: ClientRequest = { action: source.action };

  if (source.action !== "drafts") {
    if (!isReportType(source.reportType)) return "昼か夜かを指定してください。";
    request.reportType = source.reportType;
  }
  if (source.action === "save") {
    if (typeof source.body !== "string" || source.body.trim().length === 0) {
      return "日報の本文が空です。";
    }
    request.body = source.body;
  }
  return request;
}

/** 連携先から JSON が返らなかったときに、直す場所まで書いたメッセージにする */
function describeBadResponse(status: number): string {
  if (status === 404) {
    return (
      "連携先の URL が見つかりません（status 404）。DAILY_REPORT_GAS_URL を確認してください。" +
      "Apps Script の［デプロイを管理］にあるウェブアプリの URL（末尾が /exec）である必要があります。"
    );
  }
  if (status === 401 || status === 403) {
    return (
      `連携先にアクセスできません（status ${status}）。` +
      "ウェブアプリのアクセス設定を「全員」にして、デプロイし直してください。"
    );
  }
  if (status === 200) {
    return (
      "連携先から日報以外の応答が返りました。ウェブアプリのデプロイが古い可能性があります。" +
      "Apps Script でコードを保存し、［デプロイを管理］→ 編集 → バージョン「新バージョン」で更新してください。"
    );
  }
  return `連携先から想定外の応答が返りました（status ${status}）。`;
}

export async function POST(request: Request) {
  const url = process.env.DAILY_REPORT_GAS_URL;
  const secret = process.env.DAILY_REPORT_SECRET;

  if (!url || !secret) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "日報の連携先が設定されていません。DAILY_REPORT_GAS_URL と DAILY_REPORT_SECRET を設定してください。",
        notConfigured: true,
      },
      { status: 200 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "リクエストを読み取れませんでした。" }, { status: 400 });
  }

  const parsed = readRequest(payload);
  if (typeof parsed === "string") {
    return NextResponse.json({ ok: false, error: parsed }, { status: 400 });
  }

  try {
    // GAS のウェブアプリは application/json を受けると扱いが変わるため、text/plain で渡す
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ ...parsed, secret }),
      redirect: "follow",
      cache: "no-store",
    });

    const text = await response.text();
    try {
      return NextResponse.json(JSON.parse(text) as unknown, { status: 200 });
    } catch {
      // JSON が返らないときは、設定のどこがおかしいかまで書く。
      // 番号だけ出しても、どこを直せばよいか分からない
      return NextResponse.json({ ok: false, error: describeBadResponse(response.status) }, { status: 200 });
    }
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: `連携先へ接続できませんでした: ${String(error)}` },
      { status: 200 },
    );
  }
}
