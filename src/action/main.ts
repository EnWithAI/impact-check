// Entry point executed by action.yml: `node "$GITHUB_ACTION_PATH/dist/action/main.js"`.
import { runAction } from "./run.js";

process.exitCode = await runAction(process.env);
