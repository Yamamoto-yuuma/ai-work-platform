/**
 * 自動取り込みの設定と、最後に取り込んだときの記録。
 *
 * 作業の内容ではなく画面の使い方の話なので、業務データには入れない。
 * localStorage が使えない環境でも、取り込み自体は手で押せば動くようにする。
 */
export const AUTO_KEY = "ai-work-platform:google-auto";
export const LAST_KEY = "ai-work-platform:google-last";

/** 既定は「する」。自動にしてほしい、という前提で作っている */
export function isAutoSyncOn(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== "0";
  } catch {
    return false;
  }
}

export function setAutoSync(on: boolean): void {
  try { localStorage.setItem(AUTO_KEY, on ? "1" : "0"); } catch { /* 使えなくても手動で足りる */ }
}

export interface LastImport { at: string; message: string }

export function rememberLastImport(message: string): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ at: new Date().toISOString(), message }));
  } catch { /* 記録できなくても取り込みは済んでいる */ }
}

export function readLastImport(): LastImport | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as LastImport;
    return v && typeof v.at === "string" ? v : null;
  } catch {
    return null;
  }
}
