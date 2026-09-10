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
