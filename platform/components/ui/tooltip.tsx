"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface TooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  className?: string;
}

export function Tooltip({ children, content, className }: TooltipProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <div className="relative inline-block">
      <div
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        className="cursor-help"
      >
        {children}
      </div>
      {isOpen && (
        <div
          className={cn(
            "absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 rounded-md bg-gray-900 px-3 py-2 text-xs text-white shadow-lg",
            "max-w-xs",
            className
          )}
        >
          {content}
          <div className="absolute left-1/2 top-full -translate-x-1/2 -translate-y-1/2 rotate-45 border-4 border-gray-900" />
        </div>
      )}
    </div>
  );
}

