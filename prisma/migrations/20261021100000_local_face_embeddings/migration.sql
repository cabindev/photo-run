-- ค้นด้วยใบหน้าย้ายจาก Azure Face (LargeFaceList) มาเป็นเวกเตอร์ SFace ที่เก็บในตารางเอง

-- DropIndex
DROP INDEX `PhotoFace_persistedFaceId_key` ON `PhotoFace`;

-- AlterTable
ALTER TABLE `Event` DROP COLUMN `faceListDirty`,
    DROP COLUMN `faceListId`;

-- AlterTable
ALTER TABLE `Photo` ADD COLUMN `facesIndexedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `PhotoFace` DROP COLUMN `persistedFaceId`,
    ADD COLUMN `embedding` BLOB NOT NULL,
    ADD COLUMN `score` DOUBLE NOT NULL;

