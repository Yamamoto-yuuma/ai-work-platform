/**
 * 日報自動生成システム（Google Apps Script）
 *
 * カレンダーの予定から日報を作り、「日報」シートに下書きとして書き出す。
 * Chatwork の本番ルームへ送るのは、ボタンを押したときだけで、トリガーからは送信しない。
 *
 * ■ このファイルは自動生成です
 *   gas/daily-report/*.gs を 1 本にまとめたものです。直すときは元のファイルを直し、
 *   npm run bundle:gas で作り直してください。ここを直しても次の生成で消えます。
 *
 * ■ このコードはスプレッドシートに紐づけて使います
 *   日報用のスプレッドシートを開き、［拡張機能］→［Apps Script］から貼り付けてください。
 *   （単独の Apps Script プロジェクトでは、シートへの書き出しとボタンが使えません）
 *
 * ■ 使う前に
 *   1. ［プロジェクトの設定］でタイムゾーンを Asia/Tokyo にする
 *   2. ［スクリプト プロパティ］に CHATWORK_API_TOKEN と CHATWORK_ROOM_ID を設定する
 *   3. runAllTests を実行して全件成功することを確認する
 *   4. setupTriggers を実行してトリガー（12:55 / 18:25）を作る
 *
 * ■ 毎日の流れ
 *   12:55 / 18:25 にトリガーが動き、「日報」シートに下書きが 1 行増える
 *     ↓ 本文のセルで所感を書き足す（そのままでもよい）
 *   ボタン（またはメニュー［日報］）を押す → 確認ダイアログ → Chatwork へ送信
 *
 * ■ 日報に入るもの
 *   そのまま Chatwork へ貼れる本文だけです。
 *   どちらの型かを示す見出し（昼用・夜用の別）は入りません。
 *
 * ■ AI Work（業務プラットフォーム）から使う場合
 *   ［スクリプト プロパティ］に API_SHARED_SECRET（推測されにくい文字列）を足し、
 *   ［デプロイ］→［新しいデプロイ］→ ウェブアプリ（実行:自分 / アクセス:全員）で公開します。
 *   その URL と合言葉を、プラットフォーム側の環境変数
 *   DAILY_REPORT_GAS_URL / DAILY_REPORT_SECRET に設定してください。
 *   合言葉が合わないリクエストは通しません。
 *
 *   コードを貼り替えたあとは、［デプロイを管理］→ 編集 → バージョン「新バージョン」で
 *   更新してください。ウェブアプリはデプロイ済みの版を配るので、保存しただけでは
 *   プラットフォーム側は古いコードのまま動きます。
 *
 * ■ 実行ボタン・シートのボタンに割り当てられる関数
 *   sendDayReportButton / sendNightReportButton  送信（確認ダイアログあり）
 *   rebuildDayDraft     / rebuildNightDraft      下書きを作り直す
 *   runAllTests                                  テスト
 *   setupTriggers                                トリガーを作る
 *   showDayDraft / showNightDraft                下書きをログで確認
 *   sendDayDraft / sendNightDraft                送信（ダイアログなし・エディタ用）
 *   runDayReport / runNightReport                下書きを作る（トリガーが実行するもの）
 *   testDayReport / testNightReport              本文だけ確認
 *   testTodayEvents                              今日の予定を確認（HOME の「今日の並び」用）
 *
 *   これ以外の関数は名前の末尾が _ になっており、実行メニューには出ません。
 *   （doGet / doPost はウェブアプリの入口です。手で実行するものではありません）
 */

/* ==================================================================
 * config.gs
 * ================================================================== */
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

/* ==================================================================
 * date.gs
 * ================================================================== */
/**
 * 日本時間（Asia/Tokyo）を前提とした日付ユーティリティ。
 */

var WEEKDAY_LABELS_JA = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 日付を受け取る関数が、正しく日付を渡されたか確認する。
 *
 * Apps Script の実行ボタンは引数を渡せないため、部品の関数を選んで実行すると
 * ここで止まる。原因が分かるように、代わりに実行すべき関数を案内する。
 */
function assertDate_(value) {
  var isDate = Object.prototype.toString.call(value) === '[object Date]';
  if (!isDate || isNaN(value.getTime())) {
    throw new Error(
      'この関数は日付を受け取る部品のため、エディタの実行ボタンからは直接実行できません。' +
        '日報を確認するときは showDayDraft / showNightDraft、動作確認は runAllTests、' +
        '本番ルームへ送るときは sendDayDraft / sendNightDraft を選んで実行してください。'
    );
  }
}

/**
 * 日本時間での年・月・日を取り出す。
 * @return {{year: number, month: number, day: number}}
 */
function getJstDateParts_(date) {
  var text = Utilities.formatDate(date, TIME_ZONE, 'yyyy-MM-dd');
  var parts = text.split('-');
  return { year: Number(parts[0]), month: Number(parts[1]), day: Number(parts[2]) };
}

/**
 * 日本時間での曜日（0 = 日曜 … 6 = 土曜）。
 */
function getJstDayOfWeek_(date) {
  var p = getJstDateParts_(date);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/**
 * 日本時間での時（0-23）。
 */
function getJstHour_(date) {
  return Number(Utilities.formatDate(date, TIME_ZONE, 'H'));
}

/**
 * 日本時間での日付キー（yyyyMMdd）。送信済み管理・ログ・同日判定に使う。
 */
function formatDateKey_(date) {
  return Utilities.formatDate(date, TIME_ZONE, 'yyyyMMdd');
}

/**
 * 日本時間のその日の 0 時ちょうどを指す Date を返す。
 * 日付の足し算やカレンダー取得はこの正規化済みの値を使う。
 */
function toJstStartOfDay_(date) {
  var p = getJstDateParts_(date);
  return new Date(p.year, p.month - 1, p.day, 0, 0, 0, 0);
}

/**
 * 日数を加算した日付（日本時間の 0 時）を返す。
 */
function addDays_(date, days) {
  var p = getJstDateParts_(date);
  return new Date(p.year, p.month - 1, p.day + days, 0, 0, 0, 0);
}

/**
 * 日報が対象とする「業務日」。
 *
 * 夜の日報を 18:25 に作り、送るのが日付をまたいだあとになることがある。
 * 暦の日付で切ると、日付が変わった瞬間に前日の下書きが行方不明になるので、
 * 朝 BUSINESS_DAY_START_HOUR 時までは前日の続きとして扱う。
 *
 * トリガーは 12:55 と 18:25 に動くので、この切り替えの影響は受けない。
 */
function businessToday_() {
  var now = new Date();
  var today = toJstStartOfDay_(now);
  return getJstHour_(now) < BUSINESS_DAY_START_HOUR ? addDays_(today, -1) : today;
}

/**
 * 日報に表示する日付文字列。例: 2026年9月11日(金)
 */
function formatJapaneseDate_(date) {
  var p = getJstDateParts_(date);
  var weekday = WEEKDAY_LABELS_JA[getJstDayOfWeek_(date)];
  return p.year + '年' + p.month + '月' + p.day + '日(' + weekday + ')';
}

/**
 * 'yyyy-MM-dd' 形式の文字列を日本時間の 0 時の Date に変換する。
 * 日付を指定してテスト・手動生成するときに使う。
 */
function parseDate_(dateText) {
  var matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText).trim());
  if (!matched) {
    throw new Error('日付は yyyy-MM-dd 形式で指定してください: ' + dateText);
  }
  return new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]), 0, 0, 0, 0);
}

