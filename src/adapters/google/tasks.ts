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
 */
import type { GoogleTask } from "@/core/integration/google-tasks";

const GIS_SRC = "https://accounts.google.com/gsi/client";
/** 読み取りだけ。書き込みの権限は求めない */
const SCOPE = "https://www.googleapis.com/auth/tasks.readonly";
const API = "https://tasks.googleapis.com/tasks/v1";

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
interface TokenClient { requestAccessToken: (o?: { prompt?: string }) => void }
interface TokenResponse { access_token?: string; error?: string; error_description?: string }
interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient: (c: {
        client_id: string; scope: string;
        callback: (r: TokenResponse) => void;
        error_callback?: (e: { type?: string; message?: string }) => void;
      }) => TokenClient;
    };
  };
}

let token: string | null = null;
let scriptLoading: Promise<void> | null = null;

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

export async function connect(): Promise<void> {
  const clientId = googleClientId();
  if (!clientId) throw new Error("Google のクライアントIDが設定されていません");
  await loadGis();
  const g = (window as unknown as { google?: GoogleGlobal }).google;
  if (!g?.accounts?.oauth2) throw new Error("Google の読み込みに失敗しました");

  await new Promise<void>((resolve, reject) => {
    const client = g.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (res) => {
        if (res.access_token) { token = res.access_token; resolve(); return; }
        reject(new Error(res.error_description || res.error || "接続を許可できませんでした"));
      },
      error_callback: (e) => reject(new Error(e.message || "接続を許可できませんでした")),
    });
    client.requestAccessToken({ prompt: "" });
  });
}

export function isConnected(): boolean {
  return token !== null;
}

/** 手元のトークンを捨てる。Google 側の許可までは取り消さない */
export function disconnect(): void {
  token = null;
}

async function get<T>(path: string): Promise<T> {
  if (!token) throw new Error("先に接続してください");
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401 || res.status === 403) {
    // 切れていたら、次に押したときに取り直せるようにしておく
    token = null;
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
    const q = new URLSearchParams({ maxResults: "100", showCompleted: "true", showHidden: "false" });
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
