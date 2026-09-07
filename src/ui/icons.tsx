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

export const NAV_ICON: Record<string, ComponentType> = {
  "/": HomeIcon,
  "/workflows": FlowIcon,
  "/tasks": TaskIcon,
  "/map": MapIcon,
  "/knowledge": KnowledgeIcon,
  "/settings": SettingsIcon,
};
