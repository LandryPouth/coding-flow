# Story 27-07 — Notifications have levels and waits are measured

## User Value

The maintainer is interrupted only for what needs them, reminded once,
left alone at night, and can see where the factory's time goes — above all
how long it waits for them.

## Requirements

- Levels over 26-02's command: `urgent` (needs-decision holding every
  chain, run stopped, breaker, security) sent at once and reminded once
  after `notify.remindAfterHours` (default 4); `info` (story done with or
  without debt, epic integrated or landed) batched every
  `notify.batchMinutes` (default 30); `digest` (`notify.digest: daily |
  run-end`).
- `notify.quiet` (e.g. `"22:00-08:00"`) holds all but urgent; duplicates
  dropped; each message carries one command.
- Time per lifecycle state, phase and hold reason per story; the report and
  `insights` show working, waiting (by sub-reason), paused, and human
  latency (needs-decision → answer).
- "Done with debt" (accepted P2s, open risks, unobserved browser) is a flag
  on the story, in `status`, the report and the info notification.

## Acceptance Criteria

- [ ] Given two info events within the batch window, then one notification
      carries both.
- [ ] Given quiet hours and an info event, then it waits; an urgent one does
      not.
- [ ] Given an urgent event unanswered after the reminder delay, then one
      reminder is sent, never two.
- [ ] Given a run, then the report shows time per hold reason and the human
      latency of each answered packet.
- [ ] Given a done story with an accepted P2, then it shows "done with debt"
      in `status` and the report.
