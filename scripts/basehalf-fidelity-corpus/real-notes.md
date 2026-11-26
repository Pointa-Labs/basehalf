---
created: 2026-07-01
---

# Reading notes: distributed systems

> **Key claim.** Consensus is impossible with one faulty process in a fully
> asynchronous system (FLP).

## Questions

- [ ] How does partial synchrony change the FLP result?
- [x] Read the original paper
  - notes in [flp-notes](./flp-notes.md)

## Quotes

The paper states:

```text
No completely asynchronous consensus protocol can tolerate
even a single unannounced process death.
```

| Model | Consensus possible |
| ----- | ------------------ |
| sync  | yes                |
| async | no (FLP)           |

<!-- todo: add the Paxos comparison -->

Final thought: *safety* vs *liveness* tradeoffs dominate the design space.
