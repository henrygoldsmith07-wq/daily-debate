import "server-only";

import type { Database } from "./database.types";
import { queryRows } from "./sql";

export type TableName = keyof Database["Tables"];
type RowFor<T extends TableName> = Database["Tables"][T]["Row"];

export type BackendError = { message: string; code?: string };
export type QueryResult<T> = { data: T | null; error: BackendError | null; count: number | null };

type Operation = "select" | "insert" | "update" | "upsert" | "delete";
type FilterOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "is" | "not.is";
type Filter = { column: string; operator: FilterOperator; value: unknown };

const TABLES = new Set<TableName>([
  "profiles",
  "daily_topics",
  "solo_debates",
  "solo_debate_turns",
  "pvp_queue",
  "pvp_matches",
  "pvp_turns",
  "rate_limits",
  "benchmark_corpus",
  "match_appeals",
  "reports",
  "corpus_items",
  "corpus_ratings",
  "drill_assignments",
  "topic_evidence",
]);

function identifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function selectedColumns(value: string): string {
  if (value.trim() === "*") return "*";
  return value
    .split(",")
    .map((column) => identifier(column.trim()))
    .join(", ");
}

function errorResult(error: unknown): QueryResult<never> {
  const candidate = error as { message?: string; code?: string };
  return {
    data: null,
    error: { message: candidate?.message ?? String(error), code: candidate?.code },
    count: null,
  };
}

