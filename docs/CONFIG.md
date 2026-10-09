# Configuration (`.impact-check.json`)

JSON only (no JS configs — they would have to be executed). Unknown fields are rejected (exit 2). All fields optional.

```json
{
  "base": "main",
  "tsconfig": "tsconfig.json",
  "maxDepth": 10,
  "maxAffected": 500,
  "blastRadiusThreshold": 10,
  "ignorePaths": ["generated/**", "**/*.snap"],
  "securityPathPatterns": ["src/billing/**"],
  "branding": true,
  "conventions": {
    "testPatterns": ["e2e/**/*.ts"],
    "generatedPaths": ["src/graphql/types/**"]
  },
  "policy": {
    "failOnSeverity": "high",
    "failOnRules": [],
    "maxAffectedModules": null
  }
}
```

| Field                        | Default                                           | Meaning                                                                                                                         |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `base`                       | `null` → main, origin/main, master, origin/master | Default base ref when `--base` is omitted.                                                                                      |
| `tsconfig`                   | auto                                              | tsconfig/jsconfig used for `paths` aliases.                                                                                     |
| `maxDepth`                   | 10                                                | Reverse-dependency hops.                                                                                                        |
| `maxAffected`                | 500                                               | Dependents listed before truncation.                                                                                            |
| `blastRadiusThreshold`       | 10                                                | Transitive dependents that trigger `wide-blast-radius`.                                                                         |
| `ignorePaths`                | `[]`                                              | Globs (`*`, `**`, `?`) of changed paths to exclude (reported as a limitation).                                                  |
| `securityPathPatterns`       | `[]`                                              | Extra globs treated as security-sensitive.                                                                                      |
| `branding`                   | `true`                                            | One-line footer in Markdown.                                                                                                    |
| `conventions.testPatterns`   | `[]`                                              | Extra globs classified as tests (changed-file kind, test candidates).                                                           |
| `conventions.generatedPaths` | `[]`                                              | Extra globs flagged as generated code (`generated-code` limitation).                                                            |
| `policy.failOnSeverity`      | `"high"`                                          | `check` fails when any finding has at least this severity (`none` disables). In alpha only graph-confirmed findings are `high`. |
| `policy.failOnRules`         | `[]`                                              | `check` fails when any finding has one of these rule IDs.                                                                       |
| `policy.maxAffectedModules`  | `null`                                            | `check` fails when more modules are affected.                                                                                   |

Globs are converted to anchored expressions internally; regular-expression syntax from users is never evaluated.
In the GitHub Action the config is read from the **base** commit by default (`config-source: base`).
An example lives at [`../.impact-check.example.json`](../.impact-check.example.json).
