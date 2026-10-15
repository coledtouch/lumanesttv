CREATE TABLE `paypal_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`received` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `paypal_webhook_events_received_idx` ON `paypal_webhook_events` (`received`);--> statement-breakpoint
CREATE TABLE `player_revoked_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `player_revoked_sessions_expires_idx` ON `player_revoked_sessions` (`expires`);--> statement-breakpoint
ALTER TABLE `orders` ADD `resolution` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `resolved` integer;