/* ==================================================================
 * businessDay.gs
 * ================================================================== */
/**
 * 営業日判定。
 *
 * 土曜・日曜・日本の祝日を休日として扱う。
 * 祝日はコードへ列挙せず、日本の祝日カレンダー（Script Property で変更可能）を参照する。
 */

/** 1 回の実行の中で祝日カレンダーへの問い合わせを繰り返さないためのキャッシュ。 */
var holidayCache_ = {};

/** 1 回の実行の中で使い回す祝日カレンダー。 */
var holidayCalendarCache_ = null;

/**
 * 土日かどうか。
 */
function isWeekend_(date) {
  var dayOfWeek = getJstDayOfWeek_(date);
  return dayOfWeek === 0 || dayOfWeek === 6;
}

/**
 * 祝日カレンダーを取得する（実行中は使い回す）。
 * アクセスできない場合はエラーにする（祝日に誤って投稿しないため）。
 */
function getHolidayCalendar_() {
  if (holidayCalendarCache_ !== null) return holidayCalendarCache_;

  var calendarId = getHolidayCalendarId_();
  var calendar;
  try {
    calendar = CalendarApp.getCalendarById(calendarId);
  } catch (e) {
    throw new Error('祝日カレンダーへアクセスできません（ID: ' + calendarId + '）: ' + e);
  }
  if (!calendar) {
    throw new Error(
      '祝日カレンダーが見つかりません（ID: ' + calendarId + '）。' +
        'Script Properties の「' + PROP_HOLIDAY_CALENDAR_ID + '」を確認してください。'
    );
  }

  holidayCalendarCache_ = calendar;
  return calendar;
}

/**
 * 祝日カレンダーの予定が「休業日」を表すかどうか。
 *
 * Google の「日本の祝日」カレンダーには祝日と行事（節分・七夕・銀行休業日など）が混在しており、
 * 行事の日は通常どおり出社する営業日のため、休業日として扱ってはいけない。
 * 種別は予定の説明の 1 行目に入っている（祝日 / 祭日）。
 */
function isHolidayEvent_(event) {
  var description;
  try {
    description = event.getDescription();
  } catch (e) {
    // 説明を読めない場合は種別を判定できないため、安全側に倒して休業日として扱う。
    Logger.log('祝日カレンダーの予定の説明を取得できませんでした（休業日として扱います）: ' + e);
    return true;
  }

  var label = String(description === null || description === undefined ? '' : description)
    .split('\n')[0]
    .trim();

  for (var i = 0; i < HOLIDAY_CALENDAR_NON_HOLIDAY_LABELS.length; i++) {
    if (label === HOLIDAY_CALENDAR_NON_HOLIDAY_LABELS[i]) return false;
  }
  return true;
}

/**
 * 日本の祝日（休業日）かどうか。
 */
function isHoliday_(date) {
  var key = formatDateKey_(date);
  if (Object.prototype.hasOwnProperty.call(holidayCache_, key)) {
    return holidayCache_[key];
  }

  var calendar = getHolidayCalendar_();
  var events;
  try {
    events = calendar.getEventsForDay(toJstStartOfDay_(date));
  } catch (e) {
    throw new Error('祝日カレンダーの取得に失敗しました（' + key + '）: ' + e);
  }

  var isHoliday = false;
  for (var i = 0; i < events.length; i++) {
    if (isHolidayEvent_(events[i])) {
      isHoliday = true;
      break;
    }
  }

  holidayCache_[key] = isHoliday;
  return isHoliday;
}

/**
 * 営業日（平日かつ祝日でない）かどうか。
 */
function isBusinessDay_(date) {
  assertDate_(date);
  if (isWeekend_(date)) return false;
  return !isHoliday_(date);
}

/**
 * 休日と判定した理由をログ用に返す（営業日なら null）。
 */
function describeNonBusinessDay_(date) {
  if (isWeekend_(date)) {
    return getJstDayOfWeek_(date) === 6 ? '土曜日' : '日曜日';
  }
  if (isHoliday_(date)) return '祝日';
  return null;
}

/* ==================================================================
 * calendar.gs
 * ================================================================== */
/**
 * Google カレンダーからの予定取得。
 *
 * 使うのは予定のタイトルと開始時刻だけ。説明・参加者・場所は使用しない。
 */

/** 1 回の実行の中で使い回す対象カレンダー。 */
var targetCalendarCache_ = null;

/**
 * 予定を取得する対象カレンダー（実行中は使い回す）。
 * Script Property `TARGET_CALENDAR_ID` があればそのカレンダー、なければ実行者のデフォルトカレンダー。
 */
function getTargetCalendar_() {
  if (targetCalendarCache_ !== null) return targetCalendarCache_;
  targetCalendarCache_ = resolveTargetCalendar_();
  return targetCalendarCache_;
}

/** 設定に従って対象カレンダーを解決する。見つからない場合はエラーにする。 */
function resolveTargetCalendar_() {
  var calendarId = getTargetCalendarId_();

  if (calendarId === null) {
    var defaultCalendar;
    try {
      defaultCalendar = CalendarApp.getDefaultCalendar();
    } catch (e) {
      throw new Error('デフォルトカレンダーへアクセスできません: ' + e);
    }
    if (!defaultCalendar) {
      throw new Error('デフォルトカレンダーが取得できませんでした。カレンダーの権限を確認してください。');
    }
    return defaultCalendar;
  }

  var calendar;
  try {
    calendar = CalendarApp.getCalendarById(calendarId);
  } catch (e) {
    throw new Error('カレンダーへアクセスできません（ID: ' + calendarId + '）: ' + e);
  }
  if (!calendar) {
    throw new Error(
      '対象カレンダーが見つかりません（ID: ' + calendarId + '）。' +
        'Script Properties の「' + PROP_TARGET_CALENDAR_ID + '」を確認してください。'
    );
  }
  return calendar;
}

