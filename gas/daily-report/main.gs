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

    var today = businessToday_();
    var dateKey = formatDateKey_(today);

    var nonBusinessDayReason = describeNonBusinessDay_(today);
    if (nonBusinessDayReason !== null) {
      Logger.log(dateKey + ' は' + nonBusinessDayReason + 'のため、' + label + 'は作成しません。');
      return;
    }

    var executed = runExclusively_(function () {
      var reportKey = buildReportKey_(today, reportType);
      if (hasAlreadySent_(reportKey)) {
        Logger.log(label + 'はすでに送信済みです（key: ' + reportKey + '）。再送信しません。');
        return;
      }

      var body =
        reportType === REPORT_TYPE_DAY ? generateDayReport_(today) : generateNightReport_(today);
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
  return testDayReportForDate_(Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd'));
}

/**
 * 当日の夜の日報本文をログへ出力する（投稿はしない）。
 */
function testNightReport() {
  return testNightReportForDate_(Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd'));
}

/**
 * 夜の日報が、シートとカレンダーのどちらから何を取っているかをログへ出す。
 *
 * 「業務報告より下が変わらない」とき、原因は 3 つありうる。
 *   1. 貼り替えたコードがデプロイされていない
 *   2. 前に作った下書きが表示されているだけ（作り直していない）
 *   3. シートの節の見出しを見つけられず、全部を上半分として読んでいる
 *
 * 3 だけはログを見ないと分からないので、切れ目がどこだったかを出す。
 * 投稿もシートへの書き出しもしない。
 */
function showNightSources() {
  assertTimeZone_();
  var today = businessToday_();
  var lines = readNightReportLines_();

  var cut = -1;
  for (var i = 0; i < lines.length; i++) {
    if (isSectionMarker_(lines[i])) { cut = i; break; }
  }

  var report = [];
  report.push('----- シートから読んだ行（' + lines.length + ' 行）-----');
  for (var j = 0; j < lines.length; j++) {
    var mark = j === cut ? ' ← ここから下は読まない（節の見出し）' : '';
    report.push(String(j + 1) + ': ' + lines[j] + mark);
  }
  report.push('');
  report.push(
    cut < 0
      ? '節の見出しが見つかりませんでした。全部を進捗状況として扱い、' +
        'その下にカレンダーの業務報告・業務予定を足します。' +
        'シート側の見出しが「' + NIGHT_SECTION_NAMES.join('／') + '」のどれかになっているか確認してください。'
      : '節の見出しは ' + (cut + 1) + ' 行目です。'
  );
  var next = nextBusinessDay_(today);
  report.push('');
  report.push('----- AM と PM の境目 -----');
  report.push(
    formatAmPmBoundary_() + ' から PM（この時刻より前に始まる予定が AM）' +
      (getProperty_(PROP_AM_PM_BOUNDARY) === null
        ? '　※ 既定値。変えるときは Script Properties に ' + PROP_AM_PM_BOUNDARY + ' を足す'
        : '　※ Script Properties の ' + PROP_AM_PM_BOUNDARY + ' で設定されています')
  );

  report.push('');
  report.push('----- 当日（' + formatJapaneseDate_(today) + '）のカレンダー -----');
  report.push('※ 業務報告に出るのは、ここで「採用（PM）」になったものだけです');
  var todayLines = describeCalendarDay_(today);
  for (var k = 0; k < todayLines.length; k++) report.push(todayLines[k]);

  report.push('');
  report.push('----- 次の営業日（' + formatJapaneseDate_(next) + '）のカレンダー -----');
  report.push('※ 業務予定に出るのは、ここで「採用」になったものです');
  var nextLines = describeCalendarDay_(next);
  for (var m = 0; m < nextLines.length; m++) report.push(nextLines[m]);

  report.push('');
  report.push('----- 次の営業日（' + formatJapaneseDate_(next) + '）の Google ToDo -----');
  report.push('※ 業務予定の AM 側に、ここで「採用」になったものが並びます');
  var taskLines = describeTasksForDate_(next);
  for (var t = 0; t < taskLines.length; t++) report.push(taskLines[t]);

  report.push('');
  report.push('----- 組み上がる本文 -----');
  report.push(generateNightReport_(today));

  var text = report.join('\n');
  Logger.log(text);
  return text;
}

/**
 * Google ToDo（タスク）を、日報に出るかどうかまで含めてログへ出す。
 *
 * 「タスクが日報に出ない」原因は、たいてい次のどれか。
 *   1. 拡張サービス「Tasks API」を足していない
 *   2. タスクに期限を付けていない（期限の無いタスクは日報に出ない）
 *   3. 期限が別の日になっている
 *
 * どれなのかはログを見ないと分からないので、リストごとに 1 件ずつ出す。
 * 投稿もシートへの書き出しもしない。
 */
function showTasks() {
  assertTimeZone_();
  var today = businessToday_();
  var next = nextBusinessDay_(today);

  var report = [];
  report.push('----- 当日（' + formatJapaneseDate_(today) + '）の Google ToDo -----');
  report.push('※ 昼の日報の業務予定（PM）の末尾に、ここで「採用」になったものが並びます');
  var todayLines = describeTasksForDate_(today);
  for (var i = 0; i < todayLines.length; i++) report.push(todayLines[i]);

  report.push('');
  report.push('----- 次の営業日（' + formatJapaneseDate_(next) + '）の Google ToDo -----');
  report.push('※ 夜の日報の業務予定（AM）の末尾に、ここで「採用」になったものが並びます');
  var nextLines = describeTasksForDate_(next);
  for (var j = 0; j < nextLines.length; j++) report.push(nextLines[j]);

  var text = report.join('\n');
  Logger.log(text);
  return text;
}

/**
 * 今日の予定をログへ出力する（投稿もシートへの書き出しもしない）。
 *
 * HOME の Schedule 欄に渡している中身を、そのまま目で確かめるためのもの。
 * ウェブアプリ経由でしか使わない口なので、これが無いと動作を確認できない。
 */
function testTodayEvents() {
  assertTimeZone_();
  var today = businessToday_();
  var events = getDayEventsForApi_(today);

  if (events.length === 0) {
    Logger.log(formatJapaneseDate_(today) + ' の予定はありません。');
    return events;
  }

  var lines = [];
  for (var i = 0; i < events.length; i++) {
    lines.push(
      events[i].start.substring(11, 16) + '-' + events[i].end.substring(11, 16) +
        '  ' + events[i].title
    );
  }
  Logger.log(
    '----- ' + formatJapaneseDate_(today) + ' の予定（' + events.length + '件） -----\n' + lines.join('\n')
  );
  return events;
}

/**
 * 日付（yyyy-MM-dd）を指定して昼の日報本文をログへ出力する（投稿はしない）。
 */
function testDayReportForDate_(dateText) {
  assertTimeZone_();
  var date = parseDate_(dateText);
  var body = generateDayReport_(date);
  Logger.log('----- 昼の日報 ' + formatJapaneseDate_(date) + ' -----\n' + body);
  return body;
}

/**
 * 日付（yyyy-MM-dd）を指定して夜の日報本文をログへ出力する（投稿はしない）。
 */
function testNightReportForDate_(dateText) {
  assertTimeZone_();
  var date = parseDate_(dateText);
  var body = generateNightReport_(date);
  Logger.log('----- 夜の日報 ' + formatJapaneseDate_(date) + ' -----\n' + body);
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
