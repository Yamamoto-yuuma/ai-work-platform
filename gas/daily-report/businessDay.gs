/**
 * 営業日判定。
 *
 * 土曜・日曜・日本の祝日を休日として扱う。
 * 祝日はコードへ列挙せず、日本の祝日カレンダー（Script Property で変更可能）を参照する。
 */

/** 1 回の実行の中で祝日カレンダーへの問い合わせを繰り返さないためのキャッシュ。 */
var holidayCache_ = {};

/**
 * 土日かどうか。
 */
function isWeekend_(date) {
  var dayOfWeek = getJstDayOfWeek_(date);
  return dayOfWeek === 0 || dayOfWeek === 6;
}

/**
 * 日本の祝日かどうか。
 * 祝日カレンダーへアクセスできない場合はエラーにする（祝日に誤って投稿しないため）。
 */
function isHoliday_(date) {
  var key = formatDateKey_(date);
  if (Object.prototype.hasOwnProperty.call(holidayCache_, key)) {
    return holidayCache_[key];
  }

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

  var events;
  try {
    events = calendar.getEventsForDay(toJstStartOfDay_(date));
  } catch (e) {
    throw new Error('祝日カレンダーの取得に失敗しました（' + key + '）: ' + e);
  }

  var isHoliday = events.length > 0;
  holidayCache_[key] = isHoliday;
  return isHoliday;
}

/**
 * 営業日（平日かつ祝日でない）かどうか。
 */
function isBusinessDay(date) {
  if (isWeekend_(date)) return false;
  return !isHoliday_(date);
}

/**
 * 次の営業日を返す。翌日ではなく、土日祝を飛ばした最初の営業日。
 */
function getNextBusinessDay(date) {
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
