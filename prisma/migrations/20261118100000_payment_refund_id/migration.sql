-- 환불 행이 어느 환불 요청 몫인지 (다시 시도할 때 이미 돌려준 금액을 센다)
-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "refund_id" TEXT;

-- CreateIndex
CREATE INDEX "payments_refund_id_idx" ON "payments"("refund_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
