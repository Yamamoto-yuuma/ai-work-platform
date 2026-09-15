/**
 * 羅列したテキストを、1行ずつタスクに割る。
 *
 * 依頼が立て込むと、1件ごとにフォームを開いて項目を埋める手間が
 * そのまま税になる。思い出した順に書き並べて、まとめて入れられるようにする。
 *
 * 読み取りは決まった規則だけで行う。AIには渡さない。
 * 毎日何十回も通る道なので、同じ文字列がいつも同じ結果になることの方が、
 * 賢く読めることより大事（違う結果が出ると、毎回確かめる羽目になる）。
 *
 * 業務の中身は一切知らない。日付と時間と記号だけを見る。
 */
import type { TaskPriority } from "../model/types";

export interface ParsedTaskLine {
  /** 入力された行そのもの。取り違えたときに見比べられるように残す */
  raw: string;
  title: string;
  dueAt?: string;
  estimatedMinutes?: number;
  priority?: TaskPriority;
  /** 何を読み取ったか。画面で「なぜこの期限になったか」を出すために持つ */
  matched: string[];
}

/* 行頭の箇条書き記号。書き写したときに付いてくるので落とす */
const BULLET = /^\s*(?:[-–—*・･>＞]|[□☐■●○◯]|[①-⑳]|[❶-❿]|\[[ xX]?\]|\(?\d{1,2}[.)、]|\d{1,2}\s*[.)]\s)\s*/;

const WEEKDAY: Record<string, number> = {
  日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6,
};

function atEndOfDay(base: Date, y: number, m: number, d: number): string {
  return new Date(y, m, d, 18, 0, 0, 0).toISOString();
}

/** その日の 0 時。日付だけを比べるために使う */
function dayStart(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

interface Hit { text: string; value: string }

/**
 * 期限を読む。
 *
 * 拾えるのは、日付として書かれたものだけ。
 * 「15日締めの請求書」のように文の途中にあるものは、期限にはするが
 * 題名からは消さない（消すと何のことか分からなくなる）。
 * 行の末尾にあるものだけ、題名から外す。
 */
export function readDue(line: string, now: Date): Hit | undefined {
  const y = now.getFullYear();
  const mk = (dd: Date) => atEndOfDay(now, dd.getFullYear(), dd.getMonth(), dd.getDate());
  const plus = (n: number) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
    return mk(d);
  };

  // 今日・明日のような言い方
  const words: [RegExp, () => string][] = [
    [/今日|本日|きょう/, () => plus(0)],
    [/明後日|あさって/, () => plus(2)],
    [/明日|あした|あす/, () => plus(1)],
    [/(\d{1,3})\s*日後(?!ろ)/, () => plus(0)], // 下で数値を取り直す
    [/来週/, () => plus(7)],
    [/今週中|週内/, () => {
      // 今週の金曜。過ぎていれば今日
      const diff = (5 - now.getDay() + 7) % 7;
      return plus(diff);
    }],
  ];
  for (const [re, get] of words) {
    const m = re.exec(line);
    if (!m) continue;
    if (/日後/.test(m[0])) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 0 && n <= 365) return { text: m[0], value: plus(n) };
      continue;
    }
    return { text: m[0], value: get() };
  }

  // 曜日。次に来るその曜日（今日と同じ曜日なら来週）
  const wd = /(?:今度の|次の)?([日月火水木金土])曜(?:日)?/.exec(line);
  if (wd) {
    const target = WEEKDAY[wd[1]];
    const diff = ((target - now.getDay() + 7) % 7) || 7;
    return { text: wd[0], value: plus(diff) };
  }

  // 9/15、9月15日
  const md = /(\d{1,2})\s*[/／月]\s*(\d{1,2})\s*日?/.exec(line);
  if (md) {
    const mm = Number(md[1]);
    const dd = Number(md[2]);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      // 過ぎている月日は来年のものとして読む
      const thisYear = new Date(y, mm - 1, dd);
      const use = dayStart(thisYear) < dayStart(now) ? new Date(y + 1, mm - 1, dd) : thisYear;
      return { text: md[0], value: mk(use) };
    }
  }

  /*
    15日（月を書かないとき）。過ぎていれば来月。

    「3日分」「2日間」「5日目」「3日連続」は日付ではなく数え方なので外す。
    ここを外し損ねると、身に覚えのない期限が黙って付く。
    件数が多いほど効いてくるので、拾い漏らす方に倒す。
  */
  const dOnly = /(?:^|[\s、,])(\d{1,2})\s*日(?![後間分目連ぶ以])/.exec(line);
  if (dOnly) {
    const dd = Number(dOnly[1]);
    if (dd >= 1 && dd <= 31) {
      const thisMonth = new Date(y, now.getMonth(), dd);
      const use = dayStart(thisMonth) < dayStart(now) ? new Date(y, now.getMonth() + 1, dd) : thisMonth;
      return { text: dOnly[1] + "日", value: mk(use) };
    }
  }

  return undefined;
}

