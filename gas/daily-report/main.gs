/**
 * エントリポイント。
 *
 * 自動実行（トリガー）と手動実行の入口、テスト用の本文確認、トリガー設定をまとめる。
 */

var REPORT_TYPE_DAY = 'day';
var REPORT_TYPE_NIGHT = 'night';

/* ------------------------------------------------------------------ *
 * 自動実行・手動実行
 * ------------------------------------------------------------------ */

/**
 * 昼の日報を生成して Chatwork へ投稿する（12:50 頃のトリガー／手動実行の入口）。
 */
function runDayReport() {
  runReport_(REPORT_TYPE_DAY);
}

/**
 * 夜の日報を生成して Chatwork へ投稿する（18:20 頃のトリガー／手動実行の入口）。
 */
function runNightReport() {
  runReport_(REPORT_TYPE_NIGHT);
}

/**
 * 日報の生成と投稿。
 *
 * 土日祝は投稿せずに終了する（トリガーは止めない）。
 * 同日・同種の日報が送信済みの場合も投稿しない。
 */
function runReport_(reportType) {
  assertTimeZone_();

  var today = toJstStartOfDay_(new Date());
  var label = reportType === REPORT_TYPE_DAY ? '昼の日報' : '夜の日報';
  var dateKey = formatDateKey_(today);

  try {
    var nonBusinessDayReason = describeNonBusinessDay_(today);
    if (nonBusinessDayReason !== null) {
      Logger.log(dateKey + ' は' + nonBusinessDayReason + 'のため、' + label + 'は投稿しません。');
      return;
    }

    var executed = runExclusively_(function () {
      var reportKey = buildReportKey(today, reportType);
      if (hasAlreadySent(reportKey)) {
        Logger.log(label + 'はすでに送信済みです（key: ' + reportKey + '）。再送信しません。');
        return;
      }

      var body =
        reportType === REPORT_TYPE_DAY ? generateDayReport(today) : generateNightReport(today);

      var messageId = sendToChatwork(body);
      markAsSent(reportKey);
      Logger.log(label + 'を投稿しました（key: ' + reportKey + ' / message_id: ' + messageId + '）。');
    });

    if (!executed) {
      Logger.log(label + 'の処理をロック未取得のためスキップしました。');
    }
  } catch (e) {
    // 握りつぶさず、原因をログへ残したうえで実行を失敗させる（トリガーの失敗通知を効かせるため）。
    Logger.log(label + 'の処理でエラーが発生しました: ' + e + (e && e.stack ? '\n' + e.stack : ''));
    throw e;
  }
}

/* ------------------------------------------------------------------ *
 * テスト（Chatwork へは送信しない）
 * ------------------------------------------------------------------ */

/**
 * 当日の昼の日報本文をログへ出力する（投稿はしない）。
 */
function testDayReport() {
  return testDayReportForDate(Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd'));
}

/**
 * 当日の夜の日報本文をログへ出力する（投稿はしない）。
 */
function testNightReport() {
  return testNightReportForDate(Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd'));
}

/**
 * 日付（yyyy-MM-dd）を指定して昼の日報本文をログへ出力する（投稿はしない）。
 */
function testDayReportForDate(dateText) {
  assertTimeZone_();
  var date = parseDate(dateText);
  var body = generateDayReport(date);
  Logger.log('----- 昼の日報 ' + formatJapaneseDate(date) + ' -----\n' + body);
  return body;
}

/**
 * 日付（yyyy-MM-dd）を指定して夜の日報本文をログへ出力する（投稿はしない）。
 */
function testNightReportForDate(dateText) {
  assertTimeZone_();
  var date = parseDate(dateText);
  var body = generateNightReport(date);
  Logger.log(
    '----- 夜の日報 ' + formatJapaneseDate(date) +
      '（次営業日: ' + formatJapaneseDate(getNextBusinessDay(date)) + '） -----\n' + body
  );
  return body;
}

/* ------------------------------------------------------------------ *
 * トリガー
 * ------------------------------------------------------------------ */

/**
 * 自動実行トリガーを設定する（昼 12:50 頃 / 夜 18:20 頃）。
 *
 * 何度実行しても重複しないよう、同じ関数の既存トリガーを作り直す。
 * 土日祝もトリガーは止めない（実行時に営業日判定でスキップする）。
 */
function setupTriggers() {
  assertTimeZone_();

  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    var handler = existing[i].getHandlerFunction();
    if (handler === 'runDayReport' || handler === 'runNightReport') {
      ScriptApp.deleteTrigger(existing[i]);
    }
  }

  ScriptApp.newTrigger('runDayReport').timeBased().everyDays(1).atHour(12).nearMinute(50).create();
  ScriptApp.newTrigger('runNightReport').timeBased().everyDays(1).atHour(18).nearMinute(20).create();

  Logger.log('トリガーを設定しました（runDayReport 12:50 頃 / runNightReport 18:20 頃）。');
}
