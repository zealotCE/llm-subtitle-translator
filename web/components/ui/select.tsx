import * as React from "react";

import { cn } from "@/lib/utils";

type OptionItem = { value: string; label: string; group?: string };

function toOptions(children: React.ReactNode): OptionItem[] {
  const items = React.Children.toArray(children);
  const options: OptionItem[] = [];
  items.forEach((child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === "option") {
      const option = child as React.ReactElement<{ value?: string; children?: React.ReactNode }>;
      const value = String(option.props.value ?? option.props.children ?? "");
      const label = typeof option.props.children === "string" ? option.props.children : value;
      options.push({ value, label });
      return;
    }
    if (child.type === "optgroup") {
      const group = child as React.ReactElement<{ label?: string; children?: React.ReactNode }>;
      const groupLabel = String(group.props.label ?? "");
      React.Children.forEach(group.props.children, (inner) => {
        if (!React.isValidElement(inner) || inner.type !== "option") return;
        const option = inner as React.ReactElement<{ value?: string; children?: React.ReactNode }>;
        const value = String(option.props.value ?? option.props.children ?? "");
        const label = typeof option.props.children === "string" ? option.props.children : value;
        options.push({ value, label, group: groupLabel });
      });
    }
  });
  return options;
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
            "flex h-10 w-full items-center justify-between rounded-full border border-border bg-white px-4 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 disabled:cursor-not-allowed disabled:opacity-60",
            className
          )}
        >
          <span className="truncate text-left">{selected?.label || ""}</span>
          <span className="ml-3 text-neutral-500">▾</span>
        </button>
        {open ? (
          <div className="absolute left-0 top-full z-40 mt-2 w-full rounded-2xl border border-neutral-200 bg-white p-1 text-sm shadow-lg">
            {options.map((opt, index) => {
              const prevGroup = index > 0 ? options[index - 1].group : undefined;
              const showGroup = opt.group && opt.group !== prevGroup;
              return (
                <div key={`${opt.group || "default"}-${opt.value}`}>
                  {showGroup ? (
                    <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                      {opt.group}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleSelect(opt.value)}
                    className={cn(
                      "w-full rounded-lg px-3 py-2 text-left hover:bg-neutral-100",
                      opt.value === String(value ?? "") ? "bg-neutral-100 text-neutral-900" : "text-neutral-600"
                    )}
                  >
                    {opt.label}
                  </button>
                </div>
              );
            })}
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
