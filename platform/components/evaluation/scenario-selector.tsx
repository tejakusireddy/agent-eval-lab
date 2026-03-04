"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tooltip } from "@/components/ui/tooltip";
import { Info, Search, X } from "lucide-react";
import { useToast } from "@/components/ui/toast";

interface ScenarioSelectorProps {
  scenarios: any[];
  selectedScenarios: string[];
  onSelectionChange: (scenarios: string[]) => void;
}

interface ScenarioPreset {
  name: string;
  description: string;
  categories: string[];
  maxPerCategory?: number;
}

const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    name: "Minimal Safety Test",
    description: "A quick test covering basic prompt injection and jailbreak scenarios.",
    categories: ["prompt_injection", "jailbreak"],
    maxPerCategory: 2,
  },
  {
    name: "Full Safety Suite",
    description: "Comprehensive testing across all safety-critical categories.",
    categories: ["prompt_injection", "jailbreak", "pii", "tool_abuse", "toxicity", "exfil", "vision_attacks", "multi_turn", "scam_bait", "brand_safety", "economic_legal", "safety"],
  },
  {
    name: "PII-Only",
    description: "Focuses specifically on scenarios designed to leak Personally Identifiable Information.",
    categories: ["pii"],
  },
  {
    name: "Jailbreak-Only",
    description: "Targets various techniques to bypass agent safety mechanisms.",
    categories: ["jailbreak"],
  },
];

