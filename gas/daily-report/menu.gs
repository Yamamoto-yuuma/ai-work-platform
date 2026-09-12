/**
 * スプレッドシート上の操作。
 *
 * メニューと、シートに置いたボタンから呼ぶ関数をまとめる。
 * 送信は必ず確認ダイアログを挟む（押した瞬間に本番ルームへ流れないようにするため）。
 */

/**
 * スプレッドシートを開いたときに「日報」メニューを追加する。
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('日報')
    .addItem('昼の日報を作り直す', 'rebuildDayDraft')
    .addItem('夜の日報を作り直す', 'rebuildNightDraft')
    .addSeparator()
    .addItem('昼の日報を Chatwork へ送信', 'sendDayReportButton')
    .addItem('夜の日報を Chatwork へ送信', 'sendNightReportButton')
    .addToUi();
}

/** 昼の下書きを最新のカレンダーで作り直す（送信しない）。 */
function rebuildDayDraft() {
  rebuildDraft_(REPORT_TYPE_DAY);
}

/** 夜の下書きを最新のカレンダーで作り直す（送信しない）。 */
function rebuildNightDraft() {
  rebuildDraft_(REPORT_TYPE_NIGHT);
}

/** 昼の日報を Chatwork へ送信する（シートのボタン・メニュー用）。 */
function sendDayReportButton() {
  confirmAndSend_(REPORT_TYPE_DAY);
}

/** 夜の日報を Chatwork へ送信する（シートのボタン・メニュー用）。 */
function sendNightReportButton() {
  confirmAndSend_(REPORT_TYPE_NIGHT);
}

/* ------------------------------------------------------------------ *
 * 中身
 * ------------------------------------------------------------------ */

/** 画面の通知を出しておく秒数。読む時間はほしいが、作業の邪魔にはしない。 */
var NOTIFY_SECONDS = 8;

/** 画面が使えるなら UI を返す（トリガーからの実行では null）。 */
function getUiOrNull_() {
  try {
    return SpreadsheetApp.getUi();
  } catch (e) {
    return null;
  }
}

/** 画面が使えるならメッセージを出す。使えなければログへ。 */
function notify_(title, message) {
  // ログには必ず残す。画面の通知は見逃せるが、ログは後から追える。
  Logger.log(title + ': ' + message);

  // 知らせるだけの用件で ui.alert は使わない。
  // エディタの実行ボタンから動かしたとき、ダイアログはスプレッドシートの側に出る。
  // その画面を開いていないと、誰も押せない返事を待って「実行中」のまま止まる。
  // toast は返事を待たないので、どこから動かしても処理が終わる。
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(message, title, NOTIFY_SECONDS);
  } catch (e) {
    // スプレッドシートが無い場面（トリガーなど）。ログには残っているのでこのまま進む。
  }
}

/** 下書きを作り直してシートへ反映する。 */
function rebuildDraft_(reportType) {
  var label = reportType === REPORT_TYPE_DAY ? '昼の日報' : '夜の日報';
  try {
    assertTimeZone_();
    var today = businessToday_();

    if (hasAlreadySent_(buildReportKey_(today, reportType))) {
      notify_(label, '今日の' + label + 'はすでに送信済みです。下書きは作り直しません。');
      return;
    }

    var body =
      reportType === REPORT_TYPE_DAY ? generateDayReport_(today) : generateNightReport_();
    saveDraft_(today, reportType, body);
    notify_(label, '最新のカレンダーで下書きを作り直しました。シートの本文をご確認ください。');
  } catch (e) {
    Logger.log(label + 'の作り直しでエラーが発生しました: ' + e + (e && e.stack ? '\n' + e.stack : ''));
    notify_('エラー', label + 'を作り直せませんでした。\n\n' + e);
  }
}

/**
 * 内容を確認したうえで Chatwork の本番ルームへ送信する。
 */
function confirmAndSend_(reportType) {
  var label = reportType === REPORT_TYPE_DAY ? '昼の日報' : '夜の日報';

  try {
    assertTimeZone_();
    var today = businessToday_();

    if (hasAlreadySent_(buildReportKey_(today, reportType))) {
      notify_(label, '今日の' + label + 'はすでに送信済みです。二重に送らないよう、送信しませんでした。');
      return;
    }

    var nonBusinessDayReason = describeNonBusinessDay_(today);
    if (nonBusinessDayReason !== null) {
      Logger.log('今日は' + nonBusinessDayReason + 'ですが、手動送信のため処理を続けます。');
    }

    var body = loadDraftBody_(today, reportType);
    if (body === null) {
      notify_(label, '下書きがありません。先にメニューの［' + label + 'を作り直す］を実行してください。');
      return;
    }

    var ui = getUiOrNull_();
    if (ui !== null) {
      var answer = ui.alert(
        label + 'を Chatwork へ送信します',
        body + '\n\nこの内容で送信しますか？',
        ui.ButtonSet.YES_NO
      );
      if (answer !== ui.Button.YES) {
        Logger.log(label + 'の送信を取りやめました。');
        return;
      }
    }

    var sent = sendDraft_(reportType);
    if (sent) {
      notify_(label, 'Chatwork へ送信しました。シートの状態を「' + SHEET_STATUS_SENT + '」にしました。');
    } else {
      notify_(label, '送信しませんでした。実行ログで理由をご確認ください。');
    }
  } catch (e) {
    Logger.log(label + 'の送信でエラーが発生しました: ' + e + (e && e.stack ? '\n' + e.stack : ''));
    notify_('エラー', label + 'を送信できませんでした。\n\n' + e);
  }
}
