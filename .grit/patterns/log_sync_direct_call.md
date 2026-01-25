# Log Sync Direct Call Check

Detects direct calls to log sync internal functions outside of the syncLogs service.

## Background

The log sync process requires strict execution order:
```
appendLoglines → loadLogInfo → cache invalidation
```

Violating this order causes data integrity issues (photos associated with wrong worlds).

## Allowed callers
- `electron/module/logSync/service.ts` - The syncLogs orchestration service
- Test files (`*.test.ts`, `*.spec.ts`)
- The controller exposing the function as tRPC endpoint

## Prohibited pattern

```typescript
// ❌ Direct call from service layer (outside syncLogs)
await appendLoglinesToFileFromLogFilePathList(true);
await loadLogInfoIndexFromVRChatLog({ excludeOldLogLoad: true });
```

## Recommended pattern

```typescript
// ✅ Use the syncLogs service
import { syncLogs } from '../logSync/service';
await syncLogs({ mode: 'incremental' });
```

## Pattern

```grit
language js

// Detect direct calls to appendLoglinesToFileFromLogFilePathList
`appendLoglinesToFileFromLogFilePathList($args)`
```
