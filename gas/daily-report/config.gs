/**
 * 設定の取得。
 *
 * 秘密情報（Chatwork API Token など）はソースコードへ書かず、
 * すべて Script Properties から取得する。
 */

/** 日報が前提とするタイムゾーン。GAS プロジェクトの設定もこれに合わせる。 */
var TIME_ZONE = 'Asia/Tokyo';

/** 夜の日報の挨拶文に入る差出人名。 */
var SENDER_NAME = '山本';

/**
 * トリガーで日報の下書きを用意する時刻（送信予定時刻の 5 分前）。
 * GAS の時間主導型トリガーは指定時刻の前後 15 分ほどぶれるため、秒単位の保証はない。
 *
 * トリガーが行うのは下書きの保存までで、Chatwork への送信は一切行わない。
 */
var DAY_REPORT_HOUR = 12;
var DAY_REPORT_MINUTE = 55;
var NIGHT_REPORT_HOUR = 18;
var NIGHT_REPORT_MINUTE = 25;

/**
 * 業務日の始まり（時）。
 * これより前の時刻は、前日の続きとして扱う。
 * 夜の日報を日付が変わってから送るときに、前日の下書きを見失わないようにするため。
 */
var BUSINESS_DAY_START_HOUR = 5;

/**
 * PM が始まる時刻。この時刻より前に始まる予定が AM。
 *
 * 昼の 12 時ではなく 14 時で切る。午前の打ち合わせが午後まで続くことが多く、
 * 12 時で切ると運営MTGや架電班MTGが PM 側に落ちて、実際の動き方と合わなかった。
 *
 *   AM … 00:00 〜 13:59 開始（13:45 の予定も AM）
 *   PM … 14:00 〜 23:59 開始（14:00 ちょうどは PM）
 *
 * 判定は開始時刻だけを見る。終わる時刻でまたいでも、始めた側に入れる。
 *
 * スクリプト プロパティ「AM_PM_BOUNDARY」があればそちらを使う（例: 13:45）。
 * 働き方が変われば切り方も変わるので、そのたびにコードを貼り替えて
 * デプロイし直さずに済むようにしておく。
 */
var DEFAULT_AM_PM_BOUNDARY = '14:00';
var PROP_AM_PM_BOUNDARY = 'AM_PM_BOUNDARY';

/**
 * 終日イベントを日報に含めるか。
 * 初版は「時刻付きの業務予定のみ」を対象とするため false。
 * 含めたい場合はここを true にする（終日イベントは開始時刻 00:00 のため AM 扱いになる）。
 */
var INCLUDE_ALL_DAY_EVENTS = false;

/**
 * 祝日判定に使う Google カレンダーの ID。
 * Script Property `HOLIDAY_CALENDAR_ID` が設定されていればそちらを優先する。
 */
var DEFAULT_HOLIDAY_CALENDAR_ID = 'ja.japanese#holiday@group.v.calendar.google.com';

/**
 * 祝日カレンダーに入っているが、休業日として扱わない予定の種別。
 *
 * Google の「日本の祝日」カレンダーは祝日と行事の両方を含んでおり、
 * 予定の説明の 1 行目が種別になっている。
 *   「祝日」→ 元日・成人の日・振替休日・国民の休日 など（＝休業日）
 *   「祭日」→ 節分・七夕・母の日・銀行休業日 など（＝通常の営業日）
 * ここに挙げた種別だけを営業日として扱い、それ以外は安全側に倒して休業日とする。
 */
var HOLIDAY_CALENDAR_NON_HOLIDAY_LABELS = ['祭日', '行事', 'Observance', 'Season'];

/** Script Properties のキー名。 */
var PROP_CHATWORK_API_TOKEN = 'CHATWORK_API_TOKEN';
var PROP_CHATWORK_ROOM_ID = 'CHATWORK_ROOM_ID';
var PROP_HOLIDAY_CALENDAR_ID = 'HOLIDAY_CALENDAR_ID';
var PROP_TARGET_CALENDAR_ID = 'TARGET_CALENDAR_ID';

/**
 * Script Property を取得する（未設定なら null）。
 */
function getProperty_(key) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  if (value === null || value === undefined) return null;
  value = String(value).trim();
  return value === '' ? null : value;
}

