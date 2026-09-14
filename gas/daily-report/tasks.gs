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
 * ■ 期限での絞り込みは Google に任せない
 *   Tasks API の dueMin / dueMax は、期限の保存形式との噛み合わせで期待どおりに
 *   効かないことがある。実際、期限がその日のタスクがあるのに 0 件で返ってきた。
 *   未完了のタスクをすべて取ってきて、日付の突き合わせはこちらで行う。
 *   読む量は増えるが、静かに落ちるよりよい。
 *
 * ■ 期限に時刻は入らない
 *   Tasks API の due は日付だけを持つ。画面で時刻を付けても API からは読めない
 *   （Google 側の仕様で、時刻部分は捨てられる）。したがって、タスクを開始時刻で
 *   AM / PM に振り分けることはできない。置き場所は report.gs で決めている。
 */

/** 1 回の実行で読むタスクリストの数の上限。 */
var TASK_LISTS_MAX = 50;

/** 1 回の問い合わせで読むタスクの数（Tasks API の上限が 100）。 */
var TASKS_PAGE_SIZE = 100;

/** 1 つのリストで読むページ数の上限。無限に回らないための歯止め。 */
var TASKS_MAX_PAGES = 10;

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
 * タスクの期限を yyyy-MM-dd で返す。期限が無ければ空文字。
 *
 * due は「2026-09-14T00:00:00.000Z」の形で来る。意味を持つのは日付の部分だけで、
 * 時刻は Google 側が捨てている。
 */
function taskDueDate_(task) {
  if (task === null || task === undefined) return '';
  if (typeof task.due !== 'string' || task.due.length < 10) return '';
  return task.due.substring(0, 10);
}

/**
 * その日が期限の、まだ終わっていないタスクかどうか。
 *
 * 完了・削除・非表示のものは日報に出さない。
 *
 * @param {Object} task Tasks API が返したタスク
 * @param {string} dueKey 期限の日付（yyyy-MM-dd）
 */
function isIncompleteTaskDueOn_(task, dueKey) {
  if (task === null || task === undefined) return false;
  if (task.deleted === true || task.hidden === true) return false;
  if (task.status === 'completed') return false;
  return taskDueDate_(task) === dueKey;
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
    var items = listOpenTasks_(lists[i]);
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
 * 1 つのリストの、未完了タスクをすべて読む。読めなければ空。
 *
 * 期限では絞らない（ファイル冒頭の理由による）。ページ送りをたどるのは、
 * 期限を付けていないタスクが多い人でも、期限付きのタスクを取りこぼさないため。
 */
function listOpenTasks_(list) {
  var out = [];
  var pageToken = null;

  for (var page = 0; page < TASKS_MAX_PAGES; page++) {
    var response;
    try {
      var options = {
        showCompleted: false,
        showHidden: false,
        showDeleted: false,
        maxResults: TASKS_PAGE_SIZE,
      };
      if (pageToken !== null) options.pageToken = pageToken;
      response = Tasks.Tasks.list(list.id, options);
    } catch (e) {
      Logger.log(
        'Google ToDo「' + (list && list.title ? list.title : list.id) + '」を読めませんでした: ' + e
      );
      return out;
    }

    var items = response && response.items ? response.items : [];
    for (var i = 0; i < items.length; i++) out.push(items[i]);

    pageToken = response && response.nextPageToken ? response.nextPageToken : null;
    if (pageToken === null) break;
  }
  return out;
}

/**
 * その日のタスクを、絞り込む前の状態から順に説明する行を返す。
 *
 * 「タスクが日報に出ない」とき、サービスを足していないのか、期限を付けていないのか、
 * 期限が別の日なのかで直す場所が違う。Google が返した due をそのまま並べる。
 * 生の値を見ないと、この 3 つは区別できない。
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

  lines.push('探している期限: ' + dueKey + '　／　タスクリスト: ' + lists.length + ' 個');

  for (var i = 0; i < lists.length; i++) {
    var items = listOpenTasks_(lists[i]);
    lines.push('［リスト］' + lists[i].title + '（未完了のタスク: ' + items.length + ' 件）');

    if (items.length === 0) {
      lines.push('　（このリストには未完了のタスクがありません）');
      continue;
    }

    for (var j = 0; j < items.length; j++) {
      var task = items[j];
      var due = taskDueDate_(task);
      var verdict;
      if (due === '') {
        verdict = '除外（期限が入っていない）';
      } else if (due !== dueKey) {
        verdict = '除外（期限が ' + due + '）';
      } else if (formatTitleLine_(task.title) === null) {
        verdict = '除外（タスク名が空）';
      } else {
        verdict = '★採用';
      }
      lines.push(
        '　・' + task.title + '　[due: ' + (task.due === undefined ? 'なし' : task.due) + ']　→ ' + verdict
      );
    }
  }
  return lines;
}
