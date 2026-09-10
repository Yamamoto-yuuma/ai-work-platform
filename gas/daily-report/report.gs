/**
 * 日報本文の生成。
 *
 * フォーマットは固定のため、AI・LLM は使用しない。
 * カレンダーのタイトルをそのまま「■」付きの行にするだけ。
 */

/** 昼の日報で AM ブロックと業務予定の間に入る行（半角スペース 1 つ）。 */
var DAY_REPORT_SPACER_LINE = ' ';

/**
 * 予定タイトルを日報の 1 行にする。
 * すでに「■」が付いている場合は二重にしない。空タイトルは null を返す。
 */
function formatTitleLine_(title) {
  var text = String(title === null || title === undefined ? '' : title).trim();
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
 * 昼の日報本文を組み立てる（カレンダーへはアクセスしない純粋な処理）。
 *
 * @param {Array.<string>} morningTitles 当日 AM の予定タイトル
 * @param {Array.<string>} afternoonTitles 当日 PM の予定タイトル
 */
function buildDayReportBody(morningTitles, afternoonTitles) {
  var lines = [];
  lines.push('【昼用】');
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
 * @param {Date} date 当日（日報の日付として表示する日）
 * @param {Array.<string>} todayAfternoonTitles 当日 PM の予定タイトル
 * @param {Array.<string>} nextMorningTitles 次営業日 AM の予定タイトル
 * @param {Array.<string>} nextAfternoonTitles 次営業日 PM の予定タイトル
 */
function buildNightReportBody(date, todayAfternoonTitles, nextMorningTitles, nextAfternoonTitles) {
  var lines = [];
  lines.push('【夜用】');
  lines.push('お疲れ様です。' + SENDER_NAME + 'です。');
  lines.push(formatJapaneseDate(date) + 'の日報をお送りいたします。');
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
function generateDayReport(date) {
  var titles = getEventTitlesByHalf_(date);
  return buildDayReportBody(titles.morning, titles.afternoon);
}

/**
 * 指定日の夜の日報本文を生成する（カレンダーを参照する）。
 */
function generateNightReport(date) {
  var today = getEventTitlesByHalf_(date);
  var nextBusinessDay = getNextBusinessDay(date);
  var next = getEventTitlesByHalf_(nextBusinessDay);
  return buildNightReportBody(date, today.afternoon, next.morning, next.afternoon);
}
