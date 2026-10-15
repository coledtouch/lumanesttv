CREATE TABLE `subscription_catalog` (
	`mode` text PRIMARY KEY NOT NULL,
	`product_id` text,
	`state` text NOT NULL,
	`created` integer NOT NULL,
	`locked_at` integer
);
--> statement-breakpoint
CREATE TABLE `subscription_payments` (
	`sale_id` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`amount` text NOT NULL,
	`currency` text NOT NULL,
	`state` text NOT NULL,
	`paid_at` text NOT NULL,
	`created` integer NOT NULL,
	`attempted` integer,
	`fulfilled` integer,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `subscription_plans` (
	`sku` text PRIMARY KEY NOT NULL,
	`paypal_plan_id` text,
	`product_id` text NOT NULL,
	`devices` integer NOT NULL,
	`months` integer NOT NULL,
	`amount` text NOT NULL,
	`currency` text NOT NULL,
	`mode` text NOT NULL,
	`state` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_plans_paypal_plan_id_unique` ON `subscription_plans` (`paypal_plan_id`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`paypal_id` text,
	`plan_id` text NOT NULL,
	`line_id` integer NOT NULL,
	`line_slot` integer,
	`credential` text NOT NULL,
	`devices` integer NOT NULL,
	`months` integer NOT NULL,
	`amount` text NOT NULL,
	`currency` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`state` text NOT NULL,
	`mode` text NOT NULL,
	`starts_at` text NOT NULL,
	`next_billing_at` text,
	`approval_url` text,
	`cancel_requested` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_paypal_id_unique` ON `subscriptions` (`paypal_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_line_slot_unique` ON `subscriptions` (`line_slot`);