/**
 * 日本時間（Asia/Tokyo）を前提とした日付ユーティリティ。
 */

var WEEKDAY_LABELS_JA = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 日付を受け取る関数が、正しく日付を渡されたか確認する。
 *
 * Apps Script の実行ボタンは引数を渡せないため、部品の関数を選んで実行すると
 * ここで止まる。原因が分かるように、代わりに実行すべき関数を案内する。
 */
function assertDate_(value) {
  var isDate = Object.prototype.toString.call(value) === '[object Date]';
  if (!isDate || isNaN(value.getTime())) {
    throw new Error(
      'この関数は日付を受け取る部品のため、エディタの実行ボタンからは直接実行できません。' +
        '日報を確認するときは showDayDraft / showNightDraft、動作確認は runAllTests、' +
        '本番ルームへ送るときは sendDayDraft / sendNightDraft を選んで実行してください。'
    );
  }
}

/**
 * 日本時間での年・月・日を取り出す。
 * @return {{year: number, month: number, day: number}}
 */
function getJstDateParts_(date) {
  var text = Utilities.formatDate(date, TIME_ZONE, 'yyyy-MM-dd');
  var parts = text.split('-');
  return { year: Number(parts[0]), month: Number(parts[1]), day: Number(parts[2]) };
}

/**
 * 日本時間での曜日（0 = 日曜 … 6 = 土曜）。
 */
function getJstDayOfWeek_(date) {
  var p = getJstDateParts_(date);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/**
 * 日本時間での時（0-23）。
 */
function getJstHour_(date) {
  return Number(Utilities.formatDate(date, TIME_ZONE, 'H'));
}

/**
 * 日本時間での日付キー（yyyyMMdd）。送信済み管理・ログ・同日判定に使う。
 */
function formatDateKey_(date) {
  return Utilities.formatDate(date, TIME_ZONE, 'yyyyMMdd');
}

/**
 * 日本時間のその日の 0 時ちょうどを指す Date を返す。
 * 日付の足し算やカレンダー取得はこの正規化済みの値を使う。
 */
function toJstStartOfDay_(date) {
  var p = getJstDateParts_(date);
  return new Date(p.year, p.month - 1, p.day, 0, 0, 0, 0);
}

/**
 * 日数を加算した日付（日本時間の 0 時）を返す。
 */
function addDays_(date, days) {
  var p = getJstDateParts_(date);
  return new Date(p.year, p.month - 1, p.day + days, 0, 0, 0, 0);
}

/**
 * 日報に表示する日付文字列。例: 2026年9月11日(金)
 */
function formatJapaneseDate_(date) {
  var p = getJstDateParts_(date);
  var weekday = WEEKDAY_LABELS_JA[getJstDayOfWeek_(date)];
  return p.year + '年' + p.month + '月' + p.day + '日(' + weekday + ')';
}

/**
 * 'yyyy-MM-dd' 形式の文字列を日本時間の 0 時の Date に変換する。
 * 日付を指定してテスト・手動生成するときに使う。
 */
function parseDate_(dateText) {
  var matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText).trim());
  if (!matched) {
    throw new Error('日付は yyyy-MM-dd 形式で指定してください: ' + dateText);
  }
  return new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]), 0, 0, 0, 0);
}
