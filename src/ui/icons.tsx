/**
 * ナビの記号。
 *
 * ⌂ ▷ ☑ のような文字記号を並べていたが、書体まかせなので
 * 太さも大きさも向きも揃わない。手描きの貼り紙のように見える。
 * 同じ枠・同じ線幅で引き直して、6つが一組に見えるようにする。
 *
 * 塗らない。線だけにして、文字と同じ濃さで並ぶようにする。
 * 外部のアイコン集は入れない。6つのために依存を増やさない。
 */
import type { ComponentType } from "react";

const BOX = {
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const HomeIcon = () => (
  <svg {...BOX} className="h-[17px] w-[17px]">
    <path d="M3.5 8.4 10 3.2l6.5 5.2V16a.8.8 0 0 1-.8.8H4.3a.8.8 0 0 1-.8-.8Z" />
    <path d="M8 16.8v-4.4h4v4.4" />
  </svg>
);

/** 業務＝順に流れる手順。三角ではなく、繋がった段で表す */
export const FlowIcon = () => (
  <svg {...BOX} className="h-[17px] w-[17px]">
    <rect x="2.8" y="3.2" width="6" height="4.2" rx="1" />
    <rect x="11.2" y="12.6" width="6" height="4.2" rx="1" />
    <path d="M5.8 7.4v4.2a1 1 0 0 0 1 1h7.4" />
  </svg>
);

export const TaskIcon = () => (
  <svg {...BOX} className="h-[17px] w-[17px]">
    <rect x="3.2" y="3.2" width="13.6" height="13.6" rx="2.4" />
    <path d="M6.8 10.2 9 12.4l4.2-4.6" />
  </svg>
);

/** マップ＝分かれて繋がる関係。点を線で結ぶ */
export const MapIcon = () => (
  <svg {...BOX} className="h-[17px] w-[17px]">
    <circle cx="4.6" cy="10" r="1.9" />
    <circle cx="15.4" cy="5.4" r="1.9" />
    <circle cx="15.4" cy="14.6" r="1.9" />
    <path d="M6.3 9.1 13.7 6.2M6.3 10.9l7.4 2.9" />
  </svg>
);

export const KnowledgeIcon = () => (
  <svg {...BOX} className="h-[17px] w-[17px]">
    <path d="M3.6 4.6A1.4 1.4 0 0 1 5 3.2h4.2a1.6 1.6 0 0 1 1.6 1.6v11a1.4 1.4 0 0 0-1.4-1.4H5a1.4 1.4 0 0 1-1.4-1.4Z" />
    <path d="M16.4 4.6A1.4 1.4 0 0 0 15 3.2h-4.2a1.6 1.6 0 0 0-1.6 1.6v11a1.4 1.4 0 0 1 1.4-1.4H15a1.4 1.4 0 0 0 1.4-1.4Z" />
  </svg>
);

/*
  設定。歯車は小さく描くと歯が潰れて、太陽の絵に見えてしまう。
  つまみを並べた形（スライダー）なら、17px でも形が残る。
*/
export const SettingsIcon = () => (
  <svg {...BOX} className="h-[17px] w-[17px]">
    <path d="M3 5.6h14M3 10h14M3 14.4h14" />
    <circle cx="7.4" cy="5.6" r="1.7" fill="var(--color-rail)" />
    <circle cx="13" cy="10" r="1.7" fill="var(--color-rail)" />
    <circle cx="6.2" cy="14.4" r="1.7" fill="var(--color-rail)" />
  </svg>
);

/** 日報＝書いて出すもの。紙面と、書かれた行で表す */
export const ReportIcon = () => (
  <svg {...BOX} className="h-[17px] w-[17px]">
    <path d="M5 3.2h7.2L16 6.9V16a.8.8 0 0 1-.8.8H5a.8.8 0 0 1-.8-.8V4a.8.8 0 0 1 .8-.8Z" />
    <path d="M11.8 3.4v3.6h3.6" />
    <path d="M6.9 10.4h5.4M6.9 13.2h3.6" />
  </svg>
);

export const NAV_ICON: Record<string, ComponentType> = {
  "/": HomeIcon,
  "/workflows": FlowIcon,
  "/tasks": TaskIcon,
  "/daily-report": ReportIcon,
  "/map": MapIcon,
  "/knowledge": KnowledgeIcon,
  "/settings": SettingsIcon,
};

/* ---------------------------------------------------------------------------
   置き場所の印。
   ロゴは使わない。他社の商標を持ち込まずに済むし、6つのナビ記号と
   線の太さが揃わないものが1つでも混じると、そこだけ貼り紙に見える。
   「何の種類の置き場所か」が分かれば足りるので、形で表す。
--------------------------------------------------------------------------- */

/** ノートブック＝綴じた冊子 */
const NotebookMark = () => (
  <svg {...BOX} className="h-4 w-4">
    <path d="M5.4 3.4h9.2a.9.9 0 0 1 .9.9v11.4a.9.9 0 0 1-.9.9H5.4" />
    <path d="M5.4 3.4a1.6 1.6 0 0 0-1.6 1.6v10a1.6 1.6 0 0 0 1.6 1.6" />
    <path d="M8.2 7.2h4.6M8.2 10h4.6" />
  </svg>
);

/** 書類＝角を折った紙 */
const DocMark = () => (
  <svg {...BOX} className="h-4 w-4">
    <path d="M11.4 2.8H6a1.4 1.4 0 0 0-1.4 1.4v11.6A1.4 1.4 0 0 0 6 17.2h8a1.4 1.4 0 0 0 1.4-1.4V6.8Z" />
    <path d="M11.4 2.8v4h4" />
  </svg>
);

/** ページ＝罫の入った紙。冊子（NotebookMark）と見分けが付くようにする */
const PageMark = () => (
  <svg {...BOX} className="h-4 w-4">
    <rect x="4.2" y="3" width="11.6" height="14" rx="1.6" />
    <path d="M7.2 7h5.6M7.2 10h5.6M7.2 13h3.2" />
  </svg>
);

/** 保管場所＝重ねた箱 */
const DriveMark = () => (
  <svg {...BOX} className="h-4 w-4">
    <path d="M3.2 7.4 10 3.4l6.8 4v5.2L10 16.6l-6.8-4Z" />
    <path d="M3.2 7.4 10 11.4l6.8-4M10 11.4v5.2" />
  </svg>
);

/** 外のページ＝地球 */
const WebMark = () => (
  <svg {...BOX} className="h-4 w-4">
    <circle cx="10" cy="10" r="6.8" />
    <path d="M3.2 10h13.6" />
    <path d="M10 3.2c1.8 2 2.7 4.3 2.7 6.8S11.8 14.8 10 16.8C8.2 14.8 7.3 12.5 7.3 10S8.2 5.2 10 3.2Z" />
  </svg>
);

/** 開けない置き場所＝棚・フォルダ */
const FolderMark = () => (
  <svg {...BOX} className="h-4 w-4">
    <path d="M3.2 6a1.4 1.4 0 0 1 1.4-1.4h3l1.6 2h6.2A1.4 1.4 0 0 1 16.8 8v6.6a1.4 1.4 0 0 1-1.4 1.4H4.6a1.4 1.4 0 0 1-1.4-1.4Z" />
  </svg>
);

/** 置き場所の種類ごとの印。knowledge-link.ts の LocationService と対で使う */
export const LOCATION_MARK: Record<string, ComponentType> = {
  notebooklm: NotebookMark,
  gdrive: DriveMark,
  gdocs: DocMark,
  gsheets: DocMark,
  gslides: DocMark,
  notion: PageMark,
  web: WebMark,
  path: FolderMark,
};