/**
 * 指定日の予定を開始時刻の早い順に返す。
 *
 * - 終日イベントは INCLUDE_ALL_DAY_EVENTS が false の間は除外する。
 * - 前日から続いている予定は、開始日が当日でないため対象外とする。
 *
 * @return {Array.<{title: string, startTime: Date, endTime: Date, allDay: boolean}>}
 */
function getCalendarEvents_(date) {
  assertDate_(date);
  var calendar = getTargetCalendar_();
  var targetDay = toJstStartOfDay_(date);
  var dateKey = formatDateKey_(targetDay);

  var events;
  try {
    events = calendar.getEventsForDay(targetDay);
  } catch (e) {
    throw new Error('カレンダーの予定取得に失敗しました（' + dateKey + '）: ' + e);
  }

  var result = [];
  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    var isAllDay = event.isAllDayEvent();

    if (isAllDay && !INCLUDE_ALL_DAY_EVENTS) continue;

    var startTime = event.getStartTime();
    if (!isAllDay && formatDateKey_(startTime) !== dateKey) continue;

    /*
      終了時刻も持つ。日報では使わないが、HOME の 1 日の並びで
      「何時から何時まで埋まっているか」を出すのに要る。
      終日イベントは終了が翌日 0 時になるため、そのまま使わない。
    */
    result.push({
      title: event.getTitle(),
      startTime: startTime,
      endTime: isAllDay ? startTime : event.getEndTime(),
      allDay: isAllDay,
    });
  }

  result.sort(function (a, b) {
    return a.startTime.getTime() - b.startTime.getTime();
  });
  return result;
}

/**
 * AM（00:00:00 - 11:59:59 開始）の予定。
 */
function getMorningEvents_(date) {
  assertDate_(date);
  return filterEventsByHalf_(getCalendarEvents_(date), true);
}

/**
 * PM（12:00:00 - 23:59:59 開始）の予定。
 */
function getAfternoonEvents_(date) {
  assertDate_(date);
  return filterEventsByHalf_(getCalendarEvents_(date), false);
}

/**
 * 開始時刻を基準に AM / PM で絞り込む。
 */
function filterEventsByHalf_(events, wantMorning) {
  var result = [];
  for (var i = 0; i < events.length; i++) {
    var isMorning = getJstHour_(events[i].startTime) < 12;
    if (isMorning === wantMorning) result.push(events[i]);
  }
  return result;
}

/**
 * 予定の配列からタイトルだけを取り出す。
 */
function toEventTitles_(events) {
  var titles = [];
  for (var i = 0; i < events.length; i++) {
    titles.push(events[i].title);
  }
  return titles;
}

/**
 * 指定日の予定を 1 回だけ取得し、AM / PM のタイトル配列に分けて返す。
 * @return {{morning: Array.<string>, afternoon: Array.<string>}}
 */
function getEventTitlesByHalf_(date) {
  var events = getCalendarEvents_(date);
  return {
    morning: toEventTitles_(filterEventsByHalf_(events, true)),
    afternoon: toEventTitles_(filterEventsByHalf_(events, false)),
  };
}

/**
 * 指定日の予定を、画面に並べられる形で返す。
 *
 * 日報とは別の用途（HOME で 1 日の埋まり具合を見る）なので、時刻も一緒に渡す。
 * 出欠や参加者は渡さない。必要になるまで外へ出す情報を増やさない。
 *
 * @return {Array.<{title: string, start: string, end: string, allDay: boolean}>}
 */
function getDayEventsForApi_(date) {
  var events = getCalendarEvents_(date);
  var out = [];
  for (var i = 0; i < events.length; i++) {
    out.push({
      title: formatTitleLine_(events[i].title) === null ? '' : events[i].title,
      start: formatTimestamp_(events[i].startTime),
      end: formatTimestamp_(events[i].endTime),
      allDay: events[i].allDay === true,
    });
  }
  return out;
}

/* ==================================================================
 * nightBody.gs
 * ================================================================== */
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

/* ==================================================================
 * report.gs
 * ================================================================== */
/**
 * 昼の日報本文の生成。
 *
 * フォーマットは固定のため、AI・LLM は使用しない。
 * カレンダーのタイトルをそのまま「■」付きの行にするだけ。
 *
 * 夜の日報はここでは作らない。スプレッドシートの「日報」タブがそのまま本文になる
 * （nightBody.gs）。同じ文面を二か所で組み立てると、片方だけ直した日に食い違う。
 *
 * 出来上がるのは、そのまま Chatwork へ貼れる本文だけにする。
 * 「【昼用】」「【夜用】」のような、どちらの型かを示す見出しは入れない。
 * 送る前に毎回消す手間になるうえ、消し忘れるとそのまま相手に届く。
 */

/** 昼の日報で AM ブロックと業務予定の間に入る行（半角スペース 1 つ）。 */
var DAY_REPORT_SPACER_LINE = ' ';

/**
 * 予定タイトルを日報の 1 行にする。
 * すでに「■」が付いている場合は二重にしない。空タイトルは null を返す。
 */
function formatTitleLine_(title) {
  var text = String(title === null || title === undefined ? '' : title);
  // 予定名に改行が入っていると、1 件が複数行になって日報の形が崩れる。
  // 見出しのない行や、偽の「■」行ができてしまうため、1 行に畳む。
  text = text.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  text = text.replace(/^[■\s]+/, '').trim();
  if (text === '') return null;
  return '■' + text;
}

/**
 * タイトル配列を日報の行として lines へ追加する。
 * 予定が無い場合は何も足さない（「予定なし」等の文言は入れない）。
 */
function appendTitleLines_(lines, titles) {
  if (!titles) return;
  for (var i = 0; i < titles.length; i++) {
    var line = formatTitleLine_(titles[i]);
    if (line !== null) lines.push(line);
  }
}

/**
 * 昼の日報本文を組み立てる（カレンダーへはアクセスしない純粋な処理）。
 *
 * @param {Array.<string>} morningTitles 当日 AM の予定タイトル
 * @param {Array.<string>} afternoonTitles 当日 PM の予定タイトル
 */
function buildDayReportBody_(morningTitles, afternoonTitles) {
  var lines = [];
  lines.push('---業務報告---');
  lines.push('AM');
  appendTitleLines_(lines, morningTitles);
  lines.push(DAY_REPORT_SPACER_LINE);
  lines.push('---業務予定---');
  lines.push('PM');
  appendTitleLines_(lines, afternoonTitles);
  return lines.join('\n');
}

