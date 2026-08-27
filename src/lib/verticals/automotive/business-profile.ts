import type { BusinessProfile } from "../../business-profile.ts";

export const automotiveBusinessProfile = {
  businessType: "AUTOMOTIVE",
  modules: {
    customers: true,
    assets: true,
    workOrders: true,
    invoices: true,
    payments: true,
    accountsReceivable: true,
    reports: true,
    leads: true,
    admin: true,
  },
  terminology: {
    businessWorkspace: "Shop Workspace",
    assetSingular: "Vehicle",
    assetPlural: "Vehicles",
    workOrderSingular: "Repair Order",
    workOrderPlural: "Repair Orders",
    workOrderAbbreviation: "RO",
    personnelSingular: "Technician",
    partsLabel: "Parts",
    laborLabel: "Labor",
  },
} as const satisfies BusinessProfile;
