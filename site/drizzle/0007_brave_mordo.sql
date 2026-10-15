CREATE INDEX `orders_line_kind_state_idx` ON `orders` (`line_id`,`kind`,`state`);--> statement-breakpoint
CREATE INDEX `owner_auth_attempts_expires_idx` ON `owner_auth_attempts` (`expires`);--> statement-breakpoint
CREATE INDEX `owner_sessions_expires_idx` ON `owner_sessions` (`expires`);--> statement-breakpoint
CREATE INDEX `player_login_attempts_expires_idx` ON `player_login_attempts` (`expires`);--> statement-breakpoint
CREATE INDEX `subscription_payments_subscription_id_idx` ON `subscription_payments` (`subscription_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_line_id_idx` ON `subscriptions` (`line_id`);