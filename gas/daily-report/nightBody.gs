/**
 * 夜の日報のうち、スプレッドシートから取る部分。
 *
 * 夜の日報は 2 つの出どころが混ざる。
 *
 *   上半分（日付・挨拶・進捗状況） … 「日報」タブをそのまま
 *   下半分（業務報告・業務予定・所感） … カレンダーの予定から（report.gs）
 *
 * 上半分をシートに任せるのは、数字がシートの数式の結果だから。
 * 売上も進捗率もこちらで計算し直すと、シートの式を直した日に日報だけ古い数字が残る。
 * 書式（「69.4万円」など）もシート側の設定で付いている。
 *
 * 下半分をカレンダーから作るのは、予定をシートへ書き写す手作業を毎日残さないため。
 *
 * 切れ目は「---業務報告---」のような節の見出しで判断する。行番号で決めると、
 * シートに 1 行足した日にずれる。見出しが無いシートなら、全部が上半分になる。
 *
 * 昼の日報はこの仕組みを使わない。今までどおり全部をカレンダーの予定から組み立てる。
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
 * 節の名前。この行から下はカレンダーで作り直すので、シートからは読まない。
 */
var NIGHT_SECTION_NAMES = ['業務報告', '業務予定', '所感'];

/**
 * 節の見出しの行かどうか。
 *
 * 「---業務報告---」を想定しているが、シートの書き方は人が決めるので、
 * 飾りの付け方まで決め打ちにしない。前後の飾り（ダッシュ・罫線・かっこ・■・空白）を
 * 落としたうえで、節の名前そのものと一致するかだけを見る。
 *
 *   ---業務報告---  ／  【業務報告】  ／  ■業務報告  ／  業務報告
 *
 * 逆に「ダッシュで囲まれた行」を広く拾うことはしない。
 * 進捗状況の中に区切り線があると、そこで切れて日報が途中までになる。
 * 「＜進捗状況＞」も、飾りを落とすと「進捗状況」で名前に無いため残る。
 */
function isSectionMarker_(line) {
  var text = String(line === null || line === undefined ? '' : line).trim();
  if (text === '') return false;

  var core = text
    .replace(/^[-‐-―ー─-╿=＝【［\[＜<「■◆●○\s]+/, '')
    .replace(/[-‐-―ー─-╿=＝】］\]＞>」\s]+$/, '');

  for (var i = 0; i < NIGHT_SECTION_NAMES.length; i++) {
    if (core === NIGHT_SECTION_NAMES[i]) return true;
  }
  return false;
}

/**
 * シートから読んだ行のうち、最初の節の見出しより前だけを返す。
 *
 * つまり、日付・挨拶・進捗状況まで。見出しが無ければ全部を返す
 * （まだ節を分けていないシートでも、今までどおり全文が本文になる）。
 */
function takeProgressLines_(lines) {
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    if (isSectionMarker_(lines[i])) break;
    out.push(lines[i]);
  }
  // 見出しの直前に空行が残ると、下でもう 1 行空けたときに間が開きすぎる
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

/**
 * 夜の日報の上半分を、スプレッドシートから読む。
 *
 * 読めなければエラーにする。空の日報や、途中までの日報を下書きとして残すと、
 * それに気づかないまま送ってしまう。作らないほうが安全。
 *
 * @return {Array.<string>} 日付・挨拶・進捗状況までの行
 */
function readNightProgressLines_() {
  return takeProgressLines_(readNightReportLines_());
}

/**
 * 指定した範囲を、行の配列として読む。
 *
 * @return {Array.<string>}
 */
function readNightReportLines_() {
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
  return lines;
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
 *
 * 「#REF!」などの数式のエラー表示だけは、行ごと飛ばす。
 * 計算が壊れている印であって、相手に読ませる文ではない。範囲の途中に混じっていても、
 * そこだけ避けて読めるようにする（空行にすると、日報の中に不自然な隙間が残る）。
 */
function toReportLines_(rows) {
  var lines = [];
  for (var r = 0; r < rows.length; r++) {
    var line = '';
    var hadError = false;
    for (var c = 0; c < rows[r].length; c++) {
      var cell = String(rows[r][c] === null || rows[r][c] === undefined ? '' : rows[r][c]);
      if (isSpreadsheetError_(cell)) {
        hadError = true;
        continue;
      }
      line += cell;
    }

    // 1 セルの中の改行は行を崩すため 1 行に畳む
    line = line.replace(/[\r\n\t]+/g, ' ').replace(/\s+$/, '');

    // エラーだけの行は、空行も残さずに飛ばす
    if (hadError && line === '') continue;

    lines.push(line);
    if (lines.length >= NIGHT_REPORT_MAX_LINES) break;
  }

  // 範囲を広めに取っていても日報が伸びないよう、末尾の空行だけ落とす
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * スプレッドシートの数式のエラー表示かどうか。
 * これらは計算が壊れている印で、日報の文ではない。
 */
function isSpreadsheetError_(text) {
  return /^#(REF!|N\/A|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!|ERROR!|GETTING_DATA)$/.test(String(text).trim());
}
