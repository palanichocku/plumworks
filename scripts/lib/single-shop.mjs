const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function resolveSingleShopId(prisma, explicitShopId = process.env.PLUMWORKS_SHOP_ID) {
  if (explicitShopId) {
    if (!UUID.test(explicitShopId)) throw new Error("The configured shop ID is not a valid UUID.");
    const count = await prisma.shop.count({ where: { id: explicitShopId } });
    if (count !== 1) throw new Error("The configured shop ID does not identify exactly one shop.");
    return explicitShopId;
  }

  const shops = await prisma.shop.findMany({ take: 2, select: { id: true } });
  if (shops.length !== 1) {
    throw new Error("Expected exactly one shop. Set PLUMWORKS_SHOP_ID when using a multi-shop maintenance database.");
  }
  return shops[0].id;
}
