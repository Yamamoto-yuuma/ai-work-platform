/**
 * AI Work（業務プラットフォーム）からの読み書き口。
 *
 * ウェブアプリとして公開し、合言葉（スクリプト プロパティ `API_SHARED_SECRET`）が
 * 合うリクエストだけを通す。Chatwork のトークンはここから外へ出さない。
 * プラットフォーム側はサーバー経由で呼ぶので、合言葉がブラウザに出ることはない。
 *
 * やり取りはすべて POST。URL に合言葉を載せると、履歴やログに残ってしまうため。
 *
 *   { "secret": "…", "action": "drafts" }                       今日の下書きを返す
 *   { "secret": "…", "action": "rebuild", "reportType": "day" }  最新のカレンダーで作り直す
 *   { "secret": "…", "action": "save", "reportType": "day",
 *     "body": "---業務報告---…" }                                      本文を書き換える
 *   { "secret": "…", "action": "send", "reportType": "day" }     Chatwork の本番ルームへ送る
 *
 * どの操作でも、終わったあとの状態をまとめて返す（画面側で組み立て直さずに済む）。
 */

var PROP_API_SHARED_SECRET = 'API_SHARED_SECRET';

/** GET は受け付けない（合言葉を URL に載せないため）。 */
function doGet() {
  return jsonResponse_({ ok: false, error: 'この入口は POST だけを受け付けます。' });
}

/** プラットフォームからのリクエスト。 */
function doPost(e) {
  try {
    var request = parseApiRequest_(e);
    assertApiSecret_(request.secret);
    return jsonResponse_(handleApiAction_(request));
  } catch (error) {
    Logger.log('API でエラーが発生しました: ' + error + (error && error.stack ? '\n' + error.stack : ''));
    return jsonResponse_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

/* ------------------------------------------------------------------ *
 * 入口の中身
 * ------------------------------------------------------------------ */

/** リクエストの本文を読み取る。 */
function parseApiRequest_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('リクエストの中身がありません。');
  }
  try {
    return JSON.parse(e.postData.contents);
  } catch (error) {
    throw new Error('リクエストの形式が正しくありません: ' + error);
  }
}

/** 合言葉を確かめる。未設定のときは通さない（開けっ放しにしないため）。 */
function assertApiSecret_(secret) {
  var expected = getProperty_(PROP_API_SHARED_SECRET);
  if (expected === null) {
    throw new Error(
      'スクリプト プロパティに「' + PROP_API_SHARED_SECRET + '」が設定されていないため、' +
        'この入口は使えません。'
    );
  }
  if (String(secret === null || secret === undefined ? '' : secret) !== expected) {
    throw new Error('合言葉が違います。');
  }
}

/** 操作を振り分ける。 */
function handleApiAction_(request) {
  assertTimeZone_();
  var today = businessToday_();

  switch (request.action) {
    case 'drafts':
      return buildApiState_(today);

    case 'rebuild':
      rebuildForApi_(today, toReportType_(request.reportType));
      return buildApiState_(today);

    case 'save':
      updateDraftBodyInSheet_(today, toReportType_(request.reportType), String(request.body));
      return buildApiState_(today);

    case 'send': {
      // 実際に送ったかどうかを返す（すでに送信済みなら送らない）
      var sentNow = sendDraft_(toReportType_(request.reportType));
      var state = buildApiState_(today);
      state.sentNow = sentNow;
      return state;
    }

    default:
      throw new Error('知らない操作です: ' + request.action);
  }
}

/** 昼か夜かを確かめる。 */
function toReportType_(value) {
  if (value === REPORT_TYPE_DAY || value === REPORT_TYPE_NIGHT) return value;
  throw new Error('reportType は "day" か "night" を指定してください: ' + value);
}

/** 最新のカレンダーで下書きを作り直す。 */
function rebuildForApi_(date, reportType) {
  if (hasAlreadySent_(buildReportKey_(date, reportType))) {
    throw new Error('この日報はすでに送信済みです。作り直せません。');
  }
  var body = reportType === REPORT_TYPE_DAY ? generateDayReport_(date) : generateNightReport_(date);
  saveDraft_(date, reportType, body);
}

/** 今日の状態をまとめて返す。 */
function buildApiState_(date) {
  return {
    ok: true,
    today: Utilities.formatDate(date, TIME_ZONE, 'yyyy-MM-dd'),
    todayLabel: formatJapaneseDate_(date),
    nonBusinessDayReason: describeNonBusinessDay_(date),
    reports: {
      day: buildApiReport_(date, REPORT_TYPE_DAY),
      night: buildApiReport_(date, REPORT_TYPE_NIGHT),
    },
  };
}

/** 1 件分の下書きの状態。 */
function buildApiReport_(date, reportType) {
  var row = readDraftRow_(date, reportType);
  return {
    reportType: reportType,
    exists: row !== null,
    body: row === null ? '' : row.body,
    generatedAt: row === null ? '' : row.generatedAt,
    sentAt: row === null ? '' : row.sentAt,
    sent: hasAlreadySent_(buildReportKey_(date, reportType)),
  };
}

/** JSON で返す。 */
function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
