import "server-only";

import { addActivity, createId, dealProbability, timestamp, type DealRecord, type DealStage, type WorkspaceState } from "@/lib/domain";
import { getWorkspace, updateWorkspace } from "@/lib/server-store";

export type CreateDealInput = {
  name: string;
  company: string;
  personId?: string | null;
  amount: number;
  currency?: string;
  stage?: DealStage;
  ownerEmployeeId?: string | null;
  source?: string;
  nextAction?: string;
  closeDate?: string | null;
  notes?: string;
};

export type UpdateDealInput = Partial<Pick<DealRecord, "amount" | "nextAction" | "closeDate" | "notes" | "ownerEmployeeId">> & {
  stage?: DealStage;
  stageNote?: string;
};

const stages: DealStage[] = ["lead", "qualified", "proposal", "won", "lost"];

function assertStage(stage: DealStage | undefined): DealStage {
  return stage && stages.includes(stage) ? stage : "lead";
}

function assertAmount(amount: number) {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Deal amount must be a non-negative number.");
  return amount;
}

export function createDealInState(state: WorkspaceState, input: CreateDealInput) {
  const name = input.name.trim();
  const company = input.company.trim();
  if (!name || !company) throw new Error("Deal name and company are required.");
  const amount = assertAmount(input.amount);
  const stage = assertStage(input.stage);
  const personId = input.personId?.trim() || null;
  const ownerEmployeeId = input.ownerEmployeeId?.trim() || null;
  if (personId && !state.people.some((person) => person.id === personId)) throw new Error("Person not found.");
  if (ownerEmployeeId && !state.employees.some((employee) => employee.id === ownerEmployeeId)) throw new Error("Owner employee not found.");
  const createdAt = timestamp();
  const deal: DealRecord = {
    id: createId("deal"),
    name,
    company,
    personId,
    amount,
    currency: (input.currency?.trim().toUpperCase().slice(0, 3) || "USD"),
    stage,
    probability: dealProbability(stage),
    ownerEmployeeId,
    source: input.source?.trim() || "manual",
    nextAction: input.nextAction?.trim() || "",
    closeDate: input.closeDate || null,
    notes: input.notes?.trim() || "",
    createdAt,
    updatedAt: createdAt,
    stageHistory: [{ stage, at: createdAt, note: "Deal created" }],
  };
  state.deals.unshift(deal);
  addActivity(state, { type: "lead", title: `${deal.name} entered the pipeline`, detail: `${deal.company} · ${deal.stage} · ${deal.amount.toLocaleString()} ${deal.currency}` });
  return deal;
}

export function updateDealInState(state: WorkspaceState, dealId: string, input: UpdateDealInput) {
  const deal = state.deals.find((candidate) => candidate.id === dealId);
  if (!deal) throw new Error("Deal not found.");
  if (input.stage && stages.includes(input.stage) && input.stage !== deal.stage) {
    deal.stage = input.stage;
    deal.probability = dealProbability(input.stage);
    deal.stageHistory = [...deal.stageHistory, { stage: input.stage, at: timestamp(), note: input.stageNote?.trim() || "Stage updated" }].slice(-30);
  }
  if (input.amount !== undefined) deal.amount = assertAmount(input.amount);
  if (input.nextAction !== undefined) deal.nextAction = input.nextAction.trim();
  if (input.closeDate !== undefined) deal.closeDate = input.closeDate || null;
  if (input.notes !== undefined) deal.notes = input.notes.trim();
  if (input.ownerEmployeeId !== undefined) {
    const ownerEmployeeId = input.ownerEmployeeId?.trim() || null;
    if (ownerEmployeeId && !state.employees.some((employee) => employee.id === ownerEmployeeId)) throw new Error("Owner employee not found.");
    deal.ownerEmployeeId = ownerEmployeeId;
  }
  deal.updatedAt = timestamp();
  addActivity(state, { type: "lead", title: `${deal.name} was updated`, detail: `${deal.company} · ${deal.stage} · next action ${deal.nextAction || "not set"}` });
  return deal;
}

export async function createWorkspaceDeal(args: { workspaceId: string; input: CreateDealInput }) {
  let deal!: DealRecord;
  const state = await updateWorkspace(args.workspaceId, (workspace) => {
    deal = createDealInState(workspace, args.input);
    return workspace;
  });
  return { state, deal };
}

export async function updateWorkspaceDeal(args: { workspaceId: string; dealId: string; input: UpdateDealInput }) {
  let deal!: DealRecord;
  const state = await updateWorkspace(args.workspaceId, (workspace) => {
    deal = updateDealInState(workspace, args.dealId, args.input);
    return workspace;
  });
  return { state, deal };
}

export async function getWorkspaceDeals(workspaceId: string) {
  return (await getWorkspace(workspaceId)).deals;
}
