CREATE TABLE `VRChatPhotoMetadataModels` (
	`id` text PRIMARY KEY,
	`photoPath` text NOT NULL,
	`authorId` text NOT NULL,
	`authorDisplayName` text NOT NULL,
	`worldId` text,
	`worldDisplayName` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `VRChatPhotoPathModels` (
	`id` text PRIMARY KEY,
	`photoPath` text NOT NULL,
	`photoTakenAt` text NOT NULL,
	`height` integer DEFAULT 720 NOT NULL,
	`width` integer DEFAULT 1280 NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `VRChatPlayerJoinLogModels` (
	`id` text PRIMARY KEY,
	`playerId` text,
	`playerName` text NOT NULL,
	`joinDateTime` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `VRChatPlayerLeaveLogModels` (
	`id` text PRIMARY KEY,
	`leaveDateTime` text NOT NULL,
	`playerName` text NOT NULL,
	`playerId` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `VRChatWorldJoinLogModels` (
	`id` text PRIMARY KEY,
	`worldId` text NOT NULL,
	`worldName` text NOT NULL,
	`worldInstanceId` text NOT NULL,
	`joinDateTime` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `VRChatWorldJoinLogFromPhotoModels` (
	`id` text PRIMARY KEY,
	`worldId` text NOT NULL,
	`joinDateTime` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `v_r_chat_photo_metadata_models_photo_path_unique` ON `VRChatPhotoMetadataModels` (`photoPath`);--> statement-breakpoint
CREATE INDEX `v_r_chat_photo_metadata_models_world_id` ON `VRChatPhotoMetadataModels` (`worldId`);--> statement-breakpoint
CREATE UNIQUE INDEX `v_r_chat_photo_path_models_photo_path_unique` ON `VRChatPhotoPathModels` (`photoPath`);--> statement-breakpoint
CREATE UNIQUE INDEX `playerName-joinDateTime` ON `VRChatPlayerJoinLogModels` (`playerName`,`joinDateTime`);--> statement-breakpoint
CREATE INDEX `joinDateTime-idx` ON `VRChatPlayerJoinLogModels` (`joinDateTime`);--> statement-breakpoint
CREATE UNIQUE INDEX `worldInstanceId-joinDateTime` ON `VRChatWorldJoinLogModels` (`worldInstanceId`,`joinDateTime`);--> statement-breakpoint
CREATE INDEX `world-joinDateTime-idx` ON `VRChatWorldJoinLogModels` (`joinDateTime`);--> statement-breakpoint
CREATE UNIQUE INDEX `worldInstanceId-joinDateTime-fromPhoto` ON `VRChatWorldJoinLogFromPhotoModels` (`worldId`,`joinDateTime`);--> statement-breakpoint
CREATE INDEX `photo-joinDateTime-idx` ON `VRChatWorldJoinLogFromPhotoModels` (`joinDateTime`);