export function ScenarioSelector({
  scenarios,
  selectedScenarios,
  onSelectionChange,
}: ScenarioSelectorProps) {
  const { addToast } = useToast();
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    scenarios.forEach((s) => {
      const category = s.id.split(".")[0] || "other";
      cats.add(category);
    });
    return Array.from(cats).sort();
  }, [scenarios]);

  // Search suggestions (top 5 matching scenarios)
  const searchSuggestions = useMemo(() => {
    if (!search || search.length < 2) return [];
    
    const query = search.toLowerCase();
    const matches = scenarios
      .filter((scenario) => {
        const matchesName = scenario.name?.toLowerCase().includes(query);
        const matchesDescription = scenario.description?.toLowerCase().includes(query);
        const matchesId = scenario.id?.toLowerCase().includes(query);
        const matchesTags = scenario.tags?.some((tag: string) => tag.toLowerCase().includes(query));
        return matchesName || matchesDescription || matchesId || matchesTags;
      })
      .slice(0, 5);
    
    return matches;
  }, [scenarios, search]);

  const filteredScenarios = useMemo(() => {
    return scenarios.filter((scenario) => {
      const matchesSearch =
        !search ||
        scenario.name?.toLowerCase().includes(search.toLowerCase()) ||
        scenario.description?.toLowerCase().includes(search.toLowerCase()) ||
        scenario.id?.toLowerCase().includes(search.toLowerCase()) ||
        scenario.tags?.some((tag: string) => tag.toLowerCase().includes(search.toLowerCase()));

      const scenarioCategory = scenario.id.split(".")[0] || "other";
      const matchesCategory =
        !filterCategory || scenarioCategory === filterCategory;

      return matchesSearch && matchesCategory;
    });
  }, [scenarios, search, filterCategory]);

  const groupedScenarios = useMemo(() => {
    const grouped: Record<string, any[]> = {};
    filteredScenarios.forEach((scenario) => {
      const category = scenario.id.split(".")[0] || "other";
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(scenario);
    });
    return grouped;
  }, [filteredScenarios]);

  const toggleScenario = (scenarioId: string, e?: React.MouseEvent | React.ChangeEvent) => {
    if (e) {
      e.stopPropagation();
      if ('preventDefault' in e) {
        e.preventDefault();
      }
    }
    
    if (selectedScenarios.includes(scenarioId)) {
      onSelectionChange(selectedScenarios.filter((id) => id !== scenarioId));
    } else {
      if (selectedScenarios.length >= 20) {
        addToast({
          variant: "error",
          title: "Maximum Scenarios Reached",
          description: "You can select a maximum of 20 scenarios per evaluation.",
        });
        return;
      }
      onSelectionChange([...selectedScenarios, scenarioId]);
    }
  };

  const toggleCategory = (category: string, e?: React.MouseEvent | React.ChangeEvent) => {
    if (e) {
      e.stopPropagation();
    }
    
    const categoryScenarios = scenarios
      .filter((s) => s.id.startsWith(category + "."))
      .map((s) => s.id);

    const allSelected = categoryScenarios.every((id) =>
      selectedScenarios.includes(id)
    );

    if (allSelected) {
      onSelectionChange(
        selectedScenarios.filter((id) => !categoryScenarios.includes(id))
      );
    } else {
      const toAdd = categoryScenarios.filter((id) => !selectedScenarios.includes(id));
      const newTotal = selectedScenarios.length + toAdd.length;
      
      if (newTotal > 20) {
        const canAdd = 20 - selectedScenarios.length;
        if (canAdd > 0) {
          onSelectionChange([...selectedScenarios, ...toAdd.slice(0, canAdd)]);
          addToast({
            variant: "warning",
            title: "Selection Limited",
            description: `Only ${canAdd} more scenario(s) can be added (max 20).`,
          });
        } else {
          addToast({
            variant: "error",
            title: "Maximum Reached",
            description: "You can select a maximum of 20 scenarios per evaluation.",
          });
        }
        return;
      }
      
      onSelectionChange([
        ...selectedScenarios.filter((id) => !categoryScenarios.includes(id)),
        ...categoryScenarios,
      ]);
    }
  };

  const applyPreset = (preset: ScenarioPreset) => {
    const newSelection: string[] = [];
    scenarios.forEach((s) => {
      const category = s.id.split(".")[0];
      if (preset.categories.includes(category)) {
        if (preset.maxPerCategory) {
          const categoryScenarios = scenarios.filter((sc) => sc.id.startsWith(category + "."));
          const sorted = categoryScenarios.sort((a, b) => a.id.localeCompare(b.id));
          if (sorted.findIndex((sc) => sc.id === s.id) < preset.maxPerCategory) {
            newSelection.push(s.id);
          }
        } else {
          newSelection.push(s.id);
        }
      }
    });
    
    if (newSelection.length > 20) {
      onSelectionChange(newSelection.slice(0, 20));
      addToast({
        variant: "warning",
        title: "Preset Applied (Limited)",
        description: `Applied preset with ${20} scenarios (max limit).`,
      });
    } else {
      onSelectionChange(newSelection);
      addToast({
        variant: "success",
        title: "Preset Applied",
        description: `${preset.name} scenarios loaded.`,
      });
    }
  };

  const selectSuggestion = (scenarioId: string) => {
    toggleScenario(scenarioId);
    setSearch("");
    setShowSuggestions(false);
    searchInputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || searchSuggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((prev) => 
        prev < searchSuggestions.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === "Enter" && focusedIndex >= 0) {
      e.preventDefault();
      selectSuggestion(searchSuggestions[focusedIndex].id);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
      setFocusedIndex(-1);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-gray-700">Quick Presets</h3>
        <div className="flex flex-wrap gap-3">
          {SCENARIO_PRESETS.map((preset) => (
            <Card
              key={preset.name}
              className="w-full cursor-pointer transition-all hover:border-gray-400 md:w-auto shadow-sm"
              onClick={() => applyPreset(preset)}
            >
              <CardContent className="p-4">
                <div className="font-medium text-gray-900">{preset.name}</div>
                <p className="text-sm text-gray-500 mt-1">{preset.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            ref={searchInputRef}
            type="text"
            placeholder="Search scenarios by name, description, ID, or tags..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setShowSuggestions(true);
              setFocusedIndex(-1);
            }}
            onFocus={() => {
              if (searchSuggestions.length > 0) {
                setShowSuggestions(true);
              }
            }}
            onKeyDown={handleKeyDown}
            className="pl-10 pr-10"
          />
          {search && (
            <button
              onClick={() => {
                setSearch("");
                setShowSuggestions(false);
                searchInputRef.current?.focus();
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {showSuggestions && searchSuggestions.length > 0 && (
          <div
            ref={suggestionsRef}
            className="absolute z-50 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg max-h-60 overflow-auto"
          >
            {searchSuggestions.map((scenario, index) => (
              <div
                key={scenario.id}
                onClick={() => selectSuggestion(scenario.id)}
                onMouseEnter={() => setFocusedIndex(index)}
                className={`cursor-pointer px-4 py-3 transition-colors ${
                  index === focusedIndex
                    ? "bg-gray-100"
                    : "bg-white hover:bg-gray-50"
                } ${
                  index === 0 ? "rounded-t-md" : ""
                } ${
                  index === searchSuggestions.length - 1 ? "rounded-b-md" : "border-b border-gray-100"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 truncate">
                      {scenario.name}
                    </div>
                    <div className="text-xs text-gray-500 font-mono mt-0.5 truncate">
                      {scenario.id}
                    </div>
                    {scenario.description && (
                      <div className="text-sm text-gray-600 mt-1 line-clamp-2">
                        {scenario.description}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {selectedScenarios.includes(scenario.id) && (
                      <Badge variant="success" className="text-xs">
                        Selected
                      </Badge>
                    )}
                    <input
                      type="checkbox"
                      checked={selectedScenarios.includes(scenario.id)}
                      onChange={() => toggleScenario(scenario.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-500"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant={filterCategory === null ? "default" : "outline"}
          onClick={() => setFilterCategory(null)}
          size="sm"
        >
          All ({scenarios.length})
        </Button>
        {categories.map((cat) => (
          <Button
            key={cat}
            variant={filterCategory === cat ? "default" : "outline"}
            onClick={() => setFilterCategory(cat)}
            size="sm"
          >
            {cat.replace(/_/g, " ")} (
            {scenarios.filter((s) => s.id.startsWith(cat + ".")).length})
          </Button>
        ))}
      </div>

      <div className="max-h-[500px] space-y-4 overflow-y-auto rounded-lg border border-gray-200 p-4 shadow-sm">
        {Object.entries(groupedScenarios).length === 0 && (
          <div className="text-center text-gray-500 py-8">
            No scenarios match your search or filter.
          </div>
        )}
        <Accordion type="multiple" defaultValue={categories}>
          {Object.entries(groupedScenarios).map(([category, categoryScenarios]) => {
            const categorySelected = categoryScenarios.every((s) =>
              selectedScenarios.includes(s.id)
            );
            const categoryPartial =
              categoryScenarios.some((s) => selectedScenarios.includes(s.id)) &&
              !categorySelected;

            return (
              <AccordionItem key={category} value={category}>
                <AccordionTrigger className="hover:bg-gray-50">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={categorySelected}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleCategory(category, e);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-500"
                    />
                    <span className="font-semibold capitalize">
                      {category.replace(/_/g, " ")} ({categoryScenarios.length})
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="border-t border-gray-100 bg-gray-50 p-4">
                  <div className="space-y-3">
                    {categoryScenarios.map((scenario) => (
                      <div
                        key={scenario.id}
                        className="flex items-start gap-3 rounded-md border border-gray-200 bg-white p-3 shadow-sm transition-colors hover:border-gray-400"
                      >
                        <input
                          type="checkbox"
                          checked={selectedScenarios.includes(scenario.id)}
                          onChange={() => {
                            toggleScenario(scenario.id);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1 h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-500 cursor-pointer"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className="font-medium text-gray-900">
                              {scenario.name}
                            </div>
                            <Tooltip content={scenario.description || "No description available"}>
                              <Info className="h-3 w-3 text-gray-400 cursor-help" />
                            </Tooltip>
                            <Badge variant="outline" className="text-xs">
                              {scenario.attack_type?.replace(/_/g, " ")}
                            </Badge>
                          </div>
                          <div className="mt-1 text-sm text-gray-600">
                            {scenario.id}
                          </div>
                          <div className="mt-2 flex gap-2">
                            {scenario.tags?.map((tag: string) => (
                              <Badge
                                key={tag}
                                variant="secondary"
                                className="text-xs"
                              >
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-600">
              <strong>{selectedScenarios.length}</strong> scenario
              {selectedScenarios.length !== 1 ? "s" : ""} selected
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Estimated runtime: ~{Math.ceil(selectedScenarios.length * 2)} seconds
            </div>
          </div>
          {selectedScenarios.length >= 20 && (
            <Badge variant="warning" className="text-xs">
              Max 20 reached
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
