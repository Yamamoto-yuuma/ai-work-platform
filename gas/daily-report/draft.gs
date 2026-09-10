/**
 * 下書きの保管。
 *
 * Chatwork API には下書きを作る機能がないため、日報の本文を Script Properties へ保管し、
 * 内容を確認してから手動で送信できるようにする。
 */

/** 下書きの保管キー。例: draft_20260911_day */
function buildDraftKey_(date, reportType) {
  return 'draft_' + formatDateKey_(date) + '_' + reportType;
}

/**
 * 下書きを保存する（同じ日・同じ種類の下書きは上書きする）。
 */
function saveDraft_(date, reportType, body) {
  var record = { createdAt: Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd HH:mm'), body: body };
  PropertiesService.getScriptProperties().setProperty(
    buildDraftKey_(date, reportType),
    JSON.stringify(record)
  );
}

/**
 * 保存済みの下書きを取り出す。無ければ null。
 * @return {?{createdAt: string, body: string}}
 */
function loadDraft_(date, reportType) {
  var raw = PropertiesService.getScriptProperties().getProperty(buildDraftKey_(date, reportType));
  if (!raw) return null;

  var record;
  try {
    record = JSON.parse(raw);
  } catch (e) {
    throw new Error('下書きを読み取れませんでした（key: ' + buildDraftKey_(date, reportType) + '）: ' + e);
  }
  if (!record || typeof record.body !== 'string') {
    throw new Error('下書きの形式が正しくありません（key: ' + buildDraftKey_(date, reportType) + '）。');
  }
  return record;
}

/**
 * 下書きを削除する（送信済みになった下書きを残さないため）。
 */
function deleteDraft_(date, reportType) {
  PropertiesService.getScriptProperties().deleteProperty(buildDraftKey_(date, reportType));
}

/**
 * 当日の下書きを取り出す。まだ作られていなければ、その場で作って保存する。
 */
function prepareDraft_(reportType) {
  assertTimeZone_();
  var today = toJstStartOfDay_(new Date());

  var existing = loadDraft_(today, reportType);
  if (existing !== null) return { date: today, record: existing, created: false };

  var body = reportType === REPORT_TYPE_DAY ? generateDayReport(today) : generateNightReport(today);
  saveDraft_(today, reportType, body);
  return { date: today, record: loadDraft_(today, reportType), created: true };
}

/**
 * 下書きをログへ表示する（送信はしない）。
 */
function showDraft_(reportType) {
  var label = reportType === REPORT_TYPE_DAY ? '昼の日報' : '夜の日報';
  var draft = prepareDraft_(reportType);
  var reportKey = buildReportKey(draft.date, reportType);

  var header =
    '----- ' + label + 'の下書き（' + formatJapaneseDate(draft.date) + '） -----\n' +
    '作成: ' + draft.record.createdAt + (draft.created ? '（いま作成しました）' : '') + '\n' +
    (hasAlreadySent(reportKey) ? '※ この日報は送信済みです。\n' : '') +
    '------------------------------------------';

  Logger.log(header + '\n' + draft.record.body + '\n------------------------------------------');
  return draft.record.body;
}

/**
 * 下書きを Chatwork へ送信する。
 * 送信済みの場合は再送信しない（手動実行でも二重投稿を防ぐ）。
 *
 * @return {boolean} 送信したかどうか
 */
function sendDraft_(reportType) {
  var label = reportType === REPORT_TYPE_DAY ? '昼の日報' : '夜の日報';
  assertTimeZone_();
  var today = toJstStartOfDay_(new Date());

  var sent = false;
  var executed = runExclusively_(function () {
    var reportKey = buildReportKey(today, reportType);
    if (hasAlreadySent(reportKey)) {
      Logger.log(label + 'はすでに送信済みです（key: ' + reportKey + '）。再送信しません。');
      return;
    }

    var draft = loadDraft_(today, reportType);
    if (draft === null) {
      throw new Error(
        label + 'の下書きがありません。先に show' +
          (reportType === REPORT_TYPE_DAY ? 'Day' : 'Night') + 'Draft() で下書きを作ってください。'
      );
    }

    var messageId = sendToChatwork(draft.body);
    markAsSent(reportKey);
    deleteDraft_(today, reportType);
    sent = true;
    Logger.log(label + 'を投稿しました（key: ' + reportKey + ' / message_id: ' + messageId + '）。');
  });

  if (!executed) {
    Logger.log(label + 'の送信をロック未取得のため中止しました。少し待って再実行してください。');
  }
  return sent;
}
