import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { type MissionControlConfig, missionControlConfig } from "../domain/config.ts";
import { type Plan, plan } from "../domain/plan.ts";
import { type Roadmap, roadmap } from "../domain/roadmap.ts";
import { checkRules, type RuleIssue } from "../domain/rules.ts";
import { type Revision, StoreError } from "./store.ts";

/** Every issue of a Zod parse as a schema issue of `record`, with its path, kind and rule. */
export function schemaIssues(error: z.ZodError, record: string): RuleIssue[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".") || "(record)";
    const rule =
      issue.code === "custom" && typeof issue.params?.rule === "string"
        ? issue.params.rule
        : undefined;
    return {
      record,
      code: "schema",
      params: { path, kind: issue.code, ...(rule ? { rule } : {}) },
      message: `${path}: ${issue.message}`,
    };
  });
}

/** Parse one record with its schema, or refuse it with every issue named. */
export function parseRecord<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = schemaIssues(result.error, label);
  throw new StoreError(
    "invalid_record",
    `${label} does not match its schema: ${issues.map((issue) => issue.message).join("; ")}`,
    issues,
  );
}

export const parsePlan = (value: unknown, label: string): Plan => parseRecord(plan, value, label);
export const parseRoadmap = (value: unknown, label: string): Roadmap =>
  parseRecord(roadmap, value, label);
export const parseConfig = (value: unknown, label: string): MissionControlConfig =>
  parseRecord(missionControlConfig, value, label);

/**
 * The record as the port writes it: with a new write revision, a random value
 * no earlier write had (Module Standard, "One data port"). Whatever revision
 * the caller sent is replaced.
 */
export function withNewRevision<T extends { revision?: string }>(value: T): T {
  return { ...value, revision: randomUUID() };
}

/**
 * The revision the port hands out and compares: the record's stored write
 * revision and a fingerprint of its content. The write revision makes it new
 * on every write, also after A → B → A; the fingerprint makes a direct change
 * that kept the old write revision a change too. A record written before the
 * write revision existed has the fingerprint alone until its first save.
 */
export function portRevision(stored: unknown, fingerprint: string): Revision {
  return typeof stored === "string" && stored.length > 0
    ? `rev:${stored};${fingerprint}`
    : fingerprint;
}

/** File name of a new record: its code and a slug of its title. */
export function recordFileName(code: string, title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `${code}-${slug || "record"}.yaml`;
}

/**
 * Refuse a save that would break a rule across records (a duplicate code, a
 * roadmap step naming an unknown plan). Only issues about the saved record
 * count, so an older problem elsewhere never blocks an unrelated edit.
 */
export function assertRulesFor(record: string, input: Parameters<typeof checkRules>[0]): void {
  const issues = checkRules(input).filter((issue) => issue.record === record);
  if (issues.length === 0) return;
  throw new StoreError(
    "invalid_record",
    `${record}: ${issues.map((issue) => issue.message).join("; ")}`,
    issues,
  );
}
