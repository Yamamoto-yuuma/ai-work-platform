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

/** 次営業日を探すときに先読みする最大日数（無限ループ防止）。 */
var MAX_BUSINESS_DAY_LOOKAHEAD = 14;

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

/**
 * GAS プロジェクトのタイムゾーンが Asia/Tokyo であることを確認する。
 * ここがずれていると日付の切り替わりと AM / PM 判定がずれるため、処理を止める。
 */
function assertTimeZone_() {
  var current = Session.getScriptTimeZone();
  if (current !== TIME_ZONE) {
    throw new Error(
      'GAS プロジェクトのタイムゾーンが「' + current + '」です。' +
        '［プロジェクトの設定］で「' + TIME_ZONE + '」に変更してください。'
    );
  }
}
