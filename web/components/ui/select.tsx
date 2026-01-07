import * as React from "react";

import { cn } from "@/lib/utils";

type OptionItem = { value: string; label: string };

function toOptions(children: React.ReactNode): OptionItem[] {
  const items = React.Children.toArray(children);
  return items
    .filter((child) => React.isValidElement(child) && child.type === "option")
    .map((child) => {
      const option = child as React.ReactElement<{ value?: string; children?: React.ReactNode }>;
      const value = String(option.props.value ?? option.props.children ?? "");
      const label = typeof option.props.children === "string" ? option.props.children : value;
      return { value, label };
    });
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  ({ className, value, onChange, children, disabled, ...props }, ref) => {
    const [open, setOpen] = React.useState(false);
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const options = React.useMemo(() => toOptions(children), [children]);
    const selected = options.find((opt) => opt.value === String(value ?? "")) || options[0];

    React.useEffect(() => {
      if (!open) return;
      const handler = (event: MouseEvent) => {
        if (!containerRef.current) return;
        if (!containerRef.current.contains(event.target as Node)) {
          setOpen(false);
        }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, [open]);

    const handleSelect = (nextValue: string) => {
      if (disabled) return;
      const event = { target: { value: nextValue } } as React.ChangeEvent<HTMLSelectElement>;
      onChange?.(event);
      setOpen(false);
    };

    return (
      <div ref={containerRef} className="relative w-full">
        <button
          ref={ref}
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setOpen((prev) => !prev)}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-xl border border-border bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 disabled:cursor-not-allowed disabled:opacity-60",
            className
          )}
        >
          <span className="truncate text-left">{selected?.label || ""}</span>
          <span className="ml-3 text-neutral-500">▾</span>
        </button>
        {open ? (
          <div className="absolute left-0 top-full z-40 mt-2 w-full rounded-xl border border-neutral-200 bg-white p-1 text-sm shadow-lg">
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSelect(opt.value)}
                className={cn(
                  "w-full rounded-lg px-3 py-2 text-left hover:bg-neutral-100",
                  opt.value === String(value ?? "") ? "bg-neutral-100 text-neutral-900" : "text-neutral-600"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        ) : null}
        <select
          value={value}
          onChange={onChange}
          disabled={disabled}
          className="hidden"
          {...props}
        >
          {children}
        </select>
      </div>
    );
  }
);
Select.displayName = "Select";

export { Select };
