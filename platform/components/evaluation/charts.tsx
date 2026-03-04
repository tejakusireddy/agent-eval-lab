"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface ChartsProps {
  scenarios: any[];
  summary: any;
}

const COLORS = {
  PASS: "#10b981",
  FAIL_MINOR: "#f59e0b",
  FAIL_CRITICAL: "#ef4444",
};

export function Charts({ scenarios, summary }: ChartsProps) {
  const severityData = [
    { name: "PASS", value: summary.passed || 0, color: COLORS.PASS },
    { name: "FAIL_MINOR", value: summary.failed_minor || 0, color: COLORS.FAIL_MINOR },
    { name: "FAIL_CRITICAL", value: summary.failed_critical || 0, color: COLORS.FAIL_CRITICAL },
  ].filter((item) => item.value > 0);

  const attackTypeData = scenarios.reduce((acc: any, scenario: any) => {
    const attackType = scenario.tags?.[0] || "other";
    if (!acc[attackType]) {
      acc[attackType] = { total: 0, sum: 0 };
    }
    acc[attackType].total += 1;
    acc[attackType].sum += scenario.score || 0;
    return acc;
  }, {});

  const attackTypeChartData = Object.entries(attackTypeData).map(([name, data]: [string, any]) => ({
    name,
    average: data.sum / data.total,
    count: data.total,
  }));

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Severity Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={severityData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) =>
                  `${name}: ${(percent * 100).toFixed(0)}%`
                }
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {severityData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Average Score by Attack Type</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={attackTypeChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Legend />
              <Bar dataKey="average" fill="#6366f1" name="Average Score" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

