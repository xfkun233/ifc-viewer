-- CreateTable
CREATE TABLE `IfcModel` (
  `id` VARCHAR(191) NOT NULL,
  `originalFileName` VARCHAR(191) NOT NULL,
  `storedFileName` VARCHAR(191) NOT NULL,
  `mimeType` VARCHAR(191) NOT NULL,
  `fileSize` INTEGER NOT NULL,
  `fileHash` VARCHAR(191) NOT NULL,
  `sourceFingerprint` VARCHAR(191) NOT NULL,
  `syncStatus` ENUM('PENDING', 'PROCESSING', 'READY', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `syncError` TEXT NULL,
  `totalElements` INTEGER NOT NULL DEFAULT 0,
  `totalProperties` INTEGER NOT NULL DEFAULT 0,
  `syncStartedAt` DATETIME(3) NULL,
  `syncCompletedAt` DATETIME(3) NULL,
  `lastAccessedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `IfcModel_storedFileName_key`(`storedFileName`),
  INDEX `IfcModel_createdAt_idx`(`createdAt`),
  INDEX `IfcModel_fileHash_idx`(`fileHash`),
  INDEX `IfcModel_sourceFingerprint_idx`(`sourceFingerprint`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IfcElement` (
  `id` VARCHAR(191) NOT NULL,
  `modelId` VARCHAR(191) NOT NULL,
  `expressId` INTEGER NOT NULL,
  `globalId` VARCHAR(191) NULL,
  `entityType` VARCHAR(191) NULL,
  `name` VARCHAR(191) NULL,
  `objectType` VARCHAR(191) NULL,
  `predefinedType` VARCHAR(191) NULL,
  `attributesJson` JSON NULL,
  `rawDataJson` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `IfcElement_modelId_expressId_key`(`modelId`, `expressId`),
  INDEX `IfcElement_modelId_expressId_idx`(`modelId`, `expressId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IfcElementProperty` (
  `id` VARCHAR(191) NOT NULL,
  `modelId` VARCHAR(191) NOT NULL,
  `expressId` INTEGER NOT NULL,
  `source` ENUM('NATIVE', 'CUSTOM') NOT NULL,
  `psetName` VARCHAR(191) NOT NULL,
  `propertyName` VARCHAR(191) NOT NULL,
  `valueType` ENUM('STRING', 'LABEL', 'REAL', 'INTEGER', 'BOOLEAN') NOT NULL,
  `valueText` VARCHAR(191) NOT NULL,
  `numericValue` DECIMAL(18, 6) NULL,
  `booleanValue` BOOLEAN NULL,
  `rawValueJson` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `uniq_model_prop`(`modelId`, `expressId`, `source`, `psetName`, `propertyName`),
  INDEX `IfcElementProperty_modelId_expressId_source_idx`(`modelId`, `expressId`, `source`),
  INDEX `IfcElementProperty_modelId_source_idx`(`modelId`, `source`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IfcAnnotation` (
  `id` VARCHAR(191) NOT NULL,
  `modelId` VARCHAR(191) NOT NULL,
  `clientId` VARCHAR(191) NOT NULL,
  `x` DECIMAL(18, 6) NOT NULL,
  `y` DECIMAL(18, 6) NOT NULL,
  `z` DECIMAL(18, 6) NOT NULL,
  `text` TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `IfcAnnotation_modelId_clientId_key`(`modelId`, `clientId`),
  INDEX `IfcAnnotation_modelId_idx`(`modelId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `IfcElement`
  ADD CONSTRAINT `IfcElement_modelId_fkey`
  FOREIGN KEY (`modelId`) REFERENCES `IfcModel`(`id`)
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IfcElementProperty`
  ADD CONSTRAINT `IfcElementProperty_modelId_fkey`
  FOREIGN KEY (`modelId`) REFERENCES `IfcModel`(`id`)
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IfcAnnotation`
  ADD CONSTRAINT `IfcAnnotation_modelId_fkey`
  FOREIGN KEY (`modelId`) REFERENCES `IfcModel`(`id`)
  ON DELETE CASCADE
  ON UPDATE CASCADE;