/**
 * Script Property を取得する（未設定ならエラー）。
 */
function getRequiredProperty_(key) {
  var value = getProperty_(key);
  if (value === null) {
    throw new Error(
      'Script Properties に「' + key + '」が設定されていません。' +
        'Apps Script エディタの［プロジェクトの設定］→［スクリプト プロパティ］で設定してください。'
    );
  }
  return value;
}

/** Chatwork API Token。 */
function getChatworkApiToken_() {
  return getRequiredProperty_(PROP_CHATWORK_API_TOKEN);
}

/** 投稿先の Chatwork ルーム ID。 */
function getChatworkRoomId_() {
  var roomId = getRequiredProperty_(PROP_CHATWORK_ROOM_ID);
  if (!/^[0-9]+$/.test(roomId)) {
    throw new Error(
      'Script Properties の「' + PROP_CHATWORK_ROOM_ID + '」が数値ではありません: ' + roomId
    );
  }
  return roomId;
}

/** 祝日カレンダー ID（未設定なら既定値）。 */
function getHolidayCalendarId_() {
  var id = getProperty_(PROP_HOLIDAY_CALENDAR_ID);
  return id === null ? DEFAULT_HOLIDAY_CALENDAR_ID : id;
}

/** 予定を取得するカレンダー ID（未設定なら実行アカウントのデフォルトカレンダー）。 */
function getTargetCalendarId_() {
  return getProperty_(PROP_TARGET_CALENDAR_ID);
}

/** 1 回の実行の中で使い回す AM / PM の境目（分）。 */
var amPmBoundaryCache_ = null;

/**
 * PM が始まる時刻を「0 時からの分」で返す（14:00 なら 840）。
 *
 * 書き方を間違えたときは黙って既定に戻さず、止める。
 * 静かに 14:00 に戻すと、設定したつもりの時刻で切られていないことに
 * 気づかないまま日報が出続ける。
 */
function getAmPmBoundaryMinutes_() {
  if (amPmBoundaryCache_ !== null) return amPmBoundaryCache_;

  var text = getProperty_(PROP_AM_PM_BOUNDARY);
  if (text === null) text = DEFAULT_AM_PM_BOUNDARY;

  var matched = /^([0-9]{1,2}):([0-9]{2})$/.exec(String(text).trim());
  if (matched === null) {
    throw new Error(
      'Script Properties の「' + PROP_AM_PM_BOUNDARY + '」は 14:00 のような形式で指定してください: ' + text
    );
  }
  var hour = Number(matched[1]);
  var minute = Number(matched[2]);
  if (hour > 23 || minute > 59) {
    throw new Error(
      'Script Properties の「' + PROP_AM_PM_BOUNDARY + '」が時刻として正しくありません: ' + text
    );
  }

  amPmBoundaryCache_ = hour * 60 + minute;
  return amPmBoundaryCache_;
}

/** 設定されている境目を「14:00」の形で返す（ログ用）。 */
function formatAmPmBoundary_() {
  var minutes = getAmPmBoundaryMinutes_();
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return p(Math.floor(minutes / 60)) + ':' + p(minutes % 60);
}

/** 日本時間の UTC からのオフセット（分）。Date.getTimezoneOffset() は符号が逆で -540 になる。 */
var JST_TIMEZONE_OFFSET_MINUTES = -540;

/**
 * スクリプトが日本時間で動いていることを確認する。
 *
 * 日付の切り替わり・AM / PM 判定・カレンダーの 1 日の範囲は、
 * すべて GAS プロジェクトのタイムゾーン設定に従う。ここがずれると日報がずれるため処理を止める。
 * （タイムゾーン名ではなく実際の時差を見ることで、追加の OAuth 権限なしに判定する）
 */
function assertTimeZone_() {
  var offset = new Date().getTimezoneOffset();
  if (offset !== JST_TIMEZONE_OFFSET_MINUTES) {
    throw new Error(
      'スクリプトが日本時間で動いていません（UTC からの時差: ' + -offset / 60 + ' 時間）。' +
        '［プロジェクトの設定］でタイムゾーンを「' + TIME_ZONE + '」に変更してください。'
    );
  }
}
