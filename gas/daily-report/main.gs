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
 * 昼の日報の下書きを用意する（12:55 頃のトリガー／手動実行の入口）。
 * 下書きを保存するだけで、Chatwork へは送らない。
 */
function runDayReport() {
  runReport_(REPORT_TYPE_DAY);
}

/**
 * 夜の日報の下書きを用意する（18:25 頃のトリガー／手動実行の入口）。
 * 下書きを保存するだけで、Chatwork へは送らない。
 */
function runNightReport() {
  runReport_(REPORT_TYPE_NIGHT);
}

/* ------------------------------------------------------------------ *
 * 下書きの確認と送信（手動）
 * ------------------------------------------------------------------ */

/** 当日の昼の日報の下書きを表示する（送信はしない）。無ければその場で作る。 */
function showDayDraft() {
  return showDraft_(REPORT_TYPE_DAY);
}

/** 当日の夜の日報の下書きを表示する（送信はしない）。無ければその場で作る。 */
function showNightDraft() {
  return showDraft_(REPORT_TYPE_NIGHT);
}

/** 確認した昼の日報の下書きを Chatwork の本番ルームへ送信する（手動実行のみ）。 */
function sendDayDraft() {
  return sendDraft_(REPORT_TYPE_DAY);
}

/** 確認した夜の日報の下書きを Chatwork の本番ルームへ送信する（手動実行のみ）。 */
function sendNightDraft() {
  return sendDraft_(REPORT_TYPE_NIGHT);
}

/**
 * 日報の生成と下書き保存。
 *
 * ここから Chatwork へ送信することはない（送信は sendDayDraft() / sendNightDraft() のみ）。
 * 土日祝は何もせずに終了する（トリガーは止めない）。
 * 同日・同種の日報が本番ルームへ送信済みの場合も何もしない。
 */
function runReport_(reportType) {
  var label = reportType === REPORT_TYPE_DAY ? '昼の日報' : '夜の日報';

  try {
    assertTimeZone_();

    var today = toJstStartOfDay_(new Date());
    var dateKey = formatDateKey_(today);

    var nonBusinessDayReason = describeNonBusinessDay_(today);
    if (nonBusinessDayReason !== null) {
      Logger.log(dateKey + ' は' + nonBusinessDayReason + 'のため、' + label + 'は作成しません。');
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
      var record = saveDraft_(today, reportType, body);

      Logger.log(
        label + 'の下書きを保存しました（key: ' + buildDraftKey_(today, reportType) +
          ' / status: ' + record.status + '）。Chatwork へは送信していません。\n' +
          '内容の確認: ' + (reportType === REPORT_TYPE_DAY ? 'showDayDraft()' : 'showNightDraft()') + '\n' +
          '本番ルームへの送信: ' + (reportType === REPORT_TYPE_DAY ? 'sendDayDraft()' : 'sendNightDraft()') + '\n' +
          body
      );
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
 * 自動実行トリガーを設定する（昼 12:55 頃 / 夜 18:25 頃）。
 *
 * 何度実行しても重複しないよう、同じ関数の既存トリガーを作り直す。
 * 土日祝もトリガーは止めない（実行時に営業日判定でスキップする）。
 * トリガーが行うのは下書きの保存までで、Chatwork への送信は行わない。
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

  ScriptApp.newTrigger('runDayReport')
    .timeBased()
    .everyDays(1)
    .atHour(DAY_REPORT_HOUR)
    .nearMinute(DAY_REPORT_MINUTE)
    .create();
  ScriptApp.newTrigger('runNightReport')
    .timeBased()
    .everyDays(1)
    .atHour(NIGHT_REPORT_HOUR)
    .nearMinute(NIGHT_REPORT_MINUTE)
    .create();

  Logger.log(
    'トリガーを設定しました（runDayReport ' + formatTriggerTime_(DAY_REPORT_HOUR, DAY_REPORT_MINUTE) +
      ' 頃 / runNightReport ' + formatTriggerTime_(NIGHT_REPORT_HOUR, NIGHT_REPORT_MINUTE) + ' 頃）。' +
      'トリガーは下書きを保存するだけで、Chatwork へは送信しません。'
  );
}

/** ログ表示用の時刻文字列（例: 13:00）。 */
function formatTriggerTime_(hour, minute) {
  return hour + ':' + (minute < 10 ? '0' + minute : String(minute));
}
