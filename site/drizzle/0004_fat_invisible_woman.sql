CREATE TABLE `billing_line_locks` (
	`line_id` integer PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL
);
