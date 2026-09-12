/**
 * 日報本文の生成。
 *
 * フォーマットは固定のため、AI・LLM は使用しない。
 * カレンダーのタイトルをそのまま「■」付きの行にするだけ。
 *
 * 出来上がるのは、そのまま Chatwork へ貼れる本文だけにする。
 * 「【昼用】」「【夜用】」のような、どちらの型かを示す見出しは入れない。
 * 送る前に毎回消す手間になるうえ、消し忘れるとそのまま相手に届く。
 */

/** 昼の日報で AM ブロックと業務予定の間に入る行（半角スペース 1 つ）。 */
var DAY_REPORT_SPACER_LINE = ' ';

/**
 * 予定タイトルを日報の 1 行にする。
 * すでに「■」が付いている場合は二重にしない。空タイトルは null を返す。
 */
function formatTitleLine_(title) {
  var text = String(title === null || title === undefined ? '' : title);
  // 予定名に改行が入っていると、1 件が複数行になって日報の形が崩れる。
  // 見出しのない行や、偽の「■」行ができてしまうため、1 行に畳む。
  text = text.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  text = text.replace(/^[■\s]+/, '').trim();
  if (text === '') return null;
  return '■' + text;
}

/**
 * タイトル配列を日報の行として lines へ追加する。
 * 予定が無い場合は何も足さない（「予定なし」等の文言は入れない）。
 */
function appendTitleLines_(lines, titles) {
  if (!titles) return;
  for (var i = 0; i < titles.length; i++) {
    var line = formatTitleLine_(titles[i]);
    if (line !== null) lines.push(line);
  }
}

/**
 * 進捗状況の行を日報へ追加する。
 * 無い場合は見出しごと出さない（空の「＜進捗状況＞」だけが残らないようにする）。
 */
function appendProgressLines_(lines, progressLines) {
  if (!progressLines || progressLines.length === 0) return;
  for (var i = 0; i < progressLines.length; i++) {
    var line = String(progressLines[i] === null || progressLines[i] === undefined ? '' : progressLines[i]);
    if (line.trim() !== '') lines.push(line);
  }
}

/**
 * 昼の日報本文を組み立てる（カレンダーへはアクセスしない純粋な処理）。
 *
 * @param {Array.<string>} morningTitles 当日 AM の予定タイトル
 * @param {Array.<string>} afternoonTitles 当日 PM の予定タイトル
 */
function buildDayReportBody_(morningTitles, afternoonTitles) {
  var lines = [];
  lines.push('---業務報告---');
  lines.push('AM');
  appendTitleLines_(lines, morningTitles);
  lines.push(DAY_REPORT_SPACER_LINE);
  lines.push('---業務予定---');
  lines.push('PM');
  appendTitleLines_(lines, afternoonTitles);
  return lines.join('\n');
}

/**
 * 夜の日報本文を組み立てる（カレンダーへはアクセスしない純粋な処理）。
 *
 * 業務報告は当日 PM のみ。業務予定は次営業日の AM と PM。
 * 当日 AM は夜の日報には入れない。所感は空欄のままにする。
 *
 * 進捗状況は挨拶の直後、業務報告の前に置く。売上管理表から読んだ行をそのまま使い、
 * ここでは数字を作らない。
 *
 * @param {Date} date 当日（日報の日付として表示する日）
 * @param {Array.<string>} todayAfternoonTitles 当日 PM の予定タイトル
 * @param {Array.<string>} nextMorningTitles 次営業日 AM の予定タイトル
 * @param {Array.<string>} nextAfternoonTitles 次営業日 PM の予定タイトル
 * @param {Array.<string>=} progressLines 売上管理表から読んだ進捗状況（無ければ省く）
 */
function buildNightReportBody_(date, todayAfternoonTitles, nextMorningTitles, nextAfternoonTitles, progressLines) {
  assertDate_(date);
  var lines = [];
  lines.push('お疲れ様です。' + SENDER_NAME + 'です。');
  lines.push(formatJapaneseDate_(date) + 'の日報をお送りいたします。');
  // 進捗状況は挨拶のすぐ下。数字を先に見せて、そのあとに中身を並べる
  appendProgressLines_(lines, progressLines);
  lines.push('---業務報告---');
  lines.push('PM');
  appendTitleLines_(lines, todayAfternoonTitles);
  lines.push('---業務予定---');
  lines.push('AM');
  appendTitleLines_(lines, nextMorningTitles);
  lines.push('PM');
  appendTitleLines_(lines, nextAfternoonTitles);
  lines.push('---所感---');
  return lines.join('\n');
}

/**
 * 指定日の昼の日報本文を生成する（カレンダーを参照する）。
 */
function generateDayReport_(date) {
  assertDate_(date);
  var titles = getEventTitlesByHalf_(date);
  return buildDayReportBody_(titles.morning, titles.afternoon);
}

/**
 * 指定日の夜の日報本文を生成する（カレンダーを参照する）。
 */
function generateNightReport_(date) {
  assertDate_(date);
  var today = getEventTitlesByHalf_(date);
  var nextBusinessDay = getNextBusinessDay_(date);
  var next = getEventTitlesByHalf_(nextBusinessDay);
  return buildNightReportBody_(
    date,
    today.afternoon,
    next.morning,
    next.afternoon,
    getSalesProgressLines_()
  );
}
