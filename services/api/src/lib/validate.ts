import type { z } from "zod";
import { AppError } from "./errors";

/** Parse untrusted input; failures become 422 with field-level details. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const details: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    (details[key] ??= []).push(issue.message);
  }
  throw new AppError("validation_failed", "Some fields are invalid", details);
}
