/**
 * スプレッドシートへの下書きの書き出しと読み取り。
 *
 * 日報の下書きを「日報」シートへ 1 行ずつ残す。新しいものが上に来る。
 * 本文のセルはそのまま書き換えられるので、所感を書き足してから送信できる。
 * 送信するときは、シートに書かれている本文（＝編集後の内容）を使う。
 */

/**
 * 下書きの記録を残すシートの名前。
 *
 * このスクリプトが付いているスプレッドシートに、同じ名前で別の用途のシートが
 * すでにあるときは、Script Property「DRAFT_SHEET_NAME」で別の名前にできる。
 */
var DEFAULT_DRAFT_SHEET_NAME = '日報';
var PROP_DRAFT_SHEET_NAME = 'DRAFT_SHEET_NAME';

/** 下書きの記録を残すシートの名前を返す。 */
function getDraftSheetName_() {
  var name = getProperty_(PROP_DRAFT_SHEET_NAME);
  return name === null ? DEFAULT_DRAFT_SHEET_NAME : name;
}

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
  var sheet = spreadsheet.getSheetByName(getDraftSheetName_());
  if (sheet === null) return createDraftSheet_(spreadsheet);
  assertDraftSheet_(sheet);
  return sheet;
}

/**
 * 同じ名前の、別の用途のシートに書き込まないようにする。
 *
 * 「日報」という名前のシートは珍しくない。日報の下書きを人が書いているシートに
 * このスクリプトが行を差し込むと、書いてあったものが下へずれ、A〜F 列が上書きされる。
 * 気づいたときには元に戻せない。見出しが違えば、書かずに止める。
 */
function assertDraftSheet_(sheet) {
  var header = sheet.getRange(1, 1, 1, SHEET_HEADERS.length).getValues()[0];
  for (var i = 0; i < SHEET_HEADERS.length; i++) {
    if (String(header[i] === null || header[i] === undefined ? '' : header[i]).trim() === SHEET_HEADERS[i]) {
      continue;
    }
    throw new Error(
      'シート「' + sheet.getName() + '」は下書きの記録用ではないため、書き込みを中止しました' +
        '（1 行目が「' + SHEET_HEADERS.join(' / ') + '」ではありません）。' +
        'このスクリプトを付けるスプレッドシートを間違えているか、同じ名前のシートが先にあります。' +
        '別の名前を使う場合は、Script Properties の「' + PROP_DRAFT_SHEET_NAME + '」に' +
        '記録用シートの名前（例: 日報下書き）を設定してください。'
    );
  }
}

/** 「日報」シートを作る。 */
function createDraftSheet_(spreadsheet) {
  var sheet = spreadsheet.insertSheet(getDraftSheetName_());

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

  Logger.log('「' + sheet.getName() + '」シートを作成しました。');
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
 * 1 行分の下書きを読み取る。無ければ null。
 * @return {?{reportDate: string, reportType: string, status: string, body: string,
 *            generatedAt: string, sentAt: string}}
 */
function readDraftRow_(date, reportType) {
  var sheet = getDraftSheet_();
  var reportDate = Utilities.formatDate(date, TIME_ZONE, 'yyyy-MM-dd');
  var row = findDraftRow_(sheet, reportDate, reportType);
  if (row === 0) return null;

  var values = sheet.getRange(row, 1, 1, SHEET_HEADERS.length).getValues()[0];
  return {
    reportDate: toReportDateText_(values[SHEET_COL_DATE - 1]),
    reportType: reportType,
    status: String(values[SHEET_COL_STATUS - 1]).trim(),
    body: String(values[SHEET_COL_BODY - 1]),
    generatedAt: String(values[SHEET_COL_GENERATED - 1]),
    sentAt: String(values[SHEET_COL_SENT - 1]),
  };
}

/**
 * 本文だけを書き換える（人が手を入れたとき）。
 * 生成日時は触らない。送信済みの行は書き換えない。
 */
function updateDraftBodyInSheet_(date, reportType, body) {
  if (String(body === null || body === undefined ? '' : body).trim() === '') {
    throw new Error('日報の本文が空です。');
  }

  var sheet = getDraftSheet_();
  var reportDate = Utilities.formatDate(date, TIME_ZONE, 'yyyy-MM-dd');
  var row = findDraftRow_(sheet, reportDate, reportType);
  if (row === 0) {
    throw new Error(reportDate + ' の下書きがありません。先に作り直してください。');
  }

  var status = String(sheet.getRange(row, SHEET_COL_STATUS).getValue()).trim();
  if (status === SHEET_STATUS_SENT) {
    throw new Error('この日報はすでに送信済みのため、書き換えられません。');
  }

  sheet.getRange(row, SHEET_COL_BODY).setValue(body);
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
