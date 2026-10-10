/**
 * Test candidates: test files that import affected modules (graph), changed tests (observed) and tests
 * matching a changed module's file name (inferred). Candidates are suggestions only; nothing is executed.
 */
import type { AffectedModule, ChangedFile, TestCandidate } from "../types.js";
/**
 * Candidate tests to run. Sources: changed tests (observed), tests that transitively import a changed module
 * (graph), and tests whose file stem matches a changed source module (inferred). Nothing is executed.
 */
export declare function suggestTests(files: ChangedFile[], affected: AffectedModule[], headFiles: string[], isTest?: (path: string) => boolean): TestCandidate[];
