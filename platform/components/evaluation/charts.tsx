"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ReportPanel } from "@/components/ui/surface";
import { formatSeverityLabel, humanizeLabel } from "@/lib/formatting";

interface ChartsProps {
  scenarios: any[];
  summary: any;
}

const COLORS = {
  PASS: "#171311",
  FAIL_MINOR: "#C98E78",
  FAIL_CRITICAL: "#E3615A",
};

export function Charts({ scenarios, summary }: ChartsProps) {
  const severityData = [
    { name: "PASS", label: formatSeverityLabel("PASS"), value: summary.passed || 0, color: COLORS.PASS },
    {
      name: "FAIL_MINOR",
      label: formatSeverityLabel("FAIL_MINOR"),
      value: summary.failed_minor || 0,
      color: COLORS.FAIL_MINOR,
    },
    {
      name: "FAIL_CRITICAL",
      label: formatSeverityLabel("FAIL_CRITICAL"),
      value: summary.failed_critical || 0,
      color: COLORS.FAIL_CRITICAL,
    },
  ].filter((item) => item.value > 0);

  const attackTypeData = scenarios.reduce((acc: any, scenario: any) => {
    const attackType = scenario.tags?.[0] || "general";
    if (!acc[attackType]) {
      acc[attackType] = { total: 0, sum: 0 };
    }
    acc[attackType].total += 1;
    acc[attackType].sum += scenario.score || 0;
    return acc;
  }, {});

  const attackTypeChartData = Object.entries(attackTypeData)
    .map(([name, data]: [string, any]) => ({
      name: humanizeLabel(name),
      average: Number((data.sum / data.total).toFixed(1)),
      count: data.total,
    }))
    .sort((a, b) => b.average - a.average)
    .slice(0, 6);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ReportPanel
        title="Outcome distribution"
        description="High-level breakdown of passes and failures."
      >
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={severityData}
              cx="50%"
              cy="50%"
              innerRadius={56}
              outerRadius={86}
              paddingAngle={3}
              dataKey="value"
              label={({ percent, payload }) =>
                `${payload.label} ${Math.round(percent * 100)}%`
              }
              labelLine={false}
            >
              {severityData.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, _name, item: any) => [value, item?.payload?.label || "Result"]}
            />
          </PieChart>
        </ResponsiveContainer>
      </ReportPanel>

      <ReportPanel
        title="Average score by category"
        description="Top scenario categories by average score."
      >
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={attackTypeChartData} margin={{ top: 8, right: 12, left: -16, bottom: 8 }}>
            <CartesianGrid stroke="rgba(148, 163, 184, 0.15)" vertical={false} />
            <XAxis
              dataKey="name"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#64748b", fontSize: 11 }}
            />
            <YAxis
              domain={[0, 100]}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#64748b", fontSize: 11 }}
            />
            <Tooltip
              formatter={(value: number) => [`${value.toFixed(1)}%`, "Average score"]}
            />
            <Bar dataKey="average" radius={[10, 10, 0, 0]} fill="#E3615A" />
          </BarChart>
        </ResponsiveContainer>
      </ReportPanel>
    </div>
  );
}
