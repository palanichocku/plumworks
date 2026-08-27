export type DisplayField = Readonly<{
  label: string;
  value: string;
}>;

export type AssetContext = Readonly<{
  id: string;
  customerId: string;
  displayLabel: string;
  secondaryLabel: string | null;
  archived: boolean;
  details: readonly DisplayField[];
}>;
