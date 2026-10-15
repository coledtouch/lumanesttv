ALTER TABLE `subscriptions` ADD `merchant_activation` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `activation_attempted` integer;