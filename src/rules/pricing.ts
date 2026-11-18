/**
 * 지금 적용되는 판매가. 할인가는 마감 시각 전(at < sale_ends_at)에만 쓴다.
 * 마감이 없는 할인가와 정가보다 싸지 않은 할인가는 할인으로 보지 않는다.
 */
export function effectivePrice(
  c: { price: number; sale_price: number | null; sale_ends_at: Date | null },
  at: Date,
): { unit: number; onSale: boolean } {
  const onSale =
    c.sale_price !== null &&
    c.sale_ends_at !== null &&
    c.sale_price < c.price &&
    at.getTime() < c.sale_ends_at.getTime();
  return onSale ? { unit: c.sale_price!, onSale: true } : { unit: c.price, onSale: false };
}
