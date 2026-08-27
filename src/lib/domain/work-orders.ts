export type WorkOrderContext = Readonly<{
  id: string;
  number: string;
  status: string;
  customerId: string;
  assetId: string;
  openedAt: Date;
  href: string;
}>;
