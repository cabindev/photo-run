-- CreateTable
CREATE TABLE `Event` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `eventDate` DATETIME(3) NULL,
    `organizer` VARCHAR(191) NULL,
    `driveFolderId` VARCHAR(191) NOT NULL,
    `isPublished` BOOLEAN NOT NULL DEFAULT false,
    `faceSearchEnabled` BOOLEAN NOT NULL DEFAULT true,
    `faceListId` VARCHAR(191) NULL,
    `faceListDirty` BOOLEAN NOT NULL DEFAULT false,
    `purgeFacesAt` DATETIME(3) NULL,
    `bibOcrEnabled` BOOLEAN NOT NULL DEFAULT true,
    `bibPattern` VARCHAR(191) NULL,
    `lastSyncedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Event_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Photo` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `driveFileId` VARCHAR(191) NOT NULL,
    `filename` VARCHAR(191) NOT NULL,
    `folderName` VARCHAR(191) NULL,
    `takenAt` DATETIME(3) NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `thumbKey` VARCHAR(191) NULL,
    `previewKey` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'PROCESSED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `error` TEXT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `processedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Photo_eventId_status_idx`(`eventId`, `status`),
    INDEX `Photo_eventId_takenAt_idx`(`eventId`, `takenAt`),
    UNIQUE INDEX `Photo_eventId_driveFileId_key`(`eventId`, `driveFileId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PhotoFace` (
    `id` VARCHAR(191) NOT NULL,
    `photoId` VARCHAR(191) NOT NULL,
    `persistedFaceId` VARCHAR(191) NOT NULL,
    `box` JSON NOT NULL,

    UNIQUE INDEX `PhotoFace_persistedFaceId_key`(`persistedFaceId`),
    INDEX `PhotoFace_photoId_idx`(`photoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PhotoBib` (
    `id` VARCHAR(191) NOT NULL,
    `photoId` VARCHAR(191) NOT NULL,
    `bib` VARCHAR(191) NOT NULL,

    INDEX `PhotoBib_bib_idx`(`bib`),
    UNIQUE INDEX `PhotoBib_photoId_bib_key`(`photoId`, `bib`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Photo` ADD CONSTRAINT `Photo_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PhotoFace` ADD CONSTRAINT `PhotoFace_photoId_fkey` FOREIGN KEY (`photoId`) REFERENCES `Photo`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PhotoBib` ADD CONSTRAINT `PhotoBib_photoId_fkey` FOREIGN KEY (`photoId`) REFERENCES `Photo`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