/** 見積時間を読む。30分・1時間・1.5h・90m */
export function readEstimate(line: string): { text: string; minutes: number } | undefined {
  const hm = /(\d+)\s*時間\s*(\d{1,2})\s*分/.exec(line);
  if (hm) return { text: hm[0], minutes: Number(hm[1]) * 60 + Number(hm[2]) };

  const h = /(\d+(?:\.\d+)?)\s*(?:時間|h|H|hr)(?![a-zA-Z])/.exec(line);
  if (h) {
    const n = Number(h[1]);
    if (Number.isFinite(n) && n > 0) return { text: h[0], minutes: Math.round(n * 60) };
  }

  const m = /(\d+)\s*(?:分|m|M|min)(?![a-zA-Z])/.exec(line);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) return { text: m[0], minutes: n };
  }
  return undefined;
}

/**
 * 急ぎの印を読む。末尾の ! と、はっきりした言葉だけ。
 *
 * 言葉の方は、前置きとして書かれたとき（後ろに区切りがあるとき）だけ
 * 題名から外す。「緊急対応マニュアルを更新する」の緊急は名前の一部で、
 * 外すと何のことか分からなくなる。
 */
export function readPriority(
  line: string,
): { text: string; priority: TaskPriority; lead?: boolean } | undefined {
  const bang = /\s*[!！]+\s*$/.exec(line);
  if (bang) return { text: bang[0], priority: "urgent" };

  // 行頭の前置き。後ろに区切りが要る
  const lead = /^(大至急|至急|緊急|重要|優先)\s*[:：、,]?[\s]+/.exec(line);
  if (lead) {
    return {
      text: lead[0],
      priority: lead[1] === "重要" || lead[1] === "優先" ? "high" : "urgent",
      lead: true,
    };
  }

  // どこかに書いてあるとき。読み取るが、題名からは外さない
  const urgent = /大至急|至急|緊急/.exec(line);
  if (urgent) return { text: urgent[0], priority: "urgent" };
  const high = /重要|優先/.exec(line);
  if (high) return { text: high[0], priority: "high" };
  return undefined;
}

/**
 * 読み取ったものを題名から外す。
 * 行の末尾にあるときだけ外す。文の途中のものを抜くと、
 * 「15日締めの請求書」が「締めの請求書」になって意味が変わる。
 */
function trimTail(title: string, token: string): string {
  const at = title.lastIndexOf(token);
  if (at < 0) return title;
  const rest = title.slice(at + token.length).trim();
  // 末尾か、末尾に助詞や記号しか残らないときだけ外す
  if (rest.length > 0 && !/^[まで迄までに、。・\-–—/／()（）\s]*$/.test(rest)) return title;
  return title.slice(0, at).replace(/[、,・\-–—/／\s]+$/, "").trim();
}

