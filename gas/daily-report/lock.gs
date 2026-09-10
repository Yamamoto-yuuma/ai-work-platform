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
function buildReportKey(date, reportType) {
  assertDate_(date);
  return formatDateKey_(date) + '_' + reportType;
}

/**
 * すでに送信済みか。
 */
function hasAlreadySent(reportKey) {
  return PropertiesService.getScriptProperties().getProperty(reportKey) === SENT_FLAG_VALUE;
}

/**
 * 送信済みとして記録する。
 */
function markAsSent(reportKey) {
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