/**
 * 指定日の昼の日報本文を生成する（カレンダーを参照する）。
 */
function generateDayReport_(date) {
  assertDate_(date);
  var titles = getEventTitlesByHalf_(date);
  return buildDayReportBody_(titles.morning, titles.afternoon);
}

/**
 * 指定日の夜の日報本文を取得する。
 *
 * 夜はスプレッドシートの「日報」タブがそのまま本文になる。ここでは文面を作らない。
 * 日付も挨拶もシート側に入っているため、date は受け取らない。
 */
function generateNightReport_() {
  return readNightReportBody_();
}

/* ==================================================================
 * chatwork.gs
 * ================================================================== */
/**
 * Chatwork への投稿。
 *
 * API Token は x-chatworktoken ヘッダーで送る（URL には含めない）。
 * 投稿本文は生成した日報そのもので、前後に文章を足さない。
 */

var CHATWORK_API_BASE_URL = 'https://api.chatwork.com/v2';

/** レート制限・一時的なサーバーエラー時の再試行回数と待ち時間（ミリ秒）。 */
var CHATWORK_MAX_ATTEMPTS = 3;
var CHATWORK_RETRY_WAIT_MS = [2000, 5000];

/**
 * 日報本文を本番ルームへ投稿する。
 *
 * 呼び出すのは手動送信（sendDayDraft() / sendNightDraft()）のときだけで、
 * 自動実行のトリガーからは呼ばれない。
 *
 * @return {string} 投稿したメッセージ ID
 */
function sendToChatwork_(message) {
  if (String(message === null || message === undefined ? '' : message).trim() === '') {
    throw new Error('Chatwork へ送信する本文が空です。');
  }

  var token = getChatworkApiToken_();
  var roomId = getChatworkRoomId_();
  var url = CHATWORK_API_BASE_URL + '/rooms/' + roomId + '/messages';

  var options = {
    method: 'post',
    headers: { 'x-chatworktoken': token },
    payload: { body: message },
    muteHttpExceptions: true,
  };

  for (var attempt = 1; attempt <= CHATWORK_MAX_ATTEMPTS; attempt++) {
    var response;
    try {
      response = UrlFetchApp.fetch(url, options);
    } catch (e) {
      // ネットワークレベルの失敗。残り試行があれば待って再実行する。
      if (attempt < CHATWORK_MAX_ATTEMPTS) {
        Logger.log('Chatwork への接続に失敗しました（' + attempt + ' 回目）: ' + e);
        Utilities.sleep(CHATWORK_RETRY_WAIT_MS[attempt - 1]);
        continue;
      }
      throw new Error('Chatwork API への接続に失敗しました: ' + e);
    }

    var status = response.getResponseCode();
    var responseBody = response.getContentText();

    if (status === 200) {
      return parseChatworkMessageId_(responseBody);
    }

    if (isChatworkRetriableStatus_(status) && attempt < CHATWORK_MAX_ATTEMPTS) {
      Logger.log(
        'Chatwork API が一時的なエラーを返しました（' + attempt + ' 回目 / status ' + status + '）: ' + responseBody
      );
      Utilities.sleep(CHATWORK_RETRY_WAIT_MS[attempt - 1]);
      continue;
    }

    throw new Error(describeChatworkError_(status, responseBody));
  }

  // ここには到達しない。
  throw new Error('Chatwork API への送信が完了しませんでした。');
}

/**
 * 再試行する価値のあるステータスか（レート制限・サーバーエラー）。
 */
function isChatworkRetriableStatus_(status) {
  return status === 429 || status >= 500;
}

/**
 * ステータスごとに原因が分かるエラーメッセージを組み立てる。
 * API Token は決してログ・メッセージへ含めない。
 */
function describeChatworkError_(status, responseBody) {
  var reason;
  if (status === 401) {
    reason = 'Chatwork API の認証に失敗しました。Script Properties の「' + PROP_CHATWORK_API_TOKEN + '」を確認してください。';
  } else if (status === 403) {
    reason = 'Chatwork API の権限が不足しています。トークンの権限と、ルームへの参加状態を確認してください。';
  } else if (status === 404) {
    reason = '投稿先の Chatwork ルームが見つかりません。「' + PROP_CHATWORK_ROOM_ID + '」を確認してください。';
  } else if (status === 429) {
    reason = 'Chatwork API のレート制限に達しました。時間をおいて再実行してください。';
  } else if (status >= 500) {
    reason = 'Chatwork API がサーバーエラーを返しました。';
  } else {
    reason = 'Chatwork API がエラーを返しました。';
  }
  return reason + '（status ' + status + ' / response: ' + responseBody + '）';
}

/**
 * 応答からメッセージ ID を取り出す（取れなくても投稿自体は成功しているため落とさない）。
 */
function parseChatworkMessageId_(responseBody) {
  try {
    var parsed = JSON.parse(responseBody);
    if (parsed && parsed.message_id) return String(parsed.message_id);
  } catch (e) {
    Logger.log('Chatwork の応答を解釈できませんでした: ' + responseBody);
  }
  return '';
}

/* ==================================================================
 * lock.gs
 * ================================================================== */
/**
 * 二重実行・二重投稿の防止。
 *
 * - 同時実行は LockService で防ぐ。
 * - 同じ日・同じ種類の日報の再送信は Script Properties の送信済みフラグで防ぐ。
 */

/** ロック取得の待ち時間（ミリ秒）。 */
var LOCK_WAIT_MS = 30000;

/** 送信済みフラグの値。 */
var SENT_FLAG_VALUE = 'sent';

/**
 * 送信済み管理キー。例: 20260911_day / 20260911_night
 */
function buildReportKey_(date, reportType) {
  assertDate_(date);
  return formatDateKey_(date) + '_' + reportType;
}

/**
 * すでに送信済みか。
 */
function hasAlreadySent_(reportKey) {
  return PropertiesService.getScriptProperties().getProperty(reportKey) === SENT_FLAG_VALUE;
}

/**
 * 送信済みとして記録する。
 */
function markAsSent_(reportKey) {
  PropertiesService.getScriptProperties().setProperty(reportKey, SENT_FLAG_VALUE);
}

/**
 * スクリプトロックを取得したうえで処理を実行する。
 * 取得できなかった場合は処理を実行せず false を返す。
 *
 * @param {function(): void} task
 * @return {boolean} 実行したかどうか
 */
function runExclusively_(task) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    Logger.log('他の実行が処理中のため、今回の実行は中止しました（二重投稿防止）。');
    return false;
  }
  try {
    task();
  } finally {
    lock.releaseLock();
  }
  return true;
}

