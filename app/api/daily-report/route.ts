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

/**
 * 連携先を待つ上限。
 * Apps Script はカレンダーを見に行くぶん遅いことがあるが、
 * 待ち続けると画面が「読み込んでいます…」のまま動かなくなる。
 */
const TIMEOUT_MS = 20_000;

/** GAS に通す操作。ここに無いものは受け付けない */
const ACTIONS = ["drafts", "rebuild", "save", "send", "events", "mail"] as const;
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

  if (source.action !== "drafts" && source.action !== "events") {
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

/** 日報 1 本ぶんとして画面が期待する形か */
function isReport(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const report = value as Record<string, unknown>;
  return (
    typeof report.exists === "boolean" &&
    typeof report.sent === "boolean" &&
    typeof report.body === "string" &&
    typeof report.generatedAt === "string" &&
    typeof report.sentAt === "string"
  );
}

/**
 * 連携先が返した理由に、直し方を足す。
 *
 * GAS は「何が起きたか」しか知らない。どこを直せばよいかは、
 * こちら側と向こう側の食い違いを知っているここでしか言えない。
 *
 * 例：画面が新しくなって使う操作が増えたのに、Apps Script 側は貼り替え前のまま。
 * このとき GAS は「知らない操作です: events」としか言えないが、
 * 直すのはコードの貼り替えとデプロイであって、カレンダーでも権限でもない。
 */
function withFixHint(error: string): string {
  if (error.includes("知らない操作です")) {
    return (
      `${error}／Apps Script のコードが貼り替え前のままの可能性があります。` +
      "最新のコードを貼り、［デプロイを管理］→ 編集 → バージョン「新バージョン」で更新してください" +
      "（保存しただけでは配られる版は変わりません）。"
    );
  }
  if (error.includes("合言葉")) {
    return `${error}／Apps Script のスクリプト プロパティ API_SHARED_SECRET と、環境変数 DAILY_REPORT_SECRET を同じ値にしてください。`;
  }
  return error;
}

/**
 * 連携先の応答が、画面の期待どおりの形か確かめる。
 *
 * JSON として読めることと、日報として使えることは別。形の違う JSON をそのまま
 * 画面へ渡すと、描くところで落ちて「保存内容を消す」案内まで出てしまう。
 * 消しても直らないうえ、自分で作ったタスクまで失う。ここで止める。
 *
 * @return 通してよい応答、または通せない理由
 */
function readGasResponse(value: unknown): Record<string, unknown> | string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "連携先から日報以外の応答が返りました。ウェブアプリのデプロイを確認してください。";
  }
  const source = value as Record<string, unknown>;

  // 連携先が理由付きで断った場合は、その理由をそのまま見せる
  if (source.ok === false) {
    if (typeof source.error === "string" && source.error.trim() !== "") {
      return { ...source, error: withFixHint(source.error) };
    }
    return "連携先が処理できませんでした（理由は返っていません）。";
  }

  if (source.ok !== true) {
    return "連携先から日報以外の応答が返りました。ウェブアプリのデプロイを確認してください。";
  }

  /*
    今日の予定と Gmail の見張りは、日報とは別の形で返る。
    日報の項目を探しに行くと、正しい応答を「形が違う」として弾いてしまう。
  */
  if (Array.isArray(source.events)) return source;
  if (Array.isArray(source.inbox) && Array.isArray(source.awaiting)) return source;

  const reports = source.reports;
  if (typeof reports !== "object" || reports === null) {
    return "連携先の応答に日報が入っていませんでした。ウェブアプリのデプロイが古い可能性があります。";
  }
  const byType = reports as Record<string, unknown>;
  if (!isReport(byType.day) || !isReport(byType.night)) {
    return "連携先の応答の形が違います。ウェブアプリのデプロイが古い可能性があります。";
  }
  return source;
}

/**
 * 設定されている URL の形を見て、分かる範囲の間違いを名指しする。
 *
 * 404 が返ったとき、「URL の書き方が違う」のか「デプロイが無くなった」のかで
 * 直す場所がまったく違う。前者はここで分かるので、推測させない。
 *
 * @return 見つかった問題、または問題なしの null
 */
function findUrlProblem(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "設定されている値が URL の形をしていません。";
  }
  if (parsed.hostname !== "script.google.com") {
    return `設定されている URL の行き先が script.google.com ではありません（${parsed.hostname}）。`;
  }
  if (parsed.pathname.endsWith("/dev")) {
    return (
      "設定されている URL の末尾が /dev です。これは編集中の版を自分だけが開くための URL で、" +
      "外からは使えません。［デプロイを管理］に出ている /exec の URL に置き換えてください。"
    );
  }
  if (!parsed.pathname.endsWith("/exec")) {
    return "設定されている URL の末尾が /exec ではありません。";
  }
  return null;
}

/**
 * URL を、目で見比べられるだけ残して隠す。
 * 全部出すと画面や記録に残ってしまう。前後だけあれば、
 * Apps Script 側に出ている URL と同じものかどうかは見分けられる。
 */
function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    /* 長い区切りは、形が想定どおりでなくても必ず縮める（そこが ID のことが多い） */
    const shorten = (part: string) =>
      part.length > 14 ? `${part.slice(0, 7)}……${part.slice(-5)}` : part;
    const path = parsed.pathname.split("/").map(shorten).join("/");
    return `${parsed.origin}${path}`;
  } catch {
    return "（URL として読めない値）";
  }
}

/** 連携先から JSON が返らなかったときに、直す場所まで書いたメッセージにする */
function describeBadResponse(status: number, url: string): string {
  if (status === 404) {
    const problem = findUrlProblem(url);
    if (problem !== null) {
      return `連携先が見つかりません（status 404）。${problem}`;
    }
    /*
      形は合っているのに 404。つまり「その URL のデプロイが、いま存在しない」。
      ［新しいデプロイ］を作ると URL ごと変わるので、貼り替えのときに
      ここへ迷い込みやすい。更新は［デプロイを管理］→ 編集 → 新バージョン。
    */
    return (
      `連携先が見つかりません（status 404）。URL の形は合っているので、` +
      `その URL のデプロイが今は存在していない可能性が高いです。` +
      `［デプロイを管理］を開き、そこに出ているウェブアプリの URL と、いま設定されている ` +
      `${maskUrl(url)} が同じかどうかを見比べてください。` +
      `［新しいデプロイ］を作ると URL ごと変わります（更新は［デプロイを管理］→ 編集 → バージョン「新バージョン」）。`
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const text = await response.text();
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      // JSON が返らないときは、設定のどこがおかしいかまで書く。
      // 番号だけ出しても、どこを直せばよいか分からない
      return NextResponse.json(
        { ok: false, error: describeBadResponse(response.status, url) },
        { status: 200 },
      );
    }

    const checked = readGasResponse(parsedJson);
    if (typeof checked === "string") {
      return NextResponse.json({ ok: false, error: checked }, { status: 200 });
    }
    return NextResponse.json(checked, { status: 200 });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return NextResponse.json(
      {
        ok: false,
        error: timedOut
          ? `連携先から ${TIMEOUT_MS / 1000} 秒以内に応答がありませんでした。時間をおいて「最新の状態にする」を押してください。`
          : `連携先へ接続できませんでした: ${String(error)}`,
      },
      { status: 200 },
    );
  }
}
