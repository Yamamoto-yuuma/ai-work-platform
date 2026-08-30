"use client";

/**
 * 業務フローのグラフ表示。
 * STEP を階層（トポロジカルな深さ）ごとに配置し、条件分岐と並列が
 * 「一本道ではない」ことを見て分かるようにする（仕様 §25-4）。
 */
import type { StepRunStatus, WorkflowDefinition } from "@/core/model/types";
import { stepDepths, orderedSteps } from "@/core/flow/engine";

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
  const ordered = orderedSteps(def);

  // 列の割り当て: 分岐の行き先は左右に振り分け、合流点は親の中央へ戻す。
  // これにより「一本道ではない」ことが図として読み取れる。
  const col = new Map<string, number>();
  for (const step of ordered) {
    const incoming = def.edges.filter((e) => e.to === step.key);
    if (incoming.length === 0) {
      col.set(step.key, 0);
      continue;
    }
    if (incoming.length > 1) {
      // 合流点は親たちの中間に置く
      const parents = incoming.map((e) => col.get(e.from) ?? 0);
      col.set(step.key, parents.reduce((a, b) => a + b, 0) / parents.length);
      continue;
    }
    const parentKey = incoming[0].from;
    const siblings = def.edges.filter((e) => e.from === parentKey);
    const base = col.get(parentKey) ?? 0;
    if (siblings.length > 1) {
      const idx = siblings.findIndex((e) => e.to === step.key);
      col.set(step.key, base + (idx - (siblings.length - 1) / 2));
    } else {
      col.set(step.key, base);
    }
  }

  const cols = Array.from(col.values());
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);
  const maxRow = Math.max(...Array.from(depths.values()));
  const lanes = maxCol - minCol + 1;

  const width = lanes * NODE_W + (lanes - 1) * GAP_X + 40;
  const height = (maxRow + 1) * NODE_H + maxRow * GAP_Y + 40;

  const pos = new Map<string, { x: number; y: number }>();
  for (const step of def.steps) {
    const c = (col.get(step.key) ?? 0) - minCol;
    pos.set(step.key, {
      x: 20 + c * (NODE_W + GAP_X),
      y: 20 + (depths.get(step.key) ?? 0) * (NODE_H + GAP_Y),
    });
  }

  return (
    <div className="overflow-x-auto rounded-xl bg-surface p-4 shadow-card">
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

          // 同じ STEP から出るエッジ同士でラベルが重ならないよう、経路に沿って段をずらす
          const siblings = def.edges.filter((x) => x.from === e.from);
          const rank = siblings.indexOf(e);
          const t = siblings.length > 1 ? 0.3 + rank * (0.34 / Math.max(1, siblings.length - 1)) : 0.5;
          const lx = x1 + (x2 - x1) * t;
          const ly = y1 + (y2 - y1) * t;
          const charW = 6.4;
          const boxW = (e.label?.length ?? 0) * charW + 8;

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
                <>
                  <rect
                    x={lx - boxW / 2} y={ly - 9} width={boxW} height={16} rx={4}
                    fill="var(--color-surface)" stroke="var(--color-line-soft)" strokeWidth={1}
                  />
                  <text
                    x={lx} y={ly + 2.5} fontSize="10" textAnchor="middle"
                    fill="var(--color-ink-3)"
                  >
                    {e.label}
                  </text>
                </>
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
