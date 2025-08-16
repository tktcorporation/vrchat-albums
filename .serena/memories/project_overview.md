# VRChat Albums Project Overview

## Purpose
VRChat Albums is an Electron desktop application for organizing VRChat photos by automatically associating them with log files. It helps users organize and reminisce about their VRChat experiences by tracking when and where photos were taken, along with information about friends present at the time.

## Key Features
- Automatic photo organization by associating VRChat photos with log files
- World information tracking (when and where photos were taken)
- Friend management (tracking who was present)
- Backup/export functionality for memories
- Fast search by world name or friend name
- Dark mode support with intuitive UI
- Currently supports Windows 10/11 (64-bit)

## Tech Stack
- **Electron**: Cross-platform desktop application framework
- **React 18**: UI library with TypeScript
- **Vite**: Fast frontend build tool
- **tRPC**: Type-safe API framework for communication between Electron main and renderer processes
- **SQLite/Sequelize**: Local database with ORM (Sequelize v7 alpha)
- **Tailwind CSS + Radix UI**: Styling and component library
- **ts-pattern**: Pattern matching for type-safe conditional logic
- **neverthrow**: Result pattern for error handling
- **Sharp**: Image processing for thumbnails
- **exiftool-vendored**: EXIF data extraction from photos

## Testing Frameworks
- **Vitest**: Unit testing framework
- **Playwright**: E2E testing framework

## Languages
- TypeScript for all application code
- Supports Japanese/English localization (i18n)