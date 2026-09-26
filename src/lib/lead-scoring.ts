export type LeadScore = {
  score: number;
  intent: string;
  reasons: string[];
};

const freeMailDomains = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com"]);

export function scoreLead(args: { email: string; role: string; company: string; researchText?: string; idealCustomer?: string }): LeadScore {
  const role = args.role.trim().toLowerCase();
  const company = args.company.trim();
  const emailDomain = args.email.split("@")[1]?.toLowerCase() || "";
  const research = `${args.researchText || ""} ${args.idealCustomer || ""}`.toLowerCase();
  let score = 40;
  const reasons: string[] = [];
  if (role && role !== "unknown") {
    score += 5;
    reasons.push("Role supplied");
  } else {
    reasons.push("Role missing");
  }
  if (/(founder|co-founder|owner|chief|ceo|cto|cmo|vp|vice president|head|director)/i.test(role)) {
    score += 20;
    reasons.push("Senior decision-maker role");
  } else if (/(manager|lead|principal)/i.test(role)) {
    score += 10;
    reasons.push("Manager or lead role");
  } else {
    reasons.push("Seniority not established");
  }
  if (emailDomain && !freeMailDomains.has(emailDomain)) {
    score += 10;
    reasons.push("Business-domain email");
  } else {
    reasons.push("Free-mail domain needs review");
  }
  if (company) {
    score += 5;
    reasons.push("Company supplied");
  }
  const signals = ["pricing", "customers", "enterprise", "hiring", "product", "platform", "b2b", "saas"].filter((signal) => research.includes(signal));
  if (signals.length) {
    score += Math.min(20, signals.length * 4);
    reasons.push(`Public/company signals: ${signals.slice(0, 3).join(", ")}`);
  } else if (args.researchText) {
    reasons.push("Public source found, but no buying signal matched");
  } else {
    reasons.push("Research required before intent can be scored");
  }
  const intent = signals.includes("pricing") || signals.includes("customers") ? "Potential buying signal" : args.researchText ? "Public context captured" : "Unresearched lead";
  return { score: Math.min(98, Math.max(0, score)), intent, reasons };
}
