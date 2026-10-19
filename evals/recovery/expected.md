# Recovery fixture — expected states

A blind `/flow-recover` assess on a copy of `evals/recovery/fixture/`, committed
in a throwaway repository, must reach every state below. The skill text is the
thing under test: the scan reports the deterministic facts, the inventories and
the reading produce the states.

## Findings

| ID | Finding | Expected state | Trace the assess must produce |
| --- | --- | --- | --- |
| R-01 | `GET /scripts/:id` returns any user's script: the route checks a token but the query filters on `id` only. | `confirmed` | `server.js:15` → `server.js:16` → `src/scripts/service.js:5` → `src/scripts/repository.js:4` |
| R-02 | `POST /scripts/test-webhook` fetches a caller-controlled URL with caller-chosen headers and returns the body. | `confirmed` | `server.js:20` → `src/scripts/service.js:8` → `src/scripts/service.js:9` |
| R-03 | `POST /scripts/test-function` looks like remote code execution, but the runtime parses its second argument as a run UUID and exits before evaluating anything. | `refuted` | `server.js:25` → `src/scripts/service.js:13` → `src/runtime/client.js:4` → `src/runtime/main.js:2` → `src/runtime/main.js:4` |
| R-04 | `AUTH_SECRET` falls back to a development secret outside production; the Docker image sets `NODE_ENV=production`, so the fallback is unreachable there. | `mitigated` — by deploy config, not by code | `src/config.js:1` → `src/config.js:4` → `Dockerfile:2` |
| R-05 | The "Long assigned credential" heuristic reports the RDS password command substitution. | `false-positive` **only if the scan reports it** — a Coding Flow tool bug. With 13-02 fixed the scan reports no tree secret, so the expected outcome is no finding and no invented false-positive. | `scripts/aws/lot1-2-rds.sh:4` when reported |
| R-06 | Vulnerable dependencies. | `not examined` — no scanner ran and no network was available | no trace; the dimension table says so |

## Dimensions

| Dimension | Expected status | Why |
| --- | --- | --- |
| Security | `examined` | Routes, ownership, outbound calls, code execution, secret fallbacks and secrets in the tree were checked. The dependency audit is the one row that stays `not examined`. |
| Data | `not examined` | The fixture has no migrations, schema or backup configuration. Saying "fine" would be a guess. |
| Reliability | `not examined` | No worker, queue, webhook retry or transaction to read. |
| Architecture | `examined` | `recover scan` reports the hotspot (`src/engine/runner.js`) and the test map; both tests touch `src/util.js`, not the runner. |
| Operations | `examined` | The Dockerfile is the only deploy artifact; no health check, no log review beyond `/dev/signal`. |
| Comprehension | `examined` | The broken `test-function` path (R-03) is the dead feature; `express` is declared and used. |

## Non-negotiable output rules

- `findings.md` uses one `### R-NN — title` block per finding, with `- State:`,
  `- Dimension:`, `- Severity:`, `- Location:`, `- Trace:` and `- Next:`.
- The file ends with the dimension table above.
- No finding says "secure", "production-ready" or "no issues".
- The command-substitution line is never described as a leaked secret; when the
  scan reports it, the finding is `false-positive` and names the tool bug.
- The assess makes no network request and modifies no application code.
