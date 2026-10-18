# App Event Export/Import Enhancement

## Overview

This document describes the planned enhancement for supporting VRChat application events in the export/import functionality. Currently, these features are marked as TODO and will be implemented in the future.

## Supported Log Patterns

### Currently Implemented

1. **World Join**: `[Behaviour] Joining `
2. **Player Join**: `[Behaviour] OnPlayerJoined `
3. **Player Leave**: `[Behaviour] OnPlayerLeft `
4. **App Exit** (partial): `VRCApplication: HandleApplicationQuit` - Raw line kept in the logStore, not parsed

### TODO: Future Implementation

1. **App Start Events**
   - Pattern: `VRC Analytics Initialized`
   - Status: TODO - Parser returns null
   - Will indicate when VRChat application started

2. **App Exit Events** (full implementation)
   - Current: Only the raw `HandleApplicationQuit` line is kept in the logStore
   - Removed patterns (not in actual VRChat logs):
     - `OnApplicationPause`
     - `OnApplicationQuit`
     - `Application terminating`
     - `Shutting down`

3. **App Version Events**
   - Pattern: `Application.version: X.X.X`
   - Status: TODO - Not found in actual VRChat logs
   - Parser returns null

## Current Implementation

### Pattern Management

- Centralized pattern definitions in `/electron/module/vrchatLog/constants/logPatterns.ts`
- All filter patterns are defined in one place to ensure consistency
- Pattern handling status is tracked via TypeScript types

### Application Quit Lines

- The raw `VRCApplication: HandleApplicationQuit` line is kept in the logStore because `FILTER_PATTERNS` includes `LOG_PATTERNS.APP_EXIT`
- No parser consumes it, so it is not stored in the database as an event

### Export/Import Process

- Export: Currently exports world joins, player joins, and player leaves
- Import: Parses supported patterns and stores them in the database
- App events (start/version) are filtered but not processed (TODO)
- `HandleApplicationQuit` lines are kept in the logStore but not parsed into events

## Design Principles

1. **Pattern Consistency**: All log patterns are centrally managed to prevent mismatches
2. **Type Safety**: Uses ts-pattern for exhaustive pattern matching
3. **TODO Implementation**: App event features are stubbed out for future implementation
4. **No New Models**: App events will be handled without creating new Sequelize models

## Future Work

1. Research actual VRChat log patterns for app lifecycle events
2. Implement app start event parsing when needed
3. Consider if app version tracking is necessary
4. Ensure export/import maintains compatibility when app events are added