/* ==================================================================
 * sheet.gs
 * ================================================================== */
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

/* ==================================================================
 * draft.gs
 * ================================================================== */
/**
 * 下書きの保管。
 *
 * 下書きは「日報」シートに書き出し、同じ内容を Script Properties にも控える。
 * 送信するときはシートの本文を使うので、セル上で所感を書き足してから送れる。
 *
 * 自動実行では日報を作って、ここに下書きとして残すところまでを行う。
 * Chatwork の本番ルームへ送るのは、手動で sendDayDraft() / sendNightDraft() を
 * 実行したときだけ（「日報を作る」と「Chatwork へ送る」を分けている）。
 *
 * 将来 AI 業務プラットフォームから読み出せるよう、下書きは次の形で保管する。
 *   {
 *     reportDate:  "2026-09-11",   // 日報の日付（日本時間）
 *     reportType:  "day" | "night",
 *     body:        "---業務報告---…", // 日報本文
 *     status:      "draft" | "sent",
 *     generatedAt: "2026-09-11T12:55:00+09:00",
 *     sentAt:      "2026-09-11T13:02:00+09:00"  // 送信済みのときだけ入る
 *   }
 */

var DRAFT_STATUS_DRAFT = 'draft';
var DRAFT_STATUS_SENT = 'sent';

/** 下書きの保管キー。例: draft_20260911_day */
function buildDraftKey_(date, reportType) {
  return 'draft_' + formatDateKey_(date) + '_' + reportType;
}

