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
function isBusinessDay(date) {
  assertDate_(date);
  if (isWeekend_(date)) return false;
  return !isHoliday_(date);
}

/**
 * 次の営業日を返す。翌日ではなく、土日祝を飛ばした最初の営業日。
 */
function getNextBusinessDay(date) {
  assertDate_(date);
  for (var offset = 1; offset <= MAX_BUSINESS_DAY_LOOKAHEAD; offset++) {
    var candidate = addDays_(date, offset);
    if (isBusinessDay(candidate)) return candidate;
  }
  throw new Error(
    MAX_BUSINESS_DAY_LOOKAHEAD + ' 日先まで営業日が見つかりませんでした（起点: ' + formatDateKey_(date) + '）。' +
      '祝日カレンダーの設定を確認してください。'
  );
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
