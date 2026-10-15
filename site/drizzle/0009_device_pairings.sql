CREATE TABLE `device_pairings` (
	`device_hash` text PRIMARY KEY NOT NULL,
	`user_code` text NOT NULL,
	`device` text NOT NULL,
	`client` text NOT NULL,
	`status` text NOT NULL,
	`payload` text,
	`created` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_pairings_user_code_unique` ON `device_pairings` (`user_code`);--> statement-breakpoint
CREATE INDEX `device_pairings_expires_idx` ON `device_pairings` (`expires`);--> statement-breakpoint
CREATE INDEX `device_pairings_client_idx` ON `device_pairings` (`client`);