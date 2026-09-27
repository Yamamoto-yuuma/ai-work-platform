/**
 * Google ToDo リストとの通信（読み取りのみ）。
 *
 * 取り込むかどうかの判断は core/integration/google-tasks.ts にある。
 * ここが持つのは「取ってくる」ところだけ。
 *
 * サーバーを持たない作りなので、Google の JavaScript 向けの仕組み
 * （Google Identity Services）で、ブラウザから直接アクセストークンを
 * もらう。クライアントシークレットは使わないし、置き場所も要らない。
 *
 * トークンはメモリにしか置かない。localStorage に残すと、他人が
 * その端末を触ったときにそのまま使えてしまう。1時間で切れるものなので、
 * 画面を読み込み直したら取り直す（同意済みなら黙って通る）。
 *
 * 「黙って通る」には、どのアカウントで通すかが決まっている必要がある。
 * Google に複数のアカウントでログインしていると、どれで通せばよいか
 * 分からないので、毎回アカウント選択が出る。開くたび・1時間ごとに
 * 選ばされるのは、連携そのものを使わなくなるだけの手間になる。
 *
 * そこで、一度繋いだアカウントのメールアドレスだけを覚えておき、
 * 次からは hint として渡す。これで選択画面を出さずに同じアカウントで通る。
 * 覚えるのはアドレスだけで、トークンでも合言葉でもない。
 * 別のアカウントに変えたいときのために、忘れる口も用意する。
 */
import type { GoogleTask } from "@/core/integration/google-tasks";

const GIS_SRC = "https://accounts.google.com/gsi/client";
/*
  読み取りだけ。書き込みの権限は求めない。

  userinfo.email は「どのアカウントで繋いだか」を知るためだけに足している。
  これが無いと、次に繋ぐときアカウントを指定できず、毎回選択画面が出る。
  メールアドレス以外は取らない（プロフィールも連絡先も求めない）。
*/
const SCOPE = [
  "https://www.googleapis.com/auth/tasks.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");
const API = "https://tasks.googleapis.com/tasks/v1";
const USERINFO = "https://www.googleapis.com/oauth2/v3/userinfo";

/** 繋いだアカウント。トークンではないので、ここだけは端末に残す */
const ACCOUNT_KEY = "ai-work-platform:google-account";

/*
  トークンが切れる少し前に取り直す。
  切れてから気づくと、その1回が必ず失敗する（自動取り込みなら黙って落ちる）。
*/
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

export interface GoogleTaskList {
  id: string;
  title: string;
}

/** 設定されていなければ、連携そのものを出さない */
export function googleClientId(): string | undefined {
  const id = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  return id && id.trim().length > 0 ? id.trim() : undefined;
}

/* Google Identity Services の型。必要な分だけ */
interface TokenClient {
  requestAccessToken: (o?: { prompt?: string; hint?: string }) => void;
}
interface TokenResponse {
  access_token?: string;
  /** 秒。これを過ぎると使えない */
  expires_in?: number;
  error?: string;
  error_description?: string;
}
interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient: (c: {
        client_id: string; scope: string; hint?: string;
        callback: (r: TokenResponse) => void;
        error_callback?: (e: { type?: string; message?: string }) => void;
      }) => TokenClient;
    };
  };
}

let token: string | null = null;
/** トークンが切れる時刻（ミリ秒）。0 は「持っていない」 */
let tokenExpiresAt = 0;
let scriptLoading: Promise<void> | null = null;

/** 前に繋いだアカウント。無ければ undefined */
export function rememberedAccount(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const v = window.localStorage.getItem(ACCOUNT_KEY);
    return v && v.trim().length > 0 ? v.trim() : undefined;
  } catch {
    // 保存を止めている環境では、今までどおり毎回選んでもらう
    return undefined;
  }
}

function saveAccount(email: string): void {
  try { window.localStorage.setItem(ACCOUNT_KEY, email); } catch { /* 残せなくても動く */ }
}

/** 覚えているアカウントを忘れる。次に繋ぐときはまた選ぶところから */
export function forgetAccount(): void {
  try { window.localStorage.removeItem(ACCOUNT_KEY); } catch { /* 無ければ何もしない */ }
}

/**
 * どのアカウントで繋いだかを1度だけ聞きに行く。
 * 取れなくても連携そのものは動くので、失敗は握りつぶす
 * （次に繋ぐとき選択画面が出るだけ）。
 */
async function learnAccount(): Promise<void> {
  if (!token || rememberedAccount()) return;
  try {
    const res = await fetch(USERINFO, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const data = (await res.json()) as { email?: string };
    if (data.email) saveAccount(data.email);
  } catch { /* 取れなければ覚えないだけ */ }
}

function loadGis(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("ブラウザでのみ使えます"));
  const g = (window as unknown as { google?: GoogleGlobal }).google;
  if (g?.accounts?.oauth2) return Promise.resolve();
  if (scriptLoading) return scriptLoading;

  scriptLoading = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = GIS_SRC;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("Google の読み込みに失敗しました。通信を確認してください"));
    document.head.appendChild(el);
  });
  return scriptLoading;
}

