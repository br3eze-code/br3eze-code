# AgentOS A2A + Task/WBS Contract

## Canonical execution identity

Every cross-agent operation is correlated by `taskId`. A WBS step is identified by `wbsId`; an individual handoff is identified by `handoffId`; the end-to-end trace is identified by `traceId`.

```text
Task
 └─ taskId
     ├─ WBS step (wbsId)
     │   └─ Agent Team member
     │       └─ A2A message
     │           ├─ handoffId
     │           └─ traceId
     └─ evidence / result / audit
```

## Team rule

Agents do not create unrelated tasks when continuing the same mission. They receive the existing `taskId`, operate on the current WBS step, and return progress/result against that identity.

## WBS gates

1. Scope
2. Authorize
3. Plan/delegate
4. Execute
5. Verify
6. Complete/handoff

A mutating capability must additionally carry an approval reference accepted by the AgentOS policy layer.

## A2A message

Protocol version: `agentos-a2a/1.0`.

Required correlation fields:

- `taskId`
- `wbsId`
- `handoffId`
- `traceId`
- sender/recipient
- capability
- scoped tenant/project/domain context
- sender and recipient agent roles

## HTTP/serverless surface

- `POST /api/tasks` — create mission/task
- `GET /api/tasks/:taskId` — task + WBS state
- `GET /api/tasks/:taskId/team` — team/WBS snapshot
- `POST /api/tasks/:taskId/team` — form team
- `POST /api/tasks/:taskId/team/start` — start team
- `POST /api/tasks/:taskId/wbs/:stepId/complete` — complete WBS step
- `POST /api/a2a/message` — dispatch A2A message
- `GET /api/tasks/:taskId/stream` — live task/WBS feed
- `POST /api/tasks/:taskId/cancel` — cancel task

Vercel is only the HTTP transport. The task registry, WBS, policy and A2A protocol remain transport-neutral.
