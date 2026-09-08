/**
 * 置き場所（location）が何なのかを、URL から決める。
 *
 * ただのリンクとして出すと「押してみないと何か分からない」ものが並ぶ。
 * 業務の最中に見るものなので、開く前に「Gemini Notebook の運営部だ」
 * と分かってほしい。判定は URL だけを見て決める（外に問い合わせない）。
 *
 * framework 非依存の純粋関数。画面は結果を出すだけにする。
 */

export type LocationService =
  | "notebooklm"
  | "gdrive"
  | "gdocs"
  | "gsheets"
  | "gslides"
  | "notion"
  | "web"
  /** ブラウザから開けない置き場所（共有フォルダ・棚・書類の場所など） */
  | "path";

export interface LocationInfo {
  service: LocationService;
  /** 何の置き場所か。カードの見出しに出す */
  label: string;
  /** 押して開けるか。http(s) だけ true */
  openable: boolean;
  /**
   * label の下に添える一行。label と同じことを二度書かない。
   * 添えるものが無ければ空。長い URL をそのまま出すと行が読めなくなる。
   */
  display: string;
}

const SERVICE_LABEL: Record<LocationService, string> = {
  notebooklm: "Gemini Notebook",
  gdrive: "Google ドライブ",
  gdocs: "Google ドキュメント",
  gsheets: "Google スプレッドシート",
  gslides: "Google スライド",
  notion: "Notion",
  web: "リンク",
  path: "ファイルの場所",
};

export function serviceLabel(service: LocationService): string {
  return SERVICE_LABEL[service];
}

/** 開ける置き場所か。http(s) だけをリンクにする（仕様は knowledge-draft と揃える） */
function isHttp(raw: string): boolean {
  return /^https?:\/\/\S+$/i.test(raw);
}

/**
 * ホストとパスからサービスを決める。
 * 当たらなかったものは web に落とす。「分からない」を作らない。
 */
function serviceOf(host: string, path: string): LocationService {
  if (host === "notebooklm.google.com") return "notebooklm";
  if (host === "docs.google.com") {
    if (path.startsWith("/document")) return "gdocs";
    if (path.startsWith("/spreadsheets")) return "gsheets";
    if (path.startsWith("/presentation")) return "gslides";
    return "gdrive";
  }
  if (host === "drive.google.com") return "gdrive";
  if (host === "notion.so" || host.endsWith(".notion.so") || host.endsWith(".notion.site")) {
    return "notion";
  }
  return "web";
}

/**
 * label の下に添える一行。label と同じことを二度書かない。
 *
 * 名前の分かるサービス（label がサービス名）では host を添える。
 * 続きは機械が振った ID でしかなく、40字の UUID を並べても読めないし、
 * どれがどれかも分からない。どのノートブックかは題名のほうが語る。
 *
 * 知らないサイト（label が host）ではパスを添える。ここには意味がある。
 * パスが無ければ添えるものが無いので空にする。空行を作らない。
 */
function detailOf(service: LocationService, host: string, path: string): string {
  const clean = host.replace(/^www\./, "");
  if (service !== "web") return clean;

  const trimmed = path.replace(/\/+$/, "");
  if (trimmed.length === 0 || trimmed === "/") return "";
  return trimmed.length <= 48 ? trimmed : `${trimmed.slice(0, 47)}…`;
}

/** 置き場所の説明。空なら null（出すものが無い） */
export function describeLocation(location: string | undefined): LocationInfo | null {
  const raw = (location ?? "").trim();
  if (raw.length === 0) return null;

  if (!isHttp(raw)) {
    /*
      共有フォルダのパスなどは押しても開けない。
      リンクの見た目にすると、押せそうに見えるだけになる。
    */
    return {
      service: "path",
      label: SERVICE_LABEL.path,
      openable: false,
      display: raw.length <= 60 ? raw : `${raw.slice(0, 59)}…`,
    };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // http(s) の形をしていて読めないものは、リンクにはしない
    return { service: "path", label: SERVICE_LABEL.path, openable: false, display: raw };
  }

  const host = url.hostname.toLowerCase();
  const service = serviceOf(host, url.pathname);
  return {
    service,
    label: service === "web" ? host.replace(/^www\./, "") : SERVICE_LABEL[service],
    openable: true,
    display: detailOf(service, host, url.pathname),
  };
}

/**
 * 置き場所から「出所」を決める。
 * 自分で書いたものは社内、外のサービスにあるものはその名前で出す。
 * 人に選ばせない。URL を貼れば決まるものを、もう一度聞かない。
 */
export function sourceFromLocation(
  location: string | undefined,
): "internal" | "gdrive" | "notion" | "notebooklm" {
  const info = describeLocation(location);
  if (!info) return "internal";
  switch (info.service) {
    case "notebooklm": return "notebooklm";
    case "gdrive":
    case "gdocs":
    case "gsheets":
    case "gslides": return "gdrive";
    case "notion": return "notion";
    default: return "internal";
  }
}
