/**
 * Error types and documented process exit codes. Every expected failure is an ImpactCheckError carrying
 * an exit code and an optional remediation hint; anything else is treated as an internal bug (exit 1).
 */
export const ExitCode = {
  Ok: 0,
  Internal: 1,
  Usage: 2,
  Repository: 3,
  Policy: 4,
} as const;

/** One of the documented exit codes. */
export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/** An expected, user-facing error with a defined exit code and optional remediation hint. */
export class ImpactCheckError extends Error {
  readonly exitCode: ExitCodeValue;
  readonly hint: string | undefined;

  constructor(message: string, exitCode: ExitCodeValue, hint?: string) {
    super(message);
    this.name = "ImpactCheckError";
    this.exitCode = exitCode;
    this.hint = hint;
  }
}

/** Creates a usage/configuration error (exit 2). */
export const usageError = (message: string, hint?: string): ImpactCheckError =>
  new ImpactCheckError(message, ExitCode.Usage, hint);

/** Creates a git/repository error (exit 3). */
export const repoError = (message: string, hint?: string): ImpactCheckError =>
  new ImpactCheckError(message, ExitCode.Repository, hint);
