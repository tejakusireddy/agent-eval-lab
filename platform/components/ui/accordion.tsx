"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface AccordionContextValue {
  openItems: Set<string>;
  toggleItem: (value: string) => void;
}

const AccordionContext = React.createContext<AccordionContextValue | undefined>(undefined);

interface AccordionProps {
  children: React.ReactNode;
  type?: "single" | "multiple";
  defaultValue?: string | string[];
  className?: string;
}

export function Accordion({ children, type = "multiple", defaultValue = [], className }: AccordionProps) {
  const [openItems, setOpenItems] = React.useState<Set<string>>(
    new Set(Array.isArray(defaultValue) ? defaultValue : defaultValue ? [defaultValue] : [])
  );

  const toggleItem = React.useCallback((value: string) => {
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (type === "single") {
        next.clear();
        if (!prev.has(value)) {
          next.add(value);
        }
      } else {
        if (next.has(value)) {
          next.delete(value);
        } else {
          next.add(value);
        }
      }
      return next;
    });
  }, [type]);

  return (
    <AccordionContext.Provider value={{ openItems, toggleItem }}>
      <div className={cn("space-y-2", className)}>{children}</div>
    </AccordionContext.Provider>
  );
}

interface AccordionItemProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

const AccordionItemContext = React.createContext<{ value: string } | undefined>(undefined);

interface AccordionTriggerProps {
  children: React.ReactNode;
  className?: string;
}

export function AccordionTrigger({ children, className }: AccordionTriggerProps) {
  const context = React.useContext(AccordionContext);
  if (!context) throw new Error("AccordionTrigger must be used within Accordion");

  const itemContext = React.useContext(AccordionItemContext);
  if (!itemContext) throw new Error("AccordionTrigger must be used within AccordionItem");

  const isOpen = context.openItems.has(itemContext.value);

  return (
    <button
      type="button"
      onClick={() => context.toggleItem(itemContext.value)}
      className={cn(
        "flex w-full items-center justify-between p-4 text-left font-medium text-gray-900 transition-colors hover:bg-gray-50",
        className
      )}
    >
      {children}
      <ChevronDown
        className={cn("h-4 w-4 text-gray-500 transition-transform", isOpen && "rotate-180")}
      />
    </button>
  );
}

interface AccordionContentProps {
  children: React.ReactNode;
  className?: string;
}

export function AccordionContent({ children, className }: AccordionContentProps) {
  const context = React.useContext(AccordionContext);
  if (!context) throw new Error("AccordionContent must be used within Accordion");

  const itemContext = React.useContext(AccordionItemContext);
  if (!itemContext) throw new Error("AccordionContent must be used within AccordionItem");

  const isOpen = context.openItems.has(itemContext.value);

  if (!isOpen) return null;

  return <div className={cn("p-4 pt-0", className)}>{children}</div>;
}

// Update AccordionItem to provide context
function AccordionItemWithContext({ value, children, className }: AccordionItemProps) {
  return (
    <AccordionItemContext.Provider value={{ value }}>
      <div className={cn("border border-gray-200 rounded-lg", className)}>{children}</div>
    </AccordionItemContext.Provider>
  );
}

export { AccordionItemWithContext as AccordionItem };

