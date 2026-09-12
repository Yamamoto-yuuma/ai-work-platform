/**
 * 昼の日報本文の生成。
 *
 * フォーマットは固定のため、AI・LLM は使用しない。
 * カレンダーのタイトルをそのまま「■」付きの行にするだけ。
 *
 * 夜の日報はここでは作らない。スプレッドシートの「日報」タブがそのまま本文になる
 * （nightBody.gs）。同じ文面を二か所で組み立てると、片方だけ直した日に食い違う。
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
 * 指定日の昼の日報本文を生成する（カレンダーを参照する）。
 */
function generateDayReport_(date) {
  assertDate_(date);
  var titles = getEventTitlesByHalf_(date);
  return buildDayReportBody_(titles.morning, titles.afternoon);
}

/**
 * 指定日の夜の日報本文を取得する。
 *
 * 夜はスプレッドシートの「日報」タブがそのまま本文になる。ここでは文面を作らない。
 * 日付も挨拶もシート側に入っているため、date は受け取らない。
 */
function generateNightReport_() {
  return readNightReportBody_();
}
