"use client";

/**
 * 業務フローのグラフ表示。
 * STEP を階層（トポロジカルな深さ）ごとに配置し、条件分岐と並列が
 * 「一本道ではない」ことを見て分かるようにする（仕様 §25-4）。
 */
import type { StepRunStatus, WorkflowDefinition } from "@/core/model/types";
import { stepDepths } from "@/core/flow/engine";

const NODE_W = 168;
const NODE_H = 54;
const GAP_X = 34;
const GAP_Y = 40;

const STATUS_STYLE: Record<StepRunStatus, { fill: string; stroke: string; text: string }> = {
  done: { fill: "var(--color-ok-soft)", stroke: "var(--color-ok)", text: "var(--color-ok)" },
  active: { fill: "var(--color-brand)", stroke: "var(--color-brand)", text: "#ffffff" },
  pending: { fill: "var(--color-surface)", stroke: "var(--color-line)", text: "var(--color-ink-3)" },
  skipped: { fill: "var(--color-surface-2)", stroke: "var(--color-line)", text: "var(--color-ink-3)" },
  blocked: { fill: "var(--color-danger-soft)", stroke: "var(--color-danger)", text: "var(--color-danger)" },
};

export function FlowGraph({
  def, statusOf, onSelect,
}: {
  def: WorkflowDefinition;
  statusOf: (key: string) => StepRunStatus;
  onSelect?: (key: string) => void;
}) {
  const depths = stepDepths(def);
  const rows = new Map<number, string[]>();
  for (const s of def.steps) {
    const d = depths.get(s.key) ?? 0;
    rows.set(d, [...(rows.get(d) ?? []), s.key]);
  }

  const maxRow = Math.max(...Array.from(rows.keys()));
  const maxCols = Math.max(...Array.from(rows.values()).map((r) => r.length));
  const width = maxCols * NODE_W + (maxCols - 1) * GAP_X + 40;
  const height = (maxRow + 1) * NODE_H + maxRow * GAP_Y + 40;

  const pos = new Map<string, { x: number; y: number }>();
  for (const [depth, keys] of rows) {
    const rowWidth = keys.length * NODE_W + (keys.length - 1) * GAP_X;
    const startX = (width - rowWidth) / 2;
    keys.forEach((k, i) => {
      pos.set(k, { x: startX + i * (NODE_W + GAP_X), y: 20 + depth * (NODE_H + GAP_Y) });
    });
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface p-4">
      <svg width={width} height={height} className="mx-auto block" role="img" aria-label="業務フロー図">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-line)" />
          </marker>
          <marker id="arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-brand)" />
          </marker>
        </defs>

        {def.edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const x1 = a.x + NODE_W / 2;
          const y1 = a.y + NODE_H;
          const x2 = b.x + NODE_W / 2;
          const y2 = b.y;
          const done = statusOf(e.from) === "done";
          const my = (y1 + y2) / 2;
          return (
            <g key={i}>
              <path
                d={`M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2 - 2}`}
                fill="none"
                stroke={done ? "var(--color-brand)" : "var(--color-line)"}
                strokeWidth={done ? 2 : 1.5}
                strokeDasharray={e.condition ? "5 3" : undefined}
                markerEnd={done ? "url(#arrow-active)" : "url(#arrow)"}
              />
              {e.label && (
                <text x={(x1 + x2) / 2 + 6} y={my - 2} fontSize="10" fill="var(--color-ink-3)">{e.label}</text>
              )}
            </g>
          );
        })}

        {def.steps.map((s) => {
          const p = pos.get(s.key);
          if (!p) return null;
          const st = statusOf(s.key);
          const style = STATUS_STYLE[st];
          const isBranch = s.componentType === "branch";
          return (
            <g key={s.key} onClick={() => onSelect?.(s.key)} className={onSelect ? "cursor-pointer" : undefined}>
              <rect
                x={p.x} y={p.y} width={NODE_W} height={NODE_H} rx={isBranch ? 26 : 9}
                fill={style.fill} stroke={style.stroke} strokeWidth={st === "active" ? 2 : 1.2}
                strokeDasharray={isBranch ? "4 3" : undefined}
              />
              <text x={p.x + NODE_W / 2} y={p.y + (isBranch ? 32 : 24)} textAnchor="middle" fontSize="12" fontWeight="600" fill={style.text}>
                {s.title.length > 12 ? `${s.title.slice(0, 11)}…` : s.title}
              </text>
              {!isBranch && (
                <text x={p.x + NODE_W / 2} y={p.y + 40} textAnchor="middle" fontSize="10" fill={style.text} opacity={0.75}>
                  {{ done: "完了", active: "実行中", pending: "未着手", skipped: "スキップ", blocked: "ブロック" }[st]}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
