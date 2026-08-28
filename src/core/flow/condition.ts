/** 条件式の評価器。データとして保存された ConditionExpr を解釈する（eval を使わない） */
import type { ConditionExpr, ValueRef } from "../model/types";

export type EvalScope = Record<string, unknown>;

function readPath(scope: EvalScope, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    if (typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, scope);
}

export function resolveRef(ref: ValueRef, scope: EvalScope): unknown {
  switch (ref.kind) {
    case "literal":
      return ref.value;
    case "var":
      return readPath(scope, ref.path);
    case "now":
      return new Date().toISOString();
  }
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

export function evaluate(expr: ConditionExpr | undefined, scope: EvalScope): boolean {
  if (!expr) return true;

  if (expr.op === "and") return expr.operands.every((o) => evaluate(o, scope));
  if (expr.op === "or") return expr.operands.some((o) => evaluate(o, scope));
  if (expr.op === "not") return !evaluate(expr.operand, scope);

  const left = resolveRef(expr.left, scope);
  const right = expr.right ? resolveRef(expr.right, scope) : undefined;

  switch (expr.op) {
    case "exists":
      return !isEmpty(left);
    case "isEmpty":
      return isEmpty(left);
    case "eq":
      return left === right;
    case "neq":
      return left !== right;
    case "gt":
      return compare(left, right) > 0;
    case "gte":
      return compare(left, right) >= 0;
    case "lt":
      return compare(left, right) < 0;
    case "lte":
      return compare(left, right) <= 0;
    case "in":
      return Array.isArray(right) && right.includes(left);
    case "contains":
      if (Array.isArray(left)) return left.includes(right);
      return typeof left === "string" && typeof right === "string" && left.includes(right);
  }
}

/**
 * 条件式から「不足している項目」を導出する。
 * AI が停止していても不足情報検出が動作するための決定的なフォールバック（仕様 §20-4）。
 * or を含む式は一意に定まらないため、and / 単項のみを対象とする。
 */
export function deriveMissingPaths(expr: ConditionExpr | undefined, scope: EvalScope): string[] {
  if (!expr) return [];
  if (expr.op === "and") return expr.operands.flatMap((o) => deriveMissingPaths(o, scope));
  if (expr.op === "or" || expr.op === "not") return [];
  if (evaluate(expr, scope)) return [];
  return expr.left.kind === "var" ? [expr.left.path] : [];
}
