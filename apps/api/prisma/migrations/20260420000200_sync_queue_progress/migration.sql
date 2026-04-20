ALTER TABLE `IfcModel`
  ADD COLUMN `syncQueuedAt` DATETIME(3) NULL,
  ADD COLUMN `syncProcessedElements` INTEGER NOT NULL DEFAULT 0;

CREATE INDEX `IfcModel_syncStatus_syncQueuedAt_idx`
  ON `IfcModel`(`syncStatus`, `syncQueuedAt`);
