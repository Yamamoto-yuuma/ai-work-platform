/**
 * 夜の日報の本文の取得。
 *
 * 夜の日報は、スプレッドシートの「日報」タブに書かれているものがそのまま本文になる。
 * 挨拶も日付も進捗状況も業務報告も、すべてシート側で組み立てられている。
 *
 * ここでは文面を作らない。読むだけにする。
 * 同じ文面を GAS 側でも組み立てると、シートと二か所に同じ形が存在することになり、
 * 片方だけ直した日に食い違う。実際に、進捗状況を足したときに見出しが二重になった。
 *
 * 数字も同じ理由で計算しない。売上も進捗率もオンスケもシートの数式が出した値で、
 * こちらで計算し直すと、シートの式を直した日に日報だけ古い数字が残る。
 *
 * 昼の日報はこの仕組みを使わない。今までどおりカレンダーの予定から組み立てる。
 */

/** Script Properties のキー名。 */
var PROP_NIGHT_REPORT_SPREADSHEET_ID = 'NIGHT_REPORT_SPREADSHEET_ID';
var PROP_NIGHT_REPORT_SHEET_NAME = 'NIGHT_REPORT_SHEET_NAME';
var PROP_NIGHT_REPORT_RANGE = 'NIGHT_REPORT_RANGE';

/**
 * 読み込む行数の上限。
 * 範囲を広く指定しすぎたときに、日報が延々と長くなるのを防ぐ。
 */
var NIGHT_REPORT_MAX_LINES = 60;

/**
 * 夜の日報の本文を、スプレッドシートから読む。
 *
 * 読めなければエラーにする。空の日報や、途中までの日報を下書きとして残すと、
 * それに気づかないまま送ってしまう。作らないほうが安全。
 *
 * @return {string} 日報本文
 */
function readNightReportBody_() {
  var spreadsheetId = getRequiredProperty_(PROP_NIGHT_REPORT_SPREADSHEET_ID);
  var sheetName = getRequiredProperty_(PROP_NIGHT_REPORT_SHEET_NAME);
  var rangeText = getRequiredProperty_(PROP_NIGHT_REPORT_RANGE);

  if (!/^[A-Za-z]+[0-9]+(:[A-Za-z]+[0-9]+)?$/.test(rangeText)) {
    throw new Error(
      'Script Properties の「' + PROP_NIGHT_REPORT_RANGE + '」は B1:C30 のような形式で指定してください: ' + rangeText
    );
  }

  var spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  } catch (e) {
    throw new Error(
      '日報のスプレッドシートを開けません。「' + PROP_NIGHT_REPORT_SPREADSHEET_ID + '」の ID と、' +
        'このスクリプトを実行するアカウントに閲覧権限があるかを確認してください: ' + e
    );
  }

  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(
      'スプレッドシートに「' + sheetName + '」というシートがありません。' +
        'Script Properties の「' + PROP_NIGHT_REPORT_SHEET_NAME + '」を確認してください。'
    );
  }

  // 数式の計算結果ではなく、画面に出ている文字をそのまま取る。
  // 「69.4万円」のような書式は、シート側の設定で付いている。
  var lines = toReportLines_(sheet.getRange(rangeText).getDisplayValues());
  if (lines.length === 0) {
    throw new Error(
      'シート「' + sheetName + '」の ' + rangeText + ' が空です。' +
        'Script Properties の「' + PROP_NIGHT_REPORT_RANGE + '」で読む範囲を確認してください。'
    );
  }
  return lines.join('\n');
}

/**
 * セルの表になったものを、日報の行に直す。
 *
 * 1 行の中は、左のセルから順につなげて 1 行にする。間に何も入れない。
 * シートは B 列と C 列で 1 つの文をつないで書いているため（「2026年9月12日(土)」＋
 * 「の日報をお送りいたします。」）、ここで空白を足すと文が割れる。
 * セルとセルの間を空けたいときは、シート側でセルの中に空白を入れる。
 *
 * 全角スペースで桁を揃えている行があるので、行の中の空白は詰めない。
 * 落とすのは行末の空白と、末尾の空の行だけ。
 * 途中の空の行は残す（日報の中で段落を分けているため）。
 */
function toReportLines_(rows) {
  var lines = [];
  for (var r = 0; r < rows.length; r++) {
    var line = '';
    for (var c = 0; c < rows[r].length; c++) {
      var cell = rows[r][c];
      line += String(cell === null || cell === undefined ? '' : cell);
    }

    // 1 セルの中の改行は行を崩すため 1 行に畳む
    lines.push(line.replace(/[\r\n\t]+/g, ' ').replace(/\s+$/, ''));
    if (lines.length >= NIGHT_REPORT_MAX_LINES) break;
  }

  // 範囲を広めに取っていても日報が伸びないよう、末尾の空行だけ落とす
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
