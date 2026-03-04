"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export function LoadingBar() {
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => setLoading(false), 300);
    return () => clearTimeout(timer);
  }, [pathname]);

  if (!loading) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-0.5 bg-gray-200">
      <div
        className="h-full bg-gray-900"
        style={{
          animation: loading ? "loading 1s ease-in-out infinite" : "none",
        }}
      />
    </div>
  );
}

