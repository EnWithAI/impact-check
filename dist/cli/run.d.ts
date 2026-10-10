/** I/O seams for the CLI so it can run in-process in tests. */
export interface CliIO {
    stdout: (text: string) => void;
    stderr: (text: string) => void;
    cwd: string;
    now?: () => Date;
}
/** Text printed by `impact-check --help`. */
export declare const HELP: string;
/** Returns the bundled report JSON Schema (works from both src/ and dist/). */
export declare function readSchema(): string;
/** CLI entry point. Never throws; maps every error to a documented exit code. */
export declare function run(argv: string[], io: CliIO): Promise<number>;
