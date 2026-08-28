/**
 * ID の採番。
 *
 * 手動で作られるレコードの ID はここに集約する。
 *
 * 例外として、派生タスクの ID は
 * `task-<変更イベントID>-<テンプレートref>` という決定的な形式を保っている
 * （src/core/derivation/engine.ts）。同じ変更を再分析しても同じ ID になり、
 * 重複生成されないようにするための意図的な設計であり、ここには寄せない。
 */

/** 時刻順にほぼ並び、衝突しない ID を作る */
export function createId(prefix: string): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${time}-${rand}`;
}

/** 手動作成タスクの ID */
export function newTaskId(): string {
  return createId("task");
}
