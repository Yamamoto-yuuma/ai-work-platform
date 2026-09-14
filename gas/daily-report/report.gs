/**
 * 日報本文の生成。
 *
 * フォーマットは固定のため、AI・LLM は使用しない。
 * カレンダーの予定と Google ToDo のタスクを「■」付きの行にするだけ。
 *
 * 夜の日報の上半分（挨拶・進捗状況）はここでは作らない。スプレッドシートの
 * 「日報」タブから読む（nightBody.gs）。下半分だけをここで組み立てる。
 *
 * ■ タスクを置く場所
 *   タスクは必ず「業務予定」側に入れる。未完了のタスク＝これからやることなので、
 *   業務報告（やったこと）に混ぜると、やっていないことを報告したことになる。
 *
 *   Tasks API は期限の「日付」しか持たず、時刻は読めない。そのため予定のように
 *   開始時刻で AM / PM へ振り分けることはできない。置き場所は下のとおり固定する。
 *     昼 … 業務予定（当日 PM）の末尾に、当日が期限のタスク
 *     夜 … 業務予定（翌営業日 AM）の末尾に、翌営業日が期限のタスク
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
 * 昼の日報本文を組み立てる（カレンダーへも ToDo へもアクセスしない純粋な処理）。
 *
 * @param {Array.<string>} morningTitles 当日 AM の予定タイトル
 * @param {Array.<string>} afternoonTitles 当日 PM の予定タイトル
 * @param {Array.<string>=} taskTitles 当日が期限の未完了タスク名
 */
function buildDayReportBody_(morningTitles, afternoonTitles, taskTitles) {
  var lines = [];
  lines.push('---業務報告---');
  lines.push('AM');
  appendTitleLines_(lines, morningTitles);
  lines.push(DAY_REPORT_SPACER_LINE);
  lines.push('---業務予定---');
  lines.push('PM');
  appendTitleLines_(lines, afternoonTitles);
  // タスクは「これからやること」なので業務予定側。業務報告に入れると
  // やっていないことを報告したことになる
  appendTitleLines_(lines, taskTitles);
  return lines.join('\n');
}

/**
 * 指定日の昼の日報本文を生成する（カレンダーと Google ToDo を参照する）。
 */
function generateDayReport_(date) {
  assertDate_(date);
  var titles = getEventTitlesByHalf_(date);
  return buildDayReportBody_(titles.morning, titles.afternoon, getTaskTitlesForDate_(date));
}

/**
 * 夜の日報本文を組み立てる（カレンダーへもシートへもアクセスしない純粋な処理）。
 *
 * 上半分は受け取ったものをそのまま置く（シートの進捗状況）。
 * 下半分はここで組む。
 *
 *   業務報告 … その日の PM。昼の日報で AM を出しているので、夜は残りを出す
 *   業務予定 … 次の営業日の AM と PM。夜に出す予定は、翌日そのまま使えるもの
 *   所感     … 見出しだけ。中身は人が下書きに書き足す
 *
 * タスクは業務予定の AM 側に置く。期限に時刻が無く（Tasks API の仕様）、
 * AM / PM のどちらかには決められないので、先に目に入る側へ寄せる。
 *
 * @param {Array.<string>} progressLines シートから読んだ上半分
 * @param {Array.<string>} afternoonTitles 当日 PM の予定タイトル
 * @param {Array.<string>} nextMorningTitles 次の営業日 AM の予定タイトル
 * @param {Array.<string>} nextAfternoonTitles 次の営業日 PM の予定タイトル
 * @param {Array.<string>=} nextTaskTitles 次の営業日が期限の未完了タスク名
 */
function buildNightReportBody_(
  progressLines, afternoonTitles, nextMorningTitles, nextAfternoonTitles, nextTaskTitles
) {
  var lines = [];
  if (progressLines) {
    for (var i = 0; i < progressLines.length; i++) lines.push(progressLines[i]);
  }
  if (lines.length > 0) lines.push('');

  lines.push('---業務報告---');
  lines.push('PM');
  appendTitleLines_(lines, afternoonTitles);
  lines.push('');

  lines.push('---業務予定---');
  lines.push('AM');
  appendTitleLines_(lines, nextMorningTitles);
  appendTitleLines_(lines, nextTaskTitles);
  lines.push('');
  lines.push('PM');
  appendTitleLines_(lines, nextAfternoonTitles);
  lines.push('');

  lines.push('---所感---');
  return lines.join('\n');
}

/**
 * 指定日の夜の日報本文を生成する（シート・カレンダー・Google ToDo を参照する）。
 *
 * タスクは翌営業日が期限のものを読む。夜の業務予定は翌営業日のことなので、
 * 当日が期限のタスクを並べると、報告の対象日とずれる。
 */
function generateNightReport_(date) {
  assertDate_(date);
  var nextDate = nextBusinessDay_(date);
  var today = getEventTitlesByHalf_(date);
  var next = getEventTitlesByHalf_(nextDate);
  return buildNightReportBody_(
    readNightProgressLines_(),
    today.afternoon,
    next.morning,
    next.afternoon,
    getTaskTitlesForDate_(nextDate)
  );
}
