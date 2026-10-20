import type { ReactNode } from "react";
import styles from "./invoice-redesign.module.css";

export default function InvoiceDetailLayout({ children }: { children: ReactNode }) {
  return <div className={styles.invoiceRedesign}>{children}</div>;
}
