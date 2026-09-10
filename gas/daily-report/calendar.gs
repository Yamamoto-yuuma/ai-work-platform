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
 * @return {Array.<{title: string, startTime: Date}>}
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

    result.push({ title: event.getTitle(), startTime: startTime });
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
