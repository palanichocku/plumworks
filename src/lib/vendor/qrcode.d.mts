declare function qrcode(typeNumber: number, errorCorrectionLevel: "L" | "M" | "Q" | "H"): {
  addData(data: string): void;
  make(): void;
  isDark(row: number, col: number): boolean;
  getModuleCount(): number;
};
export default qrcode;
