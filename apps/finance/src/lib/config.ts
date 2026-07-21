import "server-only";
import { prisma } from "./db";
import { profile as demo } from "./mockData";
import type { Bill, Goal, Paycheck } from "./types";

// The user's editable settings — the things Plaid can't know (goals, expected
// paychecks, the essentials floor). Persisted in the UserConfig singleton,
// seeded from the demo the first time so there's always something to edit.

export interface AppConfig {
  name: string;
  monthlyEssentials: number;
  goals: Goal[];
  paychecks: Paycheck[];
  bills: Bill[];
}

type JsonInput = object; // Prisma Json column accepts any serializable value

export async function getConfig(): Promise<AppConfig> {
  const existing = await prisma.userConfig.findUnique({ where: { id: "singleton" } });
  if (existing) {
    return {
      name: existing.name,
      monthlyEssentials: existing.monthlyEssentials,
      goals: (existing.goals as unknown as Goal[]) ?? [],
      paychecks: (existing.paychecks as unknown as Paycheck[]) ?? [],
      bills: (existing.bills as unknown as Bill[]) ?? [],
    };
  }
  // First run — seed from the demo so the editor isn't empty.
  await prisma.userConfig.create({
    data: {
      id: "singleton",
      name: demo.name,
      monthlyEssentials: demo.monthlyEssentials,
      goals: demo.goals as unknown as JsonInput,
      paychecks: demo.paychecks as unknown as JsonInput,
      bills: demo.bills as unknown as JsonInput,
    },
  });
  return {
    name: demo.name,
    monthlyEssentials: demo.monthlyEssentials,
    goals: demo.goals,
    paychecks: demo.paychecks,
    bills: demo.bills,
  };
}

export async function saveConfig(partial: Partial<AppConfig>): Promise<AppConfig> {
  const current = await getConfig();
  const merged: AppConfig = { ...current, ...partial };
  await prisma.userConfig.update({
    where: { id: "singleton" },
    data: {
      name: merged.name,
      monthlyEssentials: merged.monthlyEssentials,
      goals: merged.goals as unknown as JsonInput,
      paychecks: merged.paychecks as unknown as JsonInput,
      bills: merged.bills as unknown as JsonInput,
    },
  });
  return merged;
}
