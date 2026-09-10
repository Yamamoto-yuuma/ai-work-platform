/**
 * スプレッドシートへの下書きの書き出しと読み取り。
 *
 * 日報の下書きを「日報」シートへ 1 行ずつ残す。新しいものが上に来る。
 * 本文のセルはそのまま書き換えられるので、所感を書き足してから送信できる。
 * 送信するときは、シートに書かれている本文（＝編集後の内容）を使う。
 */

var DRAFT_SHEET_NAME = '日報';

var SHEET_COL_DATE = 1;
var SHEET_COL_TYPE = 2;
var SHEET_COL_STATUS = 3;
var SHEET_COL_BODY = 4;
var SHEET_COL_GENERATED = 5;
var SHEET_COL_SENT = 6;

var SHEET_HEADERS = ['日付', '種別', '状態', '日報本文', '生成日時', '送信日時'];
var SHEET_STATUS_DRAFT = '未送信';
var SHEET_STATUS_SENT = '送信済み';

/** 種別の表示名。 */
function sheetTypeLabel_(reportType) {
  return reportType === REPORT_TYPE_DAY ? '昼' : '夜';
}

/**
 * このスクリプトが紐づいているスプレッドシート。
 */
function getSpreadsheet_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error(
      'スプレッドシートが見つかりません。日報シートの［拡張機能］→［Apps Script］から作った' +
        'プロジェクトでこのコードを動かしてください。'
    );
  }
  return spreadsheet;
}

/**
 * 「日報」シート。無ければ見出し付きで作る。
 */
function getDraftSheet_() {
  var spreadsheet = getSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(DRAFT_SHEET_NAME);
  if (sheet !== null) return sheet;
  return createDraftSheet_(spreadsheet);
}

/** 「日報」シートを作る。 */
function createDraftSheet_(spreadsheet) {
  var sheet = spreadsheet.insertSheet(DRAFT_SHEET_NAME);

  var header = sheet.getRange(1, 1, 1, SHEET_HEADERS.length);
  header.setValues([SHEET_HEADERS]);
  header.setFontWeight('bold');
  header.setBackground('#e9edee');
  sheet.setFrozenRows(1);

  // 日付や日時をスプレッドシートが勝手に解釈しないよう、文字列として扱う。
  sheet.getRange(1, SHEET_COL_DATE, sheet.getMaxRows(), 1).setNumberFormat('@');
  sheet.getRange(1, SHEET_COL_GENERATED, sheet.getMaxRows(), 2).setNumberFormat('@');

  sheet.setColumnWidth(SHEET_COL_DATE, 100);
  sheet.setColumnWidth(SHEET_COL_TYPE, 50);
  sheet.setColumnWidth(SHEET_COL_STATUS, 80);
  sheet.setColumnWidth(SHEET_COL_BODY, 460);
  sheet.setColumnWidth(SHEET_COL_GENERATED, 150);
  sheet.setColumnWidth(SHEET_COL_SENT, 150);

  Logger.log('「' + DRAFT_SHEET_NAME + '」シートを作成しました。');
  return sheet;
}

/**
 * セルの値を 'yyyy-MM-dd' の文字列にそろえる。
 * スプレッドシートが日付として解釈していた場合も同じ形にする。
 */
function toReportDateText_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, TIME_ZONE, 'yyyy-MM-dd');
  return String(value === null || value === undefined ? '' : value).trim();
}

/**
 * 同じ日・同じ種別の行を探す。無ければ 0。
 */
function findDraftRow_(sheet, reportDate, reportType) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var values = sheet.getRange(2, SHEET_COL_DATE, lastRow - 1, 2).getValues();
  var label = sheetTypeLabel_(reportType);
  for (var i = 0; i < values.length; i++) {
    if (toReportDateText_(values[i][0]) === reportDate && String(values[i][1]).trim() === label) {
      return i + 2;
    }
  }
  return 0;
}

/**
 * 下書きをシートへ書き出す。
 *
 * 同じ日・同じ種別の行があれば、未送信のうちは最新の内容で上書きする。
 * 送信済みの行には手を触れない。
 */
function saveDraftToSheet_(date, reportType, body, generatedAt) {
  var sheet = getDraftSheet_();
  var reportDate = Utilities.formatDate(date, TIME_ZONE, 'yyyy-MM-dd');
  var row = findDraftRow_(sheet, reportDate, reportType);

  if (row === 0) {
    sheet.insertRowAfter(1);
    row = 2;
    writeDraftRow_(sheet, row, [
      reportDate,
      sheetTypeLabel_(reportType),
      SHEET_STATUS_DRAFT,
      body,
      generatedAt,
      '',
    ]);
    return row;
  }

  var status = String(sheet.getRange(row, SHEET_COL_STATUS).getValue()).trim();
  if (status === SHEET_STATUS_SENT) {
    Logger.log(reportDate + ' の' + sheetTypeLabel_(reportType) + 'の日報は送信済みのため、シートは書き換えません。');
    return row;
  }

  sheet.getRange(row, SHEET_COL_BODY).setValue(body);
  sheet.getRange(row, SHEET_COL_GENERATED).setValue(generatedAt);
  return row;
}

/** 1 行分を書き込む。 */
function writeDraftRow_(sheet, row, values) {
  sheet.getRange(row, 1, 1, values.length).setValues([values]);
  sheet.getRange(row, SHEET_COL_BODY).setWrap(true);
  sheet.getRange(row, SHEET_COL_DATE, 1, 1).setNumberFormat('@');
  sheet.getRange(row, SHEET_COL_GENERATED, 1, 2).setNumberFormat('@');
}

/**
 * シートに書かれている本文を取り出す（編集後の内容を尊重するため）。
 * 行が無ければ null。
 */
function readDraftBodyFromSheet_(date, reportType) {
  var sheet = getDraftSheet_();
  var reportDate = Utilities.formatDate(date, TIME_ZONE, 'yyyy-MM-dd');
  var row = findDraftRow_(sheet, reportDate, reportType);
  if (row === 0) return null;

  var body = String(sheet.getRange(row, SHEET_COL_BODY).getValue());
  return body.trim() === '' ? null : body;
}

/**
 * シートの行を送信済みにする。
 */
function markSheetSent_(date, reportType, sentAt) {
  var sheet = getDraftSheet_();
  var reportDate = Utilities.formatDate(date, TIME_ZONE, 'yyyy-MM-dd');
  var row = findDraftRow_(sheet, reportDate, reportType);
  if (row === 0) return;

  var statusCell = sheet.getRange(row, SHEET_COL_STATUS);
  statusCell.setValue(SHEET_STATUS_SENT);
  statusCell.setBackground('#dceae6');
  sheet.getRange(row, SHEET_COL_SENT).setValue(sentAt);
}
