/**
 * 売上管理表からの進捗状況の読み取り。
 *
 * 夜の日報に貼る「＜進捗状況＞」の数行を、売上管理表から取ってくる。
 *
 * ここでは金額も進捗率もオンスケも計算しない。すべてシートの数式が出した値を、
 * 表示されているとおりに読むだけにする。こちらで計算し直すと、シートの式を直した日に
 * 日報だけ古い計算のまま残り、二つの数字が食い違う。どちらが正しいか分からなくなる。
 *
 * 読むのは日報とは別のスプレッドシートなので、ID を Script Properties から受け取る。
 */

/** Script Properties のキー名。 */
var PROP_SALES_SPREADSHEET_ID = 'SALES_SPREADSHEET_ID';
var PROP_SALES_SHEET_NAME = 'SALES_SHEET_NAME';
var PROP_SALES_RANGE = 'SALES_RANGE';

/**
 * 読み込む行数の上限。
 * 範囲を広く指定しすぎたときに、日報が延々と長くなるのを防ぐ。
 */
var SALES_MAX_LINES = 30;

/**
 * 売上管理表を読めなかったときに、日報へ残す行。
 *
 * 黙って省くと、進捗状況の無い日報をそのまま送ってしまう。
 * 目に入る形で残しておき、手で貼るか、設定を直すかを選べるようにする。
 */
var SALES_READ_FAILED_LINE = '＜進捗状況＞（売上管理表を読み取れませんでした。手で貼り付けてください）';

/**
 * 夜の日報に入れる進捗状況の行。
 *
 * @return {?Array.<string>} 設定していなければ null。読めなければ案内の 1 行。
 */
function getSalesProgressLines_() {
  if (getProperty_(PROP_SALES_SPREADSHEET_ID) === null) return null;

  try {
    return readSalesProgressLines_();
  } catch (e) {
    Logger.log('売上管理表を読み取れませんでした: ' + e);
    return [SALES_READ_FAILED_LINE];
  }
}

/**
 * 売上管理表の指定範囲を、表示されているとおりに読む。
 *
 * @return {Array.<string>} 空の行を除いた文字列の配列
 */
function readSalesProgressLines_() {
  var spreadsheetId = getRequiredProperty_(PROP_SALES_SPREADSHEET_ID);
  var sheetName = getRequiredProperty_(PROP_SALES_SHEET_NAME);
  var rangeText = getRequiredProperty_(PROP_SALES_RANGE);

  if (!/^[A-Za-z]+[0-9]+(:[A-Za-z]+[0-9]+)?$/.test(rangeText)) {
    throw new Error(
      'Script Properties の「' + PROP_SALES_RANGE + '」は A1:A6 のような形式で指定してください: ' + rangeText
    );
  }

  var spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  } catch (e) {
    throw new Error(
      '売上管理表を開けません。「' + PROP_SALES_SPREADSHEET_ID + '」の ID と、' +
        'このスクリプトを実行するアカウントに閲覧権限があるかを確認してください: ' + e
    );
  }

  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(
      '売上管理表に「' + sheetName + '」というシートがありません。' +
        'Script Properties の「' + PROP_SALES_SHEET_NAME + '」を確認してください。'
    );
  }

  // 数式の計算結果ではなく、画面に出ている文字をそのまま取る。
  // 「69.4万円」のような書式は、シート側の設定で付いている。
  var rows = sheet.getRange(rangeText).getDisplayValues();
  return toProgressLines_(rows);
}

/**
 * セルの表になったものを、日報へ貼る行に直す。
 *
 * 1 行の中は、左のセルから順につなげて 1 行にする。間に何も入れない。
 * シートは B 列と C 列で 1 つの文をつないで書いているため（「2026年9月12日(土)」＋
 * 「の日報をお送りいたします。」）、ここで空白を足すと文が割れる。
 * セルとセルの間を空けたいときは、シート側でセルの中に空白を入れる。
 *
 * 全角スペースで桁を揃えている行があるので、行の中の空白は詰めない。
 * 落とすのは行末の空白と、空の行だけ。
 */
function toProgressLines_(rows) {
  var lines = [];
  for (var r = 0; r < rows.length; r++) {
    var line = '';
    for (var c = 0; c < rows[r].length; c++) {
      var cell = rows[r][c];
      line += String(cell === null || cell === undefined ? '' : cell);
    }

    // 予定名と同じ理由で、1 セルの中の改行は行を崩すため 1 行に畳む
    line = line.replace(/[\r\n\t]+/g, ' ').replace(/\s+$/, '');
    if (line === '') continue; // 空の行は飛ばす（範囲を広めに取っていても伸びない）

    lines.push(line);
    if (lines.length >= SALES_MAX_LINES) break;
  }
  return lines;
}