/** 保管する日時の文字列。例: 2026-09-11T12:55:00+09:00（日本時間で動くことは別途確認済み） */
function formatTimestamp_(date) {
  return Utilities.formatDate(date, TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ss") + '+09:00';
}

/**
 * 下書きを保存する。
 *
 * 中身が前回と同じなら、生成日時や状態を含めてそのまま残す。
 * 予定が変わって中身が変わった場合は、新しい下書きとして保存し直す。
 */
function saveDraft_(date, reportType, body) {
  var existing = null;
  try {
    existing = loadDraft_(date, reportType);
  } catch (e) {
    // 壊れている下書きは、そのまま上書きする。
    Logger.log('保存済みの下書きを読めなかったため作り直します: ' + e);
  }
  if (existing !== null && existing.body === body) {
    writeDraftToSheetQuietly_(date, reportType, body, existing.generatedAt);
    return existing;
  }

  var record = {
    reportDate: Utilities.formatDate(date, TIME_ZONE, 'yyyy-MM-dd'),
    reportType: reportType,
    body: body,
    status: DRAFT_STATUS_DRAFT,
    generatedAt: formatTimestamp_(new Date()),
  };
  writeDraft_(date, reportType, record);
  writeDraftToSheetQuietly_(date, reportType, body, record.generatedAt);
  return record;
}

/**
 * シートへの書き出し。
 * シートが使えなくても下書き自体は Script Properties に残るため、警告を残して処理は続ける。
 */
function writeDraftToSheetQuietly_(date, reportType, body, generatedAt) {
  try {
    saveDraftToSheet_(date, reportType, body, generatedAt);
  } catch (e) {
    Logger.log('スプレッドシートへ書き出せませんでした（下書きは保存済みです）: ' + e);
  }
}

/**
 * 送信する本文を取り出す。
 *
 * シートの本文を優先する（セル上で書き足した所感を反映するため）。
 * シートが使えない場合は Script Properties の控えを使う。
 */
function loadDraftBody_(date, reportType) {
  try {
    var fromSheet = readDraftBodyFromSheet_(date, reportType);
    if (fromSheet !== null) return fromSheet;
  } catch (e) {
    Logger.log('スプレッドシートから本文を読めませんでした（控えを使います）: ' + e);
  }

  var record = loadDraft_(date, reportType);
  return record === null ? null : record.body;
}

/** 下書きを書き込む。 */
function writeDraft_(date, reportType, record) {
  PropertiesService.getScriptProperties().setProperty(
    buildDraftKey_(date, reportType),
    JSON.stringify(record)
  );
}

/**
 * 保存済みの下書きを取り出す。無ければ null。
 * @return {?{reportDate: string, reportType: string, body: string, status: string,
 *            generatedAt: string, sentAt: (string|undefined)}}
 */
function loadDraft_(date, reportType) {
  var raw = PropertiesService.getScriptProperties().getProperty(buildDraftKey_(date, reportType));
  if (!raw) return null;

  var record;
  try {
    record = JSON.parse(raw);
  } catch (e) {
    throw new Error('下書きを読み取れませんでした（key: ' + buildDraftKey_(date, reportType) + '）: ' + e);
  }
  if (!record || typeof record.body !== 'string') {
    throw new Error('下書きの形式が正しくありません（key: ' + buildDraftKey_(date, reportType) + '）。');
  }
  return record;
}

/**
 * 下書きを「本番ルームへ送信済み」の状態にする。
 */
function markDraftSent_(date, reportType) {
  var sentAt = formatTimestamp_(new Date());

  var record = loadDraft_(date, reportType);
  if (record !== null) {
    record.status = DRAFT_STATUS_SENT;
    record.sentAt = sentAt;
    writeDraft_(date, reportType, record);
  }

  try {
    markSheetSent_(date, reportType, sentAt);
  } catch (e) {
    Logger.log('スプレッドシートの状態を更新できませんでした: ' + e);
  }
}

/**
 * 下書きを削除する。
 */
function deleteDraft_(date, reportType) {
  PropertiesService.getScriptProperties().deleteProperty(buildDraftKey_(date, reportType));
}

/**
 * 当日の下書きを取り出す。まだ作られていなければ、その場で作って保存する。
 */
function prepareDraft_(reportType) {
  assertTimeZone_();
  var today = businessToday_();

  var existing = loadDraft_(today, reportType);
  if (existing !== null) return { date: today, record: existing, created: false };

  var body = reportType === REPORT_TYPE_DAY ? generateDayReport_(today) : generateNightReport_();
  return { date: today, record: saveDraft_(today, reportType, body), created: true };
}

/**
 * 下書きをログへ表示する（送信はしない）。
 */
function showDraft_(reportType) {
  var label = reportType === REPORT_TYPE_DAY ? '昼の日報' : '夜の日報';
  var draft = prepareDraft_(reportType);
  var reportKey = buildReportKey_(draft.date, reportType);

  var header =
    '----- ' + label + 'の下書き（' + formatJapaneseDate_(draft.date) + '） -----\n' +
    '生成: ' + draft.record.generatedAt + (draft.created ? '（いま作成しました）' : '') + '\n' +
    '状態: ' + draft.record.status +
    (hasAlreadySent_(reportKey) ? '（本番ルームへ送信済みです）' : '（未送信）') + '\n' +
    '------------------------------------------';

  var body = loadDraftBody_(draft.date, reportType);
  if (body === null) body = draft.record.body;

  Logger.log(header + '\n' + body + '\n------------------------------------------');
  return body;
}

/**
 * 下書きを Chatwork の本番ルームへ送信する（手動実行のときだけ通る道）。
 * 送信済みの場合は再送信しない。
 *
 * @return {boolean} 送信したかどうか
 */
function sendDraft_(reportType) {
  var label = reportType === REPORT_TYPE_DAY ? '昼の日報' : '夜の日報';
  assertTimeZone_();
  var today = businessToday_();

  var sent = false;
  var executed = runExclusively_(function () {
    var reportKey = buildReportKey_(today, reportType);
    if (hasAlreadySent_(reportKey)) {
      Logger.log(label + 'はすでに送信済みです（key: ' + reportKey + '）。再送信しません。');
      return;
    }

    var body = loadDraftBody_(today, reportType);
    if (body === null) {
      throw new Error(
        label + 'の下書きがありません。先にメニューの［' + label +
          'を作り直す］（またはエディタで show' +
          (reportType === REPORT_TYPE_DAY ? 'Day' : 'Night') + 'Draft）を実行してください。'
      );
    }

    var messageId = sendToChatwork_(body);
    markAsSent_(reportKey);
    markDraftSent_(today, reportType);
    sent = true;
    Logger.log(label + 'を本番ルームへ投稿しました（key: ' + reportKey + ' / message_id: ' + messageId + '）。');
  });

  if (!executed) {
    Logger.log(label + 'の送信をロック未取得のため中止しました。少し待って再実行してください。');
  }
  return sent;
}

/* ==================================================================
 * main.gs
 * ================================================================== */
/**
 * エントリポイント。
 *
 * 自動実行（トリガー）と手動実行の入口、テスト用の本文確認、トリガー設定をまとめる。
 */

var REPORT_TYPE_DAY = 'day';
var REPORT_TYPE_NIGHT = 'night';

/* ------------------------------------------------------------------ *
 * 自動実行・手動実行
 * ------------------------------------------------------------------ */

/**
 * 昼の日報の下書きを用意する（12:55 頃のトリガー／手動実行の入口）。
 * 下書きを保存するだけで、Chatwork へは送らない。
 */
function runDayReport() {
  runReport_(REPORT_TYPE_DAY);
}

/**
 * 夜の日報の下書きを用意する（18:25 頃のトリガー／手動実行の入口）。
 * 下書きを保存するだけで、Chatwork へは送らない。
 */
function runNightReport() {
  runReport_(REPORT_TYPE_NIGHT);
}

/* ------------------------------------------------------------------ *
 * 下書きの確認と送信（手動）
 * ------------------------------------------------------------------ */

/** 当日の昼の日報の下書きを表示する（送信はしない）。無ければその場で作る。 */
function showDayDraft() {
  return showDraft_(REPORT_TYPE_DAY);
}

/** 当日の夜の日報の下書きを表示する（送信はしない）。無ければその場で作る。 */
function showNightDraft() {
  return showDraft_(REPORT_TYPE_NIGHT);
}

/** 確認した昼の日報の下書きを Chatwork の本番ルームへ送信する（手動実行のみ）。 */
function sendDayDraft() {
  return sendDraft_(REPORT_TYPE_DAY);
}

/** 確認した夜の日報の下書きを Chatwork の本番ルームへ送信する（手動実行のみ）。 */
function sendNightDraft() {
  return sendDraft_(REPORT_TYPE_NIGHT);
}

/**
 * 日報の生成と下書き保存。
 *
 * ここから Chatwork へ送信することはない（送信は sendDayDraft() / sendNightDraft() のみ）。
 * 土日祝は何もせずに終了する（トリガーは止めない）。
 * 同日・同種の日報が本番ルームへ送信済みの場合も何もしない。
 */
function runReport_(reportType) {
  var label = reportType === REPORT_TYPE_DAY ? '昼の日報' : '夜の日報';

  try {
    assertTimeZone_();

    var today = businessToday_();
    var dateKey = formatDateKey_(today);

    var nonBusinessDayReason = describeNonBusinessDay_(today);
    if (nonBusinessDayReason !== null) {
      Logger.log(dateKey + ' は' + nonBusinessDayReason + 'のため、' + label + 'は作成しません。');
      return;
    }

    var executed = runExclusively_(function () {
      var reportKey = buildReportKey_(today, reportType);
      if (hasAlreadySent_(reportKey)) {
        Logger.log(label + 'はすでに送信済みです（key: ' + reportKey + '）。再送信しません。');
        return;
      }

      var body =
        reportType === REPORT_TYPE_DAY ? generateDayReport_(today) : generateNightReport_();
      var record = saveDraft_(today, reportType, body);

      Logger.log(
        label + 'の下書きを保存しました（key: ' + buildDraftKey_(today, reportType) +
          ' / status: ' + record.status + '）。Chatwork へは送信していません。\n' +
          '内容の確認: ' + (reportType === REPORT_TYPE_DAY ? 'showDayDraft()' : 'showNightDraft()') + '\n' +
          '本番ルームへの送信: ' + (reportType === REPORT_TYPE_DAY ? 'sendDayDraft()' : 'sendNightDraft()') + '\n' +
          body
      );
    });

    if (!executed) {
      Logger.log(label + 'の処理をロック未取得のためスキップしました。');
    }
  } catch (e) {
    // 握りつぶさず、原因をログへ残したうえで実行を失敗させる（トリガーの失敗通知を効かせるため）。
    Logger.log(label + 'の処理でエラーが発生しました: ' + e + (e && e.stack ? '\n' + e.stack : ''));
    throw e;
  }
}

/* ------------------------------------------------------------------ *
 * テスト（Chatwork へは送信しない）
 * ------------------------------------------------------------------ */

/**
 * 当日の昼の日報本文をログへ出力する（投稿はしない）。
 */
function testDayReport() {
  return testDayReportForDate_(Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd'));
}

/**
 * 当日の夜の日報本文をログへ出力する（投稿はしない）。
 */
function testNightReport() {
  return testNightReportForDate_(Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd'));
}

/**
 * 今日の予定をログへ出力する（投稿もシートへの書き出しもしない）。
 *
 * HOME の「今日の並び」に渡している中身を、そのまま目で確かめるためのもの。
 * ウェブアプリ経由でしか使わない口なので、これが無いと動作を確認できない。
 */
function testTodayEvents() {
  assertTimeZone_();
  var today = businessToday_();
  var events = getDayEventsForApi_(today);

  if (events.length === 0) {
    Logger.log(formatJapaneseDate_(today) + ' の予定はありません。');
    return events;
  }

  var lines = [];
  for (var i = 0; i < events.length; i++) {
    lines.push(
      events[i].start.substring(11, 16) + '-' + events[i].end.substring(11, 16) +
        '  ' + events[i].title
    );
  }
  Logger.log(
    '----- ' + formatJapaneseDate_(today) + ' の予定（' + events.length + '件） -----\n' + lines.join('\n')
  );
  return events;
}

/**
 * 日付（yyyy-MM-dd）を指定して昼の日報本文をログへ出力する（投稿はしない）。
 */
function testDayReportForDate_(dateText) {
  assertTimeZone_();
  var date = parseDate_(dateText);
  var body = generateDayReport_(date);
  Logger.log('----- 昼の日報 ' + formatJapaneseDate_(date) + ' -----\n' + body);
  return body;
}

/**
 * 日付（yyyy-MM-dd）を指定して夜の日報本文をログへ出力する（投稿はしない）。
 */
function testNightReportForDate_(dateText) {
  assertTimeZone_();
  // 夜の日報はスプレッドシートの内容そのものなので、日付を変えても中身は変わらない
  var date = parseDate_(dateText);
  var body = generateNightReport_();
  Logger.log('----- 夜の日報（スプレッドシートの内容 / 指定日: ' + formatJapaneseDate_(date) + '） -----\n' + body);
  return body;
}

/* ------------------------------------------------------------------ *
 * トリガー
 * ------------------------------------------------------------------ */

/**
 * 自動実行トリガーを設定する（昼 12:55 頃 / 夜 18:25 頃）。
 *
 * 何度実行しても重複しないよう、同じ関数の既存トリガーを作り直す。
 * 土日祝もトリガーは止めない（実行時に営業日判定でスキップする）。
 * トリガーが行うのは下書きの保存までで、Chatwork への送信は行わない。
 */
function setupTriggers() {
  assertTimeZone_();

  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    var handler = existing[i].getHandlerFunction();
    if (handler === 'runDayReport' || handler === 'runNightReport') {
      ScriptApp.deleteTrigger(existing[i]);
    }
  }

  ScriptApp.newTrigger('runDayReport')
    .timeBased()
    .everyDays(1)
    .atHour(DAY_REPORT_HOUR)
    .nearMinute(DAY_REPORT_MINUTE)
    .create();
  ScriptApp.newTrigger('runNightReport')
    .timeBased()
    .everyDays(1)
    .atHour(NIGHT_REPORT_HOUR)
    .nearMinute(NIGHT_REPORT_MINUTE)
    .create();

  Logger.log(
    'トリガーを設定しました（runDayReport ' + formatTriggerTime_(DAY_REPORT_HOUR, DAY_REPORT_MINUTE) +
      ' 頃 / runNightReport ' + formatTriggerTime_(NIGHT_REPORT_HOUR, NIGHT_REPORT_MINUTE) + ' 頃）。' +
      'トリガーは下書きを保存するだけで、Chatwork へは送信しません。'
  );
}

/** ログ表示用の時刻文字列（例: 13:00）。 */
function formatTriggerTime_(hour, minute) {
  return hour + ':' + (minute < 10 ? '0' + minute : String(minute));
}

/* ==================================================================
 * menu.gs
 * ================================================================== */
/**
 * スプレッドシート上の操作。
 *
 * メニューと、シートに置いたボタンから呼ぶ関数をまとめる。
 * 送信は必ず確認ダイアログを挟む（押した瞬間に本番ルームへ流れないようにするため）。
 */

/**
 * スプレッドシートを開いたときに「日報」メニューを追加する。
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('日報')
    .addItem('昼の日報を作り直す', 'rebuildDayDraft')
    .addItem('夜の日報を作り直す', 'rebuildNightDraft')
    .addSeparator()
    .addItem('昼の日報を Chatwork へ送信', 'sendDayReportButton')
    .addItem('夜の日報を Chatwork へ送信', 'sendNightReportButton')
    .addToUi();
}

/** 昼の下書きを最新のカレンダーで作り直す（送信しない）。 */
function rebuildDayDraft() {
  rebuildDraft_(REPORT_TYPE_DAY);
}

/** 夜の下書きを最新のカレンダーで作り直す（送信しない）。 */
function rebuildNightDraft() {
  rebuildDraft_(REPORT_TYPE_NIGHT);
}

/** 昼の日報を Chatwork へ送信する（シートのボタン・メニュー用）。 */
function sendDayReportButton() {
  confirmAndSend_(REPORT_TYPE_DAY);
}

/** 夜の日報を Chatwork へ送信する（シートのボタン・メニュー用）。 */
function sendNightReportButton() {
  confirmAndSend_(REPORT_TYPE_NIGHT);
}

/* ------------------------------------------------------------------ *
 * 中身
 * ------------------------------------------------------------------ */

/** 画面の通知を出しておく秒数。読む時間はほしいが、作業の邪魔にはしない。 */
var NOTIFY_SECONDS = 8;

/** 画面が使えるなら UI を返す（トリガーからの実行では null）。 */
function getUiOrNull_() {
  try {
    return SpreadsheetApp.getUi();
  } catch (e) {
    return null;
  }
}

/** 画面が使えるならメッセージを出す。使えなければログへ。 */
function notify_(title, message) {
  // ログには必ず残す。画面の通知は見逃せるが、ログは後から追える。
  Logger.log(title + ': ' + message);

  // 知らせるだけの用件で ui.alert は使わない。
  // エディタの実行ボタンから動かしたとき、ダイアログはスプレッドシートの側に出る。
  // その画面を開いていないと、誰も押せない返事を待って「実行中」のまま止まる。
  // toast は返事を待たないので、どこから動かしても処理が終わる。
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(message, title, NOTIFY_SECONDS);
  } catch (e) {
    // スプレッドシートが無い場面（トリガーなど）。ログには残っているのでこのまま進む。
  }
}

/** 下書きを作り直してシートへ反映する。 */
function rebuildDraft_(reportType) {
  var label = reportType === REPORT_TYPE_DAY ? '昼の日報' : '夜の日報';
  try {
    assertTimeZone_();
    var today = businessToday_();

    if (hasAlreadySent_(buildReportKey_(today, reportType))) {
      notify_(label, '今日の' + label + 'はすでに送信済みです。下書きは作り直しません。');
      return;
    }

    var body =
      reportType === REPORT_TYPE_DAY ? generateDayReport_(today) : generateNightReport_();
    saveDraft_(today, reportType, body);
    notify_(label, '最新のカレンダーで下書きを作り直しました。シートの本文をご確認ください。');
  } catch (e) {
    Logger.log(label + 'の作り直しでエラーが発生しました: ' + e + (e && e.stack ? '\n' + e.stack : ''));
    notify_('エラー', label + 'を作り直せませんでした。\n\n' + e);
  }
}

/**
 * 内容を確認したうえで Chatwork の本番ルームへ送信する。
 */
function confirmAndSend_(reportType) {
  var label = reportType === REPORT_TYPE_DAY ? '昼の日報' : '夜の日報';

  try {
    assertTimeZone_();
    var today = businessToday_();

    if (hasAlreadySent_(buildReportKey_(today, reportType))) {
      notify_(label, '今日の' + label + 'はすでに送信済みです。二重に送らないよう、送信しませんでした。');
      return;
    }

    var nonBusinessDayReason = describeNonBusinessDay_(today);
    if (nonBusinessDayReason !== null) {
      Logger.log('今日は' + nonBusinessDayReason + 'ですが、手動送信のため処理を続けます。');
    }

    var body = loadDraftBody_(today, reportType);
    if (body === null) {
      notify_(label, '下書きがありません。先にメニューの［' + label + 'を作り直す］を実行してください。');
      return;
    }

    var ui = getUiOrNull_();
    if (ui !== null) {
      var answer = ui.alert(
        label + 'を Chatwork へ送信します',
        body + '\n\nこの内容で送信しますか？',
        ui.ButtonSet.YES_NO
      );
      if (answer !== ui.Button.YES) {
        Logger.log(label + 'の送信を取りやめました。');
        return;
      }
    }

    var sent = sendDraft_(reportType);
    if (sent) {
      notify_(label, 'Chatwork へ送信しました。シートの状態を「' + SHEET_STATUS_SENT + '」にしました。');
    } else {
      notify_(label, '送信しませんでした。実行ログで理由をご確認ください。');
    }
  } catch (e) {
    Logger.log(label + 'の送信でエラーが発生しました: ' + e + (e && e.stack ? '\n' + e.stack : ''));
    notify_('エラー', label + 'を送信できませんでした。\n\n' + e);
  }
}

/* ==================================================================
 * api.gs
 * ================================================================== */
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
 *   { "secret": "…", "action": "events" }                       今日の予定を返す（HOME 用）
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

    /*
      今日の予定。HOME で 1 日の埋まり具合を見るために使う。
      下書きには触らないので、営業日でなくても返す（土日に見ることもある）。
    */
    case 'events':
      return {
        ok: true,
        today: Utilities.formatDate(today, TIME_ZONE, 'yyyy-MM-dd'),
        events: getDayEventsForApi_(today),
      };

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
  var body = reportType === REPORT_TYPE_DAY ? generateDayReport_(date) : generateNightReport_();
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

/* ==================================================================
 * test.gs
 * ================================================================== */
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
    ['Test 2: 夜の日報はスプレッドシートの内容をそのまま使う', test2_NightReportFromSheet_],
    ['Test 3: 夜の日報を GAS 側で組み立てていないこと', test3_NightFormatNotDuplicated_],
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

  var originalRead = readNightReportBody_;
  try {
    // 実際のスプレッドシートには触らず、読み取った結果だけを差し替える
    readNightReportBody_ = function () {
      if (rows === null) throw new Error('テスト用: 読めませんでした');
      var lines = toReportLines_(rows);
      if (lines.length === 0) throw new Error('テスト用: 範囲が空です');
      return lines.join('\n');
    };
    return task();
  } finally {
    readNightReportBody_ = originalRead;
    for (var j = 0; j < keys.length; j++) {
      if (saved[j] === null) props.deleteProperty(keys[j]);
      else props.setProperty(keys[j], saved[j]);
    }
  }
}

