import { auditEntry } from "@/lib/audit";
import { getCurrentMembership } from "@/lib/data/membership";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type CsvExport = { filename: string; headers: string[]; rows: string[][] };

function text(value: unknown) {
  if (value === null || value === undefined) return "";
  return value instanceof Date ? value.toISOString() : String(value);
}

function csvCell(value: string) {
  const safe = /^[\t\r\n=+@]/.test(value) || /^-\D/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function vehicleLabel(vehicle: { year: number | null; make: string | null; model: string | null } | null) {
  return vehicle ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") : "";
}

async function createExport(exportType: string, shopId: string): Promise<CsvExport | null> {
  if (exportType === "customers") {
    const records = await prisma.customer.findMany({ where: { shopId }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { displayName: true, phone: true, email: true, city: true, state: true, createdAt: true, updatedAt: true } });
    return { filename: "customers.csv", headers: ["Name", "Phone", "Email", "City", "State", "Created At", "Updated At"], rows: records.map((row) => [row.displayName, text(row.phone), text(row.email), text(row.city), text(row.state), text(row.createdAt), text(row.updatedAt)]) };
  }
  if (exportType === "vehicles") {
    const records = await prisma.vehicle.findMany({ where: { shopId }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { year: true, make: true, model: true, licensePlate: true, vin: true, customer: { select: { displayName: true } } } });
    return { filename: "vehicles.csv", headers: ["Year", "Make", "Model", "License Plate", "VIN", "Customer"], rows: records.map((row) => [text(row.year), text(row.make), text(row.model), text(row.licensePlate), text(row.vin), row.customer.displayName]) };
  }
  if (exportType === "invoices") {
    const records = await prisma.invoice.findMany({ where: { shopId }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { repairOrderNumber: true, legacyRoNo: true, invoiceDate: true, subtotal: true, taxTotal: true, total: true, paidTotal: true, customer: { select: { displayName: true } }, vehicle: { select: { year: true, make: true, model: true } } } });
    return { filename: "invoices.csv", headers: ["RO / Invoice Number", "Date", "Customer", "Vehicle", "Subtotal", "Tax", "Total", "Paid", "Balance"], rows: records.map((row) => [text(row.repairOrderNumber ?? row.legacyRoNo), text(row.invoiceDate), row.customer.displayName, vehicleLabel(row.vehicle), text(row.subtotal), text(row.taxTotal), text(row.total), text(row.paidTotal), row.total.sub(row.paidTotal).toString()]) };
  }
  if (exportType === "accounts-receivable") {
    const records = await prisma.accountReceivable.findMany({ where: { shopId }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { legacyRoNo: true, balance: true, status: true, customer: { select: { displayName: true } }, invoice: { select: { repairOrderNumber: true, legacyRoNo: true, total: true, paidTotal: true } } } });
    return { filename: "accounts-receivable.csv", headers: ["RO / Invoice Number", "Customer", "Total", "Paid", "Balance", "Status"], rows: records.map((row) => [text(row.invoice?.repairOrderNumber ?? row.invoice?.legacyRoNo ?? row.legacyRoNo), row.customer.displayName, text(row.invoice?.total), text(row.invoice?.paidTotal), text(row.balance), row.status]) };
  }
  if (exportType === "repair-orders") {
    const records = await prisma.repairOrder.findMany({ where: { shopId }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { repairOrderNumber: true, legacyRoNo: true, status: true, partsTotal: true, laborTotal: true, taxTotal: true, estimatedTotal: true, customer: { select: { displayName: true } }, vehicle: { select: { year: true, make: true, model: true } } } });
    return { filename: "repair-orders.csv", headers: ["RO Number", "Status", "Customer", "Vehicle", "Parts Total", "Labor Total", "Tax", "Estimated Total"], rows: records.map((row) => [text(row.repairOrderNumber ?? row.legacyRoNo), row.status, row.customer.displayName, vehicleLabel(row.vehicle), text(row.partsTotal), text(row.laborTotal), text(row.taxTotal), text(row.estimatedTotal)]) };
  }
  return null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ exportType: string }> }) {
  const { user, membership } = await getCurrentMembership();
  if (!user || !membership) return new Response("Authentication required.", { status: 401 });
  if (!hasPermission(membership.role, "export_shop_data")) return new Response("Owner or administrator access is required.", { status: 403 });

  const { exportType } = await params;
  const result = await createExport(exportType, membership.shopId);
  if (!result) return new Response("Export type not found.", { status: 404 });

  await prisma.auditLog.create({ data: auditEntry(membership.shopId, user.id, "shop_data_exported", "shop", membership.shopId, { exportType, rowCount: result.rows.length }) });

  const encoder = new TextEncoder();
  const lines = [result.headers, ...result.rows];
  let index = 0;
  const stream = new ReadableStream({
    pull(controller) {
      const row = lines[index++];
      if (!row) return controller.close();
      controller.enqueue(encoder.encode(`${row.map((value) => csvCell(text(value))).join(",")}\r\n`));
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${result.filename}"`, "Cache-Control": "private, no-store" } });
}
