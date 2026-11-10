/** Environment variables as seen by the action (inputs arrive as INPUT_* variables). */
export type Env = Record<string, string | undefined>;
/**
 * Runs one Action invocation: validates inputs, loads the policy config (from the base commit by
 * default), analyzes, writes report files, job summary and step outputs.
 * @returns the process exit code (0 ok, 2 usage, 3 repository, 4 policy, 1 internal). With on-error=warn, tool
 * errors return 0 after a warning (fail-open).
 */
export declare function runAction(env: Env, log?: (line: string) => void): Promise<number>;
