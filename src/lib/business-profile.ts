import { automotiveBusinessProfile } from "./verticals/automotive/business-profile.ts";

export type BusinessType = "AUTOMOTIVE";

export type ModuleRegistry = Readonly<{
  customers: boolean;
  assets: boolean;
  workOrders: boolean;
  invoices: boolean;
  payments: boolean;
  accountsReceivable: boolean;
  reports: boolean;
  leads: boolean;
  admin: boolean;
}>;

export type Terminology = Readonly<{
  businessWorkspace: string;
  assetSingular: string;
  assetPlural: string;
  workOrderSingular: string;
  workOrderPlural: string;
  workOrderAbbreviation: string;
  personnelSingular: string;
  partsLabel: string;
  laborLabel: string;
}>;

export type BusinessProfile = Readonly<{
  businessType: BusinessType;
  modules: ModuleRegistry;
  terminology: Terminology;
}>;

export function getBusinessProfile(): BusinessProfile {
  return automotiveBusinessProfile;
}
