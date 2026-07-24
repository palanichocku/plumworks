-- Add optional tenant-specific content used by customer-facing Invoice documents.
ALTER TABLE "shops"
  ADD COLUMN "invoice_parts_warranty_text" TEXT,
  ADD COLUMN "invoice_authorization_text" TEXT,
  ADD COLUMN "invoice_certification_text" TEXT,
  ADD COLUMN "repair_facility_registration_number" TEXT,
  ADD COLUMN "default_authorized_representative" TEXT,
  ADD COLUMN "default_invoice_technician_name" TEXT,
  ADD COLUMN "default_invoice_technician_license_number" TEXT;
