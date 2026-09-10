/**
 * 下書きの保管。
 *
 * 自動実行では日報を作って、ここに下書きとして残すところまでを行う。
 * Chatwork の本番ルームへ送るのは、手動で sendDayDraft() / sendNightDraft() を
 * 実行したときだけ（「日報を作る」と「Chatwork へ送る」を分けている）。
 *
 * 将来 AI 業務プラットフォームから読み出せるよう、下書きは次の形で保管する。
 *   {
 *     reportDate:  "2026-09-11",   // 日報の日付（日本時間）
 *     reportType:  "day" | "night",
 *     body:        "【昼用】…",     // 日報本文
 *     status:      "draft" | "sent",
 *     generatedAt: "2026-09-11T12:55:00+09:00",
 *     sentAt:      "2026-09-11T13:02:00+09:00"  // 送信済みのときだけ入る
 *   }
 */

var DRAFT_STATUS_DRAFT = 'draft';
var DRAFT_STATUS_SENT = 'sent';

/** 下書きの保管キー。例: draft_20260911_day */
function buildDraftKey_(date, reportType) {
  return 'draft_' + formatDateKey_(date) + '_' + reportType;
}

/** 保管する日時の文字列。例: 2026-09-11T12:55:00+09:00（日本時間で動くことは別途確認済み） */
function formatTimestamp_(date) {
  return Utilities.formatDate(date, TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ss") + '+09:00';
}

/**
 * 下書きを保存する。
 *
 * 中身が前回と同じなら、生成日時や状態を含めてそのまま残す。
 * 予定が変わって中身が変わった場合は、新しい下書きとして保存し直す。
 */
function saveDraft_(date, reportType, body) {
  var existing = null;
  try {
    existing = loadDraft_(date, reportType);
  } catch (e) {
    // 壊れている下書きは、そのまま上書きする。
    Logger.log('保存済みの下書きを読めなかったため作り直します: ' + e);
  }
  if (existing !== null && existing.body === body) return existing;

  var record = {
    reportDate: Utilities.formatDate(date, TIME_ZONE, 'yyyy-MM-dd'),
    reportType: reportType,
    body: body,
    status: DRAFT_STATUS_DRAFT,
    generatedAt: formatTimestamp_(new Date()),
  };
  writeDraft_(date, reportType, record);
  return record;
}

/** 下書きを書き込む。 */
function writeDraft_(date, reportType, record) {
  PropertiesService.getScriptProperties().setProperty(
    buildDraftKey_(date, reportType),
    JSON.stringify(record)
  );
}

/**
 * 保存済みの下書きを取り出す。無ければ null。
 * @return {?{reportDate: string, reportType: string, body: string, status: string,
 *            generatedAt: string, sentAt: (string|undefined)}}
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
 * 下書きを「本番ルームへ送信済み」の状態にする。
 */
function markDraftSent_(date, reportType) {
  var record = loadDraft_(date, reportType);
  if (record === null) return;
  record.status = DRAFT_STATUS_SENT;
  record.sentAt = formatTimestamp_(new Date());
  writeDraft_(date, reportType, record);
}

/**
 * 下書きを削除する。
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
  return { date: today, record: saveDraft_(today, reportType, body), created: true };
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
    '生成: ' + draft.record.generatedAt + (draft.created ? '（いま作成しました）' : '') + '\n' +
    '状態: ' + draft.record.status +
    (hasAlreadySent(reportKey) ? '（本番ルームへ送信済みです）' : '（未送信）') + '\n' +
    '------------------------------------------';

  Logger.log(header + '\n' + draft.record.body + '\n------------------------------------------');
  return draft.record.body;
}

/**
 * 下書きを Chatwork の本番ルームへ送信する（手動実行のときだけ通る道）。
 * 送信済みの場合は再送信しない。
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
    markDraftSent_(today, reportType);
    sent = true;
    Logger.log(label + 'を本番ルームへ投稿しました（key: ' + reportKey + ' / message_id: ' + messageId + '）。');
  });

  if (!executed) {
    Logger.log(label + 'の送信をロック未取得のため中止しました。少し待って再実行してください。');
  }
  return sent;
}
