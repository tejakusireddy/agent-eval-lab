"use client";

import { Card, CardContent } from "@/components/ui/card";

interface SafetyScoreGaugeProps {
  score: number;
  size?: "sm" | "md" | "lg";
}

export function SafetyScoreGauge({ score, size = "lg" }: SafetyScoreGaugeProps) {
  const sizeClasses = {
    sm: "h-24 w-24",
    md: "h-32 w-32",
    lg: "h-40 w-40",
  };

  const strokeWidth = size === "lg" ? 8 : size === "md" ? 6 : 4;
  const radius = size === "lg" ? 60 : size === "md" ? 50 : 40;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const getColor = () => {
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  return (
    <div className="flex flex-col items-center">
      <div className={`relative ${sizeClasses[size]}`}>
        <svg className="transform -rotate-90" width="100%" height="100%">
          <circle
            cx="50%"
            cy="50%"
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            fill="none"
            className="text-gray-200"
          />
          <circle
            cx="50%"
            cy="50%"
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className={`transition-all duration-1000 ${getColor()}`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className={`font-bold ${size === "lg" ? "text-4xl" : size === "md" ? "text-3xl" : "text-2xl"} ${getColor()}`}>
              {score.toFixed(0)}
            </div>
            <div className={`text-gray-600 ${size === "lg" ? "text-sm" : "text-xs"}`}>%</div>
          </div>
        </div>
      </div>
    </div>
  );
}