/** 1行を読む。題名が空になるものは呼ぶ側で捨てる */
export function parseLine(raw: string, now: Date): ParsedTaskLine {
  let title = raw.replace(BULLET, "").trim();
  const matched: string[] = [];

  const pr = readPriority(title);
  if (pr) {
    title = pr.lead ? title.slice(pr.text.length).trim() : trimTail(title, pr.text);
    matched.push(pr.text.trim().replace(/[:：、,]$/, ""));
  }

  const est = readEstimate(title);
  if (est) { title = trimTail(title, est.text); matched.push(est.text.trim()); }

  const due = readDue(title, now);
  if (due) { title = trimTail(title, due.text); matched.push(due.text.trim()); }

  return {
    raw,
    title: title.trim(),
    dueAt: due?.value,
    estimatedMinutes: est?.minutes,
    priority: pr?.priority,
    matched: matched.filter((m) => m.length > 0),
  };
}

/**
 * 羅列を行ごとに割る。
 * 空行と、読んだ結果なにも残らなかった行は落とす
 * （日付だけの行を入れても、名前の無いタスクが並ぶだけになる）。
 */
export function parseBulk(text: string, now: Date): ParsedTaskLine[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => parseLine(l, now))
    .filter((p) => p.title.length > 0);
}

/* ------------------------------------------------------------------------- *
 * 箇条書きのメモを読む
 * ------------------------------------------------------------------------- */

/**
 * 1 件ぶんの塊。見出しの行と、その下に続けて書かれたもの。
 */
export interface MemoBlock extends ParsedTaskLine {
  /** 見出しに続けて書かれたもの。タスクの説明にする。無ければ undefined */
  note?: string;
}

/** 箇条書きの印で始まる行か */
function isBulleted(line: string): boolean {
  return BULLET.test(line);
}

/**
 * 箇条書きのメモを、1 件ずつの塊に分ける。
 *
 * 「①」「②」のような印が付いた行から次の印までを 1 件とする。
 * 印の無い行は、その前の件の続きとして扱う。頭の中にあることを続けて書いても、
 * 途中の一文が勝手に別のタスクにならないようにするため。
 *
 *   ①○○社の資料を確認する
 *   　明日のMTGで使うので今日中           ← ①の続き
 *   ②田中さんに見てもらう                 ← ここから 2 件目
 *
 * 印がどこにも無いときは、今までどおり 1 行を 1 件として読む。
 * 印を使わない書き方をしている人の結果を変えないため。
 *
 * 期限・見積・優先度は見出しの行から読む。見出しに無いときだけ、続きの行から
 * 最初に見つかったものを使う（続きの行を先に見ると、本文中の日付を拾ってしまう）。
 */
export function parseMemo(text: string, now: Date): MemoBlock[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (!lines.some(isBulleted)) {
    return parseBulk(text, now);
  }

  const blocks: { head: string; notes: string[] }[] = [];
  for (const line of lines) {
    // 印が無く、前の件があるなら、その続き
    if (!isBulleted(line) && blocks.length > 0) {
      blocks[blocks.length - 1].notes.push(line);
      continue;
    }
    blocks.push({ head: line, notes: [] });
  }

  return blocks
    .map(({ head, notes }) => {
      const parsed = parseLine(head, now);
      const matched = [...parsed.matched];

      // 見出しに書いていなければ、続きの行から探す
      let dueAt = parsed.dueAt;
      let estimatedMinutes = parsed.estimatedMinutes;
      let priority = parsed.priority;
      for (const note of notes) {
        if (dueAt === undefined) {
          const due = readDue(note, now);
          if (due) { dueAt = due.value; matched.push(due.text.trim()); }
        }
        if (estimatedMinutes === undefined) {
          const est = readEstimate(note);
          if (est) { estimatedMinutes = est.minutes; matched.push(est.text.trim()); }
        }
        if (priority === undefined) {
          const pr = readPriority(note);
          if (pr) { priority = pr.priority; matched.push(pr.text.trim().replace(/[:：、,]$/, "")); }
        }
      }

      return {
        ...parsed,
        dueAt,
        estimatedMinutes,
        priority,
        matched: matched.filter((m) => m.length > 0),
        note: notes.length > 0 ? notes.join("\n") : undefined,
      };
    })
    .filter((b) => b.title.length > 0);
}
