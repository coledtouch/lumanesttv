CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`paypal_id` text,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`line_id` integer,
	`devices` integer NOT NULL,
	`months` integer NOT NULL,
	`amount` text NOT NULL,
	`state` text NOT NULL,
	`created` integer NOT NULL,
	`attempted` integer,
	`capture_id` text,
	`fulfilled_line_id` integer,
	`error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_paypal_id_unique` ON `orders` (`paypal_id`);