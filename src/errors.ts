export const ExitCode = {
  Ok: 0,
  Internal: 1,
  Usage: 2,
  Repository: 3,
  Policy: 4,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/** An expected, user-facing error with a defined exit code and optional remediation hint. */
export class ChangeLensError extends Error {
  readonly exitCode: ExitCodeValue;
  readonly hint: string | undefined;

  constructor(message: string, exitCode: ExitCodeValue, hint?: string) {
    super(message);
    this.name = "ChangeLensError";
    this.exitCode = exitCode;
    this.hint = hint;
  }
}

export const usageError = (message: string, hint?: string): ChangeLensError =>
  new ChangeLensError(message, ExitCode.Usage, hint);

export const repoError = (message: string, hint?: string): ChangeLensError =>
  new ChangeLensError(message, ExitCode.Repository, hint);
