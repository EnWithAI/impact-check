// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
// Declared architecture of Impact Check, checked against the code by Architecture Check
// (.github/workflows/architecture.yml). The container is the repository root (commons.source "."); its components,
// the first-level directories under src/, are derived from the module graph.
workspace "Impact Check" {
    !identifiers hierarchical

    model {
        developer = person "Developer"
        impactCheck = softwareSystem "Impact Check" {
            cli = container "impact-check CLI and Action" "Static change-impact analysis of a git branch" "Node.js" {
                properties {
                    "commons.source" "."
                }
            }
        }
        developer -> impactCheck.cli "Runs on a branch or pull request"
    }
}
