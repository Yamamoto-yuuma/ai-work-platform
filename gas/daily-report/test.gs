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
    ['Test 2: 進捗状況までをシートから読む', test2_NightReportFromSheet_],
    ['Test 3: 夜の日報の下半分をカレンダーから組み立てる', test3_NightBodyIsAssembled_],
    ['Test 4: 読めない・空のときは下書きを作らない', test4_NightReportFailsLoudly_],
    ['Test 5: 土曜日は投稿しない', test5_Saturday_],
    ['Test 6: 日曜日は投稿しない', test6_Sunday_],
    ['Test 7: 祝日は投稿しない', test7_Holiday_],
    ['Test 8: 二重実行でも再送信しない', test8_DuplicatePrevention_],
    ['Test 9: 「■」を二重に付けない', test9_SquareMarkNotDuplicated_],
    ['Test 10: 予定が無くても見出しは残す', test10_EmptyHalfKeepsHeading_],
    ['Test 11: 祝日カレンダーの行事を休業日にしない', test11_ObservanceIsNotHoliday_],
    ['Test 12: 節分・七夕は営業日（実カレンダー）', test12_ObservanceDayIsBusinessDay_],
    ['Test 13: 自動実行は Chatwork へ送信しない', test13_AutoRunNeverSends_],
    ['Test 14: 下書きの保存・取り出し・削除', test14_DraftStore_],
    ['Test 15: 送信済みの下書きは再送信しない', test15_SentDraftIsNotResent_],
    ['Test 16: 下書き用ルームの仕組みが残っていない', test16_DraftRoomFeatureRemoved_],
    ['Test 17: 実行メニューに出るのは入口の関数だけであること', test17_OnlyEntryPointsArePublic_],
    ['Test 18: 下書きがシートに書き出される', test18_DraftIsWrittenToSheet_],
    ['Test 19: シートで書き足した本文が送信に使われる', test19_EditedSheetBodyWins_],
    ['Test 20: 合言葉が合わないと API を通さない', test20_ApiRequiresSecret_],
    ['Test 21: 予定名の改行で行が崩れない', test21_TitleWithNewline_],
    ['Test 22: 日付が変わっても前日の日報を扱える', test22_BusinessDayAcrossMidnight_],
    ['Test 23: B 列と C 列を空白なしでつなぐ', test23_ColumnsAreJoinedWithoutGap_],
    ['Test 24: シートの数字を計算し直さない', test24_SheetValuesAreNotRecomputed_],
    ['Test 25: 昼の日報はカレンダーだけで作る', test25_DayReportStaysOnCalendar_],
    ['Test 26: 別用途の同名シートには書き込まない', test26_ForeignSheetIsNotOverwritten_],
    ['Test 27: 節の見出しの書き方が違っても切れ目を見つける', test27_SectionMarkerVariants_],
    ['Test 28: AM と PM の境目は 14:00', test28_AmPmBoundary_],
    ['Test 29: 境目は設定で変えられる', test29_AmPmBoundaryIsConfigurable_],
    ['Test 30: タスクは業務予定側に入る', test30_TasksGoUnderPlans_],
    ['Test 31: 期限・完了・削除でタスクを絞り込む', test31_TaskFiltering_],
    ['Test 32: Tasks API が無くても日報は作られる', test32_ReportWorksWithoutTasksService_],
    ['Test 33: 期限の絞り込みは Google に任せない', test33_TasksAreFilteredLocally_],
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
  var actual = buildDayReportBody_(['朝礼', '架電'], ['昼礼', '計上作業']);
  var expected = [
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

/** テスト用に、夜の日報のスプレッドシートを差し替える */
function withNightSheet_(rows, task) {
  var props = PropertiesService.getScriptProperties();
  var keys = [PROP_NIGHT_REPORT_SPREADSHEET_ID, PROP_NIGHT_REPORT_SHEET_NAME, PROP_NIGHT_REPORT_RANGE];
  var saved = [];
  for (var i = 0; i < keys.length; i++) saved.push(props.getProperty(keys[i]));

  var originalRead = readNightReportLines_;
  try {
    // 実際のスプレッドシートには触らず、読み取った結果だけを差し替える
    readNightReportLines_ = function () {
      if (rows === null) throw new Error('テスト用: 読めませんでした');
      var lines = toReportLines_(rows);
      if (lines.length === 0) throw new Error('テスト用: 範囲が空です');
      return lines;
    };
    return task();
  } finally {
    readNightReportLines_ = originalRead;
    for (var j = 0; j < keys.length; j++) {
      if (saved[j] === null) props.deleteProperty(keys[j]);
      else props.setProperty(keys[j], saved[j]);
    }
  }
}

function test2_NightReportFromSheet_() {
  /*
    夜の日報は 2 つの出どころが混ざる。
    シートから取るのは、節の見出し（---業務報告--- など）より前だけ。
    そこから下は予定で作り直すので、シート側の書きかけを持ち込まない。
  */
  var rows = [
    ['お疲れ様です。' + SENDER_NAME + 'です。', ''],
    ['2026年9月12日(土)', 'の日報をお送りいたします。'],
    ['', ''],
    ['＜進捗状況＞　　実績/目標', ''],
    ['★リード売上    69.4万円　/ 　60万円　進捗率115.%（オンスケは28万円）', ''],
    ['', ''],
    ['---業務報告---', ''],
    ['PM', ''],
    ['■シートに書きかけの予定', ''],
    ['---所感---', ''],
  ];
  var actual = withNightSheet_(rows, function () {
    return readNightProgressLines_();
  });
  var expected = [
    'お疲れ様です。' + SENDER_NAME + 'です。',
    '2026年9月12日(土)の日報をお送りいたします。',
    '',
    '＜進捗状況＞　　実績/目標',
    '★リード売上    69.4万円　/ 　60万円　進捗率115.%（オンスケは28万円）',
  ];
  assertEquals_(expected.join('\n'), actual.join('\n'), '進捗状況までをシートから読む');

  // 見出しが無いシートなら、今までどおり全部が上半分
  var whole = withNightSheet_([['見出しの無いシート', '']], function () {
    return readNightProgressLines_();
  });
  assertEquals_('見出しの無いシート', whole.join('\n'), '節の見出しが無ければ全部を使う');
}

function test3_NightBodyIsAssembled_() {
  /*
    業務報告は当日の PM（昼の日報で AM を出しているため）。
    業務予定は次の営業日の AM と PM。所感は見出しだけ置いて、中身は人が書く。
    カレンダーには触れず、タイトル配列を直接与えて確かめる。
  */
  var actual = buildNightReportBody_(
    ['お疲れ様です。', '＜進捗状況＞　★リード売上 69.4万円'],
    ['昼礼', '計上作業'],
    ['朝礼', '運営MTG'],
    ['架電']
  );
  var expected = [
    'お疲れ様です。',
    '＜進捗状況＞　★リード売上 69.4万円',
    '',
    '---業務報告---',
    'PM',
    '■昼礼',
    '■計上作業',
    '',
    '---業務予定---',
    'AM',
    '■朝礼',
    '■運営MTG',
    '',
    'PM',
    '■架電',
    '',
    '---所感---',
  ].join('\n');
  assertEquals_(expected, actual, '夜の日報本文');

  // 予定が無い側でも見出しは残す（無いことが分かるように）
  var empty = buildNightReportBody_([], [], [], []);
  assertTrue_(empty.indexOf('---業務報告---') >= 0, '予定が無くても業務報告の見出しは残す');
  assertTrue_(empty.indexOf('---業務予定---') >= 0, '予定が無くても業務予定の見出しは残す');
  assertTrue_(empty.indexOf('---所感---') >= 0, '所感の見出しは残す');
}

function test4_NightReportFailsLoudly_() {
  // 空の日報や途中までの日報を下書きとして残すと、気づかずに送ってしまう。
  var failed = false;
  try {
    withNightSheet_(null, function () { return readNightProgressLines_(); });
  } catch (e) {
    failed = true;
  }
  assertTrue_(failed, '読めなければ下書きを作らない');

  var emptyFailed = false;
  try {
    withNightSheet_([['', ''], ['', '']], function () { return readNightProgressLines_(); });
  } catch (e) {
    emptyFailed = true;
  }
  assertTrue_(emptyFailed, '範囲が空なら下書きを作らない');
}

function test5_Saturday_() {
  var saturday = parseDate_('2026-09-12');
  assertEquals_(6, getJstDayOfWeek_(saturday), '土曜日であること');
  assertTrue_(!isBusinessDay_(saturday), '土曜日は営業日ではない');
  assertEquals_('土曜日', describeNonBusinessDay_(saturday), '土曜日のスキップ理由');
}

function test6_Sunday_() {
  var sunday = parseDate_('2026-09-13');
  assertEquals_(0, getJstDayOfWeek_(sunday), '日曜日であること');
  assertTrue_(!isBusinessDay_(sunday), '日曜日は営業日ではない');
  assertEquals_('日曜日', describeNonBusinessDay_(sunday), '日曜日のスキップ理由');
}

function test7_Holiday_() {
  var holiday = parseDate_('2026-01-01'); // 元日（木曜）
  assertEquals_(4, getJstDayOfWeek_(holiday), '平日（木曜）であること');
  assertTrue_(!isBusinessDay_(holiday), '祝日は営業日ではない');
  assertEquals_('祝日', describeNonBusinessDay_(holiday), '祝日のスキップ理由');
}

function test8_DuplicatePrevention_() {
  var key = buildReportKey_(parseDate_('2099-01-05'), REPORT_TYPE_DAY);
  assertEquals_('20990105_day', key, '送信済み管理キーの形式');
  try {
    PropertiesService.getScriptProperties().deleteProperty(key);
    assertTrue_(!hasAlreadySent_(key), '初回は未送信');
    markAsSent_(key);
    assertTrue_(hasAlreadySent_(key), '記録後は送信済み');
    markAsSent_(key);
    assertTrue_(hasAlreadySent_(key), '複数回記録しても送信済みのまま');
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
  var actual = buildDayReportBody_([], ['昼礼']);
  var expected = ['---業務報告---', 'AM', ' ', '---業務予定---', 'PM', '■昼礼'].join('\n');
  assertEquals_(expected, actual, '予定が無い時間帯でも見出しを残す');
}

function test11_ObservanceIsNotHoliday_() {
  // Google の「日本の祝日」カレンダーは、説明の 1 行目に種別が入っている。
  var observanceDescription = '祭日\n祭日を非表示にするには、Google カレンダーの [設定] > [日本の祝日] に移動してください';
  assertTrue_(isHolidayEvent_(makeFakeEvent_('祝日')), '「祝日」は休業日');
  assertTrue_(!isHolidayEvent_(makeFakeEvent_(observanceDescription)), '「祭日」（節分・七夕など）は営業日');
  assertTrue_(isHolidayEvent_(makeFakeEvent_('')), '説明が空の場合は安全側に倒して休業日');
  assertTrue_(isHolidayEvent_(makeFakeEvent_(null)), '説明が無い場合は安全側に倒して休業日');
}

function test12_ObservanceDayIsBusinessDay_() {
  // 2026-02-03（火）節分、2026-07-07（火）七夕。どちらも祝日ではなく通常の営業日。
  var setsubun = parseDate_('2026-02-03');
  var tanabata = parseDate_('2026-07-07');
  assertEquals_(2, getJstDayOfWeek_(setsubun), '節分が火曜日であること');
  assertEquals_(null, describeNonBusinessDay_(setsubun), '節分は営業日');
  assertEquals_(null, describeNonBusinessDay_(tanabata), '七夕は営業日');
}

function test13_AutoRunNeverSends_() {
  // 自動実行（トリガー）は下書きを保存するだけで、Chatwork へは送信しない。
  // sendToChatwork_ を差し替えて、呼ばれないことと下書きが残ることを確かめる。
  var today = toJstStartOfDay_(new Date());
  var reportKey = buildReportKey_(today, REPORT_TYPE_DAY);
  var draftKey = buildDraftKey_(today, REPORT_TYPE_DAY);
  var props = PropertiesService.getScriptProperties();

  var todayText = Utilities.formatDate(today, TIME_ZONE, 'yyyy-MM-dd');
  var savedDraft = props.getProperty(draftKey);
  var savedSent = props.getProperty(reportKey);
  var savedRow = snapshotDraftRow_(todayText, REPORT_TYPE_DAY);
  var originalSend = sendToChatwork_;
  var callCount = 0;

  try {
    props.deleteProperty(draftKey);
    props.deleteProperty(reportKey);
    sendToChatwork_ = function () {
      callCount++;
      throw new Error('自動実行から Chatwork へ送信しようとしました。');
    };

    runDayReport();

    assertEquals_(0, callCount, '自動実行から Chatwork API が呼ばれた回数');
    if (describeNonBusinessDay_(today) === null) {
      var draft = loadDraft_(today, REPORT_TYPE_DAY);
      assertTrue_(draft !== null, '自動実行で下書きが保存されること');
      assertEquals_(DRAFT_STATUS_DRAFT, draft.status, '保存直後の状態');
      assertEquals_('day', draft.reportType, '下書きの種別');
      assertTrue_(!hasAlreadySent_(reportKey), '自動実行では送信済みにならないこと');
    }
  } finally {
    sendToChatwork_ = originalSend;
    if (savedDraft === null) props.deleteProperty(draftKey);
    else props.setProperty(draftKey, savedDraft);
    if (savedSent === null) props.deleteProperty(reportKey);
    else props.setProperty(reportKey, savedSent);
    restoreDraftRow_(todayText, REPORT_TYPE_DAY, savedRow);
  }
}

function test14_DraftStore_() {
  var date = parseDate_('2099-01-05');
  var key = buildDraftKey_(date, REPORT_TYPE_NIGHT);
  assertEquals_('draft_20990105_night', key, '下書きの保管キー');
  try {
    PropertiesService.getScriptProperties().deleteProperty(key);
    assertEquals_(null, loadDraft_(date, REPORT_TYPE_NIGHT), '下書きが無ければ null');

    saveDraft_(date, REPORT_TYPE_NIGHT, '夜の日報\n本文');
    var record = loadDraft_(date, REPORT_TYPE_NIGHT);
    assertEquals_('夜の日報\n本文', record.body, '保存した下書きを取り出せる');
    assertEquals_('2099-01-05', record.reportDate, '下書きの日付');
    assertEquals_('night', record.reportType, '下書きの種別');
    assertEquals_(DRAFT_STATUS_DRAFT, record.status, '下書きの状態');
    assertTrue_(typeof record.generatedAt === 'string' && record.generatedAt !== '', '生成日時が入ること');

    saveDraft_(date, REPORT_TYPE_NIGHT, '夜の日報\n上書き');
    assertEquals_('夜の日報\n上書き', loadDraft_(date, REPORT_TYPE_NIGHT).body, '同じ日の下書きは上書きされる');

    markDraftSent_(date, REPORT_TYPE_NIGHT);
    assertEquals_(DRAFT_STATUS_SENT, loadDraft_(date, REPORT_TYPE_NIGHT).status, '送信後の状態');

    deleteDraft_(date, REPORT_TYPE_NIGHT);
    assertEquals_(null, loadDraft_(date, REPORT_TYPE_NIGHT), '削除した下書きは残らない');
  } finally {
    PropertiesService.getScriptProperties().deleteProperty(key);
    restoreDraftRow_('2099-01-05', REPORT_TYPE_NIGHT, null);
  }
}

function test15_SentDraftIsNotResent_() {
  // 本番ルームへ送信済みの日は、手動送信をもう一度実行しても送らない。
  var today = toJstStartOfDay_(new Date());
  var reportKey = buildReportKey_(today, REPORT_TYPE_NIGHT);
  var draftKey = buildDraftKey_(today, REPORT_TYPE_NIGHT);
  var props = PropertiesService.getScriptProperties();

  var todayText = Utilities.formatDate(today, TIME_ZONE, 'yyyy-MM-dd');
  var savedDraft = props.getProperty(draftKey);
  var savedSent = props.getProperty(reportKey);
  var savedRow = snapshotDraftRow_(todayText, REPORT_TYPE_NIGHT);
  var originalSend = sendToChatwork_;
  var callCount = 0;

  try {
    sendToChatwork_ = function () {
      callCount++;
      throw new Error('送信済みの日報を再送信しようとしました。');
    };
    saveDraft_(today, REPORT_TYPE_NIGHT, '夜の日報\n再送信の確認');
    markAsSent_(reportKey);

    assertTrue_(sendNightDraft() === false, '送信済みなら送信しないこと');
    assertEquals_(0, callCount, '再送信で Chatwork API が呼ばれた回数');
  } finally {
    sendToChatwork_ = originalSend;
    if (savedDraft === null) props.deleteProperty(draftKey);
    else props.setProperty(draftKey, savedDraft);
    if (savedSent === null) props.deleteProperty(reportKey);
    else props.setProperty(reportKey, savedSent);
    restoreDraftRow_(todayText, REPORT_TYPE_NIGHT, savedRow);
  }
}

function test16_DraftRoomFeatureRemoved_() {
  // Chatwork 上に下書きルームを作る方式は廃止した。名残が残っていないことを確かめる。
  assertTrue_(
    typeof globalThis.CHATWORK_DRAFT_ROOM_ID === 'undefined' &&
      typeof globalThis.PROP_CHATWORK_DRAFT_ROOM_ID === 'undefined',
    '下書き用ルームの設定が残っていないこと'
  );
  assertTrue_(
    typeof globalThis.postDraftToDraftRoom_ === 'undefined' &&
      typeof globalThis.getChatworkDraftRoomId_ === 'undefined' &&
      typeof globalThis.assertDraftRoomIsSeparate_ === 'undefined' &&
      typeof globalThis.markDraftPosted_ === 'undefined',
    '下書き用ルームへ投稿する処理が残っていないこと'
  );
}

function test17_OnlyEntryPointsArePublic_() {
  // Apps Script の実行ボタンは引数を渡せないため、引数を必要とする関数が
  // 実行メニューに並んでいると、選ぶたびにエラーになる。
  // 名前の末尾が _ の関数はメニューに出ないので、入口だけを _ なしにしておく。
  var entryPoints = [
    'onOpen', 'doGet', 'doPost',
    'rebuildDayDraft', 'rebuildNightDraft',
    'sendDayReportButton', 'sendNightReportButton',
    'runDayReport', 'runNightReport',
    'showDayDraft', 'showNightDraft',
    'sendDayDraft', 'sendNightDraft',
    'testDayReport', 'testNightReport', 'testTodayEvents', 'showNightSources', 'showTasks',
    'runAllTests', 'setupTriggers',
  ];
  for (var i = 0; i < entryPoints.length; i++) {
    assertTrue_(
      typeof globalThis[entryPoints[i]] === 'function',
      '入口の関数が存在すること: ' + entryPoints[i]
    );
  }

  // 引数を受け取る部品が、うっかり選べる状態に戻っていないこと。
  var mustBeHidden = [
    'generateDayReport', 'generateNightReport',
    'buildDayReportBody', 'buildNightReportBody',
    'getCalendarEvents', 'getMorningEvents', 'getAfternoonEvents',
    'getTaskTitlesForDate', 'describeTasksForDate', 'isIncompleteTaskDueOn',
    'isBusinessDay', 'getNextBusinessDay',
    'sendToChatwork', 'buildReportKey', 'hasAlreadySent', 'markAsSent',
    'formatJapaneseDate', 'parseDate',
    'testDayReportForDate', 'testNightReportForDate',
  ];
  for (var j = 0; j < mustBeHidden.length; j++) {
    assertTrue_(
      typeof globalThis[mustBeHidden[j]] === 'undefined',
      '部品が実行メニューに出ないこと（末尾に _ が必要）: ' + mustBeHidden[j]
    );
  }
}

function test18_DraftIsWrittenToSheet_() {
  // 実際のシートを使うので、運用では現れない未来の日付で試して、最後に行を消す。
  var date = parseDate_('2099-01-05');
  var sheet = getDraftSheet_();
  try {
    saveDraftToSheet_(date, REPORT_TYPE_DAY, '昼の日報\nテスト用の本文', '2099-01-05T12:55:00+09:00');

    var row = findDraftRow_(sheet, '2099-01-05', REPORT_TYPE_DAY);
    assertTrue_(row > 0, 'シートに行ができること');
    assertEquals_('2099-01-05', toReportDateText_(sheet.getRange(row, SHEET_COL_DATE).getValue()), '日付の列');
    assertEquals_('昼', String(sheet.getRange(row, SHEET_COL_TYPE).getValue()), '種別の列');
    assertEquals_(SHEET_STATUS_DRAFT, String(sheet.getRange(row, SHEET_COL_STATUS).getValue()), '状態の列');
    assertEquals_('昼の日報\nテスト用の本文', String(sheet.getRange(row, SHEET_COL_BODY).getValue()), '本文の列');

    markSheetSent_(date, REPORT_TYPE_DAY, '2099-01-05T13:00:00+09:00');
    assertEquals_(SHEET_STATUS_SENT, String(sheet.getRange(row, SHEET_COL_STATUS).getValue()), '送信後の状態');
    assertEquals_('2099-01-05T13:00:00+09:00', String(sheet.getRange(row, SHEET_COL_SENT).getValue()), '送信日時の列');

    // 送信済みの行は、作り直しても書き換えない。
    saveDraftToSheet_(date, REPORT_TYPE_DAY, '昼の日報\n書き換えようとした本文', '2099-01-05T13:30:00+09:00');
    assertEquals_(
      '昼の日報\nテスト用の本文',
      String(sheet.getRange(row, SHEET_COL_BODY).getValue()),
      '送信済みの行は書き換えない'
    );
  } finally {
    var cleanup = findDraftRow_(sheet, '2099-01-05', REPORT_TYPE_DAY);
    if (cleanup > 0) sheet.deleteRow(cleanup);
  }
}

function test19_EditedSheetBodyWins_() {
  // セル上で所感を書き足したら、その内容が送信されなければならない。
  var date = parseDate_('2099-01-05');
  var sheet = getDraftSheet_();
  var draftKey = buildDraftKey_(date, REPORT_TYPE_NIGHT);
  try {
    saveDraft_(date, REPORT_TYPE_NIGHT, '夜の日報\n生成した本文');
    assertEquals_('夜の日報\n生成した本文', loadDraftBody_(date, REPORT_TYPE_NIGHT), '生成直後の本文');

    var row = findDraftRow_(sheet, '2099-01-05', REPORT_TYPE_NIGHT);
    assertTrue_(row > 0, 'シートに行ができること');

    var edited = '夜の日報\n生成した本文\n---所感---\n手で書き足しました';
    sheet.getRange(row, SHEET_COL_BODY).setValue(edited);
    assertEquals_(edited, loadDraftBody_(date, REPORT_TYPE_NIGHT), 'シートで書き足した本文が使われること');
  } finally {
    PropertiesService.getScriptProperties().deleteProperty(draftKey);
    var cleanup = findDraftRow_(sheet, '2099-01-05', REPORT_TYPE_NIGHT);
    if (cleanup > 0) sheet.deleteRow(cleanup);
  }
}

function test20_ApiRequiresSecret_() {
  // プラットフォームからの入口は、合言葉が合うときだけ通す。
  // 読み取り（drafts）だけを試すので、Chatwork へは送信されない。
  var props = PropertiesService.getScriptProperties();
  var saved = props.getProperty(PROP_API_SHARED_SECRET);

  function call(payload) {
    return JSON.parse(doPost({ postData: { contents: JSON.stringify(payload) } }).getContent());
  }

  try {
    props.setProperty(PROP_API_SHARED_SECRET, 'テスト用の合言葉');

    assertTrue_(call({ action: 'drafts' }).ok === false, '合言葉が無ければ通さない');
    assertTrue_(call({ secret: 'ちがう合言葉', action: 'drafts' }).ok === false, '合言葉が違えば通さない');

    var allowed = call({ secret: 'テスト用の合言葉', action: 'drafts' });
    assertTrue_(allowed.ok === true, '合言葉が合えば通る');
    assertTrue_(typeof allowed.reports.day === 'object', '昼の日報の状態が入っていること');
    assertTrue_(typeof allowed.reports.night === 'object', '夜の日報の状態が入っていること');
    assertEquals_('day', allowed.reports.day.reportType, '種別');

    var unknown = call({ secret: 'テスト用の合言葉', action: 'なにかの操作' });
    assertTrue_(unknown.ok === false, '知らない操作は通さない');

    props.deleteProperty(PROP_API_SHARED_SECRET);
    assertTrue_(
      call({ secret: 'テスト用の合言葉', action: 'drafts' }).ok === false,
      '合言葉が未設定なら、そもそも通さない'
    );
  } finally {
    if (saved === null) props.deleteProperty(PROP_API_SHARED_SECRET);
    else props.setProperty(PROP_API_SHARED_SECRET, saved);
  }
}

function test21_TitleWithNewline_() {
  // 予定名に改行が入ると、1 件が 2 行になって「■」の無い行や偽の見出しができてしまう。
  assertEquals_('■架電 （重要）', formatTitleLine_('架電\n（重要）'), '改行は 1 行に畳む');
  assertEquals_('■架電 ■偽の見出し', formatTitleLine_('架電\n■偽の見出し'), '2 行目の「■」も畳んだうえで 1 行にする');
  assertEquals_('■打ち合わせ 先方訪問', formatTitleLine_('打ち合わせ\t先方訪問'), 'タブも空白にする');
}

function test22_BusinessDayAcrossMidnight_() {
  // 夜の日報を作ったあと、日付が変わってから送ることがある。
  // 暦の日付で切ると前日の下書きを見失うため、朝までは前日の続きとして扱う。
  var now = new Date();
  var hour = getJstHour_(now);
  var expected = hour < BUSINESS_DAY_START_HOUR
    ? formatDateKey_(addDays_(toJstStartOfDay_(now), -1))
    : formatDateKey_(toJstStartOfDay_(now));
  assertEquals_(expected, formatDateKey_(businessToday_()), '業務日の決まり方');

  assertTrue_(
    BUSINESS_DAY_START_HOUR > 0 && BUSINESS_DAY_START_HOUR < DAY_REPORT_HOUR,
    '業務日の区切りは、昼のトリガーより前であること'
  );
}

function test23_ColumnsAreJoinedWithoutGap_() {
  // シートは 1 行を B 列と C 列に分けて書いている。
  // 間に空白を足すと文が割れるため、そのままつなげる。
  assertEquals_(
    '2026年9月12日(土)の日報をお送りいたします。',
    toReportLines_([['2026年9月12日(土)', 'の日報をお送りいたします。']])[0],
    'B 列と C 列は空白を入れずにつなぐ'
  );
  assertEquals_(
    '架電数実績　　12件',
    toReportLines_([['架電数実績　　', '12件']])[0],
    'セルの中の空白で間を空ける（詰めない）'
  );

  // 日報の中の空行は段落の区切りなので残す。末尾の空行だけ落とす。
  var lines = toReportLines_([['1行目', ''], ['', ''], ['3行目', ''], ['', ''], ['', '']]);
  assertEquals_(3, lines.length, '末尾の空行だけを落とす');
  assertEquals_('', lines[1], '途中の空行は残す');

  // 数式のエラー表示は、そのまま送ると相手に届く。行ごと飛ばす。
  var withErrors = toReportLines_([
    ['累計架電数   件', ''],
    ['#REF!', ''],
    ['', '#REF!'],
    ['#N/A', ''],
    ['---業務報告---', ''],
  ]);
  assertEquals_(2, withErrors.length, 'エラーの行は空行も残さずに飛ばす');
  assertEquals_('累計架電数   件', withErrors[0], 'エラーの前の行はそのまま');
  assertEquals_('---業務報告---', withErrors[1], 'エラーの後ろの行もそのまま');

  assertTrue_(isSpreadsheetError_('#REF!'), '#REF! はエラー');
  assertTrue_(isSpreadsheetError_('#DIV/0!'), '#DIV/0! はエラー');
  assertTrue_(!isSpreadsheetError_('#REF! の対応'), '文の一部なら残す');
  assertTrue_(!isSpreadsheetError_('■架電'), 'ふつうの行は残す');
}

function test24_SheetValuesAreNotRecomputed_() {
  // 売上も進捗率もオンスケもシートの数式が出した値。ここで計算し直すと、
  // シートの式を直した日に日報だけ古い数字が残る。表示のまま使う。
  var lines = toReportLines_([
    ['★リード売上    69.4万円　/ 　60万円　進捗率115.%（オンスケは28万円）', ''],
    ['改行の\n入ったセル', ''],
  ]);
  assertEquals_(
    '★リード売上    69.4万円　/ 　60万円　進捗率115.%（オンスケは28万円）',
    lines[0],
    '桁を揃えている空白も数字もそのまま残す'
  );
  assertTrue_(lines[1].indexOf('\n') === -1, 'セルの中の改行は 1 行に畳む');
}

function test25_DayReportStaysOnCalendar_() {
  // 昼の日報は今までどおり。スプレッドシートは見ない。
  var actual = buildDayReportBody_(['朝礼'], ['昼礼']);
  var expected = ['---業務報告---', 'AM', '■朝礼', ' ', '---業務予定---', 'PM', '■昼礼'].join('\n');
  assertEquals_(expected, actual, '昼の日報本文');
  assertTrue_(actual.indexOf('＜進捗状況＞') === -1, '昼には進捗状況を入れない');
  assertTrue_(actual.indexOf('お疲れ様です') === -1, '昼には挨拶を入れない');
}

function test26_ForeignSheetIsNotOverwritten_() {
  // 「日報」という名前のシートは珍しくない。人が日報を書いているシートに
  // 行を差し込むと、書いてあったものがずれて上書きされ、元に戻せない。
  var spreadsheet = getSpreadsheet_();
  var name = '日報_別用途のテスト';
  var props = PropertiesService.getScriptProperties();
  var saved = props.getProperty(PROP_DRAFT_SHEET_NAME);

  var sheet = spreadsheet.getSheetByName(name);
  if (sheet === null) sheet = spreadsheet.insertSheet(name);

  try {
    // 人が書いた内容のつもり（見出しが下書き記録用と違う）
    sheet.getRange(1, 1).setValue('お疲れ様です。山本です。');
    props.setProperty(PROP_DRAFT_SHEET_NAME, name);

    var stopped = false;
    try {
      saveDraftToSheet_(parseDate_('2099-01-05'), REPORT_TYPE_DAY, '本文', '2099-01-05T12:55:00+09:00');
    } catch (e) {
      stopped = true;
    }
    assertTrue_(stopped, '見出しが違うシートには書き込まずに止める');
    assertEquals_(
      'お疲れ様です。山本です。',
      String(sheet.getRange(1, 1).getValue()),
      '書いてあった内容が残っていること'
    );
  } finally {
    if (saved === null) props.deleteProperty(PROP_DRAFT_SHEET_NAME);
    else props.setProperty(PROP_DRAFT_SHEET_NAME, saved);
  }
}

/* ------------------------------------------------------------------ *
 * アサーション
 * ------------------------------------------------------------------ */

/** テストの前にシートの行を控える（無ければ null）。 */
function snapshotDraftRow_(dateText, reportType) {
  var sheet = getDraftSheet_();
  var row = findDraftRow_(sheet, dateText, reportType);
  if (row === 0) return null;
  return sheet.getRange(row, 1, 1, SHEET_HEADERS.length).getValues()[0];
}

/** 控えておいた行に戻す（元が無ければ、テストで増えた行を消す）。 */
function restoreDraftRow_(dateText, reportType, values) {
  var sheet = getDraftSheet_();
  var row = findDraftRow_(sheet, dateText, reportType);

  if (values === null) {
    if (row > 0) sheet.deleteRow(row);
    return;
  }
  if (row === 0) {
    sheet.insertRowAfter(1);
    row = 2;
  }
  sheet.getRange(row, 1, 1, values.length).setValues([values]);
}

/** 説明だけを持つテスト用の予定。 */
function makeFakeEvent_(description) {
  return {
    getDescription: function () {
      return description;
    },
  };
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

function test27_SectionMarkerVariants_() {
  /*
    シートの見出しの飾り方は人が決める。決め打ちにすると、飾りを変えた日に
    切れ目を見失い、シートの書きかけがそのまま日報に出る。
    飾りを落として節の名前と突き合わせる。
  */
  var markers = [
    '---業務報告---',
    '--- 業務報告 ---',
    '―――業務報告―――',
    '【業務報告】',
    '■業務報告',
    '業務報告',
    '---業務予定---',
    '---所感---',
  ];
  for (var i = 0; i < markers.length; i++) {
    assertTrue_(isSectionMarker_(markers[i]), '節の見出しとして扱う: ' + markers[i]);
  }

  /*
    逆に、飾りが付いているだけの行を節の見出しにしない。
    進捗状況の中の区切り線で切れると、日報が途中までになる。
  */
  var notMarkers = [
    '＜進捗状況＞　　実績/目標',
    '★リード売上    69.4万円　/ 　60万円',
    '-----------------',
    '■朝礼',
    '2026年9月12日(土)の日報をお送りいたします。',
    '',
  ];
  for (var j = 0; j < notMarkers.length; j++) {
    assertTrue_(!isSectionMarker_(notMarkers[j]), '節の見出しにしない: 「' + notMarkers[j] + '」');
  }

  // 飾りを変えたシートでも、切れ目より下は読まない
  var lines = withNightSheet_([
    ['＜進捗状況＞', ''],
    ['★リード売上 69.4万円', ''],
    ['【業務報告】', ''],
    ['■シートに書きかけの予定', ''],
  ], function () {
    return readNightProgressLines_();
  });
  assertEquals_('＜進捗状況＞\n★リード売上 69.4万円', lines.join('\n'), '飾りが違っても切れ目で止まる');
}

function test28_AmPmBoundary_() {
  /*
    午前の打ち合わせが午後まで続くので、12 時で切ると運営MTGや架電班MTGが
    PM 側に落ちて、実際の動き方と合わなかった。境目は 14:00。
    分まで見る（13:45 と 14:00 を区別するため）。
    判定は開始時刻だけ（終わる時刻でまたいでも、始めた側に入れる）。
  */
  assertEquals_('14:00', DEFAULT_AM_PM_BOUNDARY, 'PM が始まる時刻の既定値');

  var day = parseDate_('2026-09-14');
  var at = function (hour, minute) {
    var d = new Date(day.getTime());
    d.setHours(hour, minute || 0, 0, 0);
    return d;
  };

  var cases = [
    [at(9, 0), true, '09:00'],
    [at(11, 0), true, '11:00（運営MTG）'],
    [at(13, 30), true, '13:30'],
    [at(13, 45), true, '13:45'],
    [at(13, 59), true, '13:59（境目の直前）'],
    [at(14, 0), false, '14:00（境目ちょうどは PM）'],
    [at(14, 1), false, '14:01'],
    [at(17, 30), false, '17:30'],
  ];
  for (var i = 0; i < cases.length; i++) {
    assertEquals_(
      cases[i][1],
      isMorningStart_(cases[i][0]),
      cases[i][2] + ' が ' + (cases[i][1] ? 'AM' : 'PM') + ' になること'
    );
  }

  // 絞り込みの側も同じ境目で動くこと
  var events = [
    { title: '朝礼', startTime: at(9, 0) },
    { title: '運営MTG', startTime: at(11, 0) },
    { title: '架電班MTG', startTime: at(13, 45) },
    { title: '計上作業', startTime: at(15, 0) },
  ];
  assertEquals_(
    '朝礼,運営MTG,架電班MTG',
    toEventTitles_(filterEventsByHalf_(events, true)).join(','),
    'AM の予定'
  );
  assertEquals_(
    '計上作業',
    toEventTitles_(filterEventsByHalf_(events, false)).join(','),
    'PM の予定'
  );
}

function test29_AmPmBoundaryIsConfigurable_() {
  /*
    働き方が変われば切り方も変わる。そのたびにコードを貼り替えて
    デプロイし直さずに済むよう、スクリプト プロパティで動かせるようにしてある。
  */
  var day = parseDate_('2026-09-14');
  var at = function (hour, minute) {
    var d = new Date(day.getTime());
    d.setHours(hour, minute || 0, 0, 0);
    return d;
  };

  withAmPmBoundary_('13:45', function () {
    assertEquals_('13:45', formatAmPmBoundary_(), '設定した境目が使われること');
    assertTrue_(isMorningStart_(at(13, 44)), '13:44 は AM');
    assertTrue_(!isMorningStart_(at(13, 45)), '13:45 ちょうどは PM（その時刻から PM のため）');
  });

  withAmPmBoundary_('12:00', function () {
    assertTrue_(isMorningStart_(at(11, 59)), '11:59 は AM');
    assertTrue_(!isMorningStart_(at(12, 0)), '12:00 は PM');
  });

  /*
    書き方を間違えたら、黙って既定に戻さずに止める。
    静かに 14:00 に戻すと、設定したつもりの時刻で切られていないことに
    気づかないまま日報が出続ける。
  */
  var rejected = 0;
  var bad = ['14時', '25:00', '14:60', '1400'];
  for (var i = 0; i < bad.length; i++) {
    try {
      withAmPmBoundary_(bad[i], function () { return formatAmPmBoundary_(); });
    } catch (e) {
      rejected++;
    }
  }
  assertEquals_(bad.length, rejected, '正しくない時刻は受け付けないこと');

  // 空欄は「設定していない」と同じ。既定に戻すのが正しい
  withAmPmBoundary_('', function () {
    assertEquals_(DEFAULT_AM_PM_BOUNDARY, formatAmPmBoundary_(), '空欄なら既定値を使う');
  });
}

function test30_TasksGoUnderPlans_() {
  /*
    Google ToDo の未完了タスクは「これからやること」なので、業務予定側に入れる。
    業務報告に混ぜると、やっていないことを報告したことになる。

    Tasks API は期限の「日付」しか持たず、時刻は読めない。そのため予定のように
    開始時刻で AM / PM へ振り分けることはできず、置き場所を固定している。
      昼 … 業務予定（当日 PM）の末尾
      夜 … 業務予定（翌営業日 AM）の末尾
  */
  var day = buildDayReportBody_(['朝礼'], ['計上作業'], ['請求書の送付', '見積の作成']);
  assertEquals_(
    [
      '---業務報告---',
      'AM',
      '■朝礼',
      ' ',
      '---業務予定---',
      'PM',
      '■計上作業',
      '■請求書の送付',
      '■見積の作成',
    ].join('\n'),
    day,
    '昼の日報はタスクを業務予定（PM）の末尾に置く'
  );

  var night = buildNightReportBody_(['お疲れ様です。'], ['昼礼'], ['朝礼'], ['架電'], ['請求書の送付']);
  assertEquals_(
    [
      'お疲れ様です。',
      '',
      '---業務報告---',
      'PM',
      '■昼礼',
      '',
      '---業務予定---',
      'AM',
      '■朝礼',
      '■請求書の送付',
      '',
      'PM',
      '■架電',
      '',
      '---所感---',
    ].join('\n'),
    night,
    '夜の日報はタスクを業務予定（AM）の末尾に置く'
  );

  // 業務報告の側へ漏れていないこと（ここが崩れると、やっていない報告になる）
  var reportPart = night.substring(night.indexOf('---業務報告---'), night.indexOf('---業務予定---'));
  assertTrue_(reportPart.indexOf('請求書の送付') === -1, 'タスクが業務報告に混ざらないこと');

  // タスクが無い日は、今までどおりの本文のまま（余分な行を足さない）
  assertEquals_(
    buildDayReportBody_(['朝礼'], ['計上作業']),
    buildDayReportBody_(['朝礼'], ['計上作業'], []),
    'タスクが無ければ日報の形は変わらない'
  );
}

function test31_TaskFiltering_() {
  /*
    日報に出すのは「その日が期限の、まだ終わっていないタスク」だけ。
    完了・削除・非表示のものが混ざると、済んだ仕事を予定として報告することになる。
    期限を付けていないタスクも出さない（いつやるか決まっていないため）。
  */
  var due = '2026-09-15';
  var accepted = [
    { title: '請求書の送付', status: 'needsAction', due: '2026-09-15T00:00:00.000Z' },
    { title: '見積の作成', due: '2026-09-15T00:00:00.000Z' },
  ];
  for (var i = 0; i < accepted.length; i++) {
    assertTrue_(isIncompleteTaskDueOn_(accepted[i], due), '採用: ' + accepted[i].title);
  }

  var rejected = [
    ['完了済み', { title: '済んだ仕事', status: 'completed', due: '2026-09-15T00:00:00.000Z' }],
    ['削除済み', { title: '消した仕事', deleted: true, due: '2026-09-15T00:00:00.000Z' }],
    ['非表示', { title: '隠れた仕事', hidden: true, due: '2026-09-15T00:00:00.000Z' }],
    ['期限が前日', { title: '昨日まで', due: '2026-09-14T00:00:00.000Z' }],
    ['期限が翌日', { title: '明日まで', due: '2026-09-16T00:00:00.000Z' }],
    ['期限が無い', { title: 'いつか', status: 'needsAction' }],
    ['中身が無い', null],
  ];
  for (var j = 0; j < rejected.length; j++) {
    assertTrue_(
      !isIncompleteTaskDueOn_(rejected[j][1], due),
      '除外（' + rejected[j][0] + '）: ' + (rejected[j][1] === null ? 'null' : rejected[j][1].title)
    );
  }
}

function test32_ReportWorksWithoutTasksService_() {
  /*
    拡張サービス「Tasks API」を足していないプロジェクトでも、日報は出さなければならない。
    タスク欄が埋まることより、日報が毎日出ることのほうが大事。
    ここが落ちると、タスクを足したせいで日報そのものが止まる。
  */
  if (isTasksServiceAvailable_()) {
    // サービスがある環境では、読めることだけを確かめる（中身は人のタスク次第）
    var titles = getTaskTitlesForDate_(parseDate_('2026-09-15'));
    assertTrue_(Object.prototype.toString.call(titles) === '[object Array]', 'タスク名は配列で返る');
    return;
  }

  assertEquals_(
    0,
    getTaskTitlesForDate_(parseDate_('2026-09-15')).length,
    'サービスが無ければタスクは 0 件'
  );

  var lines = describeTasksForDate_(parseDate_('2026-09-15'));
  assertTrue_(lines.length > 0, 'サービスが無いことを説明する行を返す');
  assertTrue_(lines.join('\n').indexOf('Tasks API') >= 0, '足し方を案内すること');
}

function test33_TasksAreFilteredLocally_() {
  /*
    Tasks API の dueMin / dueMax は期待どおりに効かないことがある。実際、期限が
    その日のタスクが入っているのに 0 件で返ってきて、日報にタスクが出なかった。
    未完了のタスクをすべて取ってきて、日付の突き合わせはこちらで行う。

    ページ送りもたどる。期限を付けていないタスクが多いと、1 ページ目に
    期限付きのタスクが入りきらないことがある。
  */
  var saved = typeof Tasks === 'undefined' ? undefined : Tasks;
  var requested = [];

  try {
    globalThis.Tasks = {
      Tasklists: {
        list: function () { return { items: [{ id: 'l1', title: 'マイタスク' }] }; },
      },
      Tasks: {
        list: function (listId, options) {
          requested.push(options);
          if (requested.length === 1) {
            return {
              items: [
                { title: '期限なし', status: 'needsAction' },
                { title: '先の予定', status: 'needsAction', due: '2026-09-30T00:00:00.000Z' },
              ],
              nextPageToken: 'p2',
            };
          }
          return {
            items: [{ title: '今日のタスク', status: 'needsAction', due: '2026-09-14T00:00:00.000Z' }],
          };
        },
      },
    };

    assertEquals_(
      '今日のタスク',
      getTaskTitlesForDate_(parseDate_('2026-09-14')).join(','),
      'その日が期限のタスクだけを返す（2 ページ目にあっても拾う）'
    );

    assertEquals_(2, requested.length, 'ページ送りをたどること');
    assertTrue_(
      requested[0].dueMin === undefined && requested[0].dueMax === undefined,
      '期限で Google 側に絞らせないこと（効かないことがあるため）'
    );
    assertEquals_('p2', requested[1].pageToken, '2 ページ目は続きから読むこと');
    assertEquals_(false, requested[0].showCompleted, '完了済みは取りに行かない');

    // 該当が無い日は、空のまま（日報にはタスクの行が出ない）
    assertEquals_(
      0,
      getTaskTitlesForDate_(parseDate_('2026-09-15')).length,
      '期限が合う日が無ければ 0 件'
    );
  } finally {
    if (saved === undefined) delete globalThis.Tasks;
    else globalThis.Tasks = saved;
  }
}

/** テスト用に AM / PM の境目を差し替える */
function withAmPmBoundary_(value, task) {
  var props = PropertiesService.getScriptProperties();
  var saved = props.getProperty(PROP_AM_PM_BOUNDARY);
  var savedCache = amPmBoundaryCache_;
  try {
    props.setProperty(PROP_AM_PM_BOUNDARY, value);
    amPmBoundaryCache_ = null;
    return task();
  } finally {
    if (saved === null) props.deleteProperty(PROP_AM_PM_BOUNDARY);
    else props.setProperty(PROP_AM_PM_BOUNDARY, saved);
    amPmBoundaryCache_ = savedCache;
  }
}
