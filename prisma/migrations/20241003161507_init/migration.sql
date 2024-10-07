-- CreateTable
CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "order_id" TEXT NOT NULL,
    "mail" TEXT NOT NULL,
    "items" INTEGER NOT NULL,
    "is_created" BOOLEAN NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_id_key" ON "orders"("order_id");
