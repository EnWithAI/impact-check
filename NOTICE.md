# NOTICE

Impact Check
Copyright (c) 2026 EnWithAI Technologies

Impact Check is licensed under the MIT License (see [LICENSE](LICENSE)). This NOTICE adds no conditions to that
license.

## Third-party components

This repository does not include (vendor) third-party source code. Runtime dependencies are installed by your
package manager from their own distributions, under their own licenses:

| Package                                                              | Version | License    | Copyright notice                        |
| -------------------------------------------------------------------- | ------- | ---------- | --------------------------------------- |
| [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) | 18.5.0  | MIT        | Copyright (c) 2016-2026 Sander Verweij  |
| [TypeScript](https://github.com/microsoft/TypeScript)                | 6.0.3   | Apache-2.0 | Copyright (c) Microsoft Corporation     |
| [yaml](https://github.com/eemeli/yaml)                               | 2.9.1   | ISC        | Copyright Eemeli Aro <eemeli@gmail.com> |

Their transitive dependencies (45 production packages: MIT 40, ISC 4, Apache-2.0 1) are listed by
`node scripts/license-audit.mjs`.

## Trademarks

EnWithAI, CrewPE and related names are not licensed under the MIT License. See [TRADEMARKS.md](TRADEMARKS.md).
