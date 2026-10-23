CREATE TABLE `trial_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`status_hash` text NOT NULL,
	`email` text NOT NULL,
	`email_key` text NOT NULL,
	`name` text NOT NULL,
	`device` text NOT NULL,
	`network` text NOT NULL,
	`state` text NOT NULL,
	`created` integer NOT NULL,
	`decided` integer,
	`attempted` integer,
	`line_id` integer,
	`customer_id` integer,
	`expires` integer,
	`message` text,
	`error` text,
	`resolution` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trial_requests_status_hash_unique` ON `trial_requests` (`status_hash`);--> statement-breakpoint
CREATE INDEX `trial_requests_state_created_idx` ON `trial_requests` (`state`,`created`);--> statement-breakpoint
CREATE INDEX `trial_requests_email_key_idx` ON `trial_requests` (`email_key`);--> statement-breakpoint
CREATE INDEX `trial_requests_network_idx` ON `trial_requests` (`network`);--> statement-breakpoint
CREATE INDEX `trial_requests_expires_idx` ON `trial_requests` (`expires`);--> statement-breakpoint
CREATE INDEX `trial_requests_line_id_idx` ON `trial_requests` (`line_id`);