function test2_NightReportFromSheet_() {
  // 夜の日報は、シートに書かれているものがそのまま本文になる。
  // 挨拶も日付も進捗状況も業務報告も、すべてシート側にある。
  var rows = [
    ['お疲れ様です。' + SENDER_NAME + 'です。', ''],
    ['2026年9月12日(土)', 'の日報をお送りいたします。'],
    ['', ''],
    ['＜進捗状況＞　　実績/目標', ''],
    ['★リード売上    69.4万円　/ 　60万円　進捗率115.%（オンスケは28万円）', ''],
    ['---業務報告---', ''],
    ['PM', ''],
    ['■運営MTG', ''],
    ['---所感---', ''],
  ];
  var actual = withNightSheet_(rows, function () {
    return generateNightReport_();
  });
  var expected = [
    'お疲れ様です。' + SENDER_NAME + 'です。',
    '2026年9月12日(土)の日報をお送りいたします。',
    '',
    '＜進捗状況＞　　実績/目標',
    '★リード売上    69.4万円　/ 　60万円　進捗率115.%（オンスケは28万円）',
    '---業務報告---',
    'PM',
    '■運営MTG',
    '---所感---',
  ].join('\n');
  assertEquals_(expected, actual, '夜の日報本文');
}

function test3_NightFormatNotDuplicated_() {
  // 同じ文面を GAS 側でも組み立てると、片方だけ直した日に食い違う。
  // 夜の見出しを作る処理が戻っていないことを、名前で押さえる。
  assertTrue_(
    typeof globalThis.buildNightReportBody_ === 'undefined',
    '夜の日報を GAS 側で組み立てる処理が残っていないこと'
  );
  assertTrue_(
    typeof globalThis.appendProgressLines_ === 'undefined',
    '進捗状況を差し込む処理が残っていないこと（シートに含まれるため不要）'
  );

  // 夜の本文にシート以外の行が混ざらないこと。
  var body = withNightSheet_([['1行だけのシート', '']], function () {
    return generateNightReport_();
  });
  assertEquals_('1行だけのシート', body, 'シートの内容以外は足さない');
}

function test4_NightReportFailsLoudly_() {
  // 空の日報や途中までの日報を下書きとして残すと、気づかずに送ってしまう。
  var failed = false;
  try {
    withNightSheet_(null, function () { return generateNightReport_(); });
  } catch (e) {
    failed = true;
  }
  assertTrue_(failed, '読めなければ下書きを作らない');

  var emptyFailed = false;
  try {
    withNightSheet_([['', ''], ['', '']], function () { return generateNightReport_(); });
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
    'testDayReport', 'testNightReport', 'testTodayEvents',
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
