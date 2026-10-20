CREATE TABLE `extras_download_counts` (
	`day` text NOT NULL,
	`client` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`day`, `client`)
);
