-- CreateEnum
CREATE TYPE "ShopMembershipRole" AS ENUM ('OWNER', 'ADMIN', 'STAFF');

-- CreateTable
CREATE TABLE "shop_memberships" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "ShopMembershipRole" NOT NULL DEFAULT 'STAFF',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shop_memberships_user_id_idx" ON "shop_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "shop_memberships_shop_id_user_id_key" ON "shop_memberships"("shop_id", "user_id");

-- AddForeignKey
ALTER TABLE "shop_memberships" ADD CONSTRAINT "shop_memberships_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
