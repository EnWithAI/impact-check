export const ExitCode = {
  Ok: 0,
  Internal: 1,
  Usage: 2,
  Repository: 3,
  Policy: 4,
} as const;

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

export const usageError = (message: string, hint?: string): ImpactCheckError =>
  new ImpactCheckError(message, ExitCode.Usage, hint);

export const repoError = (message: string, hint?: string): ImpactCheckError =>
  new ImpactCheckError(message, ExitCode.Repository, hint);
