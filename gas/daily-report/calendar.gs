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
      color: getEventColorId_(event),
    });
  }

  result.sort(function (a, b) {
    return a.startTime.getTime() - b.startTime.getTime();
  });
  return result;
}

/**
 * その日のカレンダーを、絞り込む前の状態から順に説明する行を返す。
 *
 * 「予定が日報に出ない」とき、カレンダーに無いのか、取れているのに
 * 落としているのかで直す場所が違う。1 件ずつ、採否と理由を並べる。
 *
 * ここでは日報を作らない。目で確かめるためだけの読み取り。
 *
 * @return {Array.<string>}
 */
function describeCalendarDay_(date) {
  assertDate_(date);
  var lines = [];
  var calendar = getTargetCalendar_();
  var targetDay = toJstStartOfDay_(date);
  var dateKey = formatDateKey_(targetDay);

  lines.push('読んだカレンダー: ' + calendar.getName());

  var events;
  try {
    events = calendar.getEventsForDay(targetDay);
  } catch (e) {
    lines.push('カレンダーを読めませんでした: ' + e);
    return lines;
  }

  if (events.length === 0) {
    lines.push(
      'このカレンダーには 1 件もありません。' +
        'Google ToDo（タスク）はカレンダーの画面には出ますが、予定ではないのでここには入りません。'
    );
    return lines;
  }

  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    var isAllDay = event.isAllDayEvent();
    var start = event.getStartTime();
    var title = event.getTitle();
    var verdict;

    if (isAllDay && !INCLUDE_ALL_DAY_EVENTS) {
      verdict = '除外（終日の予定。含めるには INCLUDE_ALL_DAY_EVENTS を true にする）';
    } else if (!isAllDay && formatDateKey_(start) !== dateKey) {
      verdict = '除外（前の日から続いている予定）';
    } else if (formatTitleLine_(title) === null) {
      verdict = '除外（予定名が空）';
    } else {
      verdict = '採用（' + (isMorningStart_(start) ? 'AM' : 'PM') + '）';
    }

    lines.push(
      '・' + (isAllDay ? '終日' : Utilities.formatDate(start, TIME_ZONE, 'HH:mm')) +
        ' ' + title + ' → ' + verdict
    );
  }
  return lines;
}

/**
 * 予定に付けた色の番号。
 *
 * カレンダー上で色を変えていなければ空文字が返る（＝カレンダー既定の色）。
 * 番号と実際の色の対応は Google 側が決めているので、こちらでは名前を付けず、
 * 番号のまま画面へ渡して向こうで色に直す。ここで色名を決めると、
 * Google がパレットを変えたときに食い違う。
 *
 * 予定の種類によっては色を持たず、getColor が投げることがある。
 * 色が取れないことは日報にも並びにも影響しないので、黙って既定に倒す。
 */
function getEventColorId_(event) {
  try {
    var color = event.getColor();
    return color === null || color === undefined ? '' : String(color);
  } catch (e) {
    return '';
  }
}

/** カレンダーそのものの色（#rrggbb）。色を変えていない予定はこの色で表示される。 */
function getCalendarColor_() {
  try {
    var color = getTargetCalendar_().getColor();
    return typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '';
  } catch (e) {
    return '';
  }
}

/**
 * AM（00:00 〜 AM_PM_BOUNDARY_HOUR の直前に開始）の予定。
 */
function getMorningEvents_(date) {
  assertDate_(date);
  return filterEventsByHalf_(getCalendarEvents_(date), true);
}

/**
 * PM（AM_PM_BOUNDARY_HOUR 〜 23:59 に開始）の予定。
 */
function getAfternoonEvents_(date) {
  assertDate_(date);
  return filterEventsByHalf_(getCalendarEvents_(date), false);
}

/**
 * 開始時刻が AM 側かどうか。
 * 境目は分まで見る（13:45 と 14:00 を区別するため）。値は config.gs で決める。
 */
function isMorningStart_(startTime) {
  return getJstMinutesOfDay_(startTime) < getAmPmBoundaryMinutes_();
}

/**
 * 開始時刻を基準に AM / PM で絞り込む。
 */
function filterEventsByHalf_(events, wantMorning) {
  var result = [];
  for (var i = 0; i < events.length; i++) {
    if (isMorningStart_(events[i].startTime) === wantMorning) result.push(events[i]);
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
 * 色の番号も一緒に渡す。カレンダーで色分けしている人にとっては、
 * どの予定かを読む前に色で見分けているので、色を落とすと別物になる。
 *
 * @return {Array.<{title: string, start: string, end: string, allDay: boolean, color: string}>}
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
      color: events[i].color === undefined ? '' : events[i].color,
    });
  }
  return out;
}
