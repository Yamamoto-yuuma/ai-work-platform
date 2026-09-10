/**
 * テスト。Apps Script エディタから `runAllTests` を実行する。
 * Chatwork へは一切送信しない。
 *
 * 本文生成のテストはカレンダーを使わず、タイトル配列を直接与えて検証する。
 * 営業日判定のテストは実際の祝日カレンダーを参照する。
 */

function runAllTests() {
  assertTimeZone_();

  var results = [];
  var tests = [
    ['Test 1: 平日・昼の日報', test1_DayReport_],
    ['Test 2: 平日・夜の日報', test2_NightReport_],
    ['Test 3: 金曜日の夜（次営業日は月曜）', test3_FridayNextBusinessDay_],
    ['Test 4: 祝日前（祝日を飛ばす）', test4_BeforeHolidayNextBusinessDay_],
    ['Test 5: 土曜日は投稿しない', test5_Saturday_],
    ['Test 6: 日曜日は投稿しない', test6_Sunday_],
    ['Test 7: 祝日は投稿しない', test7_Holiday_],
    ['Test 8: 二重実行でも再送信しない', test8_DuplicatePrevention_],
    ['Test 9: 「■」を二重に付けない', test9_SquareMarkNotDuplicated_],
    ['Test 10: 予定が無くても見出しは残す', test10_EmptyHalfKeepsHeading_],
  ];

  var failed = 0;
  for (var i = 0; i < tests.length; i++) {
    try {
      tests[i][1]();
      results.push('OK   ' + tests[i][0]);
    } catch (e) {
      failed++;
      results.push('FAIL ' + tests[i][0] + '\n       ' + e);
    }
  }

  var summary = results.join('\n') + '\n----- ' + (tests.length - failed) + ' / ' + tests.length + ' 件成功 -----';
  Logger.log(summary);
  if (failed > 0) throw new Error(failed + ' 件のテストが失敗しました。ログを確認してください。');
  return summary;
}

/* ------------------------------------------------------------------ *
 * 個別テスト
 * ------------------------------------------------------------------ */

function test1_DayReport_() {
  var actual = buildDayReportBody(['朝礼', '架電'], ['昼礼', '計上作業']);
  var expected = [
    '【昼用】',
    '---業務報告---',
    'AM',
    '■朝礼',
    '■架電',
    ' ',
    '---業務予定---',
    'PM',
    '■昼礼',
    '■計上作業',
  ].join('\n');
  assertEquals_(expected, actual, '昼の日報本文');
}

function test2_NightReport_() {
  var actual = buildNightReportBody(
    parseDate('2026-09-11'),
    ['昼礼', '計上作業'],
    ['朝礼', '運営MTG'],
    ['昼礼', '架電']
  );
  var expected = [
    '【夜用】',
    'お疲れ様です。' + SENDER_NAME + 'です。',
    '2026年9月11日(金)の日報をお送りいたします。',
    '---業務報告---',
    'PM',
    '■昼礼',
    '■計上作業',
    '---業務予定---',
    'AM',
    '■朝礼',
    '■運営MTG',
    'PM',
    '■昼礼',
    '■架電',
    '---所感---',
  ].join('\n');
  assertEquals_(expected, actual, '夜の日報本文');
}

function test3_FridayNextBusinessDay_() {
  // 2026-09-11 は金曜日。土日を飛ばして 2026-09-14（月）が次営業日。
  var friday = parseDate('2026-09-11');
  assertEquals_(5, getJstDayOfWeek_(friday), '起点が金曜日であること');
  assertNextBusinessDayIsValid_(friday);
  assertEquals_('20260914', formatDateKey_(getNextBusinessDay(friday)), '金曜日の次営業日');
}

function test4_BeforeHolidayNextBusinessDay_() {
  // 2026-01-01（元日・木曜）を含む週。2025-12-31（水）の次営業日は元日を飛ばす。
  var beforeHoliday = parseDate('2025-12-31');
  assertTrue_(isHoliday_(parseDate('2026-01-01')), '2026-01-01 が祝日として取得できること');
  assertNextBusinessDayIsValid_(beforeHoliday);
  assertTrue_(
    formatDateKey_(getNextBusinessDay(beforeHoliday)) !== '20260101',
    '祝日が次営業日として選ばれないこと'
  );
}

