# Reference — 01 Fix

**Should change:** `src/money.js` only (`formatAmount`).

**Should not change:** anything else. Touching `report.js` to post-process the
string, or `parseAmount`, is a miss.

**The trap:** `Math.trunc(-0.34)` is `-0`, and `String(-0)` is `"0"`, so a fix that
only reorders the existing pieces still drops the sign for amounts under one unit.
The second acceptance test exists for exactly that partial fix.
