-- アプリのバージョン 0.31.6（Sequelize 7.0.0-alpha.48 の sync({ alter: true })）が作った DB を、
-- sqlite_master と行の中身から書き出したもの。既存の DB の引き継ぎのテストが基準にする。

CREATE TABLE `Migrations` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `version` TEXT NOT NULL, `migratedAt` TEXT NOT NULL, `schemaFingerprint` TEXT, `createdAt` TEXT NOT NULL, `updatedAt` TEXT NOT NULL);
CREATE TABLE `VRChatPhotoMetadataModels` (`id` TEXT PRIMARY KEY, `photoPath` TEXT NOT NULL, `authorId` TEXT NOT NULL, `authorDisplayName` TEXT NOT NULL, `worldId` TEXT, `worldDisplayName` TEXT, `createdAt` TEXT NOT NULL, `updatedAt` TEXT NOT NULL);
CREATE TABLE `VRChatPhotoPathModels` (`id` TEXT PRIMARY KEY, `photoPath` TEXT NOT NULL, `photoTakenAt` TEXT NOT NULL, `height` INTEGER NOT NULL DEFAULT 720, `width` INTEGER NOT NULL DEFAULT 1280, `createdAt` TEXT NOT NULL, `updatedAt` TEXT NOT NULL);
CREATE TABLE `VRChatPlayerJoinLogModels` (`id` TEXT PRIMARY KEY, `playerId` TEXT, `playerName` TEXT NOT NULL, `joinDateTime` TEXT NOT NULL, `createdAt` TEXT NOT NULL, `updatedAt` TEXT NOT NULL);
CREATE TABLE `VRChatPlayerLeaveLogModels` (`id` TEXT PRIMARY KEY, `leaveDateTime` TEXT NOT NULL, `playerName` TEXT NOT NULL, `playerId` TEXT, `createdAt` TEXT NOT NULL, `updatedAt` TEXT NOT NULL);
CREATE TABLE `VRChatWorldJoinLogFromPhotoModels` (`id` TEXT PRIMARY KEY, `worldId` TEXT NOT NULL, `joinDateTime` TEXT NOT NULL, `createdAt` TEXT NOT NULL, `updatedAt` TEXT NOT NULL);
CREATE TABLE `VRChatWorldJoinLogModels` (`id` TEXT PRIMARY KEY, `worldId` TEXT NOT NULL, `worldName` TEXT NOT NULL, `worldInstanceId` TEXT NOT NULL, `joinDateTime` TEXT NOT NULL, `createdAt` TEXT NOT NULL, `updatedAt` TEXT NOT NULL);
CREATE INDEX `joinDateTime-idx` ON `VRChatPlayerJoinLogModels` (`joinDateTime`);
CREATE INDEX `photo-joinDateTime-idx` ON `VRChatWorldJoinLogFromPhotoModels` (`joinDateTime`);
CREATE UNIQUE INDEX `playerName-joinDateTime` ON `VRChatPlayerJoinLogModels` (`playerName`, `joinDateTime`);
CREATE UNIQUE INDEX `v_r_chat_photo_metadata_models_photo_path_unique` ON `VRChatPhotoMetadataModels` (`photoPath`);
CREATE INDEX `v_r_chat_photo_metadata_models_world_id` ON `VRChatPhotoMetadataModels` (`worldId`);
CREATE UNIQUE INDEX `v_r_chat_photo_path_models_photo_path_unique` ON `VRChatPhotoPathModels` (`photoPath`);
CREATE INDEX `world-joinDateTime-idx` ON `VRChatWorldJoinLogModels` (`joinDateTime`);
CREATE UNIQUE INDEX `worldInstanceId-joinDateTime` ON `VRChatWorldJoinLogModels` (`worldInstanceId`, `joinDateTime`);
CREATE UNIQUE INDEX `worldInstanceId-joinDateTime-fromPhoto` ON `VRChatWorldJoinLogFromPhotoModels` (`worldId`, `joinDateTime`);

INSERT INTO `Migrations` (`id`, `version`, `migratedAt`, `schemaFingerprint`, `createdAt`, `updatedAt`) VALUES (1, '0.0.0-test', '2026-11-09 16:53:11.786 +00:00', '5a78a6c9bb61b900f6fbbadeb1927f4438ea213802ad4b38a8b0d5e0121ec0f2', '2026-11-09 16:53:11.787 +00:00', '2026-11-09 16:53:11.788 +00:00');
INSERT INTO `VRChatPhotoMetadataModels` (`id`, `photoPath`, `authorId`, `authorDisplayName`, `worldId`, `worldDisplayName`, `createdAt`, `updatedAt`) VALUES ('01a1c13a-6550-785e-9c3e-5b9d8da2edd3', '/p/a.png', 'usr_a', 'A', 'wrld_1', 'W', '2026-11-09 16:53:12.144 +00:00', '2026-11-09 16:53:12.144 +00:00');
INSERT INTO `VRChatPhotoPathModels` (`id`, `photoPath`, `photoTakenAt`, `height`, `width`, `createdAt`, `updatedAt`) VALUES ('01a1c13a-654c-7842-bd91-b2ea9580c4c7', '/p/a.png', '2024-01-31 23:30:15.123 +00:00', 1080, 1920, '2026-11-09 16:53:12.140 +00:00', '2026-11-09 16:53:12.140 +00:00');
INSERT INTO `VRChatPlayerJoinLogModels` (`id`, `playerId`, `playerName`, `joinDateTime`, `createdAt`, `updatedAt`) VALUES ('01a1c13a-6553-72a0-8c19-12b4481eb534', 'usr_b', 'Bob', '2024-01-31 23:30:15.123 +00:00', '2026-11-09 16:53:12.147 +00:00', '2026-11-09 16:53:12.147 +00:00');
INSERT INTO `VRChatPlayerLeaveLogModels` (`id`, `leaveDateTime`, `playerName`, `playerId`, `createdAt`, `updatedAt`) VALUES ('01a1c13a-6555-7eef-b666-ca4ba0102214', '2024-01-31 23:30:15.123 +00:00', 'Bob', NULL, '2026-11-09 16:53:12.149 +00:00', '2026-11-09 16:53:12.149 +00:00');
INSERT INTO `VRChatWorldJoinLogFromPhotoModels` (`id`, `worldId`, `joinDateTime`, `createdAt`, `updatedAt`) VALUES ('01a1c13a-6559-7741-af58-b2b55d934c26', 'wrld_1', '2024-01-31 23:30:15.123 +00:00', '2026-11-09 16:53:12.153 +00:00', '2026-11-09 16:53:12.153 +00:00');
INSERT INTO `VRChatWorldJoinLogModels` (`id`, `worldId`, `worldName`, `worldInstanceId`, `joinDateTime`, `createdAt`, `updatedAt`) VALUES ('01a1c13a-6557-7b34-9384-2033f2dcee84', 'wrld_1', 'W', '123~x', '2024-01-31 23:30:15.123 +00:00', '2026-11-09 16:53:12.151 +00:00', '2026-11-09 16:53:12.151 +00:00');