function test5_Saturday_() {
  var saturday = parseDate('2026-09-12');
  assertEquals_(6, getJstDayOfWeek_(saturday), '土曜日であること');
  assertTrue_(!isBusinessDay(saturday), '土曜日は営業日ではない');
  assertEquals_('土曜日', describeNonBusinessDay_(saturday), '土曜日のスキップ理由');
}

function test6_Sunday_() {
  var sunday = parseDate('2026-09-13');
  assertEquals_(0, getJstDayOfWeek_(sunday), '日曜日であること');
  assertTrue_(!isBusinessDay(sunday), '日曜日は営業日ではない');
  assertEquals_('日曜日', describeNonBusinessDay_(sunday), '日曜日のスキップ理由');
}

function test7_Holiday_() {
  var holiday = parseDate('2026-01-01'); // 元日（木曜）
  assertEquals_(4, getJstDayOfWeek_(holiday), '平日（木曜）であること');
  assertTrue_(!isBusinessDay(holiday), '祝日は営業日ではない');
  assertEquals_('祝日', describeNonBusinessDay_(holiday), '祝日のスキップ理由');
}

function test8_DuplicatePrevention_() {
  var key = buildReportKey(parseDate('2099-01-05'), REPORT_TYPE_DAY);
  assertEquals_('20990105_day', key, '送信済み管理キーの形式');
  try {
    PropertiesService.getScriptProperties().deleteProperty(key);
    assertTrue_(!hasAlreadySent(key), '初回は未送信');
    markAsSent(key);
    assertTrue_(hasAlreadySent(key), '記録後は送信済み');
    markAsSent(key);
    assertTrue_(hasAlreadySent(key), '複数回記録しても送信済みのまま');
  } finally {
    PropertiesService.getScriptProperties().deleteProperty(key);
  }
}

function test9_SquareMarkNotDuplicated_() {
  assertEquals_('■架電', formatTitleLine_('架電'), '「■」を付ける');
  assertEquals_('■架電', formatTitleLine_('■架電'), '「■」を二重に付けない');
  assertEquals_('■架電', formatTitleLine_('  ■ 架電  '), '前後の空白と「■」を整える');
  assertEquals_(null, formatTitleLine_('   '), '空のタイトルは行にしない');
}

function test10_EmptyHalfKeepsHeading_() {
  var actual = buildDayReportBody([], ['昼礼']);
  var expected = ['【昼用】', '---業務報告---', 'AM', ' ', '---業務予定---', 'PM', '■昼礼'].join('\n');
  assertEquals_(expected, actual, '予定が無い時間帯でも見出しを残す');
}

/* ------------------------------------------------------------------ *
 * アサーション
 * ------------------------------------------------------------------ */

/**
 * 次営業日が「起点より後の最初の営業日」であることを確認する
 * （間の日がすべて土日祝であることを実際のカレンダーで検証する）。
 */
function assertNextBusinessDayIsValid_(date) {
  var next = getNextBusinessDay(date);
  assertTrue_(next.getTime() > date.getTime(), '次営業日は起点より後');
  assertTrue_(isBusinessDay(next), '次営業日は営業日: ' + formatDateKey_(next));

  for (var offset = 1; ; offset++) {
    var skipped = addDays_(date, offset);
    if (formatDateKey_(skipped) === formatDateKey_(next)) break;
    assertTrue_(
      !isBusinessDay(skipped),
      '飛ばした日は営業日ではない: ' + formatDateKey_(skipped)
    );
  }
}

function assertEquals_(expected, actual, label) {
  if (expected !== actual) {
    throw new Error(
      label + ' が一致しません。\n--- 期待値 ---\n' + expected + '\n--- 実際 ---\n' + actual + '\n---'
    );
  }
}

function assertTrue_(condition, label) {
  if (!condition) throw new Error(label + ' を満たしませんでした。');
}
