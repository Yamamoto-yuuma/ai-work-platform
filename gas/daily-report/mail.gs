/**
 * Gmail の見張り。
 *
 * 出すのは 2 つだけ。
 *
 *   自分宛（届いている）… To に自分が入っている未読。CC で回ってきたものは出さない。
 *   返信待ち（返らない）… 自分が最後に送ったまま、何日も返事が来ていないやり取り。
 *
 * メールの一覧は作らない。それは Gmail の仕事で、ここで真似ると
 * 使いにくい Gmail ができるだけ。件名と差出人と、開く口だけを渡す。
 * 本文はこの入口から外へ出さない。
 *
 * 絞り込みは Gmail の検索語でやる。こちらで文面を読んで判断すると、
 * 同じメールがその日によって出たり出なかったりする。
 */

/** 何件まで見に行くか。読みに行く量の上限（Gmail の 1 日あたりの制限を使い切らないため） */
var MAIL_INBOX_SCAN = 40;
var MAIL_SENT_SCAN = 40;

/** 画面に返す件数。これ以上は数だけ伝える */
var MAIL_SHOW = 5;

/** 何日返事が無ければ「返信待ち」とみなすか */
var MAIL_AWAIT_DAYS = 3;

/**
 * 自分宛の未読。
 *
 * to:me は To に自分が入っているものだけを拾う（CC は含まない）。
 * 宣伝・SNS の通知と、チャットは外す。手を打つ必要があるものだけを残したい。
 */
var MAIL_INBOX_QUERY =
  'is:unread to:me -in:chats -category:promotions -category:social -category:forums';

/** 自分が出したやり取り。返事が来ているかは、中を見て決める */
var MAIL_SENT_QUERY = 'in:sent -in:chats newer_than:30d';

/** 差出人の表示名。「山本 有真 <a@b.c>」から名前だけを取り出す */
function mailDisplayName_(from) {
  if (!from) return '';
  var m = /^\s*"?([^"<]+?)"?\s*</.exec(from);
  if (m && m[1]) return m[1].trim();
  var bare = /<([^>]+)>/.exec(from);
  return (bare && bare[1] ? bare[1] : String(from)).trim();
}

/** 経過日数。今日なら 0 */
function mailDaysSince_(date, now) {
  var a = toJstStartOfDay_(date).getTime();
  var b = toJstStartOfDay_(now).getTime();
  return Math.round((b - a) / 86400000);
}

/**
 * 自分宛で未読のもの。
 * 新しい順に並べて返す（Gmail の検索がその順で返す）。
 */
function getUnreadToMe_(now) {
  var threads = GmailApp.search(MAIL_INBOX_QUERY, 0, MAIL_INBOX_SCAN);
  var out = [];
  for (var i = 0; i < threads.length && out.length < MAIL_SHOW; i++) {
    var thread = threads[i];
    var last = thread.getMessages()[thread.getMessageCount() - 1];
    if (!last) continue;
    out.push({
      from: mailDisplayName_(last.getFrom()),
      subject: thread.getFirstMessageSubject(),
      at: formatTimestamp_(last.getDate()),
      days: mailDaysSince_(last.getDate(), now),
      url: thread.getPermalink(),
    });
  }
  return { items: out, total: threads.length, scanned: threads.length };
}

/**
 * 自分が最後に送ったまま、返事が来ていないもの。
 *
 * やり取りの最後のメールが自分からなら、相手の番で止まっている。
 * 何日も動いていないものだけを出す（送った直後まで並べると、
 * 全部が「待ち」になって意味を持たなくなる）。
 */
function getAwaitingReply_(now) {
  var me = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  var threads = GmailApp.search(MAIL_SENT_QUERY, 0, MAIL_SENT_SCAN);
  // 1 通ずつ取りに行くと重いので、まとめて取る
  var messagesByThread = GmailApp.getMessagesForThreads(threads);

  var waiting = [];
  for (var i = 0; i < threads.length; i++) {
    var messages = messagesByThread[i];
    if (!messages || messages.length === 0) continue;
    var last = messages[messages.length - 1];

    // 最後が自分でなければ、相手は返している
    var from = String(last.getFrom() || '').toLowerCase();
    if (me === '' || from.indexOf(me) < 0) continue;

    var days = mailDaysSince_(last.getDate(), now);
    if (days < MAIL_AWAIT_DAYS) continue;

    waiting.push({
      to: mailDisplayName_(last.getTo()),
      subject: threads[i].getFirstMessageSubject(),
      at: formatTimestamp_(last.getDate()),
      days: days,
      url: threads[i].getPermalink(),
    });
  }

  // 放ってある順（古いものから）。催促するならそこから
  waiting.sort(function (a, b) { return b.days - a.days; });
  return { items: waiting.slice(0, MAIL_SHOW), total: waiting.length, scanned: threads.length };
}

/** プラットフォームへ返す形にまとめる。 */
function getMailForApi_() {
  var now = new Date();
  var inbox = getUnreadToMe_(now);
  var awaiting = getAwaitingReply_(now);
  return {
    inbox: inbox.items,
    inboxTotal: inbox.total,
    awaiting: awaiting.items,
    awaitingTotal: awaiting.total,
    /* 何日で「返信待ち」とみなしたか。画面で言い切るために渡す */
    awaitDays: MAIL_AWAIT_DAYS,
  };
}
