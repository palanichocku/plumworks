"use client";

import { useState } from "react";
import { formatExistingCustomerPhone, formatPhoneInput } from "@/lib/customer-phone";

type CustomerPhoneInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "defaultValue" | "name" | "type" | "inputMode"> & {
  defaultValue?: string | null;
};

export function CustomerPhoneInput({ defaultValue = "", onChange, ...props }: CustomerPhoneInputProps) {
  const [value, setValue] = useState(() => formatExistingCustomerPhone(defaultValue ?? ""));

  return <input
    {...props}
    name="phone"
    type="tel"
    inputMode="tel"
    value={value}
    onChange={(event) => {
      const formatted = formatPhoneInput(event.target.value);
      setValue(formatted);
      event.target.value = formatted;
      onChange?.(event);
    }}
  />;
}
