// Synthetic acceptance fixture (extends the basic TS fixture). Line numbers matter: expectations cite them.
import { basicTs } from "../fixtures/basic-ts.js";

export const acceptanceRepo: Record<string, string> = {
  ...basicTs,
  // imports both exports of src/utils/format.ts (formatPrice line 1, CURRENCY line 5)
  "src/services/price-label.ts":
    'import { formatPrice, CURRENCY } from "@utils/format";\nexport const label = (c: number) => `${CURRENCY} ${formatPrice(c)}`;\n',
  "src/utils/tax.ts":
    "function roundHalfUp(n: number): number {\n  return Math.round(n);\n}\n\nexport function applyTax(cents: number, rate: number): number {\n  const taxed = cents * (1 + rate);\n  return roundHalfUp(taxed);\n}\n\nexport interface TaxRule {\n  rate: number;\n}\n",
  "src/services/invoice.ts":
    'import { applyTax, type TaxRule } from "../utils/tax";\nexport const invoice = (c: number, r: TaxRule) => applyTax(c, r.rate);\n',
  "src/utils/index.ts": 'export * from "./format";\nexport const VERSION = 1;\n',
  "src/app-version.ts": 'import { VERSION } from "./utils/index";\nexport const v = VERSION;\n',
};

export const FORMAT_TS = acceptanceRepo["src/utils/format.ts"] as string;
export const TAX_TS = acceptanceRepo["src/utils/tax.ts"] as string;
