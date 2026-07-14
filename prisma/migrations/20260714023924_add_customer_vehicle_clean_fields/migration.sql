-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "address_line1" TEXT,
ADD COLUMN     "address_line2" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "message" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "phone2" TEXT,
ADD COLUMN     "postal_code" TEXT,
ADD COLUMN     "state" TEXT;

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "engine" TEXT,
ADD COLUMN     "message" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "odometer" INTEGER;
