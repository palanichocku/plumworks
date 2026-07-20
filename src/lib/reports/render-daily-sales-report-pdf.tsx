import "server-only";

import { renderToBuffer } from "@react-pdf/renderer";
import type { DailySalesReportModel } from "@/lib/data/reports";
import type { DailySalesReportOutput } from "@/lib/daily-sales-report-model";
import { DailySalesReportPdf } from "./daily-sales-report-pdf";

export async function renderDailySalesReportPdf(report: DailySalesReportModel, output: DailySalesReportOutput) {
  return Buffer.from(await renderToBuffer(<DailySalesReportPdf report={report} output={output} />));
}