/**
 * アクセストークンを取る。
 * 一度同意していれば、次からは画面を出さずに通る（prompt を空にしている）。
 */
/**
 * 画面を出さずにトークンを取り直す。
 * 一度許可していて、その端末で Google にログインしていれば黙って通る。
 * 通らなければ何もしない（自動取り込みのために、勝手に画面を出さない）。
 */
export async function connectSilently(): Promise<boolean> {
  try {
    await connect();
    return true;
  } catch {
    return false;
  }
}

/**
 * 繋ぐ。
 *
 * chooseAccount を立てたときだけ選択画面を出す（別のアカウントに変えるとき）。
 * ふだんは覚えているアカウントを hint に渡して、黙って通す。
 */
export async function connect(options: { chooseAccount?: boolean } = {}): Promise<void> {
  const clientId = googleClientId();
  if (!clientId) throw new Error("Google のクライアントIDが設定されていません");
  if (options.chooseAccount) forgetAccount();
  await loadGis();
  const g = (window as unknown as { google?: GoogleGlobal }).google;
  if (!g?.accounts?.oauth2) throw new Error("Google の読み込みに失敗しました");

  const hint = options.chooseAccount ? undefined : rememberedAccount();

  await new Promise<void>((resolve, reject) => {
    const client = g.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      ...(hint ? { hint } : {}),
      callback: (res) => {
        if (res.access_token) {
          token = res.access_token;
          // expires_in が無いときは、Google の既定（1時間）とみなす
          const ttl = (res.expires_in ?? 3600) * 1000;
          tokenExpiresAt = Date.now() + ttl;
          resolve();
          return;
        }
        reject(new Error(res.error_description || res.error || "接続を許可できませんでした"));
      },
      error_callback: (e) => reject(new Error(e.message || "接続を許可できませんでした")),
    });
    client.requestAccessToken({
      prompt: options.chooseAccount ? "select_account" : "",
      ...(hint ? { hint } : {}),
    });
  });

  // 次から選択画面を出さずに済むよう、1度だけ聞いて覚える
  await learnAccount();
}

/**
 * 持っているトークンがまだ使えるか。
 * 切れる少し前から「使えない」と答える。切れた直後の1回を失敗させないため。
 */
export function isConnected(): boolean {
  return token !== null && Date.now() < tokenExpiresAt - EXPIRY_MARGIN_MS;
}

/**
 * 手元のトークンを捨てる。Google 側の許可までは取り消さない。
 * どのアカウントで繋いでいたかは覚えたままにする
 * （切って繋ぎ直すたびに選ばされては、切る意味より手間が勝つ）。
 * 別のアカウントにしたいときは forgetAccount か connect({ chooseAccount: true }) を使う。
 */
export function disconnect(): void {
  token = null;
  tokenExpiresAt = 0;
}

async function get<T>(path: string): Promise<T> {
  if (!token) throw new Error("先に接続してください");
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401 || res.status === 403) {
    // 切れていたら、次に押したときに取り直せるようにしておく
    token = null;
    tokenExpiresAt = 0;
    throw new Error("Google への接続が切れました。もう一度接続してください");
  }
  if (!res.ok) throw new Error(`Google から取得できませんでした（${res.status}）`);
  return (await res.json()) as T;
}

export async function fetchTaskLists(): Promise<GoogleTaskList[]> {
  const data = await get<{ items?: GoogleTaskList[] }>("/users/@me/lists?maxResults=100");
  return data.items ?? [];
}

/**
 * 1つのリストのタスクを全部取る。
 * 完了したものも取る（向こうで済ませたものを、こちらでも済みにするため）。
 * 100件ずつ返ってくるので、続きがあるあいだ辿る。
 */
export async function fetchTasks(listId: string): Promise<GoogleTask[]> {
  const out: GoogleTask[] = [];
  let pageToken: string | undefined;
  // 際限なく回さない。1リスト2000件で十分すぎる
  for (let i = 0; i < 20; i++) {
    /*
      showHidden を落とすと、完了したタスクが返ってこない。

      Google ToDo の画面でチェックを付けたタスクは completed になると同時に
      hidden も立つ。showHidden=false だと一覧から丸ごと消えるので、
      こちらからは「Google側で消えた」ようにしか見えず、
      完了が伝わらないまま未着手として残ってしまう。
    */
    const q = new URLSearchParams({ maxResults: "100", showCompleted: "true", showHidden: "true" });
    if (pageToken) q.set("pageToken", pageToken);
    const data = await get<{ items?: GoogleTask[]; nextPageToken?: string }>(
      `/lists/${encodeURIComponent(listId)}/tasks?${q.toString()}`,
    );
    out.push(...(data.items ?? []));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out;
}
