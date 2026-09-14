/**
 * Google ToDo（タスク）の読み取り。
 *
 * カレンダーの画面にはタスクも並ぶが、タスクは予定ではない。別のサービスで、
 * CalendarApp からは 1 件も取れない。読むには拡張サービス「Tasks API」を足す。
 *
 *   Apps Script の左メニュー［サービス］→［+］→ Tasks API → 追加
 *
 * 足していないプロジェクトでもスクリプト全体が止まらないようにしてある。
 * タスクだけが空になり、日報は今までどおり出る。日報が毎日出ることのほうが、
 * タスク欄が埋まることより大事なため。
 *
 * ■ 期限に時刻は入らない
 *   Tasks API の due は日付だけを持つ。画面で時刻を付けても API からは読めない
 *   （Google 側の仕様で、時刻部分は捨てられる）。したがって、タスクを開始時刻で
 *   AM / PM に振り分けることはできない。置き場所は report.gs で決めている。
 */

/** 1 回の実行で読むタスクリストの数の上限。 */
var TASK_LISTS_MAX = 20;

/** 1 つのリストから読むタスクの数の上限（Tasks API の上限が 100）。 */
var TASKS_PER_LIST_MAX = 100;

/** 日報 1 本に並べるタスクの数の上限。多すぎると日報が読めなくなる。 */
var TASKS_PER_REPORT_MAX = 20;

/**
 * 拡張サービス「Tasks API」が足されているか。
 *
 * 足されていないプロジェクトでは Tasks という名前自体が無い。
 * 参照すると落ちるので、typeof で確かめる。
 */
function isTasksServiceAvailable_() {
  return (
    typeof Tasks !== 'undefined' &&
    Tasks !== null &&
    Tasks.Tasklists !== undefined &&
    Tasks.Tasks !== undefined
  );
}

/**
 * その日が期限の、まだ終わっていないタスクかどうか。
 *
 * 完了・削除・非表示のものは日報に出さない。
 * due は「2026-09-14T00:00:00.000Z」の形で、日付の部分だけが意味を持つ。
 *
 * @param {Object} task Tasks API が返したタスク
 * @param {string} dueKey 期限の日付（yyyy-MM-dd）
 */
function isIncompleteTaskDueOn_(task, dueKey) {
  if (task === null || task === undefined) return false;
  if (task.deleted === true || task.hidden === true) return false;
  if (task.status === 'completed') return false;
  if (typeof task.due !== 'string' || task.due.length < 10) return false;
  return task.due.substring(0, 10) === dueKey;
}

/**
 * 指定日が期限の、未完了タスクの名前を返す。
 *
 * 読めないときは空の配列を返す（日報は作る）。理由はログへ残す。
 * 黙って空にすると、タスクが 0 件なのか読めていないのか分からなくなる。
 *
 * @return {Array.<string>}
 */
function getTaskTitlesForDate_(date) {
  assertDate_(date);
  if (!isTasksServiceAvailable_()) {
    Logger.log(
      'Google ToDo は読んでいません（拡張サービス「Tasks API」が足されていません）。' +
        'Apps Script の［サービス］→［+］→ Tasks API で追加できます。'
    );
    return [];
  }

  var dueKey = Utilities.formatDate(date, TIME_ZONE, 'yyyy-MM-dd');
  var lists = listTaskLists_();
  var titles = [];

  for (var i = 0; i < lists.length; i++) {
    var items = listTasksDueOn_(lists[i], dueKey);
    for (var j = 0; j < items.length; j++) {
      if (!isIncompleteTaskDueOn_(items[j], dueKey)) continue;
      if (formatTitleLine_(items[j].title) === null) continue;
      titles.push(items[j].title);
      if (titles.length >= TASKS_PER_REPORT_MAX) return titles;
    }
  }
  return titles;
}

/**
 * タスクリストの一覧。読めなければ空。
 *
 * リストを 1 つに決め打ちしない。仕事のタスクを既定の「マイタスク」以外に
 * 分けている人がいて、決め打ちにするとその人の日報だけ空になる。
 */
function listTaskLists_() {
  try {
    var response = Tasks.Tasklists.list({ maxResults: TASK_LISTS_MAX });
    return response && response.items ? response.items : [];
  } catch (e) {
    Logger.log('Google ToDo のリストを読めませんでした（日報はタスクなしで作ります）: ' + e);
    return [];
  }
}

/**
 * 1 つのリストから、その日が期限のタスクを読む。読めなければ空。
 *
 * dueMin / dueMax で Google 側に絞らせる。手元だけで絞ると、期限を付けていない
 * タスクが多い人は上限に当たって、期限付きのタスクが最後まで届かない。
 * 返ってきたものは呼び出し側でもう一度確かめる（絞り込みを二重にしておく）。
 */
function listTasksDueOn_(list, dueKey) {
  try {
    var response = Tasks.Tasks.list(list.id, {
      showCompleted: false,
      showHidden: false,
      showDeleted: false,
      dueMin: dueKey + 'T00:00:00.000Z',
      dueMax: dueKey + 'T23:59:59.999Z',
      maxResults: TASKS_PER_LIST_MAX,
    });
    return response && response.items ? response.items : [];
  } catch (e) {
    Logger.log(
      'Google ToDo「' + (list && list.title ? list.title : list.id) + '」を読めませんでした: ' + e
    );
    return [];
  }
}

/**
 * その日のタスクを、絞り込む前の状態から順に説明する行を返す。
 *
 * 「タスクが日報に出ない」とき、サービスを足していないのか、リストが違うのか、
 * 期限を付けていないのかで直す場所が違う。1 件ずつ、採否と理由を並べる。
 *
 * ここでは日報を作らない。目で確かめるためだけの読み取り。
 *
 * @return {Array.<string>}
 */
function describeTasksForDate_(date) {
  assertDate_(date);
  var lines = [];

  if (!isTasksServiceAvailable_()) {
    lines.push(
      '拡張サービス「Tasks API」が足されていません。' +
        'Apps Script の左メニュー［サービス］→［+］→ Tasks API →［追加］で足してください。' +
        '足すまで、タスクは 1 件も日報に出ません。'
    );
    return lines;
  }

  var dueKey = Utilities.formatDate(date, TIME_ZONE, 'yyyy-MM-dd');
  var lists = listTaskLists_();
  if (lists.length === 0) {
    lines.push('タスクリストが 1 つも読めませんでした。');
    return lines;
  }

  for (var i = 0; i < lists.length; i++) {
    var items = listTasksDueOn_(lists[i], dueKey);
    lines.push('［リスト］' + lists[i].title + '（期限が ' + dueKey + ' のもの: ' + items.length + ' 件）');
    for (var j = 0; j < items.length; j++) {
      var task = items[j];
      var verdict;
      if (!isIncompleteTaskDueOn_(task, dueKey)) {
        verdict = '除外（完了済み・削除済み、または期限が別の日）';
      } else if (formatTitleLine_(task.title) === null) {
        verdict = '除外（タスク名が空）';
      } else {
        verdict = '採用';
      }
      lines.push('・' + task.title + ' → ' + verdict);
    }
  }

  lines.push(
    '※ 期限を付けていないタスクはここに出ません。Tasks API は期限の「日付」しか持たず、' +
      '時刻は読めないため、時刻での絞り込みもできません。'
  );
  return lines;
}