export class QueryBuilder<Row extends object, Result = Row[]>
  implements PromiseLike<QueryResult<Result>>
{
  private operation: Operation = "select";
  private columns = "*";
  private values: Partial<Row> | Partial<Row>[] | null = null;
  private filters: Filter[] = [];
  private orGroups: Filter[][] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private rowLimit: number | null = null;
  private resultMode: "many" | "single" | "maybeSingle" = "many";
  private countRequested = false;
  private headOnly = false;
  private conflictColumns: string[] = [];
  private returning = false;

  constructor(private readonly table: TableName) {
    if (!TABLES.has(table)) throw new Error(`Unknown table: ${table}`);
  }

  select(columns = "*", options?: { count?: "exact"; head?: boolean }) {
    this.columns = columns;
    this.returning = this.operation !== "select";
    this.countRequested = options?.count === "exact";
    this.headOnly = options?.head === true;
    return this;
  }

  insert(values: Partial<Row> | Partial<Row>[]) {
    this.operation = "insert";
    this.values = values;
    return this;
  }

  update(values: Partial<Row>) {
    this.operation = "update";
    this.values = values;
    return this;
  }

  upsert(values: Partial<Row> | Partial<Row>[], options?: { onConflict?: string }) {
    this.operation = "upsert";
    this.values = values;
    this.conflictColumns = (options?.onConflict ?? "id")
      .split(",")
      .map((column) => column.trim())
      .filter(Boolean);
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    return this.addFilter(column, "eq", value);
  }

  neq(column: string, value: unknown) {
    return this.addFilter(column, "neq", value);
  }

  gt(column: string, value: unknown) {
    return this.addFilter(column, "gt", value);
  }

  gte(column: string, value: unknown) {
    return this.addFilter(column, "gte", value);
  }

  lt(column: string, value: unknown) {
    return this.addFilter(column, "lt", value);
  }

  lte(column: string, value: unknown) {
    return this.addFilter(column, "lte", value);
  }

  is(column: string, value: unknown) {
    return this.addFilter(column, "is", value);
  }

  not(column: string, operator: "is", value: unknown) {
    return this.addFilter(column, `not.${operator}`, value);
  }

  in(column: string, values: unknown[]) {
    identifier(column);
    if (values.length === 0) {
      this.orGroups.push([]);
      return this;
    }
    this.orGroups.push(values.map((value) => ({ column, operator: "eq", value })));
    return this;
  }

  or(expression: string) {
    const group = expression.split(",").map((item): Filter => {
      const match = item.match(/^([a-z_][a-z0-9_]*)\.(eq|neq)\.(.+)$/);
      if (!match) throw new Error(`Unsupported OR filter: ${item}`);
      return { column: match[1], operator: match[2] as FilterOperator, value: match[3] };
    });
    this.orGroups.push(group);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    identifier(column);
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(value: number) {
    if (!Number.isInteger(value) || value < 0) throw new Error("Limit must be a non-negative integer.");
    this.rowLimit = value;
    return this;
  }

  single(): QueryBuilder<Row, Row> {
    this.resultMode = "single";
    return this as unknown as QueryBuilder<Row, Row>;
  }

  maybeSingle(): QueryBuilder<Row, Row> {
    this.resultMode = "maybeSingle";
    return this as unknown as QueryBuilder<Row, Row>;
  }

  then<TResult1 = QueryResult<Result>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<Result>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private addFilter(column: string, operator: FilterOperator, value: unknown) {
    identifier(column);
    this.filters.push({ column, operator, value });
    return this;
  }

  private whereClause(params: unknown[]): string {
    const clauses: string[] = [];
    const operatorSql: Record<Exclude<FilterOperator, "is" | "not.is">, string> = {
      eq: "=",
      neq: "<>",
      gt: ">",
      gte: ">=",
      lt: "<",
      lte: "<=",
    };

    const render = (filter: Filter): string => {
      const column = identifier(filter.column);
      if (filter.operator === "is" || filter.operator === "not.is") {
        if (filter.value !== null) throw new Error("Only null IS filters are supported.");
        return `${column} IS ${filter.operator === "not.is" ? "NOT " : ""}NULL`;
      }
      params.push(filter.value);
      return `${column} ${operatorSql[filter.operator]} $${params.length}`;
    };

    clauses.push(...this.filters.map(render));
    for (const group of this.orGroups) {
      clauses.push(group.length === 0 ? "FALSE" : `(${group.map(render).join(" OR ")})`);
    }
    return clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  }

  private async execute(): Promise<QueryResult<Result>> {
    try {
      const params: unknown[] = [];
      const table = identifier(this.table);
      let statement: string;

      if (this.operation === "select") {
        const projection = this.countRequested ? "COUNT(*)::int AS count" : selectedColumns(this.columns);
        statement = `SELECT ${projection} FROM ${table}${this.whereClause(params)}`;
        if (!this.countRequested && this.orders.length) {
          statement += ` ORDER BY ${this.orders
            .map((order) => `${identifier(order.column)} ${order.ascending ? "ASC" : "DESC"}`)
            .join(", ")}`;
        }
        if (!this.countRequested && this.rowLimit !== null) statement += ` LIMIT ${this.rowLimit}`;
      } else if (this.operation === "insert" || this.operation === "upsert") {
        const rows = Array.isArray(this.values) ? this.values : [this.values ?? {}];
        if (rows.length === 0) return { data: [] as unknown as Result, error: null, count: 0 };
        const columns = Object.keys(rows[0] as object);
        if (columns.length === 0) throw new Error("Insert requires at least one value.");
        const tuples = rows.map((row) => {
          const placeholders = columns.map((column) => {
            params.push((row as Record<string, unknown>)[column]);
            return `$${params.length}`;
          });
          return `(${placeholders.join(", ")})`;
        });
        statement = `INSERT INTO ${table} (${columns.map(identifier).join(", ")}) VALUES ${tuples.join(", ")}`;
        if (this.operation === "upsert") {
          if (this.conflictColumns.length === 0) throw new Error("Upsert requires conflict columns.");
          const updates = columns.filter((column) => !this.conflictColumns.includes(column));
          statement += ` ON CONFLICT (${this.conflictColumns.map(identifier).join(", ")}) `;
          statement += updates.length
            ? `DO UPDATE SET ${updates.map((column) => `${identifier(column)} = EXCLUDED.${identifier(column)}`).join(", ")}`
            : "DO NOTHING";
        }
        if (this.returning) statement += ` RETURNING ${selectedColumns(this.columns)}`;
      } else if (this.operation === "update") {
        if (this.filters.length + this.orGroups.length === 0) throw new Error("Refusing an unfiltered update.");
        const entries = Object.entries(this.values ?? {});
        if (entries.length === 0) throw new Error("Update requires at least one value.");
        const assignments = entries.map(([column, value]) => {
          params.push(value);
          return `${identifier(column)} = $${params.length}`;
        });
        statement = `UPDATE ${table} SET ${assignments.join(", ")}${this.whereClause(params)}`;
        if (this.returning) statement += ` RETURNING ${selectedColumns(this.columns)}`;
      } else {
        if (this.filters.length + this.orGroups.length === 0) throw new Error("Refusing an unfiltered delete.");
        statement = `DELETE FROM ${table}${this.whereClause(params)}`;
        if (this.returning) statement += ` RETURNING ${selectedColumns(this.columns)}`;
      }

      const rows = await queryRows<Row>(statement, params);
      if (this.countRequested) {
        const count = Number((rows[0] as Record<string, unknown> | undefined)?.count ?? 0);
        return { data: this.headOnly ? null : ([] as Result), error: null, count };
      }

      const data = this.returning || this.operation === "select" ? rows : null;
      if (this.resultMode === "single") {
        if (!data || data.length !== 1) {
          return { data: null, error: { message: `Expected one row, received ${data?.length ?? 0}.` }, count: null };
        }
        return { data: data[0] as unknown as Result, error: null, count: null };
      }
      if (this.resultMode === "maybeSingle") {
        if (!data || data.length === 0) return { data: null, error: null, count: null };
        if (data.length > 1) return { data: null, error: { message: "Expected at most one row." }, count: null };
        return { data: data[0] as unknown as Result, error: null, count: null };
      }
      return { data: data as Result | null, error: null, count: null };
    } catch (error) {
      return errorResult(error);
    }
  }
}

export function tableQuery<T extends TableName>(table: T) {
  return new QueryBuilder<RowFor<T>>(table);